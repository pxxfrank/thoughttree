import { invoke } from '@tauri-apps/api/core'
import type { Snapshot } from '../domain/types'

export const openCaptureWindow = (): Promise<unknown> => invoke('open_capture_window')
export const hideCaptureWindow = (): Promise<unknown> => invoke('hide_capture_window')
export const showMainWindow = (): Promise<unknown> => invoke('show_main_window')
export const hideMainWindow = (): Promise<unknown> => invoke('hide_main_window')
export const quitApp = (): Promise<unknown> => invoke('quit_app')
export const snapOrbWindow = (): Promise<unknown> => invoke('orb_snap_window')
export const peekOrbWindow = (): Promise<unknown> => invoke('orb_peek_window')
export const expandOrbWindow = (): Promise<unknown> => invoke('orb_expand_window')
export const setAppTheme = (theme: string): Promise<unknown> => invoke('set_app_theme', { theme })
export const fitMainToScreen = (width: number, height: number): Promise<unknown> =>
  invoke('fit_main_to_screen', { width, height })
export const captureSourceContext = (): Promise<{ app: string | null; title: string | null }> =>
  invoke('capture_source_context')
export const checkShortcut = (): Promise<unknown> => invoke('shortcut_status')

/** One rotating `.db` snapshot written by the Rust side at launch. */
export interface BackupInfo {
  name: string
  path: string
  created_at: number
  size: number
}

export const listBackups = (): Promise<BackupInfo[]> => invoke('list_backups')
export const restoreBackup = (path: string): Promise<Snapshot> =>
  invoke('restore_backup', { path })
