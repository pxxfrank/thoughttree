import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

/**
 * The version Settings displays. `package.json` is the copy Vite can read at
 * build time; at runtime the desktop app prefers the bundle's own version,
 * which is what the installer reports (see `ShortcutHelp`).
 */
const { version } = JSON.parse(readFileSync(r('./package.json'), 'utf-8')) as {
  version: string
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**', '**/target/**'] },
  },
  build: {
    target: 'chrome110',
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: r('./index.html'),
        orb: r('./orb.html'),
        capture: r('./capture.html'),
      },
    },
  },
})
