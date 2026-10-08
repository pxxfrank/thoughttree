import { test, expect, openApp, seedTree } from './helpers'

// Focus pins ONE question and shows it with everything filed under it — even a
// sub-question that was never starred. The old model filtered the tree to the
// ★-important questions, so a plain child of the focused question disappeared.
//
// This spec also keeps the undo/redo coverage the previous focus spec provided:
// those header buttons are handed to React as detached handlers (D028), and the
// guard in helpers.ts fails the test if invoking one throws.
test('focus pins one question and keeps its sub-questions in view', async ({ page }) => {
  await openApp(page)

  const ids = await seedTree(page, [
    { text: 'Parent', parent: null, important: true },
    { text: 'Starred child', parent: 0, important: true },
    { text: 'Plain child', parent: 0 },
  ])
  const parent = ids[0]

  const leftPanel = page.locator('.workspace > .panel').first()
  const tree = page.locator('.workspace > .panel').nth(1)
  const detail = page.locator('.workspace > .panel').nth(2)

  // Select the parent in the middle tree, then focus it from the detail panel.
  await tree.locator(`.row[data-node-id="${parent}"]`).click()
  await detail.locator('.panel-head .btn', { hasText: 'Focus on this question' }).click()

  // The left column becomes the Focus panel, with the parent pinned and BOTH
  // children listed — including the non-starred one.
  await expect(leftPanel.locator('.panel-title')).toHaveText('Focus')
  await expect(leftPanel.locator('.focus-text')).toHaveText('Parent')
  await expect(leftPanel.locator('.child-row', { hasText: 'Starred child' })).toBeVisible()
  await expect(leftPanel.locator('.child-row', { hasText: 'Plain child' })).toBeVisible()
  await expect(leftPanel.locator('.child-row')).toHaveCount(2)

  // The tree filter follows the same subtree, so both children survive there too.
  await expect(tree.locator('.row .row-text', { hasText: 'Starred child' })).toBeVisible()
  await expect(tree.locator('.row .row-text', { hasText: 'Plain child' })).toBeVisible()

  // Leaving focus returns the left column to the Inbox.
  await leftPanel.locator('.panel-head .btn', { hasText: 'Leave focus' }).click()
  await expect(leftPanel.locator('.panel-title')).toHaveText('Inbox')

  // Undo/redo (bound handlers) still work: the last seed mutation was adding
  // the plain child, so undo drops it and redo brings it back.
  await page.locator('.header button[aria-label="Undo"]').click()
  await expect(page.locator('.row .row-text', { hasText: 'Plain child' })).toHaveCount(0)

  await page.locator('.header button[aria-label="Redo"]').click()
  await expect(page.locator('.row .row-text', { hasText: 'Plain child' })).toBeVisible()
})
