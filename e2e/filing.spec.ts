import { test, expect, openApp, pointerDrag, centre, addRootViaUi, captureViaUi } from './helpers'

// Bug: the "Why here?" popover was unclickable because its click-outside scrim
// sat above it (D020). Filing must both raise the prompt and let the user
// actually answer it.
test('filing an Inbox item raises a clickable "Why here?" and applies the relation', async ({
  page,
}) => {
  await openApp(page)

  const rootText = 'Root question'
  await addRootViaUi(page, rootText)
  const rootRow = page.locator('.row', { hasText: rootText })
  const rootId = await rootRow.getAttribute('data-node-id')
  expect(rootId).toBeTruthy()

  const movedText = `Inbox thought ${Date.now()}`
  await captureViaUi(page, movedText)

  const from = await centre(page, page.locator('[data-inbox-id]'))
  const to = await centre(page, rootRow)
  await pointerDrag(page, from, to)

  // The prompt appears...
  const popover = page.locator('.popover')
  await expect(popover).toBeVisible()
  await expect(popover.locator('.popover-title')).toHaveText('Why here?')

  // ...and it is genuinely clickable: pick a relation, type a reason, save.
  const reason = 'because it answers the root'
  await popover.locator('.chips .chip').nth(1).click()
  await popover.locator('input').fill(reason)
  await popover.locator('.popover-actions .btn.primary').click()

  // The prompt closes and the relation took effect.
  await expect(page.locator('.popover')).toHaveCount(0)
  await expect(page.locator('[data-inbox-id] .text', { hasText: movedText })).toHaveCount(0)

  // It is now a child row *inside* the root's branch, not a top-level row.
  const nested = page.locator(`li:has(> [data-node-id="${rootId}"]) > .branch .row-text`, {
    hasText: movedText,
  })
  await expect(nested).toBeVisible()

  // The chosen relation and reason show in the detail panel for the moved node.
  await expect(page.locator('.reason-quote')).toHaveText(reason)
  await expect(page.locator('.reason-quote + .hint')).toContainText('Answer')
})

// Bug: dragging into an empty tree did nothing, because the only drop target
// was a 22px strip at the bottom; the empty panel body itself was not droppable.
test('an empty tree accepts a drop on its panel body and files the item at top level', async ({
  page,
}) => {
  await openApp(page)

  const text = `First thought ${Date.now()}`
  await captureViaUi(page, text)

  // The tree really is empty to begin with.
  await expect(page.locator('.panel-body .row')).toHaveCount(0)
  const rootDrop = page.locator('.panel-body[data-root-drop="true"]')
  await expect(rootDrop).toBeVisible()

  const inboxBox = await page.locator('[data-inbox-id]').boundingBox()
  const bodyBox = await rootDrop.boundingBox()
  if (!inboxBox || !bodyBox) throw new Error('missing bounding box')

  // Aim at the middle of the panel body — deliberately away from the thin
  // `.root-drop` strip at the bottom that used to be the only target.
  await pointerDrag(
    page,
    { x: inboxBox.x + inboxBox.width / 2, y: inboxBox.y + inboxBox.height / 2 },
    { x: bodyBox.x + bodyBox.width / 2, y: bodyBox.y + bodyBox.height * 0.45 },
  )

  // It left the Inbox...
  await expect(page.locator('[data-inbox-id] .text', { hasText: text })).toHaveCount(0)
  // ...and landed as a top-level row in the tree.
  await expect(page.locator('.panel-body .branch > li > .row', { hasText: text })).toBeVisible()
  await expect(page.locator('.panel-body .row')).toHaveCount(1)
})
