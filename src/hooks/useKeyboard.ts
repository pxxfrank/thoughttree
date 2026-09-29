import { useEffect } from 'react'
import { focusCaptureBar } from '../components/CaptureBar'
import { indexChildren } from '../domain/tree'
import { useAppState, useStore } from '../state/context'
import { useVisibleForest } from '../state/selectors'

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  const tag = element.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || element.isContentEditable
}

/**
 * The keyboard is the fast lane: navigating, splitting and triaging a tree of
 * questions should never require the mouse.
 */
export function useKeyboard(): void {
  const store = useStore()
  const state = useAppState()
  const { flat } = useVisibleForest()

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // Never touch keys while an IME is composing: Enter picks a candidate.
      if (event.isComposing || event.keyCode === 229) return
      const mod = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      const typing = isTypingTarget(event.target)

      if (mod && key === 'z') {
        if (typing) return
        event.preventDefault()
        if (event.shiftKey) store.redo()
        else store.undo()
        return
      }
      if (mod && key === 'y') {
        if (typing) return
        event.preventDefault()
        store.redo()
        return
      }
      if (mod && event.shiftKey && key === 'c') {
        event.preventDefault()
        focusCaptureBar()
        return
      }
      if (mod && event.shiftKey && key === 'f') {
        event.preventDefault()
        store.toggleFocusMode()
        return
      }
      // Ctrl+P opens search from anywhere, including while typing. It must be
      // handled before the typing/mod guard below, and prevented from reaching
      // the browser's print dialog.
      if (mod && !event.shiftKey && key === 'p') {
        event.preventDefault()
        store.openSearch()
        return
      }

      const snapshot = store.getState()
      const selectedId = snapshot.selectedId
      const node = selectedId ? snapshot.nodes[selectedId] : undefined

      if (mod && node && !event.shiftKey) {
        if (key === 'i') {
          if (typing) return
          event.preventDefault()
          store.togglePriority(node.id)
          return
        }
        if (key === 'l') {
          if (typing) return
          event.preventDefault()
          store.setStatus(node.id, node.status === 'later' ? 'open' : 'later')
          return
        }
        if (key === 'k') {
          if (typing) return
          event.preventDefault()
          store.setStatus(node.id, node.status === 'done' ? 'open' : 'done')
          return
        }
      }

      if (typing || mod) return

      const index = flat.findIndex((item) => item.node.id === selectedId)
      const current = index >= 0 ? flat[index] : null
      const nodes = Object.values(snapshot.nodes)

      const move = (delta: number) => {
        if (flat.length === 0) return
        const next = index < 0 ? 0 : Math.max(0, Math.min(flat.length - 1, index + delta))
        store.select(flat[next].node.id)
      }

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault()
          move(1)
          return
        case 'ArrowUp':
          event.preventDefault()
          move(-1)
          return
        case 'ArrowRight':
          event.preventDefault()
          if (!current) return
          if (current.node.collapsed) store.toggleCollapse(current.node.id)
          else if (current.children[0]) store.select(current.children[0].node.id)
          return
        case 'ArrowLeft':
          event.preventDefault()
          if (!current) return
          if (!current.node.collapsed && current.children.length > 0) {
            store.toggleCollapse(current.node.id)
          } else if (current.node.parent_id) {
            store.select(current.node.parent_id)
          }
          return
        case 'Enter': {
          event.preventDefault()
          if (!current) {
            store.beginCreate(null, flat.length + 1)
            return
          }
          const siblings = (indexChildren(nodes).get(current.node.parent_id) ?? []).map(
            (sibling) => sibling.id,
          )
          store.beginCreate(current.node.parent_id, siblings.indexOf(current.node.id) + 1)
          return
        }
        case 'Tab':
          event.preventDefault()
          if (!current) return
          store.beginCreate(current.node.id, current.children.length)
          return
        case 'F2':
          if (!current) return
          event.preventDefault()
          store.beginEdit(current.node.id)
          return
        case 'e':
        case 'E':
          // "Why here?" is otherwise only reachable by dragging or by finding the
          // button in the detail panel. A question whose relation is unexplained
          // needs a keyboard route to the prompt.
          if (!current || !current.node.parent_id) return
          event.preventDefault()
          store.openWhyHere(current.node.id)
          return
        case 'Delete':
        case 'Backspace':
          if (!current) return
          event.preventDefault()
          store.remove([current.node.id])
          return
        case 'Escape':
          store.cancelCreate()
          store.endEdit()
          if (snapshot.whyHereFor) store.skipExplain()
          else store.select(null)
          return
        default:
          return
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [store, state.selectedId, state.whyHereFor, flat])
}
