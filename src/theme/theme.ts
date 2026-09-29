export type Theme = 'dark' | 'light' | 'system'
export type ResolvedTheme = 'dark' | 'light'

export const THEMES: { value: Theme; labelKey: string }[] = [
  { value: 'system', labelKey: 'theme.system' },
  { value: 'light', labelKey: 'theme.light' },
  { value: 'dark', labelKey: 'theme.dark' },
]

/**
 * All Tauri windows share an origin, so localStorage is shared between them.
 * That is how the orb — which has no store of its own — picks up the theme the
 * main window is using.
 */
const STORAGE_KEY = 'thoughttree.theme'

export function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === 'system' ? systemTheme() : theme
}

export function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.dataset.theme = resolved
  try {
    localStorage.setItem(STORAGE_KEY, resolved)
  } catch {
    /* private mode or a locked-down webview: the page theme still applies */
  }
}

/** Used by the orb and the quick-capture window, which have no store. */
export function applyStoredTheme(): ResolvedTheme {
  let stored: ResolvedTheme | null = null
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    if (value === 'dark' || value === 'light') stored = value
  } catch {
    stored = null
  }
  const resolved = stored ?? systemTheme()
  applyTheme(resolved)
  return resolved
}

/** Keeps a separate window in step when the main window switches theme. */
export function watchStoredTheme(): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return
    if (event.newValue === 'dark' || event.newValue === 'light') applyTheme(event.newValue)
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}
