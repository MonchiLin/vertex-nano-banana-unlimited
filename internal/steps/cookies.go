package steps

import (
	"regexp"

	playwright "github.com/playwright-community/playwright-go"
)

// AcceptCookieBar clicks the cookie accept button if visible.
func AcceptCookieBar(page playwright.Page) (bool, error) {
	bar := page.Locator("#glue-cookie-notification-bar-1").Or(page.Locator(".glue-cookie-notification-bar"))
	visible, _ := bar.First().IsVisible()
	if !visible {
		return false, nil
	}

	button := bar.Locator("button.glue-cookie-notification-bar__accept").Or(
		bar.GetByRole("button", playwright.LocatorGetByRoleOptions{
			Name: regexp.MustCompile("(?i)ok,?\\s*got it"),
		}),
	)
	btnVisible, _ := button.First().IsVisible()
	if !btnVisible {
		return false, nil
	}

	_ = button.First().ScrollIntoViewIfNeeded()
	if err := button.First().Click(playwright.LocatorClickOptions{Force: playwright.Bool(true)}); err != nil {
		return false, err
	}

	_ = bar.WaitFor(playwright.LocatorWaitForOptions{
		State:   playwright.WaitForSelectorStateDetached,
		Timeout: playwright.Float(3000),
	})
	return true, nil
}
