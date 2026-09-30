import { defineConfig, devices } from '@playwright/test'

/**
 * Real-browser E2E harness. The app runs on in-memory persistence outside Tauri
 * (see `src/state/desktop.ts`), so the Vite dev server alone is enough to drive
 * the whole UI.
 */
export default defineConfig({
  testDir: './e2e',
  // This is a slow VM and reliability matters more than speed, so the specs run
  // one at a time rather than in parallel workers.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:1420',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:1420',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
