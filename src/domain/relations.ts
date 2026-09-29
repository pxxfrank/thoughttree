import type { Edge, Node, RelationType } from './types'

export const RELATION_TYPES: {
  value: RelationType
  label: string
  hint: string
}[] = [
  { value: 'decompose', label: 'Decompose', hint: 'This is part of the parent question' },
  { value: 'answer', label: 'Answer', hint: 'It helps answer the parent question' },
  { value: 'support', label: 'Support', hint: 'It supports a judgement' },
  { value: 'challenge', label: 'Challenge', hint: 'It challenges or refutes a judgement' },
  { value: 'depends_on', label: 'Depends on', hint: 'The parent must be solved after this' },
]

export function relationLabel(type: RelationType): string {
  return RELATION_TYPES.find((r) => r.value === type)?.label ?? type
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
