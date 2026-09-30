import { test, expect, openApp, seedTree } from './helpers'

// A starting tree is seeded through the store (setup only); every assertion
// below is on the DOM. Search must both find a hidden node and open the
// collapsed ancestors that hide it — the "reveal" half of Ctrl+P.
test('Ctrl+P finds a thought and reveals it by expanding a collapsed ancestor', async ({
  page,
}) => {
  await openApp(page)

  await seedTree(page, [
    { text: 'Alpha root', parent: null, collapsed: true },
    { text: 'Beta child', parent: 0 },
    { text: 'Gamma leaf', parent: 1 },
  ])

  // With the root collapsed, only the root row is on screen.
  await expect(page.locator('.panel-body .row')).toHaveCount(1)
  await expect(page.locator('.row .row-text', { hasText: 'Gamma leaf' })).toHaveCount(0)

  // Open the palette from anywhere.
  await page.keyboard.press('Control+p')
  const searchInput = page.locator('.search-palette input')
  await expect(searchInput).toBeFocused()

  // Type a fragment of the hidden thought.
  await searchInput.fill('Gamma')
  await expect(page.locator('.search-row', { hasText: 'Gamma leaf' })).toBeVisible()

  // Enter jumps to it, opening the folded branch above it.
  await searchInput.press('Enter')
  await expect(page.locator('.search-palette')).toHaveCount(0)

  await expect(page.locator('.row .row-text', { hasText: 'Gamma leaf' })).toBeVisible()
  await expect(page.locator('.panel-body .row')).toHaveCount(3)
  // The collapsed ancestor is now open.
  await expect(page.locator('.row', { hasText: 'Alpha root' }).locator('.caret')).toHaveClass(
    /\bopen\b/,
  )
})
