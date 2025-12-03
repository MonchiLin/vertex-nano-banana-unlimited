package steps

import (
	"fmt"
	"regexp"
	"time"

	playwright "github.com/playwright-community/playwright-go"
)

// UploadLocalFile opens the upload menu and selects a local file.
func UploadLocalFile(page playwright.Page, filePath string) (bool, error) {
	// 如果文件路径为空，跳过上传
	if filePath == "" {
		fmt.Println("🟦 No file to upload, skipping")
		return true, nil
	}
	fmt.Printf("🟦 Upload target: %s\n", filePath)
	addBtn := page.Locator("ai-llm-prompt-input-actions-button button").First()
	err := addBtn.WaitFor(playwright.LocatorWaitForOptions{
		State:   playwright.WaitForSelectorStateVisible,
		Timeout: playwright.Float(5000),
	})
	if err != nil {
		return false, nil
	}
	if err := addBtn.Click(playwright.LocatorClickOptions{Force: playwright.Bool(true)}); err != nil {
		return false, err
	}
	time.Sleep(300 * time.Millisecond)

	menuRoot := page.Locator(".cdk-overlay-pane").Last()
	uploadOption := menuRoot.Locator("a[role=\"menuitem\"]", playwright.LocatorLocatorOptions{
		HasText: regexp.MustCompile("(?i)上传|提供本地文件|upload"),
	}).First()

	err = uploadOption.WaitFor(playwright.LocatorWaitForOptions{
		State:   playwright.WaitForSelectorStateVisible,
		Timeout: playwright.Float(2000),
	})
	if err != nil {
		return false, nil
	}
	time.Sleep(300 * time.Millisecond)

	chooser, err := page.ExpectFileChooser(func() error {
		return uploadOption.Click(playwright.LocatorClickOptions{Force: playwright.Bool(true)})
	})
	if err != nil {
		return false, err
	}
	if err := chooser.SetFiles(filePath); err != nil {
		return false, err
	}
	fmt.Println("🟦 File uploaded via chooser")
	return true, nil
}
