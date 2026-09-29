import type { Changes, Edge, Node, Snapshot } from './types'

export interface EntityState {
  nodes: Record<string, Node>
  edges: Record<string, Edge>
}

export const emptyEntityState = (): EntityState => ({ nodes: {}, edges: {} })

export function indexById<T extends { id: string }>(items: T[]): Record<string, T> {
  const out: Record<string, T> = {}
  for (const item of items) out[item.id] = item
  return out
}

export function fromSnapshot(snapshot: Snapshot): EntityState {
  return { nodes: indexById(snapshot.nodes), edges: indexById(snapshot.edges) }
}

export function toSnapshot(state: EntityState): Snapshot {
  return { nodes: Object.values(state.nodes), edges: Object.values(state.edges) }
}

export function isEmptyChanges(changes: Changes): boolean {
  return (
    changes.upsert_nodes.length === 0 &&
    changes.upsert_edges.length === 0 &&
    changes.delete_nodes.length === 0 &&
    changes.delete_edges.length === 0
  )
}

/**
 * The single reducer for the whole app. It mirrors the SQLite side exactly:
 * deleting a node cascades to its edges, and a node can only ever have one
 * incoming edge. Local state and the database therefore never drift, and the
 * same changeset can be replayed in any other window.
 */
export function applyChanges(state: EntityState, changes: Changes): EntityState {
  let nodes = state.nodes
  let edges = state.edges

  if (changes.delete_nodes.length) {
    const dead = new Set(changes.delete_nodes)
    nodes = { ...nodes }
    for (const id of dead) delete nodes[id]
    edges = { ...edges }
    for (const [id, edge] of Object.entries(edges)) {
      if (dead.has(edge.from_node) || dead.has(edge.to_node)) delete edges[id]
    }
  }

  if (changes.delete_edges.length) {
    edges = { ...edges }
    for (const id of changes.delete_edges) delete edges[id]
  }

  if (changes.upsert_nodes.length) {
    nodes = { ...nodes }
    for (const node of changes.upsert_nodes) nodes[node.id] = node
  }

  if (changes.upsert_edges.length) {
    edges = { ...edges }
    for (const edge of changes.upsert_edges) {
      for (const [id, existing] of Object.entries(edges)) {
        if (existing.to_node === edge.to_node && id !== edge.id) delete edges[id]
      }
      edges[edge.id] = edge
    }
  }

  return { nodes, edges }
}

/** Removes dangling edges; used as a cheap consistency check in tests. */
export function danglingEdges(state: EntityState): Edge[] {
  return Object.values(state.edges).filter(
    (e) => !state.nodes[e.from_node] || !state.nodes[e.to_node],
  )
}
