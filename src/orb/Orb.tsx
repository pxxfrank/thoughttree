import { useCallback, useEffect, useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  expandOrbWindow,
  openCaptureWindow,
  peekOrbWindow,
  showMainWindow,
  snapOrbWindow,
} from '../storage/desktop-actions'

const IDLE_MS = 20_000
const SNAP_DEBOUNCE_MS = 260
const DRAG_THRESHOLD = 4

/**
 * The floating orb: the lowest-friction way into the app. Click to capture,
 * right-click for the main window, drag to move. When it has been ignored for a
 * while it slides off the screen edge and comes back when the pointer nears it.
 */
export function Orb() {
  const [dragging, setDragging] = useState(false)
  const start = useRef<{ x: number; y: number } | null>(null)
  const dragged = useRef(false)
  const idleTimer = useRef<number | null>(null)
  const snapTimer = useRef<number | null>(null)

  const scheduleIdle = useCallback(() => {
    if (idleTimer.current) window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => {
      void peekOrbWindow()
    }, IDLE_MS)
  }, [])

  // Snap to the nearest screen edge once the window stops moving.
  useEffect(() => {
    const appWindow = getCurrentWindow()
    let unlisten: (() => void) | undefined
    let cancelled = false
    void appWindow
      .onMoved(() => {
        if (snapTimer.current) window.clearTimeout(snapTimer.current)
        snapTimer.current = window.setTimeout(() => {
          void snapOrbWindow()
        }, SNAP_DEBOUNCE_MS)
      })
      .then((dispose) => {
        if (cancelled) dispose()
        else unlisten = dispose
      })
    return () => {
      cancelled = true
      unlisten?.()
      if (snapTimer.current) window.clearTimeout(snapTimer.current)
    }
  }, [])

  useEffect(() => {
    scheduleIdle()
    return () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current)
    }
  }, [scheduleIdle])

  return (
    <div
      className={`orb ${dragging ? 'dragging' : ''}`}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        start.current = { x: event.clientX, y: event.clientY }
        dragged.current = false
        setDragging(true)
        void expandOrbWindow()
        scheduleIdle()
      }}
      onPointerMove={(event) => {
        if (!start.current || dragged.current) return
        const dx = event.clientX - start.current.x
        const dy = event.clientY - start.current.y
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
        dragged.current = true
        void getCurrentWindow().startDragging()
      }}
      onPointerUp={() => {
        const wasDragged = dragged.current
        start.current = null
        dragged.current = false
        setDragging(false)
        scheduleIdle()
        if (!wasDragged) void openCaptureWindow()
      }}
      onPointerCancel={() => {
        start.current = null
        dragged.current = false
        setDragging(false)
      }}
      onMouseEnter={() => {
        void expandOrbWindow()
        if (idleTimer.current) window.clearTimeout(idleTimer.current)
      }}
      onMouseLeave={() => scheduleIdle()}
      onContextMenu={(event) => {
        event.preventDefault()
        void showMainWindow()
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path className="link" d="M12 9.6 L7.4 15.4" />
        <path className="link" d="M12 9.6 L16.6 15.4" />
        <circle className="node" cx="12" cy="7" r="3.1" />
        <circle className="node" cx="6.6" cy="17.4" r="2.7" />
        <circle className="node dim" cx="17.4" cy="17.4" r="2.7" />
      </svg>
    </div>
  )
}
