import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { RELATION_TYPES } from '../domain/relations'
import type { RelationType } from '../domain/types'
import { useAppState, useStore } from '../state/context'
import { useEdgeFor } from '../state/selectors'
import { isComposing } from '../util/keyboard'

const WIDTH = 430

/**
 * The heart of the product: moving a question is a judgement, so the app asks
 * the user to say why. It never blocks — skipping leaves an "unexplained
 * relation" marker that can be resolved later in bulk.
 */
export function WhyHerePopover() {
  const store = useStore()
  const state = useAppState()
  const nodeId = state.whyHereFor
  const node = nodeId ? state.nodes[nodeId] : undefined
  const edge = useEdgeFor(nodeId)
  const parent = node?.parent_id ? state.nodes[node.parent_id] : undefined

  const [reason, setReason] = useState('')
  const [type, setType] = useState<RelationType>('decompose')
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!nodeId) return
    setReason(edge?.reason ?? '')
    setType(edge?.relation_type ?? 'decompose')
  }, [nodeId, edge?.reason, edge?.relation_type])

  useLayoutEffect(() => {
    if (!nodeId) {
      setPosition(null)
      return
    }
    const row = document.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(nodeId)}"]`)
    const rect = row?.getBoundingClientRect()
    const left = rect
      ? Math.max(12, Math.min(rect.left, window.innerWidth - WIDTH - 16))
      : Math.max(12, window.innerWidth / 2 - WIDTH / 2)
    const top = rect
      ? Math.min(rect.bottom + 8, window.innerHeight - 250)
      : Math.max(24, window.innerHeight / 2 - 140)
    setPosition({ left, top })
  }, [nodeId, state.nodes])

  useEffect(() => {
    if (nodeId) inputRef.current?.focus()
  }, [nodeId])

  if (!nodeId || !node) return null

  const save = () => {
    store.explain(nodeId, type, reason)
  }

  return (
    <>
      <div className="backdrop" style={{ background: 'transparent' }} onClick={store.skipExplain} />
      <div
        className="popover"
        style={{ left: position?.left ?? 40, top: position?.top ?? 80 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="popover-title">Why here?</div>
        <div className="popover-sub">
          <strong>{node.text}</strong>
          {parent ? (
            <>
              {' '}
              now sits under <strong>{parent.text}</strong>. What makes that true?
            </>
          ) : (
            ' moved.'
          )}
        </div>

        <div className="chips" style={{ marginBottom: 9 }}>
          {RELATION_TYPES.map((relation) => (
            <button
              key={relation.value}
              className={`chip ${type === relation.value ? 'on' : ''}`}
              title={relation.hint}
              onClick={() => setType(relation.value)}
            >
              {relation.label}
            </button>
          ))}
        </div>

        <input
          ref={inputRef}
          value={reason}
          placeholder="Because…"
          onChange={(event) => setReason(event.target.value)}
          onKeyDown={(event) => {
            if (isComposing(event)) return
            if (event.key === 'Enter') {
              event.preventDefault()
              save()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              store.skipExplain()
            }
          }}
        />

        <div className="popover-actions">
          <button className="btn primary" onClick={save}>
            Save reason
          </button>
          <button className="btn ghost" onClick={store.skipExplain}>
            Skip for now
          </button>
          <span className="spacer" style={{ flex: 1 }} />
          <span className="hint">
            {RELATION_TYPES.find((r) => r.value === type)?.hint}
          </span>
        </div>
      </div>
    </>
  )
}
