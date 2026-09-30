import { expect as baseExpect, test as base, type Page } from '@playwright/test'

/**
 * The single most important guard in this harness: a test built on this `test`
 * fails if the page throws *any* uncaught exception, or logs a `console.error`
 * that is not explicitly tolerated below. The bugs this catches (an unbound
 * store method throwing inside an onClick, a popover that could not be clicked)
 * produced no assertion failure on their own — the UI just did nothing.
 *
 * Add to this list only for messages that are genuinely not the app's fault.
 */
const ALLOWED_CONSOLE_ERRORS: RegExp[] = []

interface RejectionWindow extends Window {
  __E2E_REJECTIONS__?: string[]
}

export const test = base.extend<{ errors: string[] }>({
  // `auto: true` so the guard runs for every test that uses this `test`, not
  // only the ones that happen to ask for the fixture.
  errors: [
    async ({ page }, use) => {
      const errors: string[] = []

      // Playwright's `pageerror` covers uncaught synchronous exceptions but not
      // unhandled promise rejections, which is exactly how an unawaited Tauri
      // `invoke()` fails in a browser. Capture those too, before any navigation.
      await page.addInitScript(() => {
        ;(window as RejectionWindow).__E2E_REJECTIONS__ = []
        window.addEventListener('unhandledrejection', (event) => {
          const reason: unknown = event.reason
          const message =
            reason && typeof reason === 'object' && 'message' in reason
              ? String((reason as { message: unknown }).message)
              : String(reason)
          ;(window as RejectionWindow).__E2E_REJECTIONS__!.push(message)
        })
      })

      page.on('pageerror', (error) => {
        errors.push(`uncaught exception: ${error.message}`)
      })
      page.on('console', (message) => {
        if (message.type() !== 'error') return
        const text = message.text()
        if (ALLOWED_CONSOLE_ERRORS.some((allowed) => allowed.test(text))) return
        errors.push(`console.error: ${text}`)
      })

      await use(errors)

      // Give Chromium a moment to deliver an exception or rejection that fired
      // as the test body finished, then fail the test if anything surfaced.
      await page.waitForTimeout(50)
      const rejections = await page
        .evaluate(() => (window as RejectionWindow).__E2E_REJECTIONS__ ?? [])
        .catch(() => [])
      for (const rejection of rejections) errors.push(`unhandled rejection: ${rejection}`)

      baseExpect(
        errors,
        'the page must not throw, reject or log console.error during the test',
      ).toEqual([])
    },
    { auto: true },
  ],
})

export { baseExpect as expect }

/** Navigates to the app and waits for the shell (the capture bar) to render. */
export async function openApp(page: Page): Promise<void> {
  await page.goto('/')
  await baseExpect(page.locator('[data-capture-bar]')).toBeVisible()
  await baseExpect(page.locator('.header')).toBeVisible()
}

interface SeedSpec {
  text: string
  /** Index into the seed list of the parent, or null for a root. */
  parent: number | null
  important?: boolean
  collapsed?: boolean
}

/**
 * Builds a starting tree through the store that `desktop.ts` exposes outside
 * Tauri. This is setup only — every spec asserts through the DOM afterwards.
 */
export async function seedTree(page: Page, spec: SeedSpec[]): Promise<string[]> {
  return page.evaluate((nodes) => {
    const store = (window as unknown as { __THOUGHTTREE__: { [k: string]: unknown } })
      .__THOUGHTTREE__ as {
      addChild: (parentId: string | null, index: number, text: string) => string | null
      setPriority: (id: string, priority: string) => void
      toggleCollapse: (id: string) => void
    }
    const ids: string[] = []
    for (const node of nodes) {
      const parentId = node.parent === null ? null : ids[node.parent]
      const id = store.addChild(parentId, 0, node.text)
      if (!id) throw new Error(`seedTree could not create "${node.text}"`)
      if (node.important) store.setPriority(id, 'important')
      if (node.collapsed) store.toggleCollapse(id)
      ids.push(id)
    }
    return ids
  }, spec)
}

/**
 * A hand-rolled pointer drag. The DnD in `src/components/dnd.tsx` listens to
 * `pointerdown` on the handle and `pointermove`/`pointerup` on `window`, and
 * only starts once the pointer has moved past a 4px threshold — so
 * Playwright's `dragTo()` (which is HTML5 DnD) does not drive it.
 */
export async function pointerDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  // Cross the drag threshold first, then travel to the target in steps so every
  // intermediate position is resolved as a drop target.
  await page.mouse.move(from.x + 10, from.y + 10, { steps: 2 })
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await page.mouse.up()
}

/** Centre of an element, in viewport coordinates, for use with `pointerDrag`. */
export async function centre(
  page: Page,
  locator: ReturnType<Page['locator']> | string,
): Promise<{ x: number; y: number }> {
  const target = typeof locator === 'string' ? page.locator(locator).first() : locator.first()
  const box = await target.boundingBox()
  if (!box) throw new Error('element has no bounding box')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** Creates a top-level question through the UI's inline create input. */
export async function addRootViaUi(page: Page, text: string): Promise<void> {
  // The tree panel is the second column; its head holds the single "+" button.
  await page.locator('.workspace > .panel').nth(1).locator('.panel-head button').click()
  const input = page.locator('.create-input')
  await baseExpect(input).toBeVisible()
  await input.fill(text)
  await input.press('Enter')
  await input.press('Escape')
  await baseExpect(page.locator('.row .row-text', { hasText: text })).toBeVisible()
}

/** Captures a thought through the bottom capture bar and waits for the Inbox row. */
export async function captureViaUi(page: Page, text: string): Promise<void> {
  const bar = page.locator('[data-capture-bar]')
  await bar.click()
  await bar.fill(text)
  await bar.press('Enter')
  await baseExpect(page.locator('[data-inbox-id] .text', { hasText: text })).toBeVisible()
}
