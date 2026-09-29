import { describe, expect, it } from 'vitest'
import { applyChanges, emptyEntityState, indexById, toSnapshot } from './changes'
import {
  DomainError,
  addChildMutation,
  captureMutation,
  deleteMutation,
  placeMutation,
  setNoteMutation,
  setPriorityMutation,
  setRelationMutation,
  setStatusMutation,
  setTextMutation,
  toggleCollapseMutation,
  type Mutation,
  type MutationContext,
} from './mutations'
import { n, T0 } from './test-utils'
import { childrenOf, indexChildren } from './tree'
import type { Edge, Node } from './types'

function ctx(nodes: Node[], edges: Edge[] = []): MutationContext {
  return { nodes, edges }
}

function run(context: MutationContext, mutation: Mutation): MutationContext {
  const graph = { nodes: indexById(context.nodes), edges: indexById(context.edges) }
  const next = applyChanges(graph, mutation.forward)
  return { nodes: Object.values(next.nodes), edges: Object.values(next.edges) }
}

function undo(context: MutationContext, mutation: Mutation): MutationContext {
  const graph = { nodes: indexById(context.nodes), edges: indexById(context.edges) }
  const next = applyChanges(graph, mutation.backward)
  return { nodes: Object.values(next.nodes), edges: Object.values(next.edges) }
}

const sampleEdge: Edge = {
  id: 'e1',
  from_node: 'a',
  to_node: 'b',
  relation_type: 'decompose',
  reason: null,
  created_at: T0,
}

describe('capture', () => {
  it('puts a new thought in the inbox, and undo removes it', () => {
    const mutation = captureMutation('  Does memory need deleting?  ', T0)
    expect(mutation).not.toBeNull()
    const m = mutation as Mutation
    const node = m.forward.upsert_nodes[0]
    expect(node.text).toBe('Does memory need deleting?')
    expect(node.inbox).toBe(true)
    expect(node.parent_id).toBeNull()

    const after = run(ctx([]), m)
    expect(after.nodes).toHaveLength(1)
    expect(after.nodes[0].inbox).toBe(true)

    const reverted = undo(after, m)
    expect(reverted.nodes).toHaveLength(0)
  })

  it('ignores blank input', () => {
    expect(captureMutation('   ', T0)).toBeNull()
  })

  it('records lightweight capture context', () => {
    const m = captureMutation('idea', T0, { app: 'Chrome', title: 'Docs' }) as Mutation
    expect(m.forward.upsert_nodes[0].source_app).toBe('Chrome')
    expect(m.forward.upsert_nodes[0].source_title).toBe('Docs')
  })
})

describe('field edits', () => {
  it('edits text and restores the old value on undo', () => {
    const node = n('a', { text: 'old' })
    const m = setTextMutation(node, '  new  ', T0) as Mutation
    expect(m.forward.upsert_nodes[0].text).toBe('new')
    const after = run(ctx([node]), m)
    const reverted = undo(after, m)
    expect(reverted.nodes[0].text).toBe('old')
  })

  it('refuses to blank out a question', () => {
    expect(setTextMutation(n('a'), '   ', T0)).toBeNull()
  })

  it('is a no-op when nothing actually changes', () => {
    expect(setStatusMutation(n('a', { status: 'open' }), 'open', T0)).toBeNull()
    expect(setPriorityMutation(n('a', { priority: 'normal' }), 'normal', T0)).toBeNull()
    expect(setNoteMutation(n('a', { note: 'x' }), 'x', T0)).toBeNull()
  })

  it('clears a note when it is emptied', () => {
    const m = setNoteMutation(n('a', { note: 'x' }), '   ', T0) as Mutation
    expect(m.forward.upsert_nodes[0].note).toBeNull()
  })

  it('toggles collapse', () => {
    const m = toggleCollapseMutation(n('a', { collapsed: false }), T0) as Mutation
    expect(m.forward.upsert_nodes[0].collapsed).toBe(true)
  })

  it('bumps updated_at', () => {
    const m = setStatusMutation(n('a', { updated_at: 1 }), 'done', T0) as Mutation
    expect(m.forward.upsert_nodes[0].updated_at).toBe(T0)
  })
})

describe('delete', () => {
  it('removes the whole subtree and can bring it back', () => {
    const context = ctx([n('a'), n('b', { parent_id: 'a' }), n('c', { parent_id: 'b' })], [
      { ...sampleEdge, to_node: 'b', from_node: 'a' },
      { ...sampleEdge, id: 'e2', from_node: 'b', to_node: 'c' },
    ])
    const m = deleteMutation(context, ['b']) as Mutation
    expect([...m.forward.delete_nodes].sort()).toEqual(['b', 'c'])

    const after = run(context, m)
    expect(after.nodes.map((x) => x.id)).toEqual(['a'])
    expect(after.edges).toHaveLength(0)

    const reverted = undo(after, m)
    expect(reverted.nodes.map((x) => x.id).sort()).toEqual(['a', 'b', 'c'])
    expect(reverted.edges).toHaveLength(2)
  })

  it('does nothing for unknown ids', () => {
    expect(deleteMutation(ctx([n('a')]), ['nope'])).toBeNull()
  })
})

describe('add child', () => {
  it('inserts at the requested index and renumbers siblings', () => {
    const context = ctx([n('p'), n('x', { parent_id: 'p', position: 1000 }), n('y', { parent_id: 'p', position: 2000 })])
    const m = addChildMutation(context, 'p', 1, 'between', T0) as Mutation
    const after = run(context, m)
    const kids = childrenOf(after.nodes, 'p')
    expect(kids.map((k) => k.text)).toEqual(['node x', 'between', 'node y'])
    expect(kids.map((k) => k.position)).toEqual([0, 1000, 2000])
  })

  it('starts the relation unexplained', () => {
    const context = ctx([n('p')])
    const m = addChildMutation(context, 'p', 0, 'child', T0) as Mutation
    expect(m.forward.upsert_edges[0].reason).toBeNull()
    expect(m.forward.upsert_edges[0].relation_type).toBe('decompose')
  })

  it('undo removes the created question and restores sibling positions', () => {
    const context = ctx([n('p'), n('x', { parent_id: 'p', position: 1000 })])
    const m = addChildMutation(context, 'p', 0, 'first', T0) as Mutation
    const after = run(context, m)
    const reverted = undo(after, m)
    expect(childrenOf(reverted.nodes, 'p').map((k) => k.position)).toEqual([1000])
  })
})

describe('place', () => {
  const base = ctx(
    [n('root'), n('a', { parent_id: 'root', position: 0 }), n('b', { parent_id: 'root', position: 1000 })],
    [
      { id: 'ea', from_node: 'root', to_node: 'a', relation_type: 'decompose', reason: 'because A', created_at: T0 },
      { id: 'eb', from_node: 'root', to_node: 'b', relation_type: 'decompose', reason: 'because B', created_at: T0 },
    ],
  )

  it('reordering under the same parent keeps the reason the user already gave', () => {
    const m = placeMutation(base, ['b'], 'root', ['b', 'a'], T0) as Mutation
    expect(m.forward.upsert_edges).toHaveLength(0)
    const after = run(base, m)
    expect(childrenOf(after.nodes, 'root').map((x) => x.id)).toEqual(['b', 'a'])
    expect(after.edges.find((e) => e.to_node === 'b')?.reason).toBe('because B')
  })

  it('re-parenting resets the relation so the app can ask why', () => {
    const context = ctx([
      n('root'),
      n('other'),
      n('a', { parent_id: 'root', position: 0 }),
    ], [{ id: 'ea', from_node: 'root', to_node: 'a', relation_type: 'answer', reason: 'old reason', created_at: T0 }])
    const m = placeMutation(context, ['a'], 'other', ['a'], T0) as Mutation
    const newEdge = m.forward.upsert_edges[0]
    expect(newEdge.from_node).toBe('other')
    expect(newEdge.reason).toBeNull()
    expect(newEdge.relation_type).toBe('decompose')
    // same edge row is reused, so no duplicate appears
    expect(newEdge.id).toBe('ea')
  })

  it('moving a node to the root drops its relation', () => {
    const m = placeMutation(base, ['a'], null, ['a', 'root', 'b'], T0) as Mutation
    expect(m.forward.delete_edges).toEqual(['ea'])
    const after = run(base, m)
    expect(after.nodes.find((x) => x.id === 'a')?.parent_id).toBeNull()
    const reverted = undo(after, m)
    expect(reverted.nodes.find((x) => x.id === 'a')?.parent_id).toBe('root')
    expect(reverted.edges.find((e) => e.to_node === 'a')?.reason).toBe('because A')
  })

  it('pulling an inbox thought into the tree clears the inbox flag', () => {
    const context = ctx([n('root'), n('idea', { inbox: true })])
    const m = placeMutation(context, ['idea'], 'root', ['idea'], T0) as Mutation
    const after = run(context, m)
    expect(after.nodes.find((x) => x.id === 'idea')?.inbox).toBe(false)
  })

  it('refuses to move a question inside its own subtree', () => {
    const context = ctx([n('a'), n('b', { parent_id: 'a' })])
    const attempt = () => placeMutation(context, ['a'], 'b', ['a'], T0)
    expect(attempt).toThrow(DomainError)
    // The message is a translation key: these reach the user, so the domain
    // must not own the wording.
    expect(attempt).toThrow('error.moveInsideSelf')
  })

  it('moves several questions as a contiguous block', () => {
    const context = ctx([
      n('root'),
      n('x', { parent_id: 'root', position: 0 }),
      n('y', { parent_id: 'root', position: 1000 }),
      n('p1', { inbox: true }),
      n('p2', { inbox: true }),
    ])
    const m = placeMutation(context, ['p1', 'p2'], 'root', ['p1', 'p2', 'x', 'y'], T0) as Mutation
    const after = run(context, m)
    expect(childrenOf(after.nodes, 'root').map((k) => k.id)).toEqual(['p1', 'p2', 'x', 'y'])
  })
})

describe('relation', () => {
  it('stores the reason and the relation type', () => {
    const m = setRelationMutation(sampleEdge, 'challenge', '  it contradicts X  ') as Mutation
    const edge = m.forward.upsert_edges[0]
    expect(edge.relation_type).toBe('challenge')
    expect(edge.reason).toBe('it contradicts X')
  })

  it('skips writing when nothing changed', () => {
    const explained: Edge = { ...sampleEdge, reason: 'why' }
    expect(setRelationMutation(explained, 'decompose', 'why')).toBeNull()
  })

  it('clears the reason when it is emptied', () => {
    const explained: Edge = { ...sampleEdge, reason: 'why' }
    const m = setRelationMutation(explained, 'decompose', '  ') as Mutation
    expect(m.forward.upsert_edges[0].reason).toBeNull()
  })
})

describe('reducer invariants', () => {
  it('never leaves a dangling edge after a sequence of operations', () => {
    let context = ctx([])
    const capture = captureMutation('one', T0) as Mutation
    context = run(context, capture)
    const id = capture.forward.upsert_nodes[0].id

    const placed = placeMutation(context, [id], null, [id], T0) as Mutation
    context = run(context, placed)
    const removed = deleteMutation(context, [id]) as Mutation
    context = run(context, removed)

    const snapshot = toSnapshot({ nodes: indexById(context.nodes), edges: indexById(context.edges) })
    expect(snapshot.nodes).toHaveLength(0)
    expect(snapshot.edges).toHaveLength(0)
    expect(emptyEntityState()).toEqual({ nodes: {}, edges: {} })
    expect(indexChildren(context.nodes).get(null)).toBeUndefined()
  })
})
