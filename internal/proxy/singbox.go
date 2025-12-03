package proxy

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	singboxDir        = "tmp/singbox"
	singboxSubEnv     = "PROXY_SINGBOX_SUB_URLS"
	singboxCacheFile  = "tmp/singbox/outbounds.json"
	singboxConfigFile = "tmp/singbox/config.json"
	singboxPenalty    = "tmp/singbox_penalty.txt"
	singboxBinName    = "sing-box"
	singboxVersion    = "1.10.6"
	singboxBasePort   = 17880
)

var penaltyMu sync.Mutex

// StartSingBox 启动 sing-box，多订阅合并缓存，按节点生成独立端口并返回可用代理列表。
// 如未配置订阅，返回空列表并不报错。
func StartSingBox(ctx context.Context) ([]Endpoint, func(), error) {
	urls := MergeEnvAndSaved(os.Getenv(singboxSubEnv))
	if len(urls) == 0 {
		return nil, func() {}, nil
	}

	if err := os.MkdirAll(singboxDir, 0o755); err != nil {
		return nil, func() {}, fmt.Errorf("make sing-box dir: %w", err)
	}

	outbounds, err := loadOrFetchOutbounds(ctx, urls)
	if err != nil {
		return nil, func() {}, fmt.Errorf("load subscriptions: %w", err)
	}

	cfg, endpoints := buildConfig(outbounds)
	if len(endpoints) == 0 {
		return nil, func() {}, errors.New("订阅未提供可用节点(outbounds)")
	}
	if err := writeJSONFile(singboxConfigFile, cfg); err != nil {
		return nil, func() {}, fmt.Errorf("write config: %w", err)
	}

	bin, err := ensureSingBoxBinary(ctx)
	if err != nil {
		return nil, func() {}, fmt.Errorf("ensure binary: %w", err)
	}

	cmd := exec.CommandContext(ctx, bin, "run", "-c", singboxConfigFile, "--disable-color")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return nil, func() {}, fmt.Errorf("start sing-box: %w", err)
	}

	stop := func() {
		_ = cmd.Process.Kill()
	}

	if len(endpoints) > 0 {
		firstPort := extractPort(endpoints[0].URL)
		_ = waitPortReady(ctx, "127.0.0.1", firstPort, 10*time.Second)
	}

	return filterPenalized(endpoints), stop, nil
}

// WarmupSingBox 预先拉取订阅并下载二进制，但不启动进程。
func WarmupSingBox(ctx context.Context) error {
	urls := MergeEnvAndSaved(os.Getenv(singboxSubEnv))
	if len(urls) == 0 {
		return nil
	}
	if err := os.MkdirAll(singboxDir, 0o755); err != nil {
		return err
	}
	if _, err := loadOrFetchOutbounds(ctx, urls); err != nil {
		return err
	}
	_, err := ensureSingBoxBinary(ctx)
	return err
}

// FreezeEndpoint 在成功或失败后冻结该节点 15 分钟。
func FreezeEndpoint(tag string) error {
	tag = strings.TrimSpace(tag)
	if tag == "" {
		return nil
	}
	penaltyMu.Lock()
	defer penaltyMu.Unlock()
	if err := savePenalty(singboxPenalty, tag, 15*time.Minute); err != nil {
		return err
	}
	fmt.Printf("⏳ 节点 %s 冻结 15 分钟\n", tag)
	return nil
}

func loadOrFetchOutbounds(ctx context.Context, urls []string) ([]map[string]any, error) {
	if data, err := os.ReadFile(singboxCacheFile); err == nil {
		var out []map[string]any
		if err := json.Unmarshal(data, &out); err == nil {
			if hasRealOutbounds(out) {
				fmt.Printf("🧭 使用 sing-box 缓存，节点数：%d\n", len(out))
				return out, nil
			}
			fmt.Println("ℹ️ 缓存不包含可用节点，重新拉取订阅")
		}
	}

	fmt.Println("🧭 获取 sing-box 订阅中…")
	seen := map[string]int{}
	var merged []map[string]any
	for idx, u := range urls {
		items, err := fetchSubscription(ctx, u)
		if err != nil {
			return nil, fmt.Errorf("fetch %s: %w", u, err)
		}
		prefix := fmt.Sprintf("sub%d-", idx+1)
		merged = append(merged, normalizeOutbounds(items, prefix, seen)...)
	}
	if len(merged) == 0 {
		return nil, errors.New("订阅未返回任何 outbounds")
	}
	if err := writeJSONFile(singboxCacheFile, merged); err != nil {
		return nil, err
	}
	return merged, nil
}

func fetchSubscription(ctx context.Context, url string) ([]map[string]any, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	content := bytes.TrimSpace(data)
	if len(content) == 0 {
		return nil, errors.New("订阅响应为空")
	}
	jsonBytes := content
	if !json.Valid(content) {
		if dec, err := base64.StdEncoding.DecodeString(string(content)); err == nil && json.Valid(dec) {
			jsonBytes = dec
		}
	}
	var cfg map[string]any
	if err := json.Unmarshal(jsonBytes, &cfg); err != nil {
		return nil, fmt.Errorf("解析订阅 JSON 失败: %w", err)
	}
	outboundsAny, ok := cfg["outbounds"].([]any)
	if !ok {
		return nil, errors.New("订阅缺少 outbounds")
	}
	var out []map[string]any
	for _, item := range outboundsAny {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		t, _ := m["type"].(string)
		if !isRealOutboundType(t) {
			continue
		}
		out = append(out, m)
	}
	return out, nil
}

func normalizeOutbounds(items []map[string]any, prefix string, seen map[string]int) []map[string]any {
	var out []map[string]any
	for i, ob := range items {
		tag, _ := ob["tag"].(string)
		origTag := strings.TrimSpace(tag)
		if origTag == "" {
			origTag = fmt.Sprintf("node-%d", i+1)
		}
		if shouldExcludeTag(origTag) {
			fmt.Printf("⏭️ 跳过节点 %s (命中黑名单关键词)\n", origTag)
			continue
		}
		tag = prefix + origTag
		if n, ok := seen[tag]; ok {
			n++
			seen[tag] = n
			tag = fmt.Sprintf("%s-%d", tag, n)
		} else {
			seen[tag] = 1
		}
		ob["tag"] = tag
		out = append(out, ob)
	}
	return out
}

func shouldExcludeTag(tag string) bool {
	blacklist := []string{
		"自动选择",
		"故障转移",
		"套餐到期",
		"剩余流量",
		"文档下载",
		"订阅更多节点",
	}
	for _, kw := range blacklist {
		if strings.Contains(tag, kw) {
			return true
		}
	}
	return false
}

func buildConfig(outbounds []map[string]any) (map[string]any, []Endpoint) {
	inbounds := make([]any, 0, len(outbounds))
	rules := make([]any, 0, len(outbounds))
	endpoints := make([]Endpoint, 0, len(outbounds))

	for i, ob := range outbounds {
		tag, _ := ob["tag"].(string)
		if tag == "" {
			tag = fmt.Sprintf("node-%d", i+1)
			ob["tag"] = tag
		}
		port := singboxBasePort + i
		inTag := fmt.Sprintf("in-%d", i+1)
		inbounds = append(inbounds, map[string]any{
			"type":        "socks",
			"tag":         inTag,
			"listen":      "127.0.0.1",
			"listen_port": port,
		})
		rules = append(rules, map[string]any{
			"inbound":  []string{inTag},
			"outbound": tag,
		})
		endpoints = append(endpoints, Endpoint{Tag: tag, URL: fmt.Sprintf("socks5://127.0.0.1:%d", port)})
	}

	outWithDefaults := append([]map[string]any{}, outbounds...)
	hasDirect, hasBlock := false, false
	for _, ob := range outWithDefaults {
		if t, _ := ob["type"].(string); t == "direct" {
			hasDirect = true
		}
		if t, _ := ob["type"].(string); t == "block" {
			hasBlock = true
		}
	}
	if !hasDirect {
		outWithDefaults = append(outWithDefaults, map[string]any{"type": "direct", "tag": "direct"})
	}
	if !hasBlock {
		outWithDefaults = append(outWithDefaults, map[string]any{"type": "block", "tag": "block"})
	}

	cfg := map[string]any{
		"log":       map[string]any{"level": "error"},
		"inbounds":  inbounds,
		"outbounds": outWithDefaults,
		"route": map[string]any{
			"rules": rules,
			"final": "direct",
		},
	}
	return cfg, endpoints
}

func writeJSONFile(path string, v any) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

// ------------------ penalty helpers ------------------

func savePenalty(path, tag string, dur time.Duration) error {
	penalties, err := readPenaltiesFile(path)
	if err != nil {
		return err
	}
	penalties[tag] = time.Now().Add(dur)
	return writePenaltiesFile(path, penalties)
}

func readPenaltiesFile(path string) (map[string]time.Time, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]time.Time{}, nil
		}
		return nil, err
	}
	penalties := make(map[string]time.Time)
	lines := strings.Split(string(data), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, ",", 2)
		if len(parts) != 2 {
			continue
		}
		if ts, err := strconv.ParseInt(strings.TrimSpace(parts[1]), 10, 64); err == nil {
			penalties[strings.TrimSpace(parts[0])] = time.Unix(ts, 0)
		}
	}
	return penalties, nil
}

func writePenaltiesFile(path string, penalties map[string]time.Time) error {
	if len(penalties) == 0 {
		_ = os.Remove(path)
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	var lines []string
	for k, v := range penalties {
		lines = append(lines, fmt.Sprintf("%s,%d", k, v.Unix()))
	}
	sort.Strings(lines)
	return os.WriteFile(path, []byte(strings.Join(lines, "\n")), 0o644)
}

func filterPenalized(endpoints []Endpoint) []Endpoint {
	penalties, _ := readPenaltiesFile(singboxPenalty)
	now := time.Now()
	var out []Endpoint
	for _, ep := range endpoints {
		if exp, ok := penalties[ep.Tag]; ok && now.Before(exp) {
			continue
		}
		out = append(out, ep)
	}
	return out
}

func hasRealOutbounds(items []map[string]any) bool {
	for _, ob := range items {
		if t, _ := ob["type"].(string); isRealOutboundType(t) {
			return true
		}
	}
	return false
}

func isRealOutboundType(t string) bool {
	t = strings.ToLower(strings.TrimSpace(t))
	switch t {
	case "selector", "urltest", "dns", "direct", "block", "tun", "mixed":
		return false
	default:
		return t != ""
	}
}

// ------------------ binary handling ------------------

func ensureSingBoxBinary(ctx context.Context) (string, error) {
	bin := singboxBinName
	if runtime.GOOS == "windows" {
		bin += ".exe"
	}
	target := filepath.Join(singboxDir, bin)
	if _, err := os.Stat(target); err == nil {
		return target, nil
	}

	url, err := pickSingBoxURL()
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept-Encoding", "identity")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	if err := extractSingBox(data, filepath.Ext(url), bin, target); err != nil {
		return "", err
	}
	return target, nil
}

func pickSingBoxURL() (string, error) {
	var asset string
	switch runtime.GOOS {
	case "windows":
		asset = fmt.Sprintf("sing-box-%s-windows-amd64.zip", singboxVersion)
	case "darwin":
		if runtime.GOARCH == "arm64" {
			asset = fmt.Sprintf("sing-box-%s-darwin-arm64.tar.gz", singboxVersion)
		} else {
			asset = fmt.Sprintf("sing-box-%s-darwin-amd64.tar.gz", singboxVersion)
		}
	case "linux":
		asset = fmt.Sprintf("sing-box-%s-linux-amd64.tar.gz", singboxVersion)
	default:
		return "", fmt.Errorf("sing-box auto-download unsupported on %s/%s", runtime.GOOS, runtime.GOARCH)
	}
	return "https://github.com/SagerNet/sing-box/releases/download/v" + singboxVersion + "/" + asset, nil
}

func extractSingBox(data []byte, ext, bin, target string) error {
	if ext == ".zip" {
		if err := extractZip(bytes.NewReader(data), int64(len(data)), bin, target); err == nil {
			return nil
		}
	}
	if ext == ".gz" {
		gz, err := gzip.NewReader(bytes.NewReader(data))
		if err != nil {
			return err
		}
		defer gz.Close()
		buf, err := io.ReadAll(gz)
		if err != nil {
			return err
		}
		if err := extractTar(buf, bin, target); err == nil {
			return nil
		}
	}
	if err := extractZip(bytes.NewReader(data), int64(len(data)), bin, target); err == nil {
		return nil
	}
	return errors.New("unsupported archive format or missing sing-box binary")
}

func extractTar(data []byte, bin, target string) error {
	gr := bytes.NewReader(data)
	tr := tar.NewReader(gr)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		if filepath.Base(hdr.Name) == bin {
			f, err := os.Create(target)
			if err != nil {
				return err
			}
			if _, err := io.Copy(f, tr); err != nil {
				f.Close()
				return err
			}
			f.Close()
			return os.Chmod(target, 0o755)
		}
	}
	return errors.New("sing-box binary not found in tar")
}

// reuse helpers from mihomo.go but keep local copy to avoid dependency order
func extractZip(r io.ReaderAt, size int64, bin, target string) error {
	zr, err := zip.NewReader(r, size)
	if err != nil {
		return err
	}
	var fallback *zip.File
	for _, f := range zr.File {
		base := filepath.Base(f.Name)
		if fallback == nil && strings.HasSuffix(strings.ToLower(base), ".exe") {
			fallback = f
		}
		if base == bin {
			return writeZipFile(f, target)
		}
	}
	if fallback != nil {
		return writeZipFile(fallback, target)
	}
	return errors.New("sing-box binary not found in archive")
}

func writeZipFile(f *zip.File, target string) error {
	rc, err := f.Open()
	if err != nil {
		return err
	}
	defer rc.Close()
	out, err := os.Create(target)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, rc); err != nil {
		out.Close()
		return err
	}
	out.Close()
	return os.Chmod(target, 0o755)
}

func waitPortReady(ctx context.Context, host string, port int, timeout time.Duration) error {
	if port == 0 {
		return nil
	}
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", host, port), time.Second)
		if err == nil {
			_ = conn.Close()
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(300 * time.Millisecond):
		}
	}
	return fmt.Errorf("port %d not ready", port)
}

func extractPort(url string) int {
	parts := strings.Split(url, ":")
	if len(parts) == 0 {
		return 0
	}
	last := parts[len(parts)-1]
	if n, err := strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(last, "//"))); err == nil {
		return n
	}
	return 0
}
