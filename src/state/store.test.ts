import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryPersistence } from '../storage/memory-persistence'
import { AppStore } from './store'
import type { Changes } from '../domain/types'

function makeStore() {
  const persistence = new MemoryPersistence()
  const store = new AppStore(persistence)
  return { store, persistence }
}

async function ready() {
  const ctx = makeStore()
  await ctx.store.init()
  return ctx
}

describe('capture → inbox', () => {
  it('lands in the inbox and is persisted', async () => {
    const { store, persistence } = await ready()
    const id = store.capture('Does memory need manual deletion?')
    expect(id).not.toBeNull()
    expect(store.inbox().map((n) => n.text)).toEqual(['Does memory need manual deletion?'])
    expect(store.getState().nodes[id as string].inbox).toBe(true)
    await vi.waitFor(() => expect(persistence.applied).toHaveLength(1))
  })

  it('shows the newest capture first', async () => {
    const { store } = await ready()
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(1000)
    store.capture('first')
    now.mockReturnValue(2000)
    store.capture('second')
    now.mockRestore()
    expect(store.inbox().map((n) => n.text)).toEqual(['second', 'first'])
  })

  it('ignores blank captures', async () => {
    const { store, persistence } = await ready()
    expect(store.capture('   ')).toBeNull()
    expect(persistence.applied).toHaveLength(0)
  })
})

describe('inbox → tree', () => {
  it('filing a thought creates a relation and asks why', async () => {
    const { store } = await ready()
    const root = store.addChild(null, 0, 'How should Agent Memory work?') as string
    const idea = store.capture('Should users delete their own memories?') as string

    store.place([idea], root, 0)

    const state = store.getState()
    expect(state.nodes[idea].inbox).toBe(false)
    expect(state.nodes[idea].parent_id).toBe(root)
    expect(store.inbox()).toHaveLength(0)
    expect(store.edgeFor(idea)).toBeDefined()
    expect(state.whyHereFor).toBe(idea)
    expect(store.unexplained().has(idea)).toBe(true)
  })

  it('recording a reason explains the relation', async () => {
    const { store } = await ready()
    const root = store.addChild(null, 0, 'root') as string
    const idea = store.capture('why?') as string
    store.place([idea], root, 0)

    store.explain(idea, 'depends_on', 'It is a permission question inside the control question')

    const edge = store.edgeFor(idea)
    expect(edge?.relation_type).toBe('depends_on')
    expect(edge?.reason).toBe('It is a permission question inside the control question')
    expect(store.getState().whyHereFor).toBeNull()
    expect(store.unexplained().has(idea)).toBe(false)
  })

  it('skipping leaves the relation flagged as unexplained', async () => {
    const { store } = await ready()
    const root = store.addChild(null, 0, 'root') as string
    const idea = store.capture('why?') as string
    store.place([idea], root, 0)
    store.skipExplain()
    expect(store.getState().whyHereFor).toBeNull()
    expect(store.unexplained().has(idea)).toBe(true)
  })

  it('dropping into the tree at a position orders siblings', async () => {
    const { store } = await ready()
    const root = store.addChild(null, 0, 'root') as string
    const a = store.addChild(root, 0, 'A') as string
    const b = store.addChild(root, 1, 'B') as string
    store.place([b], root, 0)
    const order = Object.values(store.getState().nodes)
      .filter((n) => n.parent_id === root)
      .sort((x, y) => x.position - y.position)
      .map((n) => n.id)
    expect(order).toEqual([b, a])
  })
})

describe('triage', () => {
  it('important open questions become the focus list', async () => {
    const { store } = await ready()
    const a = store.addChild(null, 0, 'A') as string
    store.addChild(null, 1, 'B')
    store.togglePriority(a)

    expect(store.focusTargets().map((n) => n.id)).toEqual([a])
    expect(store.visibleForest()).toHaveLength(2)

    store.toggleFocusMode()
    expect(store.visibleForest().map((i) => i.node.id)).toEqual([a])
  })

  it('keeps the ancestors of a focus target visible', async () => {
    const { store } = await ready()
    const root = store.addChild(null, 0, 'root') as string
    const child = store.addChild(root, 0, 'child') as string
    store.togglePriority(child)
    store.toggleFocusMode()
    const forest = store.visibleForest()
    expect(forest.map((i) => i.node.id)).toEqual([root])
    expect(forest[0].children.map((i) => i.node.id)).toEqual([child])
  })

  it('done questions are hidden when the filter is off', async () => {
    const { store } = await ready()
    const a = store.addChild(null, 0, 'A') as string
    store.setStatus(a, 'done')
    expect(store.visibleForest()).toHaveLength(1)
    store.setFilter('showDone', false)
    expect(store.visibleForest()).toHaveLength(0)
  })

  it('later questions stay visible but dimmed by default', async () => {
    const { store } = await ready()
    const a = store.addChild(null, 0, 'A') as string
    store.setStatus(a, 'later')
    expect(store.visibleForest()).toHaveLength(1)
    store.setFilter('showLater', false)
    expect(store.visibleForest()).toHaveLength(0)
  })

  it('only-unexplained shows just the flagged branches', async () => {
    const { store } = await ready()
    const root = store.addChild(null, 0, 'root') as string
    const flagged = store.capture('flagged') as string
    store.place([flagged], root, 0)
    store.explain(root, 'decompose', 'n/a')

    store.setFilter('onlyUnexplained', true)
    const forest = store.visibleForest()
    expect(forest.map((i) => i.node.id)).toEqual([root])
    expect(forest[0].children.map((i) => i.node.id)).toEqual([flagged])
  })
})

describe('undo / redo', () => {
  it('undoes and redoes a move', async () => {
    const { store } = await ready()
    const root = store.addChild(null, 0, 'root') as string
    const idea = store.capture('idea') as string
    store.place([idea], root, 0)
    expect(store.getState().nodes[idea].parent_id).toBe(root)

    store.undo()
    expect(store.getState().nodes[idea].parent_id).toBeNull()
    expect(store.getState().nodes[idea].inbox).toBe(true)

    store.redo()
    expect(store.getState().nodes[idea].parent_id).toBe(root)
    expect(store.getState().nodes[idea].inbox).toBe(false)
  })

  it('undoes a delete together with its relations', async () => {
    const { store } = await ready()
    const root = store.addChild(null, 0, 'root') as string
    const child = store.addChild(root, 0, 'child') as string
    store.remove([child])
    expect(store.getState().nodes[child]).toBeUndefined()
    expect(store.edgeFor(child)).toBeUndefined()

    store.undo()
    expect(store.getState().nodes[child]).toBeDefined()
    expect(store.edgeFor(child)).toBeDefined()
  })

  it('reports what will be undone', async () => {
    const { store } = await ready()
    store.capture('something')
    expect(store.getState().undoLabelKey).toBe('mutation.capture')
    store.undo()
    expect(store.getState().undoLabelKey).toBeNull()
    expect(store.getState().redoLabelKey).toBe('mutation.capture')
  })

  it('clears the redo stack once a new edit lands', async () => {
    const { store } = await ready()
    store.capture('one')
    store.undo()
    store.capture('two')
    expect(store.getState().redoLabelKey).toBeNull()
  })

  it('switches language and keeps it in settings', async () => {
    const { store, persistence } = await ready()
    await store.setLocale('zh')
    expect(store.getState().locale).toBe('zh')
    expect(persistence.settings['locale']).toBe('zh')
  })
})

describe('inbox is separate from the tree', () => {
  it('captured thoughts do not appear in the tree until they are filed', async () => {
    const { store } = await ready()
    store.capture('loose thought')
    expect(store.inbox()).toHaveLength(1)
    expect(store.visibleForest()).toHaveLength(0)

    const root = store.addChild(null, 0, 'main question') as string
    expect(store.visibleForest().map((i) => i.node.id)).toEqual([root])
  })

  it('an important capture still waits in the inbox rather than joining focus', async () => {
    const { store } = await ready()
    const id = store.capture('important but unfiled') as string
    store.setPriority(id, 'important')
    expect(store.focusTargets()).toHaveLength(0)
    expect(store.inbox().map((n) => n.id)).toEqual([id])
  })
})

describe('reliability', () => {
  it('rolls the change back when the write fails', async () => {
    const { store, persistence } = await ready()
    persistence.failNext = true
    const id = store.capture('fragile') as string
    expect(store.getState().nodes[id]).toBeDefined()

    await vi.waitFor(() => {
      expect(store.getState().nodes[id]).toBeUndefined()
    })
    expect(store.getState().toast?.kind).toBe('error')
    expect(store.getState().undoLabelKey).toBeNull()
  })

  it('applies changesets coming from another window', async () => {
    const { store, persistence } = await ready()
    const remote: Changes = {
      upsert_nodes: [
        {
          id: 'remote-1',
          text: 'captured from the orb',
          created_at: 1,
          updated_at: 1,
          priority: 'normal',
          status: 'open',
          parent_id: null,
          position: 1,
          note: null,
          conclusion: null,
          inbox: true,
          collapsed: false,
          source_app: null,
          source_title: null,
        },
      ],
      upsert_edges: [],
      delete_nodes: [],
      delete_edges: [],
    }
    persistence.broadcast(remote)
    expect(store.getState().nodes['remote-1']).toBeDefined()
    expect(store.inbox().map((n) => n.text)).toEqual(['captured from the orb'])
    // a remote change must not pollute the local undo history
    expect(store.getState().undoLabelKey).toBeNull()
  })

  it('survives a reload from persistence', async () => {
    const { store, persistence } = await ready()
    store.capture('persisted')
    // wait for the write to land
    await vi.waitFor(() => expect(persistence.snapshot.nodes).toHaveLength(1))

    const reopened = new AppStore(persistence)
    await reopened.init()
    expect(reopened.inbox().map((n) => n.text)).toEqual(['persisted'])
  })

  it('exposes the shortcut setting', async () => {
    const { store } = await ready()
    await store.setShortcut('Ctrl+Alt+K')
    expect(store.getState().shortcut).toBe('Ctrl+Alt+K')
  })
})

describe('node detail fields', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('stores notes and conclusions separately', async () => {
    const { store } = await ready()
    const id = store.addChild(null, 0, 'root') as string
    store.setNote(id, 'half-formed note')
    store.setConclusion(id, 'final answer')
    expect(store.getState().nodes[id].note).toBe('half-formed note')
    expect(store.getState().nodes[id].conclusion).toBe('final answer')
  })
})
