import { describe, expect, it } from 'vitest'
import { applyChanges, danglingEdges, emptyEntityState, indexById, toSnapshot } from './changes'
import {
  DomainError,
  addChildMutation,
  addLinkMutation,
  captureMutation,
  deleteLinkMutation,
  deleteMutation,
  expandAncestorsMutation,
  importMutation,
  placeMutation,
  setLinkMutation,
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
import type { Edge, Node, Snapshot } from './types'

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
  kind: 'parent',
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
      { id: 'ea', from_node: 'root', to_node: 'a', relation_type: 'decompose', reason: 'because A', created_at: T0, kind: 'parent' },
      { id: 'eb', from_node: 'root', to_node: 'b', relation_type: 'decompose', reason: 'because B', created_at: T0, kind: 'parent' },
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
    ], [{ id: 'ea', from_node: 'root', to_node: 'a', relation_type: 'answer', reason: 'old reason', created_at: T0, kind: 'parent' }])
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

describe('cross-branch links', () => {
  it('adds a link with kind "link" and undo removes it', () => {
    const context = ctx([n('a'), n('b')])
    const m = addLinkMutation(context, 'a', 'b', 'challenge', '  it refutes it  ', T0) as Mutation
    expect(m.labelKey).toBe('mutation.addLink')
    const link = m.forward.upsert_edges[0]
    expect(link.kind).toBe('link')
    expect(link.relation_type).toBe('challenge')
    expect(link.reason).toBe('it refutes it')

    const after = run(context, m)
    expect(after.edges).toHaveLength(1)
    expect(after.edges[0].kind).toBe('link')

    const reverted = undo(after, m)
    expect(reverted.edges).toHaveLength(0)
  })

  it('returns null when an identical (from, to, type) link already exists', () => {
    const existing: Edge = {
      id: 'l1',
      from_node: 'a',
      to_node: 'b',
      relation_type: 'support',
      reason: null,
      created_at: T0,
      kind: 'link',
    }
    expect(addLinkMutation(ctx([n('a'), n('b')], [existing]), 'a', 'b', 'support', 'x')).toBeNull()
    // A different relation type is a different link.
    expect(addLinkMutation(ctx([n('a'), n('b')], [existing]), 'a', 'b', 'challenge', 'x')).not.toBeNull()
  })

  it('refuses a self-link', () => {
    const attempt = () => addLinkMutation(ctx([n('a')]), 'a', 'a', 'support', '')
    expect(attempt).toThrow(DomainError)
    expect(attempt).toThrow('error.linkSelf')
  })

  it('allows a link that forms a cycle the tree cannot', () => {
    // a is the parent of b; b links back to a. The tree forbids that cycle,
    // the link layer does not.
    const context = ctx([n('a'), n('b', { parent_id: 'a' })])
    const m = addLinkMutation(context, 'b', 'a', 'challenge', 'same problem, other end', T0) as Mutation
    const after = run(context, m)
    expect(after.edges).toHaveLength(1)
    expect(after.edges[0].kind).toBe('link')
  })

  it('re-types and re-reasons a link, and undo restores it', () => {
    const link: Edge = {
      id: 'l1',
      from_node: 'a',
      to_node: 'b',
      relation_type: 'support',
      reason: 'old',
      created_at: T0,
      kind: 'link',
    }
    const m = setLinkMutation(link, 'depends_on', '  new reason  ') as Mutation
    expect(m.labelKey).toBe('mutation.editLink')
    expect(m.forward.upsert_edges[0].relation_type).toBe('depends_on')
    expect(m.forward.upsert_edges[0].reason).toBe('new reason')
    const reverted = undo(run(ctx([n('a'), n('b')], [link]), m), m)
    expect(reverted.edges[0].relation_type).toBe('support')
  })

  it('skips writing when a link edit changes nothing', () => {
    const link: Edge = {
      id: 'l1',
      from_node: 'a',
      to_node: 'b',
      relation_type: 'support',
      reason: 'why',
      created_at: T0,
      kind: 'link',
    }
    expect(setLinkMutation(link, 'support', 'why')).toBeNull()
  })

  it('deletes a link, and undo brings it back', () => {
    const link: Edge = {
      id: 'l1',
      from_node: 'a',
      to_node: 'b',
      relation_type: 'support',
      reason: null,
      created_at: T0,
      kind: 'link',
    }
    const context = ctx([n('a'), n('b')], [link])
    const m = deleteLinkMutation(link)
    expect(m.labelKey).toBe('mutation.removeLink')
    expect(m.forward.delete_edges).toEqual(['l1'])

    const after = run(context, m)
    expect(after.edges).toHaveLength(0)

    const reverted = undo(after, m)
    expect(reverted.edges).toHaveLength(1)
    expect(reverted.edges[0].id).toBe('l1')
  })

  it('deleteMutation removes a node together with its links', () => {
    const link: Edge = {
      id: 'l1',
      from_node: 'a',
      to_node: 'b',
      relation_type: 'challenge',
      reason: null,
      created_at: T0,
      kind: 'link',
    }
    const context = ctx([n('a'), n('b')], [link])
    const m = deleteMutation(context, ['b']) as Mutation
    const after = run(context, m)
    expect(after.nodes.map((x) => x.id)).toEqual(['a'])
    expect(after.edges).toHaveLength(0)

    const reverted = undo(after, m)
    expect(reverted.edges).toHaveLength(1)
    expect(reverted.edges[0].kind).toBe('link')
  })
})

describe('expand ancestors', () => {
  it('expands only the ancestors that are collapsed', () => {
    const context = ctx([
      n('root', { collapsed: true }),
      n('mid', { parent_id: 'root', collapsed: false }),
      n('leaf', { parent_id: 'mid' }),
    ])
    const m = expandAncestorsMutation(context.nodes, 'leaf', T0) as Mutation
    expect(m.labelKey).toBe('mutation.expandTo')
    expect(m.forward.upsert_nodes.map((x) => x.id)).toEqual(['root'])
    expect(m.forward.upsert_nodes[0].collapsed).toBe(false)
    expect(m.forward.upsert_nodes[0].updated_at).toBe(T0)
    // The originals come back on undo.
    expect(m.backward.upsert_nodes.map((x) => x.id)).toEqual(['root'])
    expect(m.backward.upsert_nodes[0].collapsed).toBe(true)
  })

  it('expands every collapsed ancestor, not just the nearest', () => {
    const context = ctx([
      n('root', { collapsed: true }),
      n('mid', { parent_id: 'root', collapsed: true }),
      n('leaf', { parent_id: 'mid' }),
    ])
    const m = expandAncestorsMutation(context.nodes, 'leaf', T0) as Mutation
    expect(m.forward.upsert_nodes.map((x) => x.id).sort()).toEqual(['mid', 'root'])
    expect(m.forward.upsert_nodes.every((x) => x.collapsed === false)).toBe(true)
  })

  it('returns null when nothing is collapsed', () => {
    const context = ctx([n('root'), n('leaf', { parent_id: 'root' })])
    expect(expandAncestorsMutation(context.nodes, 'leaf', T0)).toBeNull()
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

describe('import', () => {
  const edge = (id: string, from: string, to: string): Edge => ({
    id,
    from_node: from,
    to_node: to,
    relation_type: 'decompose',
    reason: null,
    created_at: T0,
    kind: 'parent',
  })

  it('merges: new ids are added, existing ids overwritten, others untouched', () => {
    const context = ctx([n('keep'), n('conflict', { text: 'old' })])
    const file: Snapshot = {
      nodes: [n('conflict', { text: 'from file' }), n('fresh')],
      edges: [],
    }
    const m = importMutation(context, file) as Mutation
    expect(m.labelKey).toBe('mutation.import')
    expect(m.forward.upsert_nodes.map((x) => x.id).sort()).toEqual(['conflict', 'fresh'])

    const after = run(context, m)
    expect(after.nodes.map((x) => x.id).sort()).toEqual(['conflict', 'fresh', 'keep'])
    expect(after.nodes.find((x) => x.id === 'conflict')?.text).toBe('from file')
    // An id the file does not mention is left exactly as it was.
    expect(after.nodes.find((x) => x.id === 'keep')?.text).toBe('node keep')
  })

  it('undo removes the imported nodes and restores the overwritten ones', () => {
    const context = ctx([n('conflict', { text: 'old' })])
    const file: Snapshot = {
      nodes: [n('conflict', { text: 'from file' }), n('fresh')],
      edges: [],
    }
    const m = importMutation(context, file) as Mutation
    const reverted = undo(run(context, m), m)
    expect(reverted.nodes.map((x) => x.id)).toEqual(['conflict'])
    expect(reverted.nodes[0].text).toBe('old')
  })

  it('undo restores an edge the import displaced', () => {
    const context = ctx(
      [n('root'), n('other'), n('child', { parent_id: 'root' })],
      [edge('e-orig', 'root', 'child')],
    )
    // The file re-parents `child`, so the original incoming edge is replaced.
    const file: Snapshot = {
      nodes: [n('child', { parent_id: 'other' })],
      edges: [edge('e-new', 'other', 'child')],
    }
    const m = importMutation(context, file) as Mutation
    const after = run(context, m)
    expect(after.edges.map((e) => e.id)).toEqual(['e-new'])

    const reverted = undo(after, m)
    expect(reverted.edges.map((e) => e.id)).toEqual(['e-orig'])
    expect(reverted.edges[0].from_node).toBe('root')
  })

  it('drops edges whose endpoints are missing from both the file and the tree', () => {
    const context = ctx([n('root')])
    const file: Snapshot = {
      nodes: [n('child', { parent_id: 'root' })],
      edges: [edge('e1', 'root', 'child'), edge('e2', 'child', 'ghost')],
    }
    const m = importMutation(context, file) as Mutation
    expect(m.forward.upsert_edges.map((e) => e.id)).toEqual(['e1'])

    const after = run(context, m)
    expect(after.edges.map((e) => e.id)).toEqual(['e1'])
    expect(
      danglingEdges({ nodes: indexById(after.nodes), edges: indexById(after.edges) }),
    ).toHaveLength(0)
  })

  it('returns null when the file carries nothing', () => {
    expect(importMutation(ctx([n('a')]), { nodes: [], edges: [] })).toBeNull()
  })
})
