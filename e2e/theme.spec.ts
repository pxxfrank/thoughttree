import { test, expect, openApp } from './helpers'

// Pin the OS preference so the initial "system" theme resolves to a known value
// and a single click is guaranteed to change the applied theme.
test.use({ colorScheme: 'dark' })

test('the theme switcher is reachable from the header and changes the document theme', async ({
  page,
}) => {
  await openApp(page)

  const themeButton = page.locator('.header button[title*="Theme:"]')
  await expect(themeButton).toBeVisible()
  await expect(themeButton).toBeInViewport()
  await expect(themeButton).toHaveAttribute('title', /System/)

  const applied = () => page.evaluate(() => document.documentElement.dataset.theme)

  // "System" resolves to the dark OS preference.
  await expect.poll(applied).toBe('dark')

  // One click advances system → light, and the document theme changes.
  await themeButton.click()
  await expect.poll(applied).toBe('light')
  await expect(themeButton).toHaveAttribute('title', /Light/)

  // And on to dark.
  await themeButton.click()
  await expect.poll(applied).toBe('dark')
  await expect(themeButton).toHaveAttribute('title', /Dark/)
})
