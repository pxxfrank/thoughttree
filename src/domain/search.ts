import { edgeForNode } from './relations'
import { pathText } from './tree'
import type { Edge, Node } from './types'

export type MatchedField = 'text' | 'note' | 'conclusion' | 'reason'

export interface SearchHit {
  node: Node
  field: MatchedField
  path: string
}

/** Lower is better: the headline the user typed beats the context around it. */
const RANK: Record<MatchedField, number> = {
  text: 0,
  note: 1,
  conclusion: 1,
  reason: 2,
}

/**
 * Finds the question worth jumping to. Only the best-matching field of a node
 * is reported, so a node the user typed by heart never appears as a mere
 * mention in someone's notes. Ties go to the most recently created question.
 */
export function searchNodes(nodes: Node[], edges: Edge[], query: string, limit = 20): SearchHit[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []

  const hits: SearchHit[] = []
  for (const node of nodes) {
    let field: MatchedField | null = null
    if (node.text.toLowerCase().includes(needle)) {
      field = 'text'
    } else if (node.note && node.note.toLowerCase().includes(needle)) {
      field = 'note'
    } else if (node.conclusion && node.conclusion.toLowerCase().includes(needle)) {
      field = 'conclusion'
    } else {
      const reason = edgeForNode(edges, node.id)?.reason
      if (reason && reason.toLowerCase().includes(needle)) field = 'reason'
    }
    if (!field) continue
    hits.push({ node, field, path: pathText(nodes, node.id) })
  }

  hits.sort((a, b) => {
    const rank = RANK[a.field] - RANK[b.field]
    return rank !== 0 ? rank : b.node.created_at - a.node.created_at
  })
  return hits.slice(0, limit)
}
