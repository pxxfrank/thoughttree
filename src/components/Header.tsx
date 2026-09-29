import { useState } from 'react'
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
            ◉ Focus
          </button>
        </div>

        <div className="seg">
          <FilterChip
            active={state.showLater}
            label="↓ Later"
            title="Show questions parked for later"
            onClick={() => store.setFilter('showLater', !state.showLater)}
          />
          <FilterChip
            active={state.showDone}
            label="✓ Done"
            title="Show completed questions"
            onClick={() => store.setFilter('showDone', !state.showDone)}
          />
          <FilterChip
            active={state.showArchived}
            label="Archived"
            title="Show archived questions"
            onClick={() => store.setFilter('showArchived', !state.showArchived)}
          />
          <FilterChip
            active={state.onlyUnexplained}
            label="⚠ Unexplained"
            title="Only questions whose relation has not been explained yet"
            onClick={() => store.setFilter('onlyUnexplained', !state.onlyUnexplained)}
          />
        </div>

        <span className="spacer" />

        <button
          className="btn"
          disabled={!state.undoLabel}
          title={state.undoLabel ? `Undo ${state.undoLabel}` : 'Nothing to undo'}
          onClick={store.undo}
        >
          ↶ Undo
        </button>
        <button
          className="btn"
          disabled={!state.redoLabel}
          title={state.redoLabel ? `Redo ${state.redoLabel}` : 'Nothing to redo'}
          onClick={store.redo}
        >
          ↷ Redo
        </button>
        <button className="btn" onClick={() => setShowHelp(true)} title="Keyboard shortcuts & settings">
          ? Keys
        </button>
        <button className="btn" onClick={() => void quitApp()} title="Quit ThoughtTree">
          Quit
        </button>
      </header>

      {showHelp && <ShortcutHelp onClose={() => setShowHelp(false)} />}
    </>
  )
}
