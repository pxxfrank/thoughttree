import { useEffect, useMemo, useRef, useState } from 'react'
import { searchNodes } from '../domain/search'
import { useI18n } from '../i18n/useI18n'
import { useAppState, useStore } from '../state/context'
import { isComposing } from '../util/keyboard'

/**
 * Jump-to-question. Typed words match the question, its notes and conclusion,
 * and the reason its parent gave for it; Enter reveals the best hit and opens
 * the branches above it.
 *
 * The same panel doubles as a node chooser: pass `onPick` and it selects a hit
 * instead of revealing it, which is how a link target is chosen (Ctrl+P is the
 * one palette either way, rather than a second picker).
 */
export function SearchPalette({ onPick }: { onPick?: (nodeId: string) => void } = {}) {
  const store = useStore()
  const state = useAppState()
  const { t } = useI18n()

  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // In pick mode the palette is driven by the caller, not by `searching`.
  const open = state.searching || !!onPick

  const hits = useMemo(
    () => searchNodes(Object.values(state.nodes), Object.values(state.edges), query),
    [state.nodes, state.edges, query],
  )

  useEffect(() => {
    if (open) {
      inputRef.current?.focus()
    } else {
      setQuery('')
      setCursor(0)
    }
  }, [open])

  if (!open) return null

  // Clamp so a stale cursor from a longer result list cannot point off the end.
  const active = hits.length ? Math.min(cursor, hits.length - 1) : 0

  const choose = (index: number) => {
    const hit = hits[index]
    if (!hit) return
    if (onPick) onPick(hit.node.id)
    else store.revealNode(hit.node.id)
  }

  const close = () => {
    if (onPick) store.cancelLink()
    else store.closeSearch()
  }

  const move = (delta: number) => {
    if (hits.length === 0) return
    setCursor((current) => Math.max(0, Math.min(hits.length - 1, current + delta)))
  }

  return (
    // The panel is nested *inside* the click-outside scrim, so it always paints
    // above it and always receives clicks (see DECISIONS.md D020).
    <div className="popover-scrim" onClick={close}>
      <div className="popover search-palette" onClick={(event) => event.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          placeholder={t('search.placeholder')}
          onChange={(event) => {
            setQuery(event.target.value)
            setCursor(0)
          }}
          onKeyDown={(event) => {
            if (isComposing(event)) return
            switch (event.key) {
              case 'ArrowDown':
                event.preventDefault()
                move(1)
                return
              case 'ArrowUp':
                event.preventDefault()
                move(-1)
                return
              case 'Enter':
                event.preventDefault()
                choose(active)
                return
              case 'Escape':
                event.preventDefault()
                close()
                return
              default:
                return
            }
          }}
        />

        {hits.length === 0 ? (
          <div className="empty">{t('search.empty')}</div>
        ) : (
          <div className="search-results">
            {hits.map((hit, index) => (
              <button
                key={hit.node.id}
                className={`search-row ${index === active ? 'on' : ''}`}
                onClick={() => choose(index)}
              >
                <span className="search-row-main">
                  <span className="search-row-text">{hit.node.text}</span>
                  <span className="search-row-path">{hit.path}</span>
                </span>
                <span className="chip">{t('search.field.' + hit.field)}</span>
              </button>
            ))}
          </div>
        )}

        <div className="hint">{t('search.hint')}</div>
      </div>
    </div>
  )
}
