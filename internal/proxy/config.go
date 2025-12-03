package proxy

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const singboxSubsFile = "tmp/singbox/subscriptions.json"

// loadSavedSubs returns subscription URLs stored on disk (editable by API).
func LoadStoredSubs() []string {
	data, err := os.ReadFile(singboxSubsFile)
	if err != nil {
		return nil
	}
	var subs []string
	if err := json.Unmarshal(data, &subs); err != nil {
		return nil
	}
	return subs
}

func SaveSubs(subs []string) error {
	if err := os.MkdirAll(filepath.Dir(singboxSubsFile), 0o755); err != nil {
		return fmt.Errorf("make subs dir: %w", err)
	}
	data, err := json.MarshalIndent(subs, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal subs: %w", err)
	}
	if err := os.WriteFile(singboxSubsFile, data, 0o644); err != nil {
		return err
	}
	// 删除 outbounds 缓存，确保下次启动 sing-box 时重新拉取新订阅
	_ = os.Remove(singboxCacheFile)
	return nil
}

// ParseEnvSubs splits a comma-separated env value into URLs.
func ParseEnvSubs(envVal string) []string {
	parts := strings.Split(envVal, ",")
	var out []string
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// MergeEnvAndSaved combines env-provided URLs and saved URLs with de-duplication.
func MergeEnvAndSaved(envVal string) []string {
	seen := map[string]bool{}
	var out []string
	add := func(u string) {
		u = strings.TrimSpace(u)
		if u == "" || seen[u] {
			return
		}
		seen[u] = true
		out = append(out, u)
	}
	for _, p := range ParseEnvSubs(envVal) {
		add(p)
	}
	for _, p := range LoadStoredSubs() {
		add(p)
	}
	return out
}
