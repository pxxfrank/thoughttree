import type { Edge, Node, RelationType } from './types'

export const RELATION_TYPES: RelationType[] = [
  'decompose',
  'answer',
  'support',
  'challenge',
  'depends_on',
]

/**
 * Presentation lives in the i18n layer: the domain only owns the vocabulary.
 * `relation.key` / `relation.key.hint` resolve to a label and a one-line
 * explanation in the active language.
 */
export function relationKey(type: RelationType): string {
  return `relation.${type}`
}

/** The single incoming edge of a node, i.e. the reason it sits where it sits. */
export function edgeForNode(edges: Edge[], nodeId: string): Edge | undefined {
  return edges.find((e) => e.to_node === nodeId)
}

export function isExplained(edge: Edge | undefined): boolean {
  return !!edge && !!edge.reason && edge.reason.trim().length > 0
}

/**
 * Nodes that sit under a parent without a stated reason. These are the ones the
 * "unexplained relations" filter collects for a later pass — the product
 * philosophy without the friction.
 */
export function unexplainedNodeIds(nodes: Node[], edges: Edge[]): Set<string> {
  const byTo = new Map(edges.map((e) => [e.to_node, e]))
  const out = new Set<string>()
  for (const node of nodes) {
    if (node.parent_id === null) continue
    if (!isExplained(byTo.get(node.id))) out.add(node.id)
  }
  return out
}
