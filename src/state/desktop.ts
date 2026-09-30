import { MemoryPersistence } from '../storage/memory-persistence'
import { TauriPersistence } from '../storage/tauri-persistence'
import { AppStore } from './store'

/** True only inside the packaged desktop app; false in a plain browser. */
const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export async function createDesktopStore(): Promise<AppStore> {
  if (inTauri) {
    const persistence = new TauriPersistence()
    await persistence.init()
    return new AppStore(persistence)
  }

  // Outside Tauri (a plain browser via `pnpm dev`, or the E2E harness) there is
  // no Rust side to talk to, so the local-first store runs on in-memory
  // persistence instead. This is what makes the app openable in an ordinary
  // browser, and it lets the browser-driven tests drive the real UI.
  const store = new AppStore(new MemoryPersistence())
  // Exposed for tests only. The assignment lives in the non-Tauri branch, so it
  // can never happen inside the desktop build.
  ;(window as unknown as { __THOUGHTTREE__?: AppStore }).__THOUGHTTREE__ = store
  return store
}
