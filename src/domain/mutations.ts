import { edgeForNode, edgeKind } from './relations'
import { canReparent, descendantIds, indexChildren, orderWithMany, ancestorsOf } from './tree'
import { applyChanges, danglingEdges, indexById } from './changes'
import type { EntityState } from './changes'
import { emptyChanges, newId, nowMs } from './types'
import type { Changes, Edge, Node, Priority, RelationType, Snapshot, Status } from './types'

/**
 * A rejected edit. It carries a translation key rather than a message, because
 * these reach the user: an untranslated English string inside a Chinese UI is
 * exactly what the i18n layer exists to prevent.
 */
export class DomainError extends Error {
  constructor(public readonly key: string) {
    super(key)
    this.name = 'DomainError'
  }
}

/** A reversible edit: the forward changeset plus the changeset that undoes it. */
export interface Mutation {
  /** Translation key; the domain never owns display text. */
  labelKey: string
  labelParams?: Record<string, number>
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
    source_url: null,
    ...overrides,
  }
}

/** Capture: the only action that puts a thought into the Inbox. */
export function captureMutation(
  text: string,
  now = nowMs(),
  source: { app?: string | null; title?: string | null; url?: string | null } = {},
): Mutation | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const created = newNode(trimmed, now, {
    inbox: true,
    position: now,
    source_app: source.app ?? null,
    source_title: source.title ?? null,
    source_url: source.url ?? null,
  })
  return {
    labelKey: 'mutation.capture',
    forward: { ...emptyChanges(), upsert_nodes: [created] },
    backward: { ...emptyChanges(), delete_nodes: [created.id] },
  }
}

function patch(
  prev: Node,
  changes: Partial<Node>,
  labelKey: string,
  now: number,
): Mutation | null {
  const next: Node = { ...prev, ...changes, updated_at: now }
  const unchanged = (Object.keys(changes) as (keyof Node)[]).every((k) => prev[k] === next[k])
  if (unchanged) return null
  return {
    labelKey,
    forward: { ...emptyChanges(), upsert_nodes: [next] },
    backward: { ...emptyChanges(), upsert_nodes: [prev] },
  }
}

export function setTextMutation(prev: Node, text: string, now = nowMs()): Mutation | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  return patch(prev, { text: trimmed }, 'mutation.editQuestion', now)
}

export function setStatusMutation(prev: Node, status: Status, now = nowMs()): Mutation | null {
  return patch(prev, { status }, `mutation.mark${statusLabel(status)}`, now)
}

export function setPriorityMutation(
  prev: Node,
  priority: Priority,
  now = nowMs(),
): Mutation | null {
  return patch(
    prev,
    { priority },
    priority === 'important' ? 'mutation.markImportant' : 'mutation.markNormal',
    now,
  )
}

function statusLabel(status: Status): string {
  return status.charAt(0).toUpperCase() + status.slice(1)
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
    status === 'archived' ? 'mutation.archive' : `mutation.mark${statusLabel(status)}`,
    now,
  )
}

export function setNoteMutation(prev: Node, note: string, now = nowMs()): Mutation | null {
  return patch(prev, { note: note.trim().length ? note : null }, 'mutation.editNotes', now)
}

export function setConclusionMutation(
  prev: Node,
  conclusion: string,
  now = nowMs(),
): Mutation | null {
  return patch(
    prev,
    { conclusion: conclusion.trim().length ? conclusion : null },
    'mutation.editConclusion',
    now,
  )
}

export function toggleCollapseMutation(prev: Node, now = nowMs()): Mutation | null {
  return patch(prev, { collapsed: !prev.collapsed }, 'mutation.toggleChildren', now)
}

/**
 * Opens every collapsed ancestor of a node, so jumping to it from search lands
 * it in view instead of inside a folded branch. Returns null when the path is
 * already open.
 */
export function expandAncestorsMutation(
  nodes: Node[],
  id: string,
  now = nowMs(),
): Mutation | null {
  const collapsed = ancestorsOf(nodes, id).filter((ancestor) => ancestor.collapsed)
  if (collapsed.length === 0) return null
  return {
    labelKey: 'mutation.expandTo',
    forward: {
      ...emptyChanges(),
      upsert_nodes: collapsed.map((ancestor) => ({ ...ancestor, collapsed: false, updated_at: now })),
    },
    backward: { ...emptyChanges(), upsert_nodes: collapsed },
  }
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
    labelKey: removedNodes.length > 1 ? 'mutation.deleteMany' : 'mutation.deleteOne',
    labelParams: removedNodes.length > 1 ? { n: removedNodes.length } : undefined,
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
      kind: 'parent',
    })
  }
  return { labelKey: 'mutation.addQuestion', forward, backward }
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
      throw new DomainError('error.moveInsideSelf')
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
      kind: 'parent',
    }
    forward.upsert_edges.push(nextEdge)
    if (previousEdge) backward.upsert_edges.push(previousEdge)
    else backward.delete_edges.push(nextEdge.id)
  }

  return {
    labelKey: moves.length === 1 ? 'mutation.moveOne' : 'mutation.moveMany',
    labelParams: moves.length === 1 ? undefined : { n: moves.length },
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
    labelKey: 'mutation.explainRelation',
    forward: { ...emptyChanges(), upsert_edges: [next] },
    backward: { ...emptyChanges(), upsert_edges: [edge] },
  }
}

/**
 * Adds a cross-branch link: a typed, reasoned relation from one node to another
 * that is independent of the tree. It is not bound by the one-parent invariant,
 * so a node may hold any number of links — and a link is allowed to form a cycle
 * the tree itself cannot. Only a self-link is refused.
 */
export function addLinkMutation(
  ctx: MutationContext,
  fromId: string,
  toId: string,
  relationType: RelationType,
  reason: string,
  now = nowMs(),
): Mutation | null {
  if (fromId === toId) throw new DomainError('error.linkSelf')
  const duplicate = ctx.edges.some(
    (edge) =>
      edgeKind(edge) === 'link' &&
      edge.from_node === fromId &&
      edge.to_node === toId &&
      edge.relation_type === relationType,
  )
  if (duplicate) return null

  const trimmed = reason.trim()
  const link: Edge = {
    id: newId(),
    from_node: fromId,
    to_node: toId,
    relation_type: relationType,
    reason: trimmed.length ? trimmed : null,
    created_at: now,
    kind: 'link',
  }
  return {
    labelKey: 'mutation.addLink',
    forward: { ...emptyChanges(), upsert_edges: [link] },
    backward: { ...emptyChanges(), delete_edges: [link.id] },
  }
}

/** Re-types or re-reasons an existing link; mirrors `setRelationMutation`. */
export function setLinkMutation(
  link: Edge,
  relationType: RelationType,
  reason: string,
): Mutation | null {
  const trimmed = reason.trim()
  const next: Edge = {
    ...link,
    relation_type: relationType,
    reason: trimmed.length ? trimmed : null,
  }
  if (next.relation_type === link.relation_type && next.reason === link.reason) return null
  return {
    labelKey: 'mutation.editLink',
    forward: { ...emptyChanges(), upsert_edges: [next] },
    backward: { ...emptyChanges(), upsert_edges: [link] },
  }
}

/** Removes a link; undo re-creates it from the same row. */
export function deleteLinkMutation(link: Edge): Mutation {
  return {
    labelKey: 'mutation.removeLink',
    forward: { ...emptyChanges(), delete_edges: [link.id] },
    backward: { ...emptyChanges(), upsert_edges: [link] },
  }
}

/**
 * Merges an exported snapshot into the tree. The file wins on an id conflict;
 * every id the file does not mention is left exactly as it is.
 *
 * Unlike a single-row edit this can touch hundreds of rows at once, but it is
 * still one reversible `Mutation`: undo restores the previous version of every
 * node the file overwrote and removes every node it introduced.
 */
export function importMutation(ctx: MutationContext, snapshot: Snapshot): Mutation | null {
  const before: EntityState = { nodes: indexById(ctx.nodes), edges: indexById(ctx.edges) }

  const draft: Changes = {
    ...emptyChanges(),
    upsert_nodes: snapshot.nodes,
    upsert_edges: snapshot.edges,
  }

  // An imported edge whose endpoint is in neither the file nor the existing tree
  // would be an orphan; drop it rather than write it.
  const orphaned = new Set(
    danglingEdges(applyChanges(before, draft)).map((edge) => edge.id),
  )
  const forward: Changes = {
    ...draft,
    upsert_edges: draft.upsert_edges.filter((edge) => !orphaned.has(edge.id)),
  }
  if (forward.upsert_nodes.length === 0 && forward.upsert_edges.length === 0) return null

  const after = applyChanges(before, forward)
  const backward = emptyChanges()

  for (const node of forward.upsert_nodes) {
    const previous = before.nodes[node.id]
    if (previous) backward.upsert_nodes.push(previous)
    else backward.delete_nodes.push(node.id)
  }

  // Edges the import added are removed; edges it replaced — including an edge
  // displaced by the one-incoming-edge rule — are put back.
  for (const [id, edge] of Object.entries(after.edges)) {
    const previous = before.edges[id]
    if (!previous) backward.delete_edges.push(id)
    else if (previous !== edge) backward.upsert_edges.push(previous)
  }
  for (const [id, edge] of Object.entries(before.edges)) {
    if (!after.edges[id]) backward.upsert_edges.push(edge)
  }

  return { labelKey: 'mutation.import', forward, backward }
}
