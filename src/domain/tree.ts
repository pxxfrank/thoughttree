import type { Node } from './types'

/** Children are ordered by fractional `position`, with creation time as tiebreak. */
export function compareSiblings(a: Node, b: Node): number {
  if (a.position !== b.position) return a.position - b.position
  return a.created_at - b.created_at
}

/**
 * Groups nodes by parent in one pass and sorts each sibling list. Nodes whose
 * parent is missing (or points at themselves) are treated as roots so a bad row
 * can never make a thought invisible.
 */
export function indexChildren(nodes: Node[]): Map<string | null, Node[]> {
  const ids = new Set(nodes.map((n) => n.id))
  const index = new Map<string | null, Node[]>()
  for (const node of nodes) {
    const parentId =
      node.parent_id && node.parent_id !== node.id && ids.has(node.parent_id)
        ? node.parent_id
        : null
    const bucket = index.get(parentId)
    if (bucket) bucket.push(node)
    else index.set(parentId, [node])
  }
  for (const bucket of index.values()) bucket.sort(compareSiblings)
  return index
}

export function childrenOf(nodes: Node[], parentId: string | null): Node[] {
  return indexChildren(nodes).get(parentId) ?? []
}

export function roots(nodes: Node[]): Node[] {
  return childrenOf(nodes, null)
}

export function findByText(nodes: Node[], query: string): Node[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  return nodes.filter((n) => n.text.toLowerCase().includes(needle))
}

export interface TreeItem {
  node: Node
  depth: number
  children: TreeItem[]
}

export function buildForest(nodes: Node[]): TreeItem[] {
  const index = indexChildren(nodes)
  const seen = new Set<string>()
  const walk = (parentId: string | null, depth: number): TreeItem[] => {
    const bucket = index.get(parentId) ?? []
    const items: TreeItem[] = []
    for (const node of bucket) {
      // Guards against a corrupted parent cycle causing infinite recursion.
      if (seen.has(node.id)) continue
      seen.add(node.id)
      items.push({ node, depth, children: walk(node.id, depth + 1) })
    }
    return items
  }
  return walk(null, 0)
}

/** Depth-first display order, skipping the children of collapsed nodes. */
export function flatten(forest: TreeItem[], skipChildrenOf: (node: Node) => boolean): TreeItem[] {
  const out: TreeItem[] = []
  const visit = (items: TreeItem[]) => {
    for (const item of items) {
      out.push(item)
      if (!skipChildrenOf(item.node)) visit(item.children)
    }
  }
  visit(forest)
  return out
}

export function descendantIds(nodes: Node[], rootId: string): string[] {
  const index = indexChildren(nodes)
  const out: string[] = []
  const stack = [rootId]
  const seen = new Set<string>([rootId])
  while (stack.length) {
    const id = stack.pop() as string
    for (const child of index.get(id) ?? []) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      out.push(child.id)
      stack.push(child.id)
    }
  }
  return out
}

export function isDescendantOf(nodes: Node[], ancestorId: string, candidateId: string): boolean {
  return descendantIds(nodes, ancestorId).includes(candidateId)
}

/** A node may not become a child of itself or of one of its own descendants. */
export function canReparent(nodes: Node[], nodeId: string, newParentId: string | null): boolean {
  if (newParentId === null) return true
  if (newParentId === nodeId) return false
  return !isDescendantOf(nodes, nodeId, newParentId)
}

export function ancestorsOf(nodes: Node[], id: string): Node[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const chain: Node[] = []
  const seen = new Set<string>([id])
  let cursor = byId.get(id)?.parent_id ?? null
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor)
    const parent = byId.get(cursor)
    if (!parent) break
    chain.unshift(parent)
    cursor = parent.parent_id
  }
  return chain
}

export function pathText(nodes: Node[], id: string): string {
  const chain = [...ancestorsOf(nodes, id), nodes.find((n) => n.id === id)].filter(Boolean)
  return chain.map((n) => (n as Node).text).join(' › ')
}

/**
 * Sibling ids in their new order after inserting `ids` at `index`. The moved
 * ids are taken out of the list first, so the index always refers to the list
 * the user is looking at.
 */
export function orderWithMany(siblings: Node[], ids: string[], index: number): string[] {
  const moving = new Set(ids)
  const rest = siblings.filter((s) => !moving.has(s.id)).map((s) => s.id)
  const clamped = Math.max(0, Math.min(index, rest.length))
  return [...rest.slice(0, clamped), ...ids.filter((id) => !rest.includes(id)), ...rest.slice(clamped)]
}

export function subtreeSize(nodes: Node[], id: string): number {
  return descendantIds(nodes, id).length + 1
}
