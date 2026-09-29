import type { Changes, Snapshot } from '../domain/types'

/**
 * Everything the app needs from its environment. Two implementations exist: the
 * Tauri/SQLite one used by the desktop app, and an in-memory one that lets the
 * whole store be exercised in tests without a browser or a database.
 */
export interface Persistence {
  load(): Promise<Snapshot>
  apply(changes: Changes): Promise<void>
  /** Tells the other windows about a changeset so they stay in step. */
  broadcast(changes: Changes): void
  onRemote(handler: (changes: Changes) => void): () => void
  exportJson(): Promise<string | null>
  /** Reads an exported file back into a snapshot; writes nothing. */
  readImport(path: string): Promise<Snapshot>
  dataDirectory(): Promise<string>
  readSettings(): Promise<Record<string, string>>
  writeSetting(key: string, value: string): Promise<void>
  applyShortcut(accel: string): Promise<void>
}
