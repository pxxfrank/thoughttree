export type Priority = 'normal' | 'important'

export type Status = 'open' | 'later' | 'done' | 'archived'

export type RelationType =
  | 'decompose'
  | 'answer'
  | 'support'
  | 'challenge'
  | 'depends_on'

/** A node is a captured thought. Field names mirror the SQLite columns. */
export interface Node {
  id: string
  text: string
  created_at: number
  updated_at: number
  priority: Priority
  status: Status
  parent_id: string | null
  position: number
  note: string | null
  conclusion: string | null
  inbox: boolean
  collapsed: boolean
  source_app: string | null
  source_title: string | null
}

/**
 * An edge records *why* one node sits under another. `from_node` is the parent,
 * `to_node` the child. A node has at most one incoming edge.
 */
export interface Edge {
  id: string
  from_node: string
  to_node: string
  relation_type: RelationType
  reason: string | null
  created_at: number
}

/** The single write primitive: everything is an atomic set of upserts + deletes. */
export interface Changes {
  upsert_nodes: Node[]
  upsert_edges: Edge[]
  delete_nodes: string[]
  delete_edges: string[]
}

export interface Snapshot {
  nodes: Node[]
  edges: Edge[]
}

export const emptyChanges = (): Changes => ({
  upsert_nodes: [],
  upsert_edges: [],
  delete_nodes: [],
  delete_edges: [],
})

export const newId = (): string => crypto.randomUUID()

export const nowMs = (): number => Date.now()
