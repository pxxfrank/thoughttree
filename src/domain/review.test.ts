import { describe, expect, it } from 'vitest'
import { reviewGroups, type ReviewGroup, type ReviewGroupKey } from './review'
import { n } from './test-utils'
import type { Edge, Node } from './types'

const ids = (nodes: Node[]): string[] => nodes.map((node) => node.id)

const group = (groups: ReviewGroup[], key: ReviewGroupKey): ReviewGroup | undefined =>
  groups.find((entry) => entry.key === key)

function edge(from: string, to: string, reason: string | null): Edge {
  return {
    id: `e-${to}`,
    from_node: from,
    to_node: to,
    relation_type: 'decompose',
    reason,
    created_at: 1,
  }
}

describe('reviewGroups', () => {
  it('older: open questions outside the Inbox', () => {
    const nodes = [
      n('a', { created_at: 100 }),
      n('b', { created_at: 200, status: 'done' }),
      n('c', { created_at: 300, inbox: true }),
      n('d', { created_at: 50 }),
    ]
    const picked = group(reviewGroups(nodes, [], 1), 'older')
    expect(new Set(ids(picked?.nodes ?? []))).toEqual(new Set(['a', 'd']))
  })

  it('notes: a note with no conclusion yet', () => {
    const nodes = [
      n('a', { note: 'half formed' }),
      n('b', { note: 'also half formed', conclusion: 'settled' }),
      n('c', { note: '' }),
      n('d', { note: '   ' }),
      n('e', { conclusion: 'answer without a note' }),
    ]
    const picked = group(reviewGroups(nodes, [], 1), 'notes')
    expect(ids(picked?.nodes ?? [])).toEqual(['a'])
  })

  it('notes excludes questions that already have a conclusion', () => {
    const nodes = [n('a', { note: 'wip' }), n('b', { note: 'wip', conclusion: 'done' })]
    const picked = group(reviewGroups(nodes, [], 1), 'notes')
    expect(ids(picked?.nodes ?? [])).toEqual(['a'])
  })

  it('unexplained: children whose relation has no reason', () => {
    const nodes = [n('parent'), n('child', { parent_id: 'parent' })]

    const flagged = group(reviewGroups(nodes, [edge('parent', 'child', null)], 1), 'unexplained')
    expect(ids(flagged?.nodes ?? [])).toEqual(['child'])

    // Once the relation is explained the group disappears entirely.
    const explained = reviewGroups(nodes, [edge('parent', 'child', 'because it matters')], 1)
    expect(group(explained, 'unexplained')).toBeUndefined()
  })

  it('inbox: the unfiled captures', () => {
    const nodes = [n('a', { inbox: true }), n('b'), n('c', { inbox: true })]
    const picked = group(reviewGroups(nodes, [], 1), 'inbox')
    expect(new Set(ids(picked?.nodes ?? []))).toEqual(new Set(['a', 'c']))
  })

  it('omits a group that has no nodes', () => {
    const keys = reviewGroups([n('a', { inbox: true })], [], 1).map((entry) => entry.key)
    expect(keys).toEqual(['inbox'])
  })

  it('caps every group at perGroup', () => {
    const nodes = Array.from({ length: 7 }, (_, i) => n(`n${i}`, { created_at: i }))
    expect(group(reviewGroups(nodes, [], 3), 'older')?.nodes).toHaveLength(4)
    expect(group(reviewGroups(nodes, [], 3, 2), 'older')?.nodes).toHaveLength(2)
  })

  it('is identical for the same seed', () => {
    const nodes = Array.from({ length: 6 }, (_, i) => n(`n${i}`, { created_at: i }))
    expect(reviewGroups(nodes, [], 42)).toEqual(reviewGroups(nodes, [], 42))
  })

  it('appending a node does not change which nodes were already selected', () => {
    const base = [n('a'), n('b'), n('c')]
    const before = ids(group(reviewGroups(base, [], 5), 'older')?.nodes ?? [])
    const after = ids(group(reviewGroups([...base, n('d')], [], 5), 'older')?.nodes ?? [])

    // The newcomer joins the pick; nobody already shown is dropped.
    expect(after).toEqual(expect.arrayContaining(before))
    // And the survivors keep their relative order — nothing reshuffles.
    expect(after.filter((id) => before.includes(id))).toEqual(before)
  })

  it('an unrelated addition leaves a full group untouched', () => {
    const full = [n('a'), n('b'), n('c'), n('d'), n('e')]
    const before = ids(group(reviewGroups(full, [], 7), 'older')?.nodes ?? [])
    const after = ids(
      group(reviewGroups([...full, n('x', { status: 'done' })], [], 7), 'older')?.nodes ?? [],
    )
    expect(after).toEqual(before)
  })

  it('does not reshuffle the relative order of existing nodes', () => {
    const base = [n('a'), n('b'), n('c'), n('d'), n('e')]
    const before = ids(group(reviewGroups(base, [], 11), 'older')?.nodes ?? [])
    const after = ids(group(reviewGroups([...base, n('f')], [], 11), 'older')?.nodes ?? [])
    // A newcomer can only bump the weakest of the four; the rest keep order.
    expect(after.filter((id) => before.includes(id))).toEqual(
      before.filter((id) => after.includes(id)),
    )
  })
})
