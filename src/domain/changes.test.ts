import { describe, expect, it } from 'vitest'
import { applyChanges, danglingEdges, fromSnapshot, toSnapshot } from './changes'
import { edgeForNode } from './relations'
import { n } from './test-utils'
import type { Edge, EdgeKind } from './types'

const edge = (
  id: string,
  from: string,
  to: string,
  reason: string | null = null,
  kind: EdgeKind = 'parent',
): Edge => ({
  id,
  from_node: from,
  to_node: to,
  relation_type: 'decompose',
  reason,
  created_at: 0,
  kind,
})

describe('applyChanges', () => {
  it('upserts nodes without mutating the previous state', () => {
    const before = { nodes: {}, edges: {} }
    const after = applyChanges(before, {
      upsert_nodes: [n('a')],
      upsert_edges: [],
      delete_nodes: [],
      delete_edges: [],
    })
    expect(Object.keys(before.nodes)).toHaveLength(0)
    expect(Object.keys(after.nodes)).toEqual(['a'])
  })

  it('deleting a node cascades to every edge that touches it', () => {
    const state = {
      nodes: { a: n('a'), b: n('b', { parent_id: 'a' }) },
      edges: { e1: edge('e1', 'a', 'b') },
    }
    const after = applyChanges(state, {
      upsert_nodes: [],
      upsert_edges: [],
      delete_nodes: ['b'],
      delete_edges: [],
    })
    expect(Object.keys(after.nodes)).toEqual(['a'])
    expect(Object.keys(after.edges)).toHaveLength(0)
  })

  it('keeps at most one incoming edge per node', () => {
    const state = {
      nodes: { a: n('a'), b: n('b') },
      edges: { e1: edge('e1', 'a', 'b') },
    }
    const after = applyChanges(state, {
      upsert_nodes: [],
      upsert_edges: [edge('e2', 'b', 'a')],
      delete_nodes: [],
      delete_edges: [],
    })
    expect(Object.keys(after.edges).sort()).toEqual(['e1', 'e2'])
    expect(after.edges.e2.to_node).toBe('a')
  })

  it('replacing an edge for the same child drops the stale one', () => {
    const state = {
      nodes: { a: n('a'), b: n('b') },
      edges: { e1: edge('e1', 'a', 'b') },
    }
    const after = applyChanges(state, {
      upsert_nodes: [],
      upsert_edges: [edge('e2', 'b', 'b', 'why')],
      delete_nodes: [],
      delete_edges: [],
    })
    expect(Object.keys(after.edges)).toEqual(['e2'])
  })

  it('a link whose to_node matches a parent edge does not drop that parent edge', () => {
    const state = {
      nodes: { a: n('a'), b: n('b'), c: n('c') },
      edges: { e1: edge('e1', 'a', 'b') },
    }
    const after = applyChanges(state, {
      upsert_nodes: [],
      upsert_edges: [edge('l1', 'c', 'b', 'related', 'link')],
      delete_nodes: [],
      delete_edges: [],
    })
    expect(Object.keys(after.edges).sort()).toEqual(['e1', 'l1'])
  })

  it('a new parent edge still displaces only the parent edge', () => {
    const state = {
      nodes: { a: n('a'), b: n('b'), c: n('c') },
      edges: { e1: edge('e1', 'a', 'b'), l1: edge('l1', 'c', 'b', 'related', 'link') },
    }
    const after = applyChanges(state, {
      upsert_nodes: [],
      upsert_edges: [edge('e2', 'c', 'b')],
      delete_nodes: [],
      delete_edges: [],
    })
    expect(Object.keys(after.edges).sort()).toEqual(['e2', 'l1'])
  })

  it('snapshot round-trips', () => {
    const state = { nodes: { a: n('a') }, edges: { e1: edge('e1', 'a', 'a') } }
    const back = fromSnapshot(toSnapshot(state))
    expect(Object.keys(back.nodes)).toEqual(['a'])
    expect(danglingEdges(back)).toHaveLength(0)
  })
})

describe('edgeForNode', () => {
  it('ignores links and returns only the parent edge', () => {
    const edges = [edge('l1', 'x', 'b', 'related', 'link'), edge('e1', 'a', 'b')]
    expect(edgeForNode(edges, 'b')?.id).toBe('e1')
  })

  it('returns undefined when a node only has links', () => {
    const edges = [edge('l1', 'x', 'b', 'related', 'link')]
    expect(edgeForNode(edges, 'b')).toBeUndefined()
  })
})
