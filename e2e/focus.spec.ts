import { test, expect, openApp, addRootViaUi } from './helpers'

// Bug: Focus/Undo/Redo/Skip handlers were passed as `onClick={store.method}`
// and invoked with no receiver, so they threw `TypeError: Cannot read
// properties of undefined (reading 'patch')` and silently did nothing. A test
// that clicks them and asserts an observable change catches that class.
test('the Focus panel and the undo/redo buttons actually do something', async ({ page }) => {
  await openApp(page)

  const text = 'Focus target'
  await addRootViaUi(page, text)

  // Make it ★ important so Focus Mode has something to show.
  const row = page.locator('.row', { hasText: text })
  await row.locator('.star').click()
  await expect(row.locator('.star')).toHaveClass(/\bon\b/)

  // Turn Focus on from the header.
  await page.locator('.seg button', { hasText: 'Focus' }).click()
  await expect(page.locator('.workspace > .panel').first().locator('.panel-title')).toHaveText('Focus')
  await expect(page.locator('.focus-item', { hasText: text })).toBeVisible()

  // Undo the "mark important": the only focus target disappears.
  // Located by accessible name: undo/redo are icon-only now.
  await page.locator('.header button[aria-label="Undo"]').click()
  await expect(page.locator('.focus-item')).toHaveCount(0)
  await expect(page.locator('.focus-body .empty')).toBeVisible()

  // Redo brings it back.
  await page.locator('.header button[aria-label="Redo"]').click()
  await expect(page.locator('.focus-item', { hasText: text })).toBeVisible()
  await expect(page.locator('.focus-item')).toHaveCount(1)

  // The Focus panel's own button is bound too: leaving focus returns to Inbox.
  // It lives in the panel head now, not at the foot of the list.
  const focusPanel = page.locator('.workspace > .panel').first()
  await focusPanel.locator('.panel-head .btn', { hasText: 'Leave focus' }).click()
  await expect(focusPanel.locator('.panel-title')).toHaveText('Inbox')
})
