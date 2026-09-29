import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { LINK_RELATION_TYPES, relationKey } from '../domain/relations'
import type { RelationType } from '../domain/types'
import { useI18n } from '../i18n/useI18n'
import { useAppState, useStore } from '../state/context'
import { isComposing } from '../util/keyboard'

const WIDTH = 430

/**
 * The create/edit popover for a cross-branch link: pick a relation type, say
 * why the two questions are related, and save. It is deliberately the same
 * shape as `WhyHerePopover`, so the two read as one gesture.
 */
export function LinkEditor() {
  const store = useStore()
  const state = useAppState()
  const { t } = useI18n()
  const draft = state.linkDraft
  const from = draft ? state.nodes[draft.fromId] : undefined
  const to = draft ? state.nodes[draft.toId] : undefined
  const existing = draft?.linkId ? state.edges[draft.linkId] : undefined

  const [reason, setReason] = useState('')
  const [type, setType] = useState<RelationType>('support')
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!draft) return
    setReason(existing?.reason ?? '')
    setType(existing?.relation_type ?? 'support')
  }, [draft, existing?.reason, existing?.relation_type])

  useLayoutEffect(() => {
    if (!draft) {
      setPosition(null)
      return
    }
    const row = document.querySelector<HTMLElement>(
      `[data-node-id="${CSS.escape(draft.fromId)}"]`,
    )
    const rect = row?.getBoundingClientRect()
    const left = rect
      ? Math.max(12, Math.min(rect.left, window.innerWidth - WIDTH - 16))
      : Math.max(12, window.innerWidth / 2 - WIDTH / 2)
    const top = rect
      ? Math.min(rect.bottom + 8, window.innerHeight - 250)
      : Math.max(24, window.innerHeight / 2 - 140)
    setPosition({ left, top })
  }, [draft, state.nodes])

  useEffect(() => {
    if (draft) inputRef.current?.focus()
  }, [draft])

  if (!draft || !from || !to) return null

  const save = () => {
    if (existing) store.updateLink(existing, type, reason)
    else store.addLink(draft.fromId, draft.toId, type, reason)
  }

  return (
    // The popover is nested *inside* the click-outside scrim, so it always
    // paints above the scrim and always receives clicks (DECISIONS.md D020).
    <div className="popover-scrim" onClick={store.closeLinkEditor}>
      <div
        className="popover"
        style={{ left: position?.left ?? 40, top: position?.top ?? 80 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="popover-title">{existing ? t('link.edit') : t('link.add')}</div>
        <div className="popover-sub">
          {from.text} → {to.text}
        </div>

        <div className="chips" style={{ marginBottom: 9 }}>
          {LINK_RELATION_TYPES.map((relation) => (
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
          placeholder={t('link.reasonPlaceholder')}
          onChange={(event) => setReason(event.target.value)}
          onKeyDown={(event) => {
            if (isComposing(event)) return
            if (event.key === 'Enter') {
              event.preventDefault()
              save()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              store.closeLinkEditor()
            }
          }}
        />

        <div className="popover-actions">
          <button className="btn primary" onClick={save}>
            {t('link.create')}
          </button>
          {existing && (
            <button className="btn ghost" onClick={() => store.removeLink(existing)}>
              {t('link.remove')}
            </button>
          )}
          <span className="spacer" style={{ flex: 1 }} />
          <span className="hint">{t(relationKey(type) + '.hint')}</span>
        </div>
      </div>
    </div>
  )
}
