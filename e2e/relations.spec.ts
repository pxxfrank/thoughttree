import { test, expect, openApp, seedTree } from './helpers'

// A cross-branch relation is revealed in place: selecting one endpoint marks
// the other endpoints' rows, and nothing is drawn in the tree. The tree stays
// a tree — the mark comes and goes with the selection.
test('selecting a node reveals its linked peers and clears them on reselect', async ({
  page,
}) => {
  await openApp(page)

  const [alpha, beta, gamma] = await seedTree(page, [
    { text: 'Alpha root', parent: null },
    { text: 'Beta root', parent: null },
    { text: 'Gamma root', parent: null },
  ])

  // Setup only: create the cross-branch link through the store, then assert on
  // the DOM. `Alpha` supports `Beta`, so each is the other's peer.
  await page.evaluate(
    ({ from, to }) => {
      const store = (
        window as unknown as {
          __THOUGHTTREE__: {
            addLink: (a: string, b: string, type: string, reason: string) => void
          }
        }
      ).__THOUGHTTREE__
      store.addLink(from, to, 'support', 'they support each other')
    },
    { from: alpha, to: beta },
  )

  const row = (id: string) => page.locator(`.row[data-node-id="${id}"]`)

  // Gamma was seeded last, so it is selected — and it has no links.
  await expect(page.locator('.row.related')).toHaveCount(0)

  // Selecting one endpoint reveals the other.
  await row(alpha).click()
  await expect(row(alpha)).toHaveClass(/\bselected\b/)
  await expect(row(beta)).toHaveClass(/\brelated\b/)
  await expect(row(alpha)).not.toHaveClass(/\brelated\b/)

  // Change the selection: the mark follows the endpoints, not the tree.
  await row(gamma).click()
  await expect(page.locator('.row.related')).toHaveCount(0)
  await expect(row(beta)).not.toHaveClass(/\brelated\b/)
})
