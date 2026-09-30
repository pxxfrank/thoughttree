import { test, expect, openApp } from './helpers'

/**
 * Nothing else covers the settings dialog, and the version line at its foot is
 * the only place the app says which build is installed.
 */
test('settings opens, shows the version, and closes', async ({ page }) => {
  await openApp(page)

  await page.locator('.header button[aria-label="Settings"]').click()
  const dialog = page.locator('.dialog')
  await expect(dialog).toBeVisible()

  // Assert the shape rather than a literal, so bumping the version cannot break
  // this test.
  await expect(dialog.locator('.dialog-foot')).toContainText(/\d+\.\d+\.\d+/)

  await dialog.locator('.dialog-head .btn.ghost').click()
  await expect(dialog).toBeHidden()
})
