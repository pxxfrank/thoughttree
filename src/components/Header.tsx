import { useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import { useAppState, useStore } from '../state/context'
import type { Theme } from '../theme/theme'
import { FilterMenu } from './FilterMenu'
import { ShortcutHelp } from './ShortcutHelp'

/** One header button cycles the three options, so the control stays small and
 *  the current state is visible at a glance. */
const THEME_CYCLE: Theme[] = ['system', 'light', 'dark']

const THEME_LABEL_KEYS: Record<Theme, string> = {
  system: 'theme.system',
  light: 'theme.light',
  dark: 'theme.dark',
}

function nextTheme(current: Theme): Theme {
  const index = THEME_CYCLE.indexOf(current)
  return THEME_CYCLE[(index + 1) % THEME_CYCLE.length]
}

/** The filter state the app starts in. "Nothing narrowed" is not four chips
 *  switched off — Later and Done are visible by default — so the menu marks
 *  itself only when the user has actually moved away from this. */
const FILTER_DEFAULTS = {
  showLater: true,
  showDone: true,
  showArchived: false,
  onlyUnexplained: false,
} as const

type GlyphProps = { children: React.ReactNode }

/* Real strokes, not text glyphs: `↶` is a thin typographic character whose
   weight is nothing like the CJK text beside it, so at this size it read as a
   stray mark rather than a button. */
function Icon({ children }: GlyphProps) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

const UndoIcon = () => (
  <Icon>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h11a5 5 0 0 1 0 10h-4" />
  </Icon>
)

const RedoIcon = () => (
  <Icon>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9a5 5 0 0 0 0 10h4" />
  </Icon>
)

const SearchIcon = () => (
  <Icon>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.6-3.6" />
  </Icon>
)

const FiltersIcon = () => (
  <Icon>
    <path d="M4 6h16" />
    <path d="M7 12h10" />
    <path d="M10 18h4" />
  </Icon>
)

const SettingsIcon = () => (
  <Icon>
    <path d="M20 7h-8" />
    <path d="M12 17H4" />
    <circle cx="16" cy="17" r="3" />
    <circle cx="8" cy="7" r="3" />
  </Icon>
)

/* The theme cycle used to be three text glyphs (◐ ☀ ☾), which were the only
   characters in the header that were not strokes — so they read as a different
   weight from everything around them. */
const SystemIcon = () => (
  <Icon>
    <rect x="2" y="4" width="20" height="13" rx="2" />
    <path d="M8 21h8" />
    <path d="M12 17v4" />
  </Icon>
)

const LightIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Icon>
)

const DarkIcon = () => (
  <Icon>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </Icon>
)

export function Header() {
  const store = useStore()
  const state = useAppState()
  const { t } = useI18n()
  const [showHelp, setShowHelp] = useState(false)
  const [showFilters, setShowFilters] = useState(false)

  const filtersChanged =
    state.showLater !== FILTER_DEFAULTS.showLater ||
    state.showDone !== FILTER_DEFAULTS.showDone ||
    state.showArchived !== FILTER_DEFAULTS.showArchived ||
    state.onlyUnexplained !== FILTER_DEFAULTS.onlyUnexplained

  return (
    <>
      <header className="header">
        <div className="brand">
          <span className="brand-mark" />
          ThoughtTree
        </div>

        <div className="seg">
          <button
            className={state.leftView === 'focus' ? 'on' : ''}
            onClick={() => store.setView('focus')}
            title="Ctrl+Shift+F"
          >
            ◉ {t('nav.focus')}
          </button>
          <button
            className={state.leftView === 'review' ? 'on' : ''}
            onClick={() => store.setView('review')}
          >
            {t('nav.review')}
          </button>
          <button
            className={state.leftView === 'conclusions' ? 'on' : ''}
            onClick={() => store.setView('conclusions')}
          >
            {t('nav.conclusions')}
          </button>
        </div>

        <span className="spacer" />

        {/* One button instead of four chips: the filters are a setting you
            visit, not a state you should have to read on every screen. */}
        <button
          className={`btn icon ${filtersChanged ? 'on' : ''}`}
          data-filters-anchor
          aria-label={t('nav.filters')}
          title={t('nav.filters')}
          onClick={() => setShowFilters((open) => !open)}
        >
          <FiltersIcon />
        </button>

        <button
          className="btn icon"
          aria-label={t('action.theme.title', { name: t(THEME_LABEL_KEYS[state.theme]) })}
          title={t('action.theme.title', { name: t(THEME_LABEL_KEYS[state.theme]) })}
          onClick={() => void store.setTheme(nextTheme(state.theme))}
        >
          {state.theme === 'system' && <SystemIcon />}
          {state.theme === 'light' && <LightIcon />}
          {state.theme === 'dark' && <DarkIcon />}
        </button>

        <span className="header-divider" />

        <button
          className="btn icon"
          disabled={!state.undoLabelKey}
          aria-label={t('action.undo.label')}
          title={
            state.undoLabelKey
              ? t('action.undo.title', { label: t(state.undoLabelKey, state.undoLabelParams) })
              : t('action.undo.none')
          }
          onClick={store.undo}
        >
          <UndoIcon />
        </button>
        <button
          className="btn icon"
          disabled={!state.redoLabelKey}
          aria-label={t('action.redo.label')}
          title={
            state.redoLabelKey
              ? t('action.redo.title', { label: t(state.redoLabelKey, state.redoLabelParams) })
              : t('action.redo.none')
          }
          onClick={store.redo}
        >
          <RedoIcon />
        </button>
        <button
          className="btn icon"
          aria-label={t('nav.search')}
          title={t('keys.search')}
          onClick={store.openSearch}
        >
          <SearchIcon />
        </button>
        <button
          className="btn icon"
          aria-label={t('action.settings')}
          title={t('action.settings.title')}
          onClick={() => setShowHelp(true)}
        >
          <SettingsIcon />
        </button>
      </header>

      {showFilters && <FilterMenu onClose={() => setShowFilters(false)} />}
      {showHelp && <ShortcutHelp onClose={() => setShowHelp(false)} />}
    </>
  )
}
