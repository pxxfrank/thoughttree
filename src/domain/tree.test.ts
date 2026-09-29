import { describe, expect, it } from 'vitest'
import { n } from './test-utils'
import {
  ancestorsOf,
  buildForest,
  canReparent,
  childrenOf,
  descendantIds,
  flatten,
  indexChildren,
  orderWithMany,
  pathText,
  roots,
  subtreeSize,
} from './tree'

const tree = [
  n('a', { position: 1000 }),
  n('b', { parent_id: 'a', position: 1000 }),
  n('c', { parent_id: 'a', position: 2000 }),
  n('d', { parent_id: 'b', position: 1000 }),
  n('z', { position: 2000 }),
]

describe('indexChildren', () => {
  it('groups by parent and sorts by position', () => {
    const index = indexChildren(tree)
    expect(index.get(null)?.map((x) => x.id)).toEqual(['a', 'z'])
    expect(index.get('a')?.map((x) => x.id)).toEqual(['b', 'c'])
  })

  it('promotes orphans and self-parented nodes to roots', () => {
    const broken = [n('x', { parent_id: 'missing' }), n('y', { parent_id: 'y' })]
    const index = indexChildren(broken)
    expect(index.get(null)?.map((x) => x.id).sort()).toEqual(['x', 'y'])
  })

  it('falls back to creation time when positions tie', () => {
    const tied = [
      n('late', { position: 1000, created_at: 500 }),
      n('early', { position: 1000, created_at: 100 }),
    ]
    expect(childrenOf(tied, null).map((x) => x.id)).toEqual(['early', 'late'])
  })
})

describe('buildForest / flatten', () => {
  it('nests children at the right depth', () => {
    const forest = buildForest(tree)
    expect(forest.map((i) => i.node.id)).toEqual(['a', 'z'])
    expect(forest[0].children.map((i) => i.node.id)).toEqual(['b', 'c'])
    expect(forest[0].children[0].children[0].node.id).toBe('d')
    expect(forest[0].children[0].children[0].depth).toBe(2)
  })

  it('skips the children of collapsed nodes only', () => {
    const flat = flatten(buildForest(tree), (node) => node.id === 'a')
    expect(flat.map((i) => i.node.id)).toEqual(['a', 'z'])
  })

  it('survives a parent cycle without recursing forever', () => {
    const cyclic = [n('a', { parent_id: 'b' }), n('b', { parent_id: 'a' })]
    expect(() => buildForest(cyclic)).not.toThrow()
  })
})

describe('descendants and cycles', () => {
  it('collects the whole subtree', () => {
    expect(descendantIds(tree, 'a').sort()).toEqual(['b', 'c', 'd'])
    expect(subtreeSize(tree, 'a')).toBe(4)
    expect(subtreeSize(tree, 'd')).toBe(1)
  })

  it('refuses to move a node into itself or its own subtree', () => {
    expect(canReparent(tree, 'a', 'a')).toBe(false)
    expect(canReparent(tree, 'a', 'd')).toBe(false)
    expect(canReparent(tree, 'd', 'c')).toBe(true)
    expect(canReparent(tree, 'd', null)).toBe(true)
  })
})

describe('ancestry', () => {
  it('returns the chain from the root down', () => {
    expect(ancestorsOf(tree, 'd').map((x) => x.id)).toEqual(['a', 'b'])
    expect(ancestorsOf(tree, 'a')).toEqual([])
  })

  it('renders a readable path', () => {
    expect(pathText(tree, 'd')).toBe('node a › node b › node d')
  })
})

describe('orderWithMany', () => {
  const siblings = [n('s0'), n('s1'), n('s2')].map((x, i) => ({ ...x, position: (i + 1) * 1000 }))

  it('inserts at an index, ignoring moving nodes already present', () => {
    expect(orderWithMany(siblings, ['x'], 1)).toEqual(['s0', 'x', 's1', 's2'])
  })

  it('moves an existing sibling without duplicating it', () => {
    expect(orderWithMany(siblings, ['s2'], 0)).toEqual(['s2', 's0', 's1'])
  })

  it('appends when the index is past the end', () => {
    expect(orderWithMany(siblings, ['s0', 's1'], 99)).toEqual(['s2', 's0', 's1'])
  })
})

describe('roots', () => {
  it('returns only parentless nodes', () => {
    expect(roots(tree).map((x) => x.id)).toEqual(['a', 'z'])
  })
})
