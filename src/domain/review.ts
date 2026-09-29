import { inboxOrder } from './focus'
import { unexplainedNodeIds } from './relations'
import type { Edge, Node } from './types'

export type ReviewGroupKey = 'older' | 'notes' | 'unexplained' | 'inbox'

export interface ReviewGroup {
  key: ReviewGroupKey
  nodes: Node[]
}

/** A cheap, stable 32-bit string hash (FNV-1a). */
function hash(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * Picks at most `perGroup` of `candidates`, ranked by a hash of `seed + id`.
 *
 * This is stable in exactly the way Review needs: a node's rank is a property
 * of its own id (plus the seed) and of nothing else, so the same seed always
 * yields the same subset — and appending a node drops it at its own hash
 * position without reshuffling the nodes already there. `Math.random()` would
 * break the first property, and ranking by array index would break the second.
 * The candidates' natural order is kept as a tiebreak so the result is total.
 */
function pick(candidates: Node[], seed: number, perGroup: number): Node[] {
  return candidates
    .map((node, index) => ({ node, index, rank: hash(`${seed}:${node.id}`) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, perGroup)
    .map((entry) => entry.node)
}

/**
 * The four "a little to revisit" lists. Each is capped and each empty list is
 * dropped entirely — Review never shows a heading with nothing under it.
 */
export function reviewGroups(
  nodes: Node[],
  edges: Edge[],
  seed: number,
  perGroup = 4,
): ReviewGroup[] {
  const unexplained = unexplainedNodeIds(nodes, edges)

  const older = nodes
    .filter((node) => !node.inbox && node.status === 'open')
    .sort((a, b) => a.created_at - b.created_at)
  const notes = nodes.filter(
    (node) => (node.note ?? '').trim() !== '' && (node.conclusion ?? '').trim() === '',
  )
  const unexplainedNodes = nodes.filter((node) => unexplained.has(node.id))
  const inbox = inboxOrder(nodes)

  const groups: ReviewGroup[] = [
    { key: 'older', nodes: pick(older, seed, perGroup) },
    { key: 'notes', nodes: pick(notes, seed, perGroup) },
    { key: 'unexplained', nodes: pick(unexplainedNodes, seed, perGroup) },
    { key: 'inbox', nodes: pick(inbox, seed, perGroup) },
  ]

  return groups.filter((group) => group.nodes.length > 0)
}
