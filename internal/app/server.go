package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"vertex-nano-banana-unlimited/internal/imageprocessing"
	"vertex-nano-banana-unlimited/internal/proxy"
)

var (
	activeRunCancel   context.CancelFunc
	activeRunToken    int64
	activeRunCancelMu sync.Mutex
)

const maxUploadBytes int64 = 7 * 1024 * 1024

// corsMiddleware 添加CORS头部，允许所有来源
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 设置CORS头部，允许所有来源
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
		w.Header().Set("Access-Control-Max-Age", "86400") // 24小时

		// 处理预检请求
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// corsMiddlewareForFunc 为函数类型的处理器添加CORS支持
func corsMiddlewareForFunc(handler func(http.ResponseWriter, *http.Request)) http.Handler {
	return corsMiddleware(http.HandlerFunc(handler))
}

func StartHTTPServer(ctx context.Context, addr string) error {
	mux := http.NewServeMux()
	mux.Handle("/", corsMiddleware(http.FileServer(http.Dir("."))))
	mux.Handle("/healthz", corsMiddlewareForFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}))
	mux.Handle("/cancel", corsMiddlewareForFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "only POST allowed"})
			return
		}
		if cancelled := cancelActiveRun(); cancelled {
			writeJSON(w, http.StatusOK, map[string]string{"status": "cancelled"})
		} else {
			writeJSON(w, http.StatusOK, map[string]string{"status": "idle"})
		}
	}))
	mux.Handle("/run", corsMiddlewareForFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "only POST allowed"})
			return
		}
		ct := r.Header.Get("Content-Type")
		if strings.HasPrefix(ct, "multipart/form-data") {
			handleMultipartRun(w, r)
		} else {
			handleJSONRun(w, r)
		}
	}))
	mux.Handle("/gallery", corsMiddlewareForFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "only GET allowed"})
			return
		}
		handleGallery(w, r)
	}))
	mux.Handle("/gallery/files", corsMiddlewareForFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "only GET allowed"})
			return
		}
		handleGalleryFiles(w, r)
	}))
	mux.Handle("/proxy/subscriptions", corsMiddlewareForFunc(handleProxySubscriptions))

	srv := &http.Server{
		Addr:    addr,
		Handler: corsMiddleware(mux),
	}

	go func() {
		<-ctx.Done()
		_ = srv.Shutdown(context.Background())
	}()

	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func cancelActiveRun() bool {
	activeRunCancelMu.Lock()
	defer activeRunCancelMu.Unlock()
	if activeRunCancel != nil {
		activeRunCancel()
		activeRunCancel = nil
		return true
	}
	return false
}

func runWithExclusive(ctx context.Context, opts RunOptions) ([]ScenarioResult, error) {
	activeRunCancelMu.Lock()
	if activeRunCancel != nil {
		activeRunCancel()
	}
	activeRunToken++
	token := activeRunToken
	cctx, cancel := context.WithCancel(ctx)
	activeRunCancel = cancel
	activeRunCancelMu.Unlock()

	results, err := RunWithOptions(cctx, opts)

	activeRunCancelMu.Lock()
	if activeRunToken == token {
		activeRunCancel = nil
	}
	activeRunCancelMu.Unlock()
	return results, err
}

func prepareImageForRun(srcPath string) (string, error) {
	info, err := os.Stat(srcPath)
	if err != nil {
		return "", err
	}
	ext := strings.ToLower(filepath.Ext(srcPath))
	if !shouldProcessImage(info, ext) {
		return srcPath, nil
	}

	data, err := os.ReadFile(srcPath)
	if err != nil {
		return "", fmt.Errorf("read image: %w", err)
	}

	opts := imageprocessing.DefaultProcessImageOptions()
	opts.OutputFormat = "png"
	opts.MaxSizeBytes = maxUploadBytes

	processed, outExt, err := imageprocessing.ProcessImage(data, opts)
	if err != nil {
		return "", fmt.Errorf("process image: %w", err)
	}

	tmpFile, err := os.CreateTemp("", "upload-processed-*"+outExt)
	if err != nil {
		return "", fmt.Errorf("create processed temp: %w", err)
	}
	if err := os.WriteFile(tmpFile.Name(), processed, 0o644); err != nil {
		return "", fmt.Errorf("write processed: %w", err)
	}
	return tmpFile.Name(), nil
}

func shouldProcessImage(info fs.FileInfo, ext string) bool {
	if info == nil {
		return true
	}
	if strings.ToLower(ext) != ".png" {
		return true
	}
	return info.Size() > maxUploadBytes
}

func handleJSONRun(w http.ResponseWriter, r *http.Request) {
	cancelActiveRun()
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("read body: %v", err)})
		return
	}
	var req struct {
		Image         string  `json:"image"`
		Prompt        string  `json:"prompt"`
		ScenarioCount int     `json:"scenarioCount"`
		Resolution    string  `json:"resolution"`
		Temperature   float64 `json:"temperature"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("invalid json: %v", err)})
		return
	}
	req.Prompt = strings.TrimSpace(req.Prompt)
	req.Image = strings.TrimSpace(req.Image)
	req.Resolution = strings.TrimSpace(req.Resolution)
	if req.Prompt == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "prompt 不能为空"})
		return
	}
	// 只有当image不为空时才检查文件存在性
	if req.Image != "" {
		if _, err := os.Stat(req.Image); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("image 不可用: %v", err)})
			return
		}
	}

	opts := DefaultRunOptions()
	var processedPath string

	// 只有当image不为空时才处理图片
	if req.Image != "" {
		var err error
		processedPath, err = prepareImageForRun(req.Image)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("处理图片失败: %v", err)})
			return
		}
		opts.ImagePath = processedPath
	} else {
		// image为空时，ImagePath保持为空字符串
		opts.ImagePath = ""
	}
	opts.PromptText = req.Prompt
	if req.Resolution != "" {
		opts.OutputRes = req.Resolution
	}
	if req.ScenarioCount > 0 {
		opts.ScenarioCount = req.ScenarioCount
	} else {
		opts.ScenarioCount = 1
	}

	// 设置温度，如果前端没有传递则使用默认值
	if req.Temperature > 0 {
		opts.Temperature = req.Temperature
	}

	fmt.Printf("▶️ /run (json) image=%s processed=%s scenario=%d res=%s temp=%.1f promptLen=%d\n", req.Image, processedPath, opts.ScenarioCount, opts.OutputRes, opts.Temperature, len(opts.PromptText))
	results, runErr := runWithExclusive(r.Context(), opts)
	if runErr != nil {
		status := http.StatusInternalServerError
		msg := runErr.Error()
		if errors.Is(runErr, context.Canceled) {
			status = http.StatusConflict
			msg = "cancelled"
		}
		fmt.Printf("⚠️ /run (json) end err=%v\n", runErr)
		writeJSON(w, status, map[string]any{
			"error":   msg,
			"results": results,
		})
		return
	}
	fmt.Printf("✅ /run (json) done scenario=%d res=%s results=%d\n", opts.ScenarioCount, opts.OutputRes, len(results))
	writeJSON(w, http.StatusOK, map[string]any{
		"status":        "ok",
		"imageUsed":     processedPath,
		"imageOrig":     req.Image,
		"scenarioCount": opts.ScenarioCount,
		"results":       results,
	})
}

func handleMultipartRun(w http.ResponseWriter, r *http.Request) {
	cancelActiveRun()
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("parse form: %v", err)})
		return
	}
	prompt := strings.TrimSpace(r.FormValue("prompt"))
	scenarioCount := 1
	if scStr := strings.TrimSpace(r.FormValue("scenarioCount")); scStr != "" {
		if n, err := strconv.Atoi(scStr); err == nil && n > 0 {
			scenarioCount = n
		}
	}
	resolution := strings.TrimSpace(r.FormValue("resolution"))
	temperature := 0.0
	if tempStr := strings.TrimSpace(r.FormValue("temperature")); tempStr != "" {
		if t, err := strconv.ParseFloat(tempStr, 64); err == nil && t >= 0 && t <= 2 {
			temperature = t
		}
	}
	var tmpFile *os.File
	var header *multipart.FileHeader
	var processedPath string

	file, header, err := r.FormFile("image")
	if err != nil {
		if err != http.ErrMissingFile {
			// 真正的错误，不是文件缺失
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("读取 image 文件字段失败: %v", err)})
			return
		}
		// 没有上传文件是允许的
		processedPath = ""
	} else {
		defer file.Close()

		tmpFile, err = os.CreateTemp("", "upload-*"+filepath.Ext(header.Filename))
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("create temp: %v", err)})
			return
		}
		defer os.Remove(tmpFile.Name())
		if _, err := io.Copy(tmpFile, file); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("save temp: %v", err)})
			return
		}
		processedPath = tmpFile.Name()
	}

	if prompt == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "prompt 不能为空"})
		return
	}

	opts := DefaultRunOptions()
	var finalProcessPath string

	// 只有当有上传文件时才处理图片
	if processedPath != "" {
		var err error
		finalProcessPath, err = prepareImageForRun(processedPath)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("处理图片失败: %v", err)})
			return
		}
		opts.ImagePath = finalProcessPath
	} else {
		opts.ImagePath = ""
	}
	opts.PromptText = prompt
	opts.ScenarioCount = scenarioCount
	if resolution != "" {
		opts.OutputRes = resolution
	}
	// 设置温度，如果前端没有传递则使用默认值
	if temperature > 0 {
		opts.Temperature = temperature
	}

	var filename string
	if header != nil {
		filename = header.Filename
	}
	fmt.Printf("▶️ /run (multipart) file=%s processed=%s scenario=%d res=%s temp=%.1f promptLen=%d\n", filename, finalProcessPath, opts.ScenarioCount, opts.OutputRes, opts.Temperature, len(opts.PromptText))
	results, runErr := runWithExclusive(r.Context(), opts)
	if runErr != nil {
		status := http.StatusInternalServerError
		msg := runErr.Error()
		if errors.Is(runErr, context.Canceled) {
			status = http.StatusConflict
			msg = "cancelled"
		}
		fmt.Printf("⚠️ /run (multipart) end err=%v\n", runErr)
		writeJSON(w, status, map[string]any{
			"error":   msg,
			"results": results,
		})
		return
	}
	fmt.Printf("✅ /run (multipart) done scenario=%d res=%s results=%d\n", opts.ScenarioCount, opts.OutputRes, len(results))
	writeJSON(w, http.StatusOK, map[string]any{
		"status":        "ok",
		"imageUsed":     finalProcessPath,
		"imageOrig":     filename,
		"scenarioCount": opts.ScenarioCount,
		"results":       results,
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func handleGallery(w http.ResponseWriter, r *http.Request) {
	dir := DefaultRunOptions().DownloadDir
	folders, total, err := listGalleryFolders(dir)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("list gallery: %v", err)})
		return
	}
	fmt.Printf("ℹ️ /gallery folders=%d files=%d dir=%s\n", len(folders), total, dir)
	writeJSON(w, http.StatusOK, map[string]any{
		"dir":     dir,
		"count":   total,
		"folders": folders,
	})
}

type galleryFile struct {
	Name    string    `json:"name"`
	URL     string    `json:"url"`
	Size    int64     `json:"size"`
	ModTime time.Time `json:"modTime"`
}

type galleryGroup struct {
	Name   string        `json:"name"`
	Count  int           `json:"count"`
	Files  []galleryFile `json:"files"`
	Latest time.Time     `json:"latest"`
}

func listGalleryFolders(dir string) ([]galleryGroup, int, error) {
	dir = filepath.Clean(dir)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, 0, err
	}
	var groups []galleryGroup
	total := 0
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		files, err := listFolderFiles(dir, e.Name())
		if err != nil || len(files) == 0 {
			continue
		}
		sort.Slice(files, func(i, j int) bool {
			return files[i].ModTime.After(files[j].ModTime)
		})
		groups = append(groups, galleryGroup{
			Name:   e.Name(),
			Count:  len(files),
			Files:  nil,
			Latest: files[0].ModTime,
		})
		total += len(files)
	}
	sort.Slice(groups, func(i, j int) bool {
		return groups[i].Latest.After(groups[j].Latest)
	})
	return groups, total, nil
}

func handleGalleryFiles(w http.ResponseWriter, r *http.Request) {
	folder := strings.TrimSpace(r.URL.Query().Get("folder"))
	dir := DefaultRunOptions().DownloadDir
	files, err := listFolderFiles(dir, folder)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("list folder: %v", err)})
		return
	}
	sort.Slice(files, func(i, j int) bool {
		return files[i].ModTime.After(files[j].ModTime)
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"folder": folder,
		"count":  len(files),
		"files":  files,
	})
}

func listFolderFiles(baseDir, folder string) ([]galleryFile, error) {
	if strings.Contains(folder, "..") || strings.Contains(folder, string(filepath.Separator)) {
		return nil, fmt.Errorf("invalid folder")
	}
	target := filepath.Join(baseDir, folder)
	info, err := os.Stat(target)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("not a folder")
	}
	entries, err := os.ReadDir(target)
	if err != nil {
		return nil, err
	}
	var files []galleryFile
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if strings.ToLower(filepath.Ext(e.Name())) != ".png" {
			continue
		}
		fi, err := e.Info()
		if err != nil {
			continue
		}
		rel := filepath.Join(folder, e.Name())
		files = append(files, galleryFile{
			Name:    rel,
			URL:     "/" + filepath.ToSlash(filepath.Join(baseDir, rel)),
			Size:    fi.Size(),
			ModTime: fi.ModTime(),
		})
	}
	return files, nil
}

func handleProxySubscriptions(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{
			"storedSubscriptions": proxy.LoadStoredSubs(),
			"effective":           proxy.LoadStoredSubs(), // 环境变量订阅不回传
		})
	case http.MethodPost:
		var body struct {
			URL string `json:"url"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("decode body: %v", err)})
			return
		}
		url := strings.TrimSpace(body.URL)
		if url == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "url 不能为空"})
			return
		}
		subs := proxy.LoadStoredSubs()
		seen := map[string]bool{}
		for _, s := range subs {
			seen[s] = true
		}
		if !seen[url] {
			subs = append(subs, url)
		}
		if err := proxy.SaveSubs(subs); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("save subs: %v", err)})
			return
		}
		go proxy.WarmupSingBox(context.Background())
		writeJSON(w, http.StatusOK, map[string]any{
			"subscriptions":       subs,
			"storedSubscriptions": subs,
			"effective":           subs,
		})
	case http.MethodPut:
		var body struct {
			URLs []string `json:"urls"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("decode body: %v", err)})
			return
		}
		var cleaned []string
		seen := map[string]bool{}
		for _, u := range body.URLs {
			u = strings.TrimSpace(u)
			if u == "" || seen[u] {
				continue
			}
			seen[u] = true
			cleaned = append(cleaned, u)
		}
		if err := proxy.SaveSubs(cleaned); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("save subs: %v", err)})
			return
		}
		go proxy.WarmupSingBox(context.Background())
		writeJSON(w, http.StatusOK, map[string]any{
			"subscriptions":       cleaned,
			"storedSubscriptions": cleaned,
			"effective":           cleaned,
		})
	case http.MethodDelete:
		url := strings.TrimSpace(r.URL.Query().Get("url"))
		if url == "" {
			var body struct {
				URL string `json:"url"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			url = strings.TrimSpace(body.URL)
		}
		if url == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "url 不能为空"})
			return
		}
		subs := proxy.LoadStoredSubs()
		var filtered []string
		for _, s := range subs {
			if s != url {
				filtered = append(filtered, s)
			}
		}
		if err := proxy.SaveSubs(filtered); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("save subs: %v", err)})
			return
		}
		go proxy.WarmupSingBox(context.Background())
		writeJSON(w, http.StatusOK, map[string]any{
			"subscriptions":       filtered,
			"storedSubscriptions": filtered,
			"effective":           filtered,
		})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "only GET/POST/PUT/DELETE allowed"})
	}
}
