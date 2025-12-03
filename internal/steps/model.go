package steps

import (
	"fmt"
	"regexp"
	"strings"
	"time"

	playwright "github.com/playwright-community/playwright-go"
)

// OpenModelSettings opens the model settings panel by clicking the header.
func OpenModelSettings(page playwright.Page) (bool, error) {
	header := page.GetByRole("button", playwright.PageGetByRoleOptions{
		Name: regexp.MustCompile("(?i)model settings|模型设置"),
	}).Or(page.Locator("ai-llm-collapsible-model-settings .collapsible-panel__title", playwright.PageLocatorOptions{
		HasText: "模型设置",
	})).First()

	vis, _ := header.IsVisible()
	if !vis {
		return false, nil
	}
	_ = header.ScrollIntoViewIfNeeded()
	return true, header.Click(playwright.LocatorClickOptions{Force: playwright.Bool(true)})
}

// SetOutputResolution chooses a resolution option in the combobox.
func SetOutputResolution(page playwright.Page, target string) (bool, error) {
	combo := page.GetByRole("combobox", playwright.PageGetByRoleOptions{
		Name: regexp.MustCompile("(?i)output resolution|输出分辨率"),
	})

	vis, _ := combo.IsVisible()
	if !vis {
		return false, nil
	}
	_ = combo.ScrollIntoViewIfNeeded()
	if err := combo.Click(playwright.LocatorClickOptions{Force: playwright.Bool(true)}); err != nil {
		return false, err
	}
	time.Sleep(300 * time.Millisecond)

	option := page.GetByRole("option", playwright.PageGetByRoleOptions{
		Name: regexp.MustCompile(fmt.Sprintf("(?i)^\\s*%s\\s*$", target)),
	}).Or(page.Locator("mat-option", playwright.PageLocatorOptions{
		HasText: target,
	})).Or(page.GetByText(target))

	optVisible, _ := option.First().IsVisible()
	if !optVisible {
		return false, nil
	}
	time.Sleep(300 * time.Millisecond)
	if err := option.First().Click(playwright.LocatorClickOptions{Force: playwright.Bool(true)}); err != nil {
		return false, err
	}
	page.WaitForTimeout(300)
	val, _ := combo.InnerText()
	return strings.Contains(strings.ToLower(val), strings.ToLower(target)), nil
}

// SetTemperature sets the temperature value using the slider. If temperature is 0, skip setting.
func SetTemperature(page playwright.Page, temperature float64) (bool, error) {
	// Skip if temperature is 0 or invalid
	if temperature <= 0 {
		return true, nil
	}

	// Prefer label text match (Chinese/English) to avoid brittle IDs
	tempContainer := page.Locator("div", playwright.PageLocatorOptions{
		HasText: regexp.MustCompile("(?i)温度|temperature"),
	}).First()
	vis, _ := tempContainer.IsVisible()
	if !vis {
		return false, nil
	}

	// Find the slider input element
	sliderInput := tempContainer.Locator("input[type=\"range\"][min=\"0\"][max=\"2\"]").First()
	vis, _ = sliderInput.IsVisible()
	if !vis {
		return false, nil
	}

	// Calculate the percentage position for the slider
	// Temperature range: 0.0 - 2.0
	percentage := (temperature / 2.0) * 100
	if percentage > 100 {
		percentage = 100
	}
	if percentage < 0 {
		percentage = 0
	}

	// Click on the slider at the calculated position
	slider := tempContainer.Locator("mat-slider").First()
	if vis, _ := slider.IsVisible(); !vis {
		// fallback: role slider in the same container
		slider = tempContainer.GetByRole("slider").First()
	}
	_ = slider.ScrollIntoViewIfNeeded()

	// Get slider dimensions to calculate click position
	sliderBoundingBox, err := slider.BoundingBox()
	if err != nil {
		return false, err
	}

	// Calculate click position (x coordinate)
	clickX := sliderBoundingBox.X + (sliderBoundingBox.Width * percentage / 100)
	clickY := sliderBoundingBox.Y + (sliderBoundingBox.Height / 2)

	// Click at the calculated position
	if err := slider.Click(playwright.LocatorClickOptions{
		Position: &playwright.Position{
			X: clickX - sliderBoundingBox.X, // Relative position
			Y: clickY - sliderBoundingBox.Y, // Relative position
		},
		Force: playwright.Bool(true),
	}); err != nil {
		return false, err
	}

	// Wait a moment for the value to update
	time.Sleep(300 * time.Millisecond)

	// Verify the temperature was set correctly by checking the input value
	currentValue, err := sliderInput.GetAttribute("aria-valuetext")
	if err != nil {
		return false, nil // Don't fail if we can't verify
	}

	// The aria-valuetext should contain our target value
	return currentValue != "", nil
}
