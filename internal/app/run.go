package app

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	playwright "github.com/playwright-community/playwright-go"

	"vertex-nano-banana-unlimited/internal/proxy"
	"vertex-nano-banana-unlimited/internal/steps"
)

type RunOptions struct {
	TargetURL     string
	ImagePath     string
	PromptText    string
	DownloadDir   string
	Headless      bool
	ScenarioCount int
	StepPause     time.Duration
	SubStepPause  time.Duration
	OutputRes     string
	Temperature   float64
}

type ScenarioResult struct {
	ID        int                   `json:"id"`
	Outcome   steps.DownloadOutcome `json:"outcome"`
	Path      string                `json:"path"`
	URL       string                `json:"url"`
	ProxyTag  string                `json:"proxyTag,omitempty"`
	OutputRes string                `json:"outputRes,omitempty"`
	Error     string                `json:"error,omitempty"`
}

func DefaultRunOptions() RunOptions {
	imagePath := "" // 不设置默认图片路径，要求用户上传

	downloadDir := os.Getenv("DEFAULT_DOWNLOAD_DIR")
	if downloadDir == "" {
		downloadDir = "tmp"
	}

	scenarioCount := 1
	outputRes := "4K"

	stepPause := time.Second

	subStepPause := 500 * time.Millisecond
	temperature := 1.0 // 默认温度值

	return RunOptions{
		TargetURL:     "https://console.cloud.google.com/vertex-ai/studio/multimodal;mode=prompt?model=gemini-3-pro-image-preview",
		ImagePath:     imagePath,
		PromptText:    "",
		DownloadDir:   downloadDir,
		Headless:      false,
		ScenarioCount: scenarioCount,
		StepPause:     stepPause,
		SubStepPause:  subStepPause,
		OutputRes:     outputRes,
		Temperature:   temperature,
	}
}

func RunWithOptions(ctx context.Context, opts RunOptions) ([]ScenarioResult, error) {
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
	}
	if opts.TargetURL == "" {
		return nil, errors.New("TargetURL 不能为空")
	}
	if opts.PromptText == "" {
		return nil, errors.New("PromptText 不能为空")
	}
	// ImagePath现在可以为空，支持纯文本生成
	if opts.ScenarioCount < 1 {
		opts.ScenarioCount = 1
	}
	if opts.DownloadDir == "" {
		opts.DownloadDir = "tmp"
	}
	if opts.StepPause == 0 {
		opts.StepPause = time.Second
	}
	if opts.SubStepPause == 0 {
		opts.SubStepPause = 500 * time.Millisecond
	}
	if opts.OutputRes == "" {
		opts.OutputRes = "4K"
	}

	if err := os.MkdirAll(opts.DownloadDir, 0o755); err != nil {
		return nil, fmt.Errorf("make download dir: %w", err)
	}

	proxyEndpoints := pickProxyEndpoints(ctx)

	batchFolder := ""
	if opts.ImagePath != "" {
		batchFolder = sanitizeSegment(strings.TrimSuffix(filepath.Base(opts.ImagePath), filepath.Ext(opts.ImagePath)))
	} else {
		batchFolder = fmt.Sprintf("text-only-%d", time.Now().Unix())
	}

	pw, err := playwright.Run()
	if err != nil {
		return nil, fmt.Errorf("start playwright: %w", err)
	}
	defer pw.Stop()

	browserType := pw.Chromium
	engineName := browserType.Name()
	launchOpts := playwright.BrowserTypeLaunchOptions{
		Headless: playwright.Bool(opts.Headless),
		Args:     chromiumArgs,
	}
	browser, err := browserType.Launch(launchOpts)
	if err != nil {
		return nil, fmt.Errorf("launch browser: %w", err)
	}
	defer browser.Close()

	viewport := playwright.Size{Width: 1920, Height: 1080}
	runCount := opts.ScenarioCount

	assigned := proxyEndpoints
	if len(assigned) > 0 && runCount > len(assigned) {
		fmt.Printf("⚠️ 并发数 %d 超过可用代理 %d，将限制为 %d\n", runCount, len(assigned), len(assigned))
		runCount = len(assigned)
	}

	var wg sync.WaitGroup
	errCh := make(chan error, runCount)
	resultCh := make(chan ScenarioResult, runCount)
	for i := 0; i < runCount; i++ {
		var proxyURL, proxyTag string
		if len(assigned) > 0 {
			proxyURL = assigned[i].URL
			proxyTag = assigned[i].Tag
			fmt.Printf("🧭 [%d] Using proxy %s (tag=%s)\n", i+1, proxyURL, proxyTag)
		}
		wg.Add(1)
		go func(id int, pURL, pTag string) {
			defer wg.Done()
			res, err := runScenario(ctx, browser, viewport, engineName, pURL, pTag, id, opts, batchFolder)
			if err != nil {
				res.Error = err.Error()
				errCh <- fmt.Errorf("scenario %d: %w", id, err)
			}
			resultCh <- res
		}(i+1, proxyURL, proxyTag)
	}
	wg.Wait()
	close(errCh)
	close(resultCh)

	var (
		results  []ScenarioResult
		firstErr error
	)
	for r := range resultCh {
		results = append(results, r)
	}
	for e := range errCh {
		if firstErr == nil {
			firstErr = e
		}
	}
	anySuccess := false
	for _, r := range results {
		if r.Outcome == steps.DownloadOutcomeDownloaded {
			anySuccess = true
			break
		}
	}
	if anySuccess {
		return results, nil
	}
	return results, firstErr
}

func proxyOptions(url string) *playwright.Proxy {
	if url == "" {
		return nil
	}
	return &playwright.Proxy{
		Server: url,
	}
}

func pickProxyEndpoints(ctx context.Context) []proxy.Endpoint {
	if endpoints, stop, err := proxy.StartSingBox(ctx); err == nil && len(endpoints) > 0 {
		fmt.Printf("🧭 使用 sing-box 代理，节点数：%d\n", len(endpoints))
		if stop != nil {
			go func() {
				<-ctx.Done()
				stop()
			}()
		}
		return endpoints
	} else if err != nil {
		fmt.Printf("⚠️ sing-box 启动失败，将直接直连：%v\n", err)
	}
	fmt.Println("🧭 未配置或未启用代理，直连运行")
	return nil
}

func runScenario(ctx context.Context, browser playwright.Browser, viewport playwright.Size, engineName, proxyURL, proxyTag string, id int, opts RunOptions, batchFolder string) (ScenarioResult, error) {
	res := ScenarioResult{ID: id, Outcome: steps.DownloadOutcomeNone, ProxyTag: proxyTag, OutputRes: opts.OutputRes}
	if err := ctx.Err(); err != nil {
		return res, err
	}
	penalized := false
	freeze := func(reason string) {
		if penalized || res.ProxyTag == "" {
			return
		}
		if err := proxy.FreezeEndpoint(res.ProxyTag); err != nil {
			fmt.Printf("⚠️ [%d] 记录节点冻结失败(%s): %v\n", id, reason, err)
			return
		}
		penalized = true
	}
	fail := func(reason string, err error) (ScenarioResult, error) {
		if err == nil {
			err = fmt.Errorf(reason)
		}
		freeze(reason)
		return res, err
	}
	defer freeze("defer")

	step := func(name string, pause time.Duration, fn func() (bool, error)) error {
		ok, err := fn()
		switch {
		case err != nil:
			fmt.Printf("⚠️ [%d] %s error: %v\n", id, name, err)
			return fmt.Errorf("%s: %w", name, err)
		case !ok:
			fmt.Printf("⚠️ [%d] %s not completed\n", id, name)
			return fmt.Errorf("%s not completed", name)
		default:
			fmt.Printf("✅ [%d] %s\n", id, name)
			time.Sleep(pause)
			return nil
		}
	}

	ctxOpts := playwright.BrowserNewContextOptions{
		Viewport: &viewport,
	}
	if proxyURL != "" {
		ctxOpts.Proxy = proxyOptions(proxyURL)
	}
	browserCtx, err := browser.NewContext(ctxOpts)
	if err != nil {
		return fail("new context", fmt.Errorf("new context: %w", err))
	}
	defer browserCtx.Close()

	page, err := browserCtx.NewPage()
	if err != nil {
		return fail("new page", fmt.Errorf("new page: %w", err))
	}

	proxyInfo := proxyTag
	if proxyInfo == "" && proxyURL != "" {
		proxyInfo = proxyURL
	}
	fmt.Printf("\n🚀 [%d] Starting (engine=%s headless=%v proxy=%s)\n", id, engineName, opts.Headless, proxyInfo)
	fmt.Printf("🔎 [%d] Navigating to %s\n", id, opts.TargetURL)

	_, err = page.Goto(opts.TargetURL, playwright.PageGotoOptions{
		WaitUntil: playwright.WaitUntilStateDomcontentloaded,
		Timeout:   playwright.Float(15_000),
	})
	if err != nil {
		fmt.Printf("⚠️ [%d] goto error: %v\n", id, err)
		return fail("goto", err)
	}
	fmt.Printf("✅ [%d] URL after goto: %s\n", id, page.URL())
	_ = page.WaitForLoadState(playwright.PageWaitForLoadStateOptions{State: playwright.LoadStateDomcontentloaded})
	_ = page.WaitForLoadState(playwright.PageWaitForLoadStateOptions{State: playwright.LoadStateNetworkidle})

	_ = page.BringToFront()
	fmt.Printf("ℹ️ [%d] Brought page to front\n", id)
	_ = page.Mouse().Click(5, 5)
	_ = page.Keyboard().Press("Escape")
	time.Sleep(opts.SubStepPause)

	if err := step("Accept terms dialog", opts.StepPause, func() (bool, error) {
		return steps.AcceptTermsBlocking(page, 45*time.Second)
	}); err != nil {
		return fail("accept terms", err)
	}

	if ok, err := steps.AcceptCookieBar(page); err != nil {
		return fail("accept cookies bar", err)
	} else if ok {
		fmt.Printf("✅ [%d] Accept cookies bar\n", id)
		time.Sleep(opts.StepPause)
	} else {
		fmt.Printf("ℹ️ [%d] Cookies bar not present, skipping\n", id)
	}

	if err := step("Open model settings", opts.StepPause, func() (bool, error) { return steps.OpenModelSettings(page) }); err != nil {
		return fail("open model settings", err)
	}

	if err := step(fmt.Sprintf("Set output resolution to %s", opts.OutputRes), opts.StepPause, func() (bool, error) {
		return steps.SetOutputResolution(page, opts.OutputRes)
	}); err != nil {
		return fail("set output resolution", err)
	}

	if opts.Temperature > 0 {
		if err := step(fmt.Sprintf("Set temperature to %.1f", opts.Temperature), opts.StepPause, func() (bool, error) {
			return steps.SetTemperature(page, opts.Temperature)
		}); err != nil {
			return fail("set temperature", err)
		}
	} else {
		fmt.Printf("ℹ️ [%d] Skipping temperature setting (not provided)\n", id)
	}

	if err := step("Enter prompt text", opts.StepPause, func() (bool, error) {
		return steps.EnterPrompt(page, opts.PromptText)
	}); err != nil {
		return fail("prompt input failed", err)
	}
	length := promptLength(page)
	fmt.Printf("ℹ️ [%d] Prompt length after entry: %d chars\n", id, length)
	if length == 0 {
		return fail("prompt is empty after entry", fmt.Errorf("prompt is empty after entry"))
	}

	// 只有当ImagePath不为空时才上传图片
	if opts.ImagePath != "" {
		if err := step("Upload local image", opts.StepPause, func() (bool, error) {
			return steps.UploadLocalFile(page, opts.ImagePath)
		}); err != nil {
			return fail("upload failed", err)
		}
	} else {
		fmt.Printf("ℹ️ [%d] No image provided, skipping upload\n", id)
		time.Sleep(opts.StepPause)
	}

	if err := step("Submit prompt", opts.StepPause, func() (bool, error) { return steps.SubmitPrompt(page) }); err != nil {
		return fail("submit prompt failed", err)
	}

	if err := ctx.Err(); err != nil {
		return fail("context done", err)
	}

	outDir := filepath.Join(opts.DownloadDir, batchFolder)
	outcome, path, err := steps.DownloadImage(ctx, page, outDir, 720*time.Second)
	res.Outcome = outcome
	res.Path = path
	if path != "" {
		res.URL = "/" + filepath.ToSlash(path)
	}
	if err != nil {
		return fail("download", fmt.Errorf("download: %w", err))
	}
	switch outcome {
	case steps.DownloadOutcomeDownloaded:
		fmt.Printf("✅ [%d] Downloaded image\n", id)
		freeze("downloaded")
	case steps.DownloadOutcomeExhausted:
		fmt.Printf("⚠️ [%d] Resource exhausted (429/quota)\n", id)
		freeze("exhausted")
	default:
		fmt.Printf("ℹ️ [%d] Download not completed\n", id)
	}

	fmt.Printf("🛑 [%d] Flow done, closing context\n", id)
	return res, nil
}

func promptLength(page playwright.Page) int {
	loc := page.Locator("ai-llm-prompt-input-box textarea, ai-llm-prompt-input-box [role=\"textbox\"], ai-llm-prompt-input-box [contenteditable=\"true\"]").First()
	val, _ := loc.InputValue()
	if val == "" {
		val, _ = loc.InnerText()
	}
	return len(val)
}

func sanitizeSegment(name string) string {
	if name == "" {
		return "output"
	}
	invalid := []string{`<`, `>`, `:`, `"`, `/`, `\`, `|`, `?`, `*`}
	for _, ch := range invalid {
		name = strings.ReplaceAll(name, ch, "_")
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return "output"
	}
	return name
}

var (
	chromiumArgs = []string{
		"--start-maximized",
		"--window-size=1920,1080",
		"--autoplay-policy=no-user-gesture-required",
		"--disable-features=IsolateOrigins,site-per-process,AutomationControlled",
		"--disable-blink-features=AutomationControlled",
		"--no-sandbox",
		"--disable-dev-shm-usage",
		"--incognito",
	}
)
