import { newNode } from './mutations'
import type { Node } from './types'

export const T0 = 1_700_000_000_000

/** A node with sensible defaults, so tests only state what they care about. */
export function n(id: string, overrides: Partial<Node> = {}): Node {
  return { ...newNode(overrides.text ?? `node ${id}`, T0), id, ...overrides }
}

export function ids(nodes: { id: string }[]): string[] {
  return nodes.map((x) => x.id)
}
