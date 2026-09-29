import { useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import { useAppState, useStore } from '../state/context'
import { quitApp } from '../storage/desktop-actions'
import { ShortcutHelp } from './ShortcutHelp'

function FilterChip({
  active,
  label,
  title,
  onClick,
}: {
  active: boolean
  label: string
  title: string
  onClick: () => void
}) {
  return (
    <button className={`chip ${active ? 'on' : ''}`} title={title} onClick={onClick}>
      {label}
    </button>
  )
}

export function Header() {
  const store = useStore()
  const state = useAppState()
  const { t } = useI18n()
  const [showHelp, setShowHelp] = useState(false)

  return (
    <>
      <header className="header">
        <div className="brand">
          <span className="brand-mark" />
          ThoughtTree
        </div>

        <div className="seg">
          <button
            className={state.focusMode ? 'on' : ''}
            onClick={store.toggleFocusMode}
            title="Ctrl+Shift+F"
          >
            ◉ {t('nav.focus')}
          </button>
        </div>

        <div className="seg">
          <FilterChip
            active={state.showLater}
            label={t('filter.later')}
            title={t('filter.later.title')}
            onClick={() => store.setFilter('showLater', !state.showLater)}
          />
          <FilterChip
            active={state.showDone}
            label={t('filter.done')}
            title={t('filter.done.title')}
            onClick={() => store.setFilter('showDone', !state.showDone)}
          />
          <FilterChip
            active={state.showArchived}
            label={t('filter.archived')}
            title={t('filter.archived.title')}
            onClick={() => store.setFilter('showArchived', !state.showArchived)}
          />
          <FilterChip
            active={state.onlyUnexplained}
            label={t('filter.unexplained')}
            title={t('filter.unexplained.title')}
            onClick={() => store.setFilter('onlyUnexplained', !state.onlyUnexplained)}
          />
        </div>

        <span className="spacer" />

        <button
          className="btn"
          disabled={!state.undoLabelKey}
          title={
            state.undoLabelKey
              ? t('action.undo.title', { label: t(state.undoLabelKey, state.undoLabelParams) })
              : t('action.undo.none')
          }
          onClick={store.undo}
        >
          {t('action.undo')}
        </button>
        <button
          className="btn"
          disabled={!state.redoLabelKey}
          title={
            state.redoLabelKey
              ? t('action.redo.title', { label: t(state.redoLabelKey, state.redoLabelParams) })
              : t('action.redo.none')
          }
          onClick={store.redo}
        >
          {t('action.redo')}
        </button>
        <button className="btn" onClick={() => setShowHelp(true)} title={t('action.keys.title')}>
          {t('action.keys')}
        </button>
        <button className="btn" onClick={() => void quitApp()} title={t('action.quit.title')}>
          {t('action.quit')}
        </button>
      </header>

      {showHelp && <ShortcutHelp onClose={() => setShowHelp(false)} />}
    </>
  )
}
