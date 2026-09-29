import { describe, expect, it } from 'vitest'
import { searchNodes } from './search'
import { n, T0 } from './test-utils'
import type { Edge } from './types'

function reasonEdge(from: string, to: string, reason: string): Edge {
  return {
    id: `e-${to}`,
    from_node: from,
    to_node: to,
    relation_type: 'decompose',
    reason,
    created_at: T0,
    kind: 'parent',
  }
}

describe('searchNodes', () => {
  it('matches the question text', () => {
    const nodes = [n('a', { text: 'How does memory work?' }), n('b', { text: 'unrelated' })]
    const hits = searchNodes(nodes, [], 'memory')
    expect(hits.map((h) => h.node.id)).toEqual(['a'])
    expect(hits[0].field).toBe('text')
  })

  it('matches a note when the text does not', () => {
    const nodes = [n('a', { text: 'root', note: 'a thought about memory' })]
    const hits = searchNodes(nodes, [], 'memory')
    expect(hits.map((h) => h.node.id)).toEqual(['a'])
    expect(hits[0].field).toBe('note')
  })

  it('matches a conclusion', () => {
    const nodes = [n('a', { text: 'root', conclusion: 'memory is bounded' })]
    const hits = searchNodes(nodes, [], 'bounded')
    expect(hits.map((h) => h.node.id)).toEqual(['a'])
    expect(hits[0].field).toBe('conclusion')
  })

  it("matches the parent edge's reason", () => {
    const nodes = [n('parent'), n('child', { parent_id: 'parent' })]
    const edges = [reasonEdge('parent', 'child', 'because memory matters')]
    const hits = searchNodes(nodes, edges, 'memory')
    expect(hits.map((h) => h.node.id)).toEqual(['child'])
    expect(hits[0].field).toBe('reason')
  })

  it('is case-insensitive and trims the query', () => {
    const nodes = [n('a', { text: 'Memory' })]
    expect(searchNodes(nodes, [], '  mEmOrY  ')).toHaveLength(1)
  })

  it('reports only the best-ranked field for a node', () => {
    const both = [n('a', { text: 'memory', note: 'memory in the notes too' })]
    expect(searchNodes(both, [], 'memory')[0].field).toBe('text')

    const noteOverReasonNodes = [
      n('parent'),
      n('child', { parent_id: 'parent', note: 'memory in the note' }),
    ]
    const noteOverReasonEdges = [reasonEdge('parent', 'child', 'memory in the reason')]
    expect(searchNodes(noteOverReasonNodes, noteOverReasonEdges, 'memory')[0].field).toBe('note')
  })

  it('ranks text above note/conclusion, and those above reason', () => {
    const nodes = [
      n('parent'),
      n('text', { text: 'memory' }),
      n('note', { note: 'memory' }),
      n('child', { parent_id: 'parent' }),
    ]
    const edges = [reasonEdge('parent', 'child', 'memory')]
    expect(searchNodes(nodes, edges, 'memory').map((h) => h.node.id)).toEqual([
      'text',
      'note',
      'child',
    ])
  })

  it('breaks ties by newest first', () => {
    const nodes = [
      n('old', { text: 'memory', created_at: T0 }),
      n('new', { text: 'memory', created_at: T0 + 1 }),
    ]
    expect(searchNodes(nodes, [], 'memory').map((h) => h.node.id)).toEqual(['new', 'old'])
  })

  it('honours the limit', () => {
    const nodes = Array.from({ length: 5 }, (_, i) => n(`n${i}`, { text: 'memory' }))
    expect(searchNodes(nodes, [], 'memory', 2)).toHaveLength(2)
    expect(searchNodes(nodes, [], 'memory')).toHaveLength(5)
  })

  it('returns nothing for an empty query', () => {
    expect(searchNodes([n('a', { text: 'memory' })], [], '   ')).toEqual([])
  })

  it('reports the path of a nested node', () => {
    const nodes = [
      n('root', { text: 'Root' }),
      n('mid', { text: 'Mid', parent_id: 'root' }),
      n('leaf', { text: 'Memory', parent_id: 'mid' }),
    ]
    const hits = searchNodes(nodes, [], 'memory')
    expect(hits).toHaveLength(1)
    expect(hits[0].path).toBe('Root › Mid › Memory')
  })
})
