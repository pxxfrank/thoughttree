import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'

export type DropTarget =
  | { kind: 'row'; nodeId: string; where: 'before' | 'after' | 'child' }
  | { kind: 'root-end' }

export interface DragPayload {
  ids: string[]
  label: string
}

interface DndValue {
  payload: DragPayload | null
  target: DropTarget | null
  isDragging: (id: string) => boolean
  begin: (payload: DragPayload, event: ReactPointerEvent) => void
}

const DndContext = createContext<DndValue | null>(null)

export function useDnd(): DndValue {
  const value = useContext(DndContext)
  if (!value) throw new Error('DndProvider is missing')
  return value
}

const DRAG_THRESHOLD = 4

function resolveTarget(x: number, y: number, dragging: Set<string>): DropTarget | null {
  const element = document.elementFromPoint(x, y)
  if (!element) return null

  const row = element.closest<HTMLElement>('[data-node-id]')
  if (row?.dataset.nodeId) {
    const nodeId = row.dataset.nodeId
    if (dragging.has(nodeId)) return null
    const rect = row.getBoundingClientRect()
    const ratio = rect.height > 0 ? (y - rect.top) / rect.height : 0.5
    if (ratio < 0.3) return { kind: 'row', nodeId, where: 'before' }
    if (ratio > 0.7) return { kind: 'row', nodeId, where: 'after' }
    return { kind: 'row', nodeId, where: 'child' }
  }

  if (element.closest('[data-root-drop]')) return { kind: 'root-end' }
  return null
}

/**
 * Pointer-based drag and drop. Native HTML5 drag never reports a drop position
 * precise enough for "before / after / inside", and a tree lives or dies by that
 * distinction, so the whole interaction is driven from pointer coordinates.
 */
export function DndProvider({
  children,
  onDrop,
}: {
  children: ReactNode
  onDrop: (payload: DragPayload, target: DropTarget) => void
}) {
  const [payload, setPayload] = useState<DragPayload | null>(null)
  const [target, setTarget] = useState<DropTarget | null>(null)
  const [pointer, setPointer] = useState({ x: 0, y: 0 })

  const payloadRef = useRef<DragPayload | null>(null)
  const targetRef = useRef<DropTarget | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const started = useRef(false)
  const onDropRef = useRef(onDrop)
  onDropRef.current = onDrop

  const reset = useCallback(() => {
    payloadRef.current = null
    targetRef.current = null
    origin.current = null
    started.current = false
    setPayload(null)
    setTarget(null)
    document.body.style.cursor = ''
  }, [])

  const begin = useCallback((next: DragPayload, event: ReactPointerEvent) => {
    if (event.button !== 0) return
    const element = event.target as HTMLElement
    if (element.closest('input, textarea, [data-no-drag]')) return
    payloadRef.current = next
    origin.current = { x: event.clientX, y: event.clientY }
    started.current = false
    setPointer({ x: event.clientX, y: event.clientY })
  }, [])

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const pending = payloadRef.current
      if (!pending || !origin.current) return
      if (!started.current) {
        const dx = event.clientX - origin.current.x
        const dy = event.clientY - origin.current.y
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
        started.current = true
        setPayload(pending)
        document.body.style.cursor = 'grabbing'
      }
      setPointer({ x: event.clientX, y: event.clientY })
      const resolved = resolveTarget(event.clientX, event.clientY, new Set(pending.ids))
      targetRef.current = resolved
      setTarget(resolved)
    }

    const onUp = () => {
      if (started.current && payloadRef.current && targetRef.current) {
        onDropRef.current(payloadRef.current, targetRef.current)
      }
      reset()
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && started.current) reset()
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('keydown', onKey)
    }
  }, [reset])

  const isDragging = useCallback(
    (id: string) => !!payload?.ids.includes(id),
    [payload],
  )

  return (
    <DndContext.Provider value={{ payload, target, isDragging, begin }}>
      {children}
      {payload && (
        <div className="drag-ghost" style={{ left: pointer.x, top: pointer.y }}>
          {payload.ids.length > 1 ? `${payload.ids.length} questions` : payload.label}
        </div>
      )}
    </DndContext.Provider>
  )
}
