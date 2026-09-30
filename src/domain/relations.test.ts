import { describe, expect, it } from 'vitest'
import { relatedNodeIds } from './relations'
import type { Edge, RelationType } from './types'

function link(from: string, to: string, relation_type: RelationType = 'support'): Edge {
  return {
    id: `l-${from}-${to}`,
    from_node: from,
    to_node: to,
    relation_type,
    reason: null,
    created_at: 1,
    kind: 'link',
  }
}

function parentEdge(from: string, to: string): Edge {
  return {
    id: `p-${from}-${to}`,
    from_node: from,
    to_node: to,
    relation_type: 'decompose',
    reason: null,
    created_at: 1,
    kind: 'parent',
  }
}

describe('relatedNodeIds', () => {
  it('collects the peer on both sides of a link', () => {
    const edges = [link('a', 'b')]
    expect(relatedNodeIds(edges, 'a')).toEqual(new Set(['b']))
    expect(relatedNodeIds(edges, 'b')).toEqual(new Set(['a']))
  })

  it('never includes the node itself', () => {
    // A stray self-link contributes nothing to its own related set.
    const edges = [link('a', 'a')]
    expect(relatedNodeIds(edges, 'a')).toEqual(new Set())
  })

  it('ignores parent edges', () => {
    const edges = [parentEdge('root', 'child')]
    expect(relatedNodeIds(edges, 'root')).toEqual(new Set())
    expect(relatedNodeIds(edges, 'child')).toEqual(new Set())
  })

  it('returns an empty set for a node with no links', () => {
    const edges = [link('a', 'b')]
    expect(relatedNodeIds(edges, 'c')).toEqual(new Set())
    expect(relatedNodeIds([], 'a')).toEqual(new Set())
  })

  it('gathers every peer across mixed directions and types', () => {
    const edges = [
      link('a', 'b', 'support'),
      link('a', 'c', 'challenge'),
      link('d', 'a', 'depends_on'),
      link('x', 'y'),
      parentEdge('a', 'z'),
    ]
    expect(relatedNodeIds(edges, 'a')).toEqual(new Set(['b', 'c', 'd']))
  })
})
