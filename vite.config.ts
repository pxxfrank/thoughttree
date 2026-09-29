import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
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
