import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { RELATION_TYPES, relationKey } from '../domain/relations'
import type { RelationType } from '../domain/types'
import { useI18n } from '../i18n/useI18n'
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
  const { t } = useI18n()
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
    // The popover is nested *inside* the click-outside scrim. Nesting means it
    // always paints above the scrim and always receives clicks — relying on
    // z-index ordering between siblings is what made this prompt unreachable.
    <div className="popover-scrim" onClick={store.skipExplain}>
      <div
        className="popover"
        style={{ left: position?.left ?? 40, top: position?.top ?? 80 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="popover-title">{t('why.title')}</div>
        <div className="popover-sub">
          {parent
            ? t('why.sub', { child: node.text, parent: parent.text })
            : t('why.moved', { child: node.text })}
        </div>

        <div className="chips" style={{ marginBottom: 9 }}>
          {RELATION_TYPES.map((relation) => (
            <button
              key={relation}
              className={`chip ${type === relation ? 'on' : ''}`}
              title={t(relationKey(relation) + '.hint')}
              onClick={() => setType(relation)}
            >
              {t(relationKey(relation))}
            </button>
          ))}
        </div>

        <input
          ref={inputRef}
          value={reason}
          placeholder={t('why.placeholder')}
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
            {t('why.save')}
          </button>
          <button className="btn ghost" onClick={store.skipExplain}>
            {t('why.skip')}
          </button>
          <span className="spacer" style={{ flex: 1 }} />
          <span className="hint">{t(relationKey(type) + '.hint')}</span>
        </div>
      </div>
    </div>
  )
}
