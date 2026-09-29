import { edgeForNode } from './relations'
import { canReparent, descendantIds, indexChildren, orderWithMany } from './tree'
import { emptyChanges, newId, nowMs } from './types'
import type { Changes, Edge, Node, Priority, RelationType, Status } from './types'

export class DomainError extends Error {}

/** A reversible edit: the forward changeset plus the changeset that undoes it. */
export interface Mutation {
  label: string
  forward: Changes
  backward: Changes
}

export interface MutationContext {
  nodes: Node[]
  edges: Edge[]
}

/** Siblings are spaced this far apart so their order is exact and stable. */
const SIBLING_GAP = 1000

export function newNode(text: string, now: number, overrides: Partial<Node> = {}): Node {
  return {
    id: newId(),
    text,
    created_at: now,
    updated_at: now,
    priority: 'normal',
    status: 'open',
    parent_id: null,
    position: SIBLING_GAP,
    note: null,
    conclusion: null,
    inbox: false,
    collapsed: false,
    source_app: null,
    source_title: null,
    ...overrides,
  }
}

/** Capture: the only action that puts a thought into the Inbox. */
export function captureMutation(
  text: string,
  now = nowMs(),
  source: { app?: string | null; title?: string | null } = {},
): Mutation | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const created = newNode(trimmed, now, {
    inbox: true,
    position: now,
    source_app: source.app ?? null,
    source_title: source.title ?? null,
  })
  return {
    label: 'Capture',
    forward: { ...emptyChanges(), upsert_nodes: [created] },
    backward: { ...emptyChanges(), delete_nodes: [created.id] },
  }
}

function patch(prev: Node, changes: Partial<Node>, label: string, now: number): Mutation | null {
  const next: Node = { ...prev, ...changes, updated_at: now }
  const unchanged = (Object.keys(changes) as (keyof Node)[]).every((k) => prev[k] === next[k])
  if (unchanged) return null
  return {
    label,
    forward: { ...emptyChanges(), upsert_nodes: [next] },
    backward: { ...emptyChanges(), upsert_nodes: [prev] },
  }
}

export function setTextMutation(prev: Node, text: string, now = nowMs()): Mutation | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  return patch(prev, { text: trimmed }, 'Edit question', now)
}

export function setStatusMutation(prev: Node, status: Status, now = nowMs()): Mutation | null {
  return patch(prev, { status }, `Mark ${status}`, now)
}

export function setPriorityMutation(
  prev: Node,
  priority: Priority,
  now = nowMs(),
): Mutation | null {
  return patch(
    prev,
    { priority },
    priority === 'important' ? 'Mark important' : 'Unmark important',
    now,
  )
}

/** Archiving files a thought away, so it stops being pending triage in the Inbox. */
export function setStatusFromInboxMutation(
  prev: Node,
  status: Status,
  now = nowMs(),
): Mutation | null {
  return patch(
    prev,
    status === 'archived' ? { status, inbox: false } : { status },
    status === 'archived' ? 'Archive' : `Mark ${status}`,
    now,
  )
}

export function setNoteMutation(prev: Node, note: string, now = nowMs()): Mutation | null {
  return patch(prev, { note: note.trim().length ? note : null }, 'Edit notes', now)
}

export function setConclusionMutation(
  prev: Node,
  conclusion: string,
  now = nowMs(),
): Mutation | null {
  return patch(
    prev,
    { conclusion: conclusion.trim().length ? conclusion : null },
    'Edit conclusion',
    now,
  )
}

export function toggleCollapseMutation(prev: Node, now = nowMs()): Mutation | null {
  return patch(prev, { collapsed: !prev.collapsed }, 'Toggle children', now)
}

/** Deletes a node and everything beneath it, so no orphan is ever left behind. */
export function deleteMutation(ctx: MutationContext, ids: string[]): Mutation | null {
  const existing = new Set(ctx.nodes.map((n) => n.id))
  const doomed = new Set<string>()
  for (const id of ids) {
    if (!existing.has(id)) continue
    doomed.add(id)
    for (const child of descendantIds(ctx.nodes, id)) doomed.add(child)
  }
  if (doomed.size === 0) return null

  const removedNodes = ctx.nodes.filter((n) => doomed.has(n.id))
  const removedEdges = ctx.edges.filter((e) => doomed.has(e.from_node) || doomed.has(e.to_node))
  return {
    label: removedNodes.length > 1 ? `Delete ${removedNodes.length} questions` : 'Delete question',
    forward: { ...emptyChanges(), delete_nodes: [...doomed] },
    backward: { ...emptyChanges(), upsert_nodes: removedNodes, upsert_edges: removedEdges },
  }
}

/**
 * Renumbers a parent's children and writes back only the rows that actually
 * changed. Explicit renumbering keeps ordering exact forever (no fractional
 * drift) and is cheap because sibling lists are short. Nodes that are moving
 * also leave the Inbox and get a fresh `updated_at`.
 */
function orderUpdates(
  ctx: MutationContext,
  parentId: string | null,
  orderedChildIds: string[],
  movingIds: ReadonlySet<string>,
  now: number,
): { forward: Node[]; backward: Node[] } {
  const byId = new Map(ctx.nodes.map((n) => [n.id, n]))
  const forward: Node[] = []
  const backward: Node[] = []
  orderedChildIds.forEach((childId, index) => {
    const existing = byId.get(childId)
    if (!existing) return
    const isMoving = movingIds.has(childId)
    const target = index * SIBLING_GAP
    if (!isMoving && existing.position === target) return
    forward.push({
      ...existing,
      parent_id: isMoving ? parentId : existing.parent_id,
      position: target,
      inbox: isMoving ? false : existing.inbox,
      updated_at: isMoving ? now : existing.updated_at,
    })
    backward.push(existing)
  })
  return { forward, backward }
}

/**
 * Creates a question directly in the tree (keyboard flow). Its relation starts
 * unexplained, so it appears under the "unexplained relations" filter until the
 * user says why it belongs there.
 */
export function addChildMutation(
  ctx: MutationContext,
  parentId: string | null,
  index: number,
  text: string,
  now = nowMs(),
): Mutation | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const siblings = indexChildren(ctx.nodes).get(parentId) ?? []
  const created = newNode(trimmed, now, { parent_id: parentId })
  const ordered = orderWithMany(siblings, [created.id], index)
  const byId = new Map(ctx.nodes.map((n) => [n.id, n]))

  const forward: Changes = emptyChanges()
  const backward: Changes = emptyChanges()
  ordered.forEach((childId, i) => {
    const target = i * SIBLING_GAP
    if (childId === created.id) {
      forward.upsert_nodes.push({ ...created, position: target })
      return
    }
    const existing = byId.get(childId)
    if (!existing || existing.position === target) return
    forward.upsert_nodes.push({ ...existing, position: target })
    backward.upsert_nodes.push(existing)
  })
  backward.delete_nodes.push(created.id)

  if (parentId) {
    forward.upsert_edges.push({
      id: newId(),
      from_node: parentId,
      to_node: created.id,
      relation_type: 'decompose',
      reason: null,
      created_at: now,
    })
  }
  return { label: 'Add question', forward, backward }
}

/**
 * Moving a question is the moment the user makes a judgement. When the parent
 * changes the previous reason no longer holds, so the relation resets and the
 * UI asks "why here?".
 */
export function placeMutation(
  ctx: MutationContext,
  ids: string[],
  newParentId: string | null,
  orderedChildIds: string[],
  now = nowMs(),
  options: { expandParent?: boolean } = {},
): Mutation | null {
  const moves = ids.filter((id) => ctx.nodes.some((n) => n.id === id))
  if (moves.length === 0) return null
  for (const id of moves) {
    if (!canReparent(ctx.nodes, id, newParentId)) {
      throw new DomainError('A question cannot be moved inside itself')
    }
  }

  const forward = emptyChanges()
  const backward = emptyChanges()
  const order = orderUpdates(ctx, newParentId, orderedChildIds, new Set(moves), now)
  forward.upsert_nodes.push(...order.forward)
  backward.upsert_nodes.push(...order.backward)

  // A drop into a collapsed parent would land out of sight.
  if (options.expandParent && newParentId) {
    const parent = ctx.nodes.find((n) => n.id === newParentId)
    if (parent?.collapsed) {
      forward.upsert_nodes.push({ ...parent, collapsed: false })
      backward.upsert_nodes.push(parent)
    }
  }

  for (const id of moves) {
    const previousEdge = edgeForNode(ctx.edges, id)
    if (newParentId === null) {
      if (previousEdge) {
        forward.delete_edges.push(previousEdge.id)
        backward.upsert_edges.push(previousEdge)
      }
      continue
    }
    if (previousEdge && previousEdge.from_node === newParentId) continue
    const nextEdge: Edge = {
      id: previousEdge?.id ?? newId(),
      from_node: newParentId,
      to_node: id,
      relation_type: 'decompose',
      reason: null,
      created_at: previousEdge?.created_at ?? now,
    }
    forward.upsert_edges.push(nextEdge)
    if (previousEdge) backward.upsert_edges.push(previousEdge)
    else backward.delete_edges.push(nextEdge.id)
  }

  return {
    label: moves.length === 1 ? 'Move question' : `Move ${moves.length} questions`,
    forward,
    backward,
  }
}

export function setRelationMutation(
  edge: Edge,
  relationType: RelationType,
  reason: string,
): Mutation | null {
  const trimmed = reason.trim()
  const next: Edge = {
    ...edge,
    relation_type: relationType,
    reason: trimmed.length ? trimmed : null,
  }
  if (next.relation_type === edge.relation_type && next.reason === edge.reason) return null
  return {
    label: 'Explain relation',
    forward: { ...emptyChanges(), upsert_edges: [next] },
    backward: { ...emptyChanges(), upsert_edges: [edge] },
  }
}
