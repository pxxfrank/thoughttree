import { applyChanges, fromSnapshot } from '../domain/changes'
import type { EntityState } from '../domain/changes'
import { filterTree, inboxOrder, focusList, makeVisibility } from '../domain/focus'
import {
  DomainError,
  addChildMutation,
  captureMutation,
  deleteMutation,
  placeMutation,
  setConclusionMutation,
  setNoteMutation,
  setPriorityMutation,
  setRelationMutation,
  setStatusMutation,
  setTextMutation,
  toggleCollapseMutation,
  type Mutation,
  type MutationContext,
} from '../domain/mutations'
import { edgeForNode, unexplainedNodeIds } from '../domain/relations'
import { buildForest, indexChildren, orderWithMany } from '../domain/tree'
import type { TreeItem } from '../domain/tree'
import type { Changes, Edge, Node, Priority, RelationType, Snapshot, Status } from '../domain/types'
import { detectLocale, type Locale } from '../i18n/strings'
import type { Persistence } from '../storage/persistence'
import type { Theme } from '../theme/theme'

export interface Toast {
  id: number
  key: string
  params?: Record<string, string | number>
  kind: 'info' | 'warn' | 'error'
}

export type CreateTarget = { parentId: string | null; index: number } | null

export interface AppState extends EntityState {
  loaded: boolean
  fatalError: string | null
  selectedId: string | null
  inboxSelection: string[]
  editingId: string | null
  creating: CreateTarget
  focusMode: boolean
  showLater: boolean
  showDone: boolean
  showArchived: boolean
  onlyUnexplained: boolean
  whyHereFor: string | null
  toast: Toast | null
  saveError: string | null
  undoLabelKey: string | null
  undoLabelParams?: Record<string, number>
  redoLabelKey: string | null
  redoLabelParams?: Record<string, number>
  shortcut: string
  locale: Locale
  theme: Theme
  dataDir: string
}

const HISTORY_LIMIT = 200
export const DEFAULT_SHORTCUT = 'Alt+Space'

function initialState(): AppState {
  return {
    nodes: {},
    edges: {},
    loaded: false,
    fatalError: null,
    selectedId: null,
    inboxSelection: [],
    editingId: null,
    creating: null,
    focusMode: false,
    showLater: true,
    showDone: true,
    showArchived: false,
    onlyUnexplained: false,
    whyHereFor: null,
    toast: null,
    saveError: null,
    undoLabelKey: null,
    redoLabelKey: null,
    shortcut: DEFAULT_SHORTCUT,
    locale: detectLocale(),
    theme: 'system',
    dataDir: '',
  }
}

/**
 * The application store. Local-first in the strict sense: every action updates
 * memory immediately and only then hands an atomic changeset to persistence. If
 * the write fails the change is rolled back, so the UI can never lie about what
 * is on disk. The store is framework-free and fully testable.
 */
export class AppStore {
  private state: AppState = initialState()
  private listeners = new Set<() => void>()
  private undoStack: Mutation[] = []
  private redoStack: Mutation[] = []
  private writeChain: Promise<void> = Promise.resolve()
  private toastSeq = 0

  constructor(private persistence: Persistence) {}

  // --- plumbing -----------------------------------------------------------

  getState = (): AppState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  private patch(partial: Partial<AppState>): void {
    this.state = { ...this.state, ...partial }
    this.notify()
  }

  private ctx(): MutationContext {
    return { nodes: Object.values(this.state.nodes), edges: Object.values(this.state.edges) }
  }

  private applyLocally(changes: Changes): void {
    const next = applyChanges({ nodes: this.state.nodes, edges: this.state.edges }, changes)
    this.state = { ...this.state, nodes: next.nodes, edges: next.edges }
    this.notify()
  }

  private syncHistory(): void {
    const undo = this.undoStack.at(-1)
    const redo = this.redoStack.at(-1)
    this.state = {
      ...this.state,
      undoLabelKey: undo?.labelKey ?? null,
      undoLabelParams: undo?.labelParams,
      redoLabelKey: redo?.labelKey ?? null,
      redoLabelParams: redo?.labelParams,
    }
  }

  private commit(mutation: Mutation): void {
    this.applyLocally(mutation.forward)
    this.undoStack.push(mutation)
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift()
    this.redoStack = []
    this.syncHistory()
    this.notify()
    this.persist(mutation.forward, mutation.backward, mutation)
  }

  /** Writes are serialised so a failure can always be rolled back in order. */
  private persist(forward: Changes, backward: Changes, mutation?: Mutation): void {
    this.writeChain = this.writeChain.then(async () => {
      try {
        await this.persistence.apply(forward)
        this.persistence.broadcast(forward)
        if (this.state.saveError) this.patch({ saveError: null })
      } catch (error) {
        this.rollback(backward, mutation, error)
      }
    })
  }

  private rollback(backward: Changes, mutation: Mutation | undefined, error: unknown): void {
    this.applyLocally(backward)
    if (mutation) {
      const index = this.undoStack.lastIndexOf(mutation)
      if (index >= 0) this.undoStack.splice(index, 1)
      const redoIndex = this.redoStack.lastIndexOf(mutation)
      if (redoIndex >= 0) this.redoStack.splice(redoIndex, 1)
    }
    this.syncHistory()
    this.toast('toast.saveFailed', 'error', { error: String(error) })
    this.notify()
  }

  toast(key: string, kind: Toast['kind'] = 'info', params?: Record<string, string | number>): void {
    this.toastSeq += 1
    this.patch({ toast: { id: this.toastSeq, key, params, kind } })
    const timer = setTimeout(() => {
      if (this.state.toast?.id === this.toastSeq) this.patch({ toast: null })
    }, 4200)
    ;(timer as unknown as { unref?: () => void }).unref?.()
  }

  dismissToast(): void {
    this.patch({ toast: null })
  }

  private fail(error: unknown): void {
    const message = error instanceof DomainError ? error.message : String(error)
    this.toast('toast.domainError', 'warn', { error: message })
  }

  // --- lifecycle ----------------------------------------------------------

  async init(): Promise<void> {
    try {
      const snapshot: Snapshot = await this.persistence.load()
      const entities = fromSnapshot(snapshot)
      this.state = { ...this.state, ...entities, loaded: true }
      this.notify()
      this.persistence.onRemote((changes) => {
        this.applyLocally(changes)
      })
      void this.loadSettings()
    } catch (error) {
      this.state = { ...this.state, loaded: true, fatalError: String(error) }
      this.notify()
    }
  }

  private async loadSettings(): Promise<void> {
    try {
      const settings = await this.persistence.readSettings()
      const dataDir = await this.persistence.dataDirectory()
      const storedLocale = settings['locale']
      const storedTheme = settings['theme']
      this.patch({
        shortcut: settings['shortcut'] ?? DEFAULT_SHORTCUT,
        locale:
          storedLocale === 'en' || storedLocale === 'zh' ? storedLocale : this.state.locale,
        theme:
          storedTheme === 'dark' || storedTheme === 'light' || storedTheme === 'system'
            ? storedTheme
            : this.state.theme,
        dataDir,
      })
    } catch {
      /* settings are a convenience; never block the app on them */
    }
  }

  async setTheme(theme: Theme): Promise<void> {
    this.patch({ theme })
    try {
      await this.persistence.writeSetting('theme', theme)
    } catch (error) {
      this.toast('toast.shortcutFailed', 'error', { error: String(error) })
    }
  }

  async setLocale(locale: Locale): Promise<void> {
    this.patch({ locale })
    try {
      await this.persistence.writeSetting('locale', locale)
    } catch (error) {
      this.toast('toast.shortcutFailed', 'error', { error: String(error) })
    }
  }

  // --- capture ------------------------------------------------------------

  capture(text: string, source: { app?: string | null; title?: string | null } = {}): string | null {
    const mutation = captureMutation(text, Date.now(), source)
    if (!mutation) return null
    this.commit(mutation)
    const created = mutation.forward.upsert_nodes[0]
    this.patch({ selectedId: created.id })
    return created.id
  }

  // --- node edits ---------------------------------------------------------

  private withNode<T>(id: string, fn: (node: Node, ctx: MutationContext) => T): T | null {
    const node = this.state.nodes[id]
    if (!node) return null
    return fn(node, this.ctx())
  }

  private run(mutation: Mutation | null): boolean {
    if (!mutation) return false
    this.commit(mutation)
    return true
  }

  setText(id: string, text: string): void {
    try {
      this.withNode(id, (node) => this.run(setTextMutation(node, text)))
    } catch (error) {
      this.fail(error)
    }
  }

  setStatus(id: string, status: Status): void {
    try {
      this.withNode(id, (node) => this.run(setStatusMutation(node, status)))
    } catch (error) {
      this.fail(error)
    }
  }

  setPriority(id: string, priority: Priority): void {
    try {
      this.withNode(id, (node) => this.run(setPriorityMutation(node, priority)))
    } catch (error) {
      this.fail(error)
    }
  }

  togglePriority(id: string): void {
    const node = this.state.nodes[id]
    if (!node) return
    this.setPriority(id, node.priority === 'important' ? 'normal' : 'important')
  }

  setNote(id: string, note: string): void {
    this.withNode(id, (node) => this.run(setNoteMutation(node, note)))
  }

  setConclusion(id: string, conclusion: string): void {
    this.withNode(id, (node) => this.run(setConclusionMutation(node, conclusion)))
  }

  toggleCollapse(id: string): void {
    this.withNode(id, (node) => this.run(toggleCollapseMutation(node)))
  }

  addChild(parentId: string | null, index: number, text: string): string | null {
    const mutation = addChildMutation(this.ctx(), parentId, index, text)
    if (!mutation) return null
    this.commit(mutation)
    const created = mutation.forward.upsert_nodes.find((n) => n.text === text.trim())
    if (created) this.patch({ selectedId: created.id, creating: null, editingId: null })
    return created?.id ?? null
  }

  remove(ids: string[]): void {
    const mutation = deleteMutation(this.ctx(), ids)
    if (!mutation) return
    this.commit(mutation)
    const selection = ids.includes(this.state.selectedId ?? '')
      ? null
      : this.state.selectedId
    this.patch({
      selectedId: selection,
      inboxSelection: this.state.inboxSelection.filter((id) => !ids.includes(id)),
    })
  }

  // --- organising ---------------------------------------------------------

  /**
   * Drops questions at `index` among the children of `parentId`. When the parent
   * actually changes the relation is reset, so the app can ask why.
   */
  place(ids: string[], parentId: string | null, index: number): void {
    if (ids.length === 0) return
    const ctx = this.ctx()
    const before = new Map(
      ids.map((id) => [id, ctx.nodes.find((n) => n.id === id)?.parent_id ?? null]),
    )
    // Top-level ordering is a property of the *tree*. Unfiled captures are also
    // parentless, but they live in the Inbox and must not take part in it.
    const siblings = (indexChildren(ctx.nodes).get(parentId) ?? []).filter((node) =>
      parentId === null ? !node.inbox : true,
    )
    const ordered = orderWithMany(siblings, ids, index)
    try {
      const mutation = placeMutation(ctx, ids, parentId, ordered, undefined, {
        expandParent: true,
      })
      if (!mutation) return
      this.commit(mutation)
      const parentChanged = parentId !== null && ids.some((id) => before.get(id) !== parentId)
      this.patch({
        selectedId: ids[0],
        inboxSelection: this.state.inboxSelection.filter((id) => !ids.includes(id)),
        whyHereFor: parentChanged ? ids[0] : this.state.whyHereFor,
      })
    } catch (error) {
      this.fail(error)
    }
  }

  /** How many questions already sit at the top level of the tree. */
  treeRootCount(): number {
    return this.allNodes().filter((node) => node.parent_id === null && !node.inbox).length
  }

  /** Files an Inbox thought under a tree node (drag-and-drop target). */
  explain(nodeId: string, relationType: RelationType, reason: string): void {
    const edge = edgeForNode(Object.values(this.state.edges), nodeId)
    if (!edge) {
      this.patch({ whyHereFor: null })
      return
    }
    this.run(setRelationMutation(edge, relationType, reason))
    this.patch({ whyHereFor: null })
  }

  skipExplain(): void {
    this.patch({ whyHereFor: null })
  }

  openWhyHere(nodeId: string): void {
    this.patch({ whyHereFor: nodeId, selectedId: nodeId })
  }

  // --- selection & UI -----------------------------------------------------

  select(id: string | null): void {
    this.patch({ selectedId: id, editingId: null })
  }

  selectInbox(ids: string[]): void {
    this.patch({ inboxSelection: ids })
  }

  beginEdit(id: string): void {
    this.patch({ editingId: id, selectedId: id })
  }

  endEdit(): void {
    this.patch({ editingId: null })
  }

  beginCreate(parentId: string | null, index: number): void {
    this.patch({ creating: { parentId, index }, editingId: null })
  }

  cancelCreate(): void {
    this.patch({ creating: null })
  }

  toggleFocusMode(): void {
    this.patch({ focusMode: !this.state.focusMode })
  }

  setFilter(key: 'showLater' | 'showDone' | 'showArchived' | 'onlyUnexplained', value: boolean): void {
    this.patch({ [key]: value } as Partial<AppState>)
  }

  // --- history ------------------------------------------------------------

  undo(): void {
    const mutation = this.undoStack.pop()
    if (!mutation) return
    this.redoStack.push(mutation)
    this.applyLocally(mutation.backward)
    this.syncHistory()
    this.notify()
    this.persist(mutation.backward, mutation.forward, mutation)
  }

  redo(): void {
    const mutation = this.redoStack.pop()
    if (!mutation) return
    this.undoStack.push(mutation)
    this.applyLocally(mutation.forward)
    this.syncHistory()
    this.notify()
    this.persist(mutation.forward, mutation.backward, mutation)
  }

  // --- derived views ------------------------------------------------------

  allNodes(): Node[] {
    return Object.values(this.state.nodes)
  }

  allEdges(): Edge[] {
    return Object.values(this.state.edges)
  }

  unexplained(): Set<string> {
    return unexplainedNodeIds(this.allNodes(), this.allEdges())
  }

  visibility() {
    return makeVisibility({
      focusMode: this.state.focusMode,
      showLater: this.state.showLater,
      showDone: this.state.showDone,
      showArchived: this.state.showArchived,
      onlyUnexplained: this.state.onlyUnexplained,
      unexplained: this.unexplained(),
    })
  }

  visibleForest(): TreeItem[] {
    const keep = this.visibility()
    return filterTree(buildForest(this.allNodes()), keep)
  }

  inbox(): Node[] {
    return inboxOrder(this.allNodes())
  }

  focusTargets(): Node[] {
    return focusList(this.allNodes())
  }

  edgeFor(nodeId: string): Edge | undefined {
    return edgeForNode(this.allEdges(), nodeId)
  }

  // --- export / settings --------------------------------------------------

  async exportJson(): Promise<void> {
    try {
      const path = await this.persistence.exportJson()
      if (path) this.toast('toast.exported', 'info', { path })
    } catch (error) {
      this.toast('toast.exportFailed', 'error', { error: String(error) })
    }
  }

  async setShortcut(accel: string): Promise<void> {
    try {
      await this.persistence.applyShortcut(accel)
      await this.persistence.writeSetting('shortcut', accel)
      this.patch({ shortcut: accel })
      this.toast(accel ? 'toast.shortcutSet' : 'toast.shortcutCleared', 'info', { accel })
    } catch (error) {
      this.toast('toast.shortcutFailed', 'error', { error: String(error) })
    }
  }
}
