import { test, expect, openApp } from './helpers'

// Bug: unfiled captures leaked into the tree as well as the Inbox, because
// `inbox` was modelled as "parentless" instead of an explicit flag (D007).
test('a capture lands in the Inbox and never in the tree', async ({ page }) => {
  await openApp(page)

  const text = `capture ${Date.now()}`
  const bar = page.locator('[data-capture-bar]')
  await bar.click()
  await bar.fill(text)
  await bar.press('Enter')

  // It is in the Inbox panel...
  await expect(page.locator('[data-inbox-id] .text', { hasText: text })).toBeVisible()
  // ...and nowhere in the tree. The tree is empty, so any row at all is a leak.
  await expect(page.locator('.row .row-text', { hasText: text })).toHaveCount(0)
  await expect(page.locator('.panel-body .row')).toHaveCount(0)
})

// Bug: the capture bar sat off the bottom edge of the window, so the one place
// you type was invisible.
test('the capture bar is on screen with a real box', async ({ page }) => {
  await openApp(page)

  const bar = page.locator('[data-capture-bar]')
  await expect(bar).toBeInViewport()

  const box = await bar.boundingBox()
  expect(box, 'the capture bar must have a bounding box').not.toBeNull()

  const viewport = page.viewportSize()
  expect(viewport).not.toBeNull()
  // A non-zero box, fully inside the viewport...
  expect(box!.width).toBeGreaterThan(40)
  expect(box!.height).toBeGreaterThan(10)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1)
  // ...and genuinely at the bottom edge, where the layout puts it.
  expect(box!.y + box!.height).toBeGreaterThan(viewport!.height - 80)
})
