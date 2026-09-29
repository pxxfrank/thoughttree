import { describe, expect, it } from 'vitest'
import { applyChanges, danglingEdges, fromSnapshot, toSnapshot } from './changes'
import { n } from './test-utils'
import type { Edge } from './types'

const edge = (id: string, from: string, to: string, reason: string | null = null): Edge => ({
  id,
  from_node: from,
  to_node: to,
  relation_type: 'decompose',
  reason,
  created_at: 0,
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

  it('snapshot round-trips', () => {
    const state = { nodes: { a: n('a') }, edges: { e1: edge('e1', 'a', 'a') } }
    const back = fromSnapshot(toSnapshot(state))
    expect(Object.keys(back.nodes)).toEqual(['a'])
    expect(danglingEdges(back)).toHaveLength(0)
  })
})
