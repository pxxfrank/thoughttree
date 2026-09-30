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
  source_url: string | null
}

/**
 * What an edge means. `'parent'` is the tree link (from_node is the parent,
 * to_node the child, and a child has at most one). `'link'` is a cross-branch
 * relation: from_node is the subject, to_node the object, and a node may have
 * any number of them in either direction.
 */
export type EdgeKind = 'parent' | 'link'

/**
 * An edge records *why* one node relates to another. For a `'parent'` edge
 * `from_node` is the parent and `to_node` the child, and a node has at most one
 * incoming parent edge. A `'link'` edge is a cross-cutting relation between any
 * two nodes and is not bound by that invariant.
 */
export interface Edge {
  id: string
  from_node: string
  to_node: string
  relation_type: RelationType
  reason: string | null
  created_at: number
  kind: EdgeKind
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
