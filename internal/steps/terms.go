package steps

import (
	"context"
	"fmt"
	"regexp"
	"time"

	playwright "github.com/playwright-community/playwright-go"
)

// StartTermsAutoAccept polls for the terms dialog and accepts it if present. Returns a stop func.
func StartTermsAutoAccept(page playwright.Page) func() {
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		defer cancel()
		maxAttempts := 30
		for i := 0; i < maxAttempts; i++ {
			select {
			case <-ctx.Done():
				return
			default:
			}
			ok, err := acceptTerms(page)
			if ok {
				fmt.Println("✅ Terms dialog accepted automatically")
				return
			}
			if err != nil {
				fmt.Printf("⚠️ Terms auto-accept error: %v\n", err)
			}
			time.Sleep(1500 * time.Millisecond)
		}
		fmt.Println("ℹ️ Terms dialog not found in allotted attempts")
	}()
	return func() { cancel() }
}

// AcceptTermsBlocking waits until the terms dialog is accepted or absent.
// Returns true when accepted or not present; errors on timeout or click failure.
func AcceptTermsBlocking(page playwright.Page, timeout time.Duration) (bool, error) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		ok, err := acceptTerms(page)
		if err != nil {
			return false, err
		}
		if ok {
			return true, nil
		}

		dialog := page.Locator(".mat-mdc-dialog-container").First()
		if vis, _ := dialog.IsVisible(); !vis {
			return true, nil // dialog not present; treat as already accepted
		}
		time.Sleep(1500 * time.Millisecond)
	}
	return false, fmt.Errorf("terms dialog not accepted within %s", timeout)
}

func acceptTerms(page playwright.Page) (bool, error) {
	dialog := page.Locator(".mat-mdc-dialog-container").First()
	if vis, _ := dialog.IsVisible(); !vis {
		return false, nil
	}

	checkbox := dialog.GetByRole("checkbox", playwright.LocatorGetByRoleOptions{
		Name: regexp.MustCompile("(?i)accept terms|accept|agree|接受|同意|使用条款"),
	}).First()

	if chkVisible, _ := checkbox.IsVisible(); !chkVisible {
		return false, nil
	}
	if checked, _ := checkbox.IsChecked(); !checked {
		_ = checkbox.Check()
	}

	submit := dialog.GetByRole("button", playwright.LocatorGetByRoleOptions{
		Name: regexp.MustCompile("(?i)submit|accept|agree|continue|同意|提交"),
	}).First()
	if vis, _ := submit.IsVisible(); vis {
		if err := submit.Click(); err != nil {
			return false, err
		}
	}

	if err := dialog.WaitFor(playwright.LocatorWaitForOptions{
		State:   playwright.WaitForSelectorStateHidden,
		Timeout: playwright.Float(10000),
	}); err == nil {
		return true, nil
	}
	return false, nil
}
