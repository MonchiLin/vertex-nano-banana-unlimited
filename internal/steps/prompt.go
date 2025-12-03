package steps

import (
	"regexp"
	"strings"

	playwright "github.com/playwright-community/playwright-go"
)

// EnterPrompt types text into the prompt box.
func EnterPrompt(page playwright.Page, text string) (bool, error) {
	box := page.Locator("ai-llm-prompt-input-box textarea, ai-llm-prompt-input-box [role=\"textbox\"], ai-llm-prompt-input-box [contenteditable=\"true\"]").First()
	visible, _ := box.IsVisible()
	if !visible {
		return false, nil
	}
	_ = box.ScrollIntoViewIfNeeded()
	_ = box.Click(playwright.LocatorClickOptions{Force: playwright.Bool(true)})

	if ok := containsText(box, text); ok {
		return true, nil
	}

	// 尝试键盘插入，不清空现有内容，避免影响附件或已有文本。
	_ = page.Keyboard().InsertText(text)
	if ok := containsText(box, text); ok {
		return true, nil
	}

	// 兜底：直接设置值并触发 input。
	_, err := box.EvaluateHandle(`(el, txt) => {
		if ('value' in el) {
			el.value = txt;
		} else {
			el.textContent = txt;
		}
		el.dispatchEvent(new Event('input', { bubbles: true }));
	}`, text)
	if err != nil {
		return false, err
	}
	return containsText(box, text), nil
}

func containsText(box playwright.Locator, text string) bool {
	val, _ := box.InputValue()
	if val == "" {
		val, _ = box.InnerText()
	}
	return val != "" && strings.Contains(val, text)
}

// SubmitPrompt clicks the send/submit button.
func SubmitPrompt(page playwright.Page) (bool, error) {
	btn := page.Locator("button[instrumentationid=\"prompt-submit-button\"]").Or(
		page.GetByRole("button", playwright.PageGetByRoleOptions{
			Name: regexp.MustCompile("(?i)submit|send"),
		}),
	).First()

	visible, _ := btn.IsVisible()
	if !visible {
		return false, nil
	}
	enabled, _ := btn.IsEnabled()
	if !enabled {
		return false, nil
	}
	_ = btn.ScrollIntoViewIfNeeded()
	if err := btn.Click(playwright.LocatorClickOptions{Force: playwright.Bool(true)}); err != nil {
		return false, err
	}
	return true, nil
}
