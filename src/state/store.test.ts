import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryPersistence } from '../storage/memory-persistence'
import { AppStore, DEFAULT_SHORTCUT, resolveShortcut } from './store'
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

describe('a stored shortcut that can never fire', () => {
  it('reads the old Alt+Space default as unset', () => {
    expect(resolveShortcut('Alt+Space')).toBe(DEFAULT_SHORTCUT)
    expect(resolveShortcut('  Alt+Space  ')).toBe(DEFAULT_SHORTCUT)
    expect(resolveShortcut(undefined)).toBe(DEFAULT_SHORTCUT)
    expect(resolveShortcut('')).toBe(DEFAULT_SHORTCUT)
  })

  it('keeps a shortcut someone chose on purpose', () => {
    expect(resolveShortcut('Ctrl+Alt+T')).toBe('Ctrl+Alt+T')
  })

  it('is corrected on load, not shown as the dead value', async () => {
    const persistence = new MemoryPersistence()
    await persistence.writeSetting('shortcut', 'Alt+Space')
    const store = new AppStore(persistence)
    await store.init()
    expect(store.getState().shortcut).toBe(DEFAULT_SHORTCUT)
  })
})

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

  it('records which app and window a thought came from', async () => {
    const { store, persistence } = await ready()
    const id = store.capture('Note jotted in an editor', {
      app: 'notepad',
      title: 'Untitled - Notepad',
      url: 'https://example.com/article',
    }) as string
    const node = store.getState().nodes[id]
    expect(node.source_app).toBe('notepad')
    expect(node.source_title).toBe('Untitled - Notepad')
    expect(node.source_url).toBe('https://example.com/article')
    await vi.waitFor(() => expect(persistence.applied).toHaveLength(1))
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
  it('focusing a question shows it and everything under it', async () => {
    const { store } = await ready()
    const a = store.addChild(null, 0, 'A') as string
    store.addChild(null, 1, 'B')

    // No focus: the whole tree is visible.
    expect(store.visibleForest()).toHaveLength(2)

    store.focusOn(a)
    expect(store.visibleForest().map((i) => i.node.id)).toEqual([a])
  })

  it('focusing a child shows that child and what is under it — not its parents', async () => {
    const { store } = await ready()
    const root = store.addChild(null, 0, 'root') as string
    const child = store.addChild(root, 0, 'child') as string
    const leaf = store.addChild(child, 0, 'leaf') as string

    store.focusOn(child)
    const forest = store.visibleForest()
    // The parent is deliberately absent. `filterTree` rescues the ancestors of
    // whatever it keeps, so filtering alone would drag `root` back in and the
    // screen would show more than the question being focused on.
    expect(forest.map((i) => i.node.id)).toEqual([child])
    expect(forest[0].depth).toBe(0)
    expect(forest[0].children.map((i) => i.node.id)).toEqual([leaf])
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

  it('switches theme and keeps it in settings', async () => {
    const { store, persistence } = await ready()
    expect(store.getState().theme).toBe('system')
    await store.setTheme('light')
    expect(store.getState().theme).toBe('light')
    expect(persistence.settings['theme']).toBe('light')
    await store.setTheme('dark')
    expect(store.getState().theme).toBe('dark')
    expect(persistence.settings['theme']).toBe('dark')
  })

  it('survives being called as a detached handler', async () => {
    const { store } = await ready()
    // This is how React calls them: `onClick={store.someMethod}` invokes the
    // function without a receiver. If the method is not bound, `this` is
    // undefined and the click silently throws — which is exactly how the Focus
    // button appeared dead.
    const setView = store.setView
    setView('focus')
    expect(store.getState().leftView).toBe('focus')
    const undo = store.undo
    undo()
    const dismissToast = store.dismissToast
    dismissToast()
    const skipExplain = store.skipExplain
    skipExplain()
  })
})

describe('capture url setting', () => {
  it('is on by default', async () => {
    const { store } = await ready()
    expect(store.getState().captureUrl).toBe(true)
  })

  it('patches state and persists capture_url as on/off', async () => {
    const { store, persistence } = await ready()
    await store.setCaptureUrl(false)
    expect(store.getState().captureUrl).toBe(false)
    expect(persistence.settings['capture_url']).toBe('off')
    await store.setCaptureUrl(true)
    expect(store.getState().captureUrl).toBe(true)
    expect(persistence.settings['capture_url']).toBe('on')
  })

  it('loads a stored off value back as disabled', async () => {
    const persistence = new MemoryPersistence()
    await persistence.writeSetting('capture_url', 'off')
    const store = new AppStore(persistence)
    await store.init()
    // Settings load is fire-and-forget; wait for the patch it applies.
    await vi.waitFor(() => expect(store.getState().dataDir).toBe('/tmp/thoughttree'))
    expect(store.getState().captureUrl).toBe(false)
  })

  it('treats a missing or unrecognised value as on', async () => {
    const persistence = new MemoryPersistence()
    await persistence.writeSetting('capture_url', 'whatever')
    const store = new AppStore(persistence)
    await store.init()
    await vi.waitFor(() => expect(store.getState().dataDir).toBe('/tmp/thoughttree'))
    expect(store.getState().captureUrl).toBe(true)
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

  it('an important capture still waits in the inbox rather than joining the tree', async () => {
    const { store } = await ready()
    const id = store.capture('important but unfiled') as string
    store.setPriority(id, 'important')
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
          source_url: null,
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

describe('search → reveal', () => {
  it('opens and closes the palette', async () => {
    const { store } = await ready()
    expect(store.getState().searching).toBe(false)
    store.openSearch()
    expect(store.getState().searching).toBe(true)
    store.closeSearch()
    expect(store.getState().searching).toBe(false)
  })

  it('revealing a node uncollapses its ancestors and clears the overlays', async () => {
    const { store } = await ready()
    const root = store.addChild(null, 0, 'root') as string
    const child = store.addChild(root, 0, 'child') as string
    const leaf = store.addChild(child, 0, 'leaf') as string

    store.toggleCollapse(root)
    store.toggleCollapse(child)
    store.focusOn(root)
    store.openSearch()
    expect(store.getState().nodes[root].collapsed).toBe(true)
    expect(store.getState().nodes[child].collapsed).toBe(true)
    expect(store.getState().focusRoot).toBe(root)

    store.revealNode(leaf)

    const state = store.getState()
    expect(state.nodes[root].collapsed).toBe(false)
    expect(state.nodes[child].collapsed).toBe(false)
    expect(state.selectedId).toBe(leaf)
    expect(state.searching).toBe(false)
    expect(state.focusRoot).toBeNull()
    expect(state.leftView).toBe('inbox')
  })
})

describe('focus on one question', () => {
  it('focusOn pins the question, opens the view and reveals it', async () => {
    const { store } = await ready()
    const root = store.addChild(null, 0, 'root') as string
    const child = store.addChild(root, 0, 'child') as string
    store.toggleCollapse(root)

    store.focusOn(child)

    const state = store.getState()
    expect(state.focusRoot).toBe(child)
    expect(state.leftView).toBe('focus')
    expect(state.selectedId).toBe(child)
    expect(state.searching).toBe(false)
    // The target is not left stuck under a collapsed ancestor.
    expect(state.nodes[root].collapsed).toBe(false)
  })

  it('focusOn ignores an id that names no node', async () => {
    const { store } = await ready()
    store.focusOn('missing')
    expect(store.getState().focusRoot).toBeNull()
    expect(store.getState().leftView).toBe('inbox')
  })

  it('a non-starred sub-question stays visible in focus', async () => {
    const { store } = await ready()
    const parent = store.addChild(null, 0, 'parent') as string
    const starred = store.addChild(parent, 0, 'starred') as string
    const unstarred = store.addChild(parent, 1, 'unstarred') as string
    store.setPriority(starred, 'important')

    store.focusOn(parent)

    // The bug this replaces: the non-starred child used to disappear.
    const forest = store.visibleForest()
    expect(forest.map((i) => i.node.id)).toEqual([parent])
    expect(forest[0].children.map((i) => i.node.id)).toEqual([starred, unstarred])

    // focusedNode / focusedRows back the Focus panel.
    expect(store.focusedNode()?.id).toBe(parent)
    expect(store.focusedRows().map((row) => [row.node.id, row.depth])).toEqual([
      [parent, 0],
      [starred, 1],
      [unstarred, 1],
    ])
  })

  it('clearFocus returns to the inbox', async () => {
    const { store } = await ready()
    const a = store.addChild(null, 0, 'A') as string
    store.focusOn(a)

    store.clearFocus()

    expect(store.getState().focusRoot).toBeNull()
    expect(store.getState().leftView).toBe('inbox')
    expect(store.visibleForest().map((i) => i.node.id)).toEqual([a])
  })

  it('removing the focused question clears the focus', async () => {
    const { store } = await ready()
    const a = store.addChild(null, 0, 'A') as string
    const b = store.addChild(null, 1, 'B') as string
    store.focusOn(a)

    store.remove([a])

    expect(store.getState().focusRoot).toBeNull()
    expect(store.getState().leftView).toBe('inbox')
    expect(store.visibleForest().map((i) => i.node.id)).toEqual([b])
  })

  it('focusSelection toggles the selection on and off', async () => {
    const { store } = await ready()
    const a = store.addChild(null, 0, 'A') as string
    store.select(a)

    store.focusSelection()
    expect(store.getState().focusRoot).toBe(a)
    expect(store.getState().leftView).toBe('focus')

    store.focusSelection()
    expect(store.getState().focusRoot).toBeNull()
    expect(store.getState().leftView).toBe('inbox')
  })

  it('focusSelection with nothing selected opens the empty focus view', async () => {
    const { store } = await ready()
    store.select(null)

    store.focusSelection()

    expect(store.getState().focusRoot).toBeNull()
    expect(store.getState().leftView).toBe('focus')
  })
})

describe('left column view', () => {
  it('setView changes the view without touching the tree filter', async () => {
    const { store } = await ready()
    store.addChild(null, 0, 'A')
    store.addChild(null, 1, 'B')

    store.setView('focus')
    expect(store.getState().leftView).toBe('focus')
    // Focus view with no pinned question does not filter the tree (D035).
    expect(store.getState().focusRoot).toBeNull()
    expect(store.visibleForest()).toHaveLength(2)

    store.setView('review')
    expect(store.getState().leftView).toBe('review')
    expect(store.getState().focusRoot).toBeNull()
  })

  it('reshuffle changes the session seed', async () => {
    const { store } = await ready()
    const before = store.getState().sessionSeed
    const now = vi.spyOn(Date, 'now').mockReturnValue(before + 1234)
    store.reshuffle()
    expect(store.getState().sessionSeed).toBe(before + 1234)
    now.mockRestore()
  })
})

describe('import and restore', () => {
  const restored = {
    id: 'restored-1',
    text: 'restored',
    created_at: 1,
    updated_at: 1,
    priority: 'normal' as const,
    status: 'open' as const,
    parent_id: null,
    position: 0,
    note: null,
    conclusion: null,
    inbox: false,
    collapsed: false,
    source_app: null,
    source_title: null,
    source_url: null,
  }

  it('importSnapshot is a single undoable mutation', async () => {
    const { store } = await ready()
    const conflict = store.addChild(null, 0, 'conflict') as string
    const previous = store.getState().nodes[conflict]

    store.importSnapshot({
      nodes: [
        { ...previous, id: 'fresh', text: 'imported' },
        { ...previous, text: 'from file' },
      ],
      edges: [],
    })

    expect(store.getState().nodes['fresh']).toBeDefined()
    expect(store.getState().nodes[conflict].text).toBe('from file')
    expect(store.getState().undoLabelKey).toBe('mutation.import')
    expect(store.getState().toast?.key).toBe('toast.imported')

    store.undo()
    expect(store.getState().nodes['fresh']).toBeUndefined()
    expect(store.getState().nodes[conflict].text).toBe('conflict')
  })

  it('restoreSnapshot replaces state and clears the undo/redo stacks', async () => {
    const { store } = await ready()
    store.capture('one')
    store.capture('two')
    store.undo()
    expect(store.getState().undoLabelKey).not.toBeNull()
    expect(store.getState().redoLabelKey).not.toBeNull()

    store.restoreSnapshot({ nodes: [restored], edges: [] })

    expect(Object.keys(store.getState().nodes)).toEqual(['restored-1'])
    expect(store.getState().edges).toEqual({})
    expect(store.getState().undoLabelKey).toBeNull()
    expect(store.getState().redoLabelKey).toBeNull()
    expect(store.getState().toast?.key).toBe('toast.restored')
  })

  it('readImport reads the file without touching the graph', async () => {
    const { store, persistence } = await ready()
    persistence.imported = { nodes: [restored], edges: [] }

    const snapshot = await store.readImport('export.json')
    expect(persistence.importedPath).toBe('export.json')
    expect(snapshot.nodes).toHaveLength(1)
    expect(Object.keys(store.getState().nodes)).toHaveLength(0)

    persistence.failImport = true
    await expect(store.readImport('bad.json')).rejects.toThrow('error.importFormat')
  })
})

describe('cross-branch links', () => {
  it('adds a link that surfaces via linksFor/linkedIds, and undo removes it', async () => {
    const { store, persistence } = await ready()
    const a = store.addChild(null, 0, 'A') as string
    const b = store.addChild(null, 1, 'B') as string

    store.addLink(a, b, 'challenge', 'it refutes B')

    // `linksFor` is what `useLinksFor` calls.
    const outgoing = store.linksFor(a).outgoing
    expect(outgoing).toHaveLength(1)
    expect(outgoing[0].kind).toBe('link')
    expect(outgoing[0].to_node).toBe(b)
    expect(outgoing[0].reason).toBe('it refutes B')
    // The mirror view: b sees it as incoming.
    expect(store.linksFor(b).incoming.map((l) => l.from_node)).toEqual([a])
    // `linkedIds` is what `useLinkedIds` calls; both endpoints are marked.
    expect(store.linkedIds().has(a)).toBe(true)
    expect(store.linkedIds().has(b)).toBe(true)

    await vi.waitFor(() => expect(persistence.applied.length).toBeGreaterThan(0))

    store.undo()
    expect(store.linksFor(a).outgoing).toHaveLength(0)
    expect(store.linkedIds().has(a)).toBe(false)
    expect(store.linkedIds().has(b)).toBe(false)
  })

  it('a link into a child does not disturb that child\'s parent edge', async () => {
    const { store } = await ready()
    const root = store.addChild(null, 0, 'root') as string
    const child = store.addChild(root, 0, 'child') as string
    const other = store.addChild(null, 1, 'other') as string

    store.addLink(other, child, 'support', 'supports it')

    expect(store.edgeFor(child)?.from_node).toBe(root)
    expect(store.linksFor(child).incoming).toHaveLength(1)
  })

  it('rejects a self-link with a toast and writes nothing', async () => {
    const { store } = await ready()
    const a = store.addChild(null, 0, 'A') as string
    store.addLink(a, a, 'support', '')
    expect(store.linksFor(a).outgoing).toHaveLength(0)
    expect(store.getState().toast?.key).toBe('error.linkSelf')
  })

  it('removes a link through the store', async () => {
    const { store, persistence } = await ready()
    const a = store.addChild(null, 0, 'A') as string
    const b = store.addChild(null, 1, 'B') as string
    store.addLink(a, b, 'depends_on', 'x')
    const link = store.linksFor(a).outgoing[0]

    store.removeLink(link)

    expect(store.linksFor(a).outgoing).toHaveLength(0)
    await vi.waitFor(() => expect(persistence.applied.length).toBeGreaterThanOrEqual(2))
  })
})
