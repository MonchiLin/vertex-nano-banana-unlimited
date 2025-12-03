package steps

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	playwright "github.com/playwright-community/playwright-go"
)

type DownloadOutcome string

const (
	DownloadOutcomeDownloaded DownloadOutcome = "downloaded"
	DownloadOutcomeExhausted  DownloadOutcome = "exhausted"
	DownloadOutcomeNone       DownloadOutcome = "none"
)

// DownloadImage waits for the download button or a 429 notice, then saves with a timestamped name.
// Returns outcome and saved path (empty if not downloaded).
func DownloadImage(ctx context.Context, page playwright.Page, dir string, maxWait time.Duration) (DownloadOutcome, string, error) {
	button := page.Locator("button[cfctooltip=\"Download image\"]").Or(
		page.Locator("button[cfctooltip=\"下载图片\"]"),
	).First()
	exhaust := page.Locator("a[href*=\"vertex-ai/generative-ai/docs/error-code-429\"]").
		Or(page.GetByText("Resource exhausted", playwright.PageGetByTextOptions{Exact: playwright.Bool(false)})).
		Or(page.GetByText("resource exhausted", playwright.PageGetByTextOptions{Exact: playwright.Bool(false)})).
		Or(page.GetByText("check quota", playwright.PageGetByTextOptions{Exact: playwright.Bool(false)})).
		Or(page.GetByText("Deadline expired before operation could complete.", playwright.PageGetByTextOptions{Exact: playwright.Bool(false)})).
		Or(page.GetByText("未能提交提示", playwright.PageGetByTextOptions{Exact: playwright.Bool(false)})).
		Or(page.GetByText("The operation was cancelled", playwright.PageGetByTextOptions{Exact: playwright.Bool(false)})).
		Or(page.GetByText("Recaptcha token is invalid, please refresh the page or log in, and try again.", playwright.PageGetByTextOptions{Exact: playwright.Bool(false)}))

	deadline := time.Now().Add(maxWait)
	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return DownloadOutcomeNone, "", ctx.Err()
		default:
		}
		if vis, _ := exhaust.First().IsVisible(); vis {
			fmt.Println("⚠️ 429/quota notice detected")
			return DownloadOutcomeExhausted, "", nil
		}
		if vis, _ := button.IsVisible(); vis {
			fmt.Println("🟦 Download button visible")
			goto click
		}
		time.Sleep(1 * time.Second)
	}
	return DownloadOutcomeNone, "", nil

click:
	select {
	case <-ctx.Done():
		return DownloadOutcomeNone, "", ctx.Err()
	default:
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return DownloadOutcomeNone, "", err
	}
	download, err := page.ExpectDownload(func() error {
		return button.Click(playwright.LocatorClickOptions{Force: playwright.Bool(true)})
	})
	if err != nil {
		return DownloadOutcomeNone, "", err
	}
	select {
	case <-ctx.Done():
		return DownloadOutcomeNone, "", ctx.Err()
	default:
	}
	suggested := download.SuggestedFilename()
	ext := filepath.Ext(suggested)
	base := strings.TrimSuffix(suggested, ext)
	now := time.Now()
	filename := fmt.Sprintf("%s_%s_%s%s", base, now.Format("20060102"), now.Format("150405.000"), ext)
	target := filepath.Join(dir, filename)
	if err := download.SaveAs(target); err != nil {
		return DownloadOutcomeNone, "", err
	}
	fmt.Printf("🟦 Image downloaded to: %s\n", target)
	return DownloadOutcomeDownloaded, target, nil
}
