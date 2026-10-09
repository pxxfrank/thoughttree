import { invoke } from '@tauri-apps/api/core'
import type { Snapshot } from '../domain/types'

/**
 * The desktop shell exists only inside Tauri. In a plain browser (`pnpm dev`,
 * and the E2E harness) `window.__TAURI_INTERNALS__` is absent, so `invoke` has
 * nothing to talk to and each call below would reject — silently, because these
 * are fire-and-forget UI commands. Outside Tauri every call therefore becomes a
 * harmless no-op instead. The desktop build is untouched: `inTauri` is true
 * there and the real command always runs.
 */
const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

function shell<T>(command: string, args?: Record<string, unknown>, fallback?: T): Promise<T> {
  if (inTauri) return invoke<T>(command, args)
  return Promise.resolve(fallback as T)
}

export const openCaptureWindow = (): Promise<unknown> => shell('open_capture_window')
export const hideCaptureWindow = (): Promise<unknown> => shell('hide_capture_window')
export const showMainWindow = (): Promise<unknown> => shell('show_main_window')
export const hideMainWindow = (): Promise<unknown> => shell('hide_main_window')
export const quitApp = (): Promise<unknown> => shell('quit_app')
export const setAppTheme = (theme: string): Promise<unknown> => shell('set_app_theme', { theme })
export const fitMainToScreen = (width: number, height: number): Promise<unknown> =>
  shell('fit_main_to_screen', { width, height })
export const captureSourceContext = (): Promise<{
  app: string | null
  title: string | null
  url: string | null
}> => shell('capture_source_context', undefined, { app: null, title: null, url: null })
export const openUrl = (url: string): Promise<void> => shell<void>('open_url', { url })
export const checkShortcut = (): Promise<unknown> => shell('shortcut_status')

/** One rotating `.db` snapshot written by the Rust side at launch. */
export interface BackupInfo {
  name: string
  path: string
  created_at: number
  size: number
}

export const listBackups = (): Promise<BackupInfo[]> => shell('list_backups', undefined, [])
export const restoreBackup = (path: string): Promise<Snapshot> =>
  shell('restore_backup', { path }, { nodes: [], edges: [] })
