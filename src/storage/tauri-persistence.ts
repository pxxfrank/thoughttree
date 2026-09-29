import { invoke } from '@tauri-apps/api/core'
import { emit, listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { save } from '@tauri-apps/plugin-dialog'
import type { Changes, Snapshot } from '../domain/types'
import type { Persistence } from './persistence'

const CHANGES_EVENT = 'tt://changes'

/** Talks to the Rust side: one atomic changeset per write, broadcast to peers. */
export class TauriPersistence implements Persistence {
  private windowLabel = 'main'

  async init(): Promise<void> {
    try {
      this.windowLabel = getCurrentWindow().label
    } catch {
      this.windowLabel = 'main'
    }
  }

  load(): Promise<Snapshot> {
    return invoke<Snapshot>('db_load')
  }

  async apply(changes: Changes): Promise<void> {
    await invoke('db_apply', { changes })
  }

  broadcast(changes: Changes): void {
    void emit(CHANGES_EVENT, { origin: this.windowLabel, changes })
  }

  onRemote(handler: (changes: Changes) => void): () => void {
    let dispose: (() => void) | undefined
    void listen<{ origin: string; changes: Changes }>(CHANGES_EVENT, (event) => {
      if (event.payload.origin === this.windowLabel) return
      handler(event.payload.changes)
    }).then((unlisten) => {
      dispose = unlisten
    })
    return () => dispose?.()
  }

  async exportJson(): Promise<string | null> {
    const target = await save({
      title: 'Export ThoughtTree data',
      defaultPath: 'thoughttree-export.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (!target) return null
    return invoke<string>('export_data', { path: target })
  }

  readImport(path: string): Promise<Snapshot> {
    return invoke<Snapshot>('read_import', { path })
  }

  dataDirectory(): Promise<string> {
    return invoke<string>('data_dir')
  }

  readSettings(): Promise<Record<string, string>> {
    return invoke<Record<string, string>>('settings_all')
  }

  async writeSetting(key: string, value: string): Promise<void> {
    await invoke('settings_set', { key, value })
  }

  async applyShortcut(accel: string): Promise<void> {
    await invoke('set_shortcut', { accel })
  }
}
