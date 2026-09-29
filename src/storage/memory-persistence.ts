import type { Changes, Snapshot } from '../domain/types'
import type { Persistence } from './persistence'

/** In-memory persistence used by tests. Records everything it is asked to store. */
export class MemoryPersistence implements Persistence {
  snapshot: Snapshot = { nodes: [], edges: [] }
  applied: Changes[] = []
  failNext = false
  exportedPath: string | null = null
  /** What the next `readImport` returns (e.g. a file the test staged). */
  imported: Snapshot = { nodes: [], edges: [] }
  importedPath: string | null = null
  failImport = false
  settings: Record<string, string> = {}
  shortcuts: string[] = []
  private handlers = new Set<(changes: Changes) => void>()

  async load(): Promise<Snapshot> {
    return { nodes: [...this.snapshot.nodes], edges: [...this.snapshot.edges] }
  }

  async apply(changes: Changes): Promise<void> {
    if (this.failNext) {
      this.failNext = false
      throw new Error('disk unavailable')
    }
    this.applied.push(changes)
    const nodes = new Map(this.snapshot.nodes.map((n) => [n.id, n]))
    const edges = new Map(this.snapshot.edges.map((e) => [e.id, e]))
    for (const id of changes.delete_nodes) {
      nodes.delete(id)
      for (const [edgeId, edge] of edges) {
        if (edge.from_node === id || edge.to_node === id) edges.delete(edgeId)
      }
    }
    for (const id of changes.delete_edges) edges.delete(id)
    for (const node of changes.upsert_nodes) nodes.set(node.id, node)
    for (const edge of changes.upsert_edges) {
      for (const [edgeId, existing] of edges) {
        if (existing.to_node === edge.to_node && edgeId !== edge.id) edges.delete(edgeId)
      }
      edges.set(edge.id, edge)
    }
    this.snapshot = { nodes: [...nodes.values()], edges: [...edges.values()] }
  }

  broadcast(changes: Changes): void {
    for (const handler of this.handlers) handler(changes)
  }

  onRemote(handler: (changes: Changes) => void): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  async exportJson(): Promise<string | null> {
    this.exportedPath = 'export.json'
    return this.exportedPath
  }

  async readImport(path: string): Promise<Snapshot> {
    if (this.failImport) throw new Error('error.importFormat')
    this.importedPath = path
    return { nodes: [...this.imported.nodes], edges: [...this.imported.edges] }
  }

  async dataDirectory(): Promise<string> {
    return '/tmp/thoughttree'
  }

  async readSettings(): Promise<Record<string, string>> {
    return { ...this.settings }
  }

  async writeSetting(key: string, value: string): Promise<void> {
    this.settings[key] = value
  }

  async applyShortcut(accel: string): Promise<void> {
    this.shortcuts.push(accel)
  }
}
