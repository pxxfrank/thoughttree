import type { Edge, EdgeKind, Node, RelationType } from './types'

export const RELATION_TYPES: RelationType[] = [
  'decompose',
  'answer',
  'support',
  'challenge',
  'depends_on',
]

/**
 * The relation types that make sense as a cross-branch link: they point at a
 * node elsewhere in the tree, not at its parent. Order is the display order.
 */
export const LINK_RELATION_TYPES: RelationType[] = ['support', 'challenge', 'depends_on']

/**
 * Presentation lives in the i18n layer: the domain only owns the vocabulary.
 * `relation.key` / `relation.key.hint` resolve to a label and a one-line
 * explanation in the active language.
 */
export function relationKey(type: RelationType): string {
  return `relation.${type}`
}

/**
 * A missing `kind` can only come from data written before the feature existed,
 * where every edge was a parent edge — so it reads as `'parent'`.
 */
export function edgeKind(edge: Edge): EdgeKind {
  return (edge as { kind?: EdgeKind }).kind ?? 'parent'
}

/** The single incoming *parent* edge of a node, i.e. the reason it sits here. */
export function edgeForNode(edges: Edge[], nodeId: string): Edge | undefined {
  return edges.find((e) => e.to_node === nodeId && edgeKind(e) === 'parent')
}

export function isExplained(edge: Edge | undefined): boolean {
  return !!edge && !!edge.reason && edge.reason.trim().length > 0
}

/**
 * A node's cross-branch links, split by direction. A link's `from_node` is the
 * subject, so `outgoing` is everything this node points at and `incoming` is
 * everything that points back at it.
 */
export function linksForNode(
  edges: Edge[],
  nodeId: string,
): { outgoing: Edge[]; incoming: Edge[] } {
  const links = edges.filter((edge) => edgeKind(edge) === 'link')
  return {
    outgoing: links.filter((edge) => edge.from_node === nodeId),
    incoming: links.filter((edge) => edge.to_node === nodeId),
  }
}

/** Every node id that takes part in at least one link, in either direction. */
export function linkedNodeIds(edges: Edge[]): Set<string> {
  const ids = new Set<string>()
  for (const edge of edges) {
    if (edgeKind(edge) !== 'link') continue
    ids.add(edge.from_node)
    ids.add(edge.to_node)
  }
  return ids
}

/** Node ids on the other end of any link touching `nodeId`, either direction. */
export function relatedNodeIds(edges: Edge[], nodeId: string): Set<string> {
  const ids = new Set<string>()
  for (const edge of edges) {
    if (edgeKind(edge) !== 'link') continue
    if (edge.from_node === nodeId) {
      if (edge.to_node !== nodeId) ids.add(edge.to_node)
    } else if (edge.to_node === nodeId) {
      if (edge.from_node !== nodeId) ids.add(edge.from_node)
    }
  }
  return ids
}

/**
 * Nodes that sit under a parent without a stated reason. These are the ones the
 * "unexplained relations" filter collects for a later pass — the product
 * philosophy without the friction.
 */
export function unexplainedNodeIds(nodes: Node[], edges: Edge[]): Set<string> {
  const byTo = new Map(
    edges.filter((edge) => edgeKind(edge) === 'parent').map((e) => [e.to_node, e]),
  )
  const out = new Set<string>()
  for (const node of nodes) {
    if (node.parent_id === null) continue
    if (!isExplained(byTo.get(node.id))) out.add(node.id)
  }
  return out
}
