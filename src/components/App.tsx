import { useCallback } from 'react'
import { indexChildren } from '../domain/tree'
import { useI18n } from '../i18n/useI18n'
import { useAppState, useStore } from '../state/context'
import { CaptureBar } from './CaptureBar'
import { DetailPanel } from './DetailPanel'
import { DndProvider, type DragPayload, type DropTarget } from './dnd'
import { FocusPanel } from './FocusPanel'
import { Header } from './Header'
import { InboxPanel } from './InboxPanel'
import { Toast } from './Toast'
import { TreePanel } from './TreePanel'
import { WhyHerePopover } from './WhyHerePopover'
import { useKeyboard } from '../hooks/useKeyboard'

export function App() {
  const store = useStore()
  const state = useAppState()
  const { t } = useI18n()

  useKeyboard()

  /**
   * Translates a raw pointer target into "which parent, which slot". The index
   * is computed against the sibling list *without* the dragged questions, which
   * is exactly what the reordering logic expects.
   */
  const handleDrop = useCallback(
    (payload: DragPayload, target: DropTarget) => {
      const snapshot = store.getState()
      const nodes = Object.values(snapshot.nodes)
      const moving = new Set(payload.ids)

      if (target.kind === 'root-end') {
        store.place(payload.ids, null, store.treeRootCount())
        return
      }

      const node = snapshot.nodes[target.nodeId]
      if (!node) return

      if (target.where === 'child') {
        const children = (indexChildren(nodes).get(node.id) ?? []).filter(
          (child) => !moving.has(child.id),
        )
        store.place(payload.ids, node.id, children.length)
        return
      }

      const siblings = (indexChildren(nodes).get(node.parent_id) ?? []).filter(
        (sibling) => !moving.has(sibling.id),
      )
      const position = siblings.findIndex((sibling) => sibling.id === node.id)
      if (position < 0) return
      store.place(payload.ids, node.parent_id, target.where === 'before' ? position : position + 1)
    },
    [store],
  )

  if (!state.loaded) {
    return <div className="empty">{t('app.opening')}</div>
  }

  if (state.fatalError) {
    return (
      <div className="empty">
        {t('app.dbFailed')}
        <br />
        {state.fatalError}
      </div>
    )
  }

  return (
    <DndProvider onDrop={handleDrop}>
      <div className="app">
        <Header />
        <div className="workspace">
          {state.focusMode ? <FocusPanel /> : <InboxPanel />}
          <TreePanel />
          <DetailPanel />
        </div>
        <CaptureBar />
      </div>
      <WhyHerePopover />
      <Toast />
    </DndProvider>
  )
}
