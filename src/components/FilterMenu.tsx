import { useLayoutEffect, useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import { useAppState, useStore } from '../state/context'

const WIDTH = 272

const FILTERS = [
  { key: 'showLater', labelKey: 'filter.later', titleKey: 'filter.later.title' },
  { key: 'showDone', labelKey: 'filter.done', titleKey: 'filter.done.title' },
  { key: 'showArchived', labelKey: 'filter.archived', titleKey: 'filter.archived.title' },
  { key: 'onlyUnexplained', labelKey: 'filter.unexplained', titleKey: 'filter.unexplained.title' },
] as const

/**
 * The four tree filters, folded into one menu.
 *
 * They used to sit in the header as four chips, which meant the header carried
 * a permanent second row of state that was mostly irrelevant — and, because
 * Later and Done are visible by default, it also opened with two of them lit up
 * as though the user had chosen something.
 */
export function FilterMenu({ onClose }: { onClose: () => void }) {
  const store = useStore()
  const state = useAppState()
  const { t } = useI18n()
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const anchor = document.querySelector<HTMLElement>('[data-filters-anchor]')
    const rect = anchor?.getBoundingClientRect()
    const left = rect
      ? Math.max(12, Math.min(rect.right - WIDTH, window.innerWidth - WIDTH - 16))
      : window.innerWidth - WIDTH - 16
    setPosition({ left, top: rect ? rect.bottom + 8 : 56 })
  }, [])

  return (
    // Nested inside the scrim, never a sibling of it (D020).
    <div className="popover-scrim" onClick={onClose}>
      <div
        className="popover filter-menu"
        style={{ left: position?.left ?? -9999, top: position?.top ?? 56 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="popover-title">{t('nav.filters')}</div>
        <div className="popover-sub">{t('filters.sub')}</div>

        <div className="chips">
          {FILTERS.map((entry) => (
            <button
              key={entry.key}
              className={`chip ${state[entry.key] ? 'on' : ''}`}
              title={t(entry.titleKey)}
              onClick={() => store.setFilter(entry.key, !state[entry.key])}
            >
              {t(entry.labelKey)}
            </button>
          ))}
        </div>

        <div className="popover-actions">
          <button
            className="btn ghost"
            onClick={() => {
              store.setFilter('showLater', true)
              store.setFilter('showDone', true)
              store.setFilter('showArchived', false)
              store.setFilter('onlyUnexplained', false)
            }}
          >
            {t('filters.reset')}
          </button>
          <span className="spacer" />
          <button className="btn primary" onClick={onClose}>
            {t('help.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
