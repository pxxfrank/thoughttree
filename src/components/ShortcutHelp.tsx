import { useEffect, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { LOCALES, useI18n } from '../i18n/useI18n'
import { useAppState, useStore } from '../state/context'
import { DEFAULT_SHORTCUT } from '../state/store'
import { THEMES } from '../theme/theme'

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'ContextMenu'])

/** Turns a browser key event into the accelerator syntax Tauri understands. */
function toAccelerator(event: ReactKeyboardEvent<HTMLInputElement>): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null
  const parts: string[] = []
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (event.metaKey) parts.push('Super')

  const code = event.code
  let key: string
  if (code.startsWith('Key')) key = code.slice(3)
  else if (code.startsWith('Digit')) key = code.slice(5)
  else if (code.startsWith('Numpad')) key = `Numpad${code.slice(6)}`
  else key = code

  if (!key) return null
  parts.push(key)
  return parts.join('+')
}

function ShortcutRecorder() {
  const store = useStore()
  const state = useAppState()
  const { t } = useI18n()
  const [value, setValue] = useState(state.shortcut)

  useEffect(() => setValue(state.shortcut), [state.shortcut])

  return (
    <div className="settings-row">
      <input
        style={{
          flex: 1,
          background: 'var(--panel-3)',
          border: '1px solid var(--border)',
          borderRadius: 5,
          padding: '6px 9px',
        }}
        value={value}
        readOnly
        placeholder={t('help.shortcut.placeholder')}
        onKeyDown={(event) => {
          event.preventDefault()
          if (event.key === 'Escape') {
            event.currentTarget.blur()
            return
          }
          if (event.key === 'Backspace' || event.key === 'Delete') {
            setValue('')
            void store.setShortcut('')
            return
          }
          const accelerator = toAccelerator(event)
          if (!accelerator) return
          setValue(accelerator)
          void store.setShortcut(accelerator)
        }}
      />
      <button className="btn" onClick={() => void store.setShortcut(DEFAULT_SHORTCUT)}>
        {t('help.shortcut.reset')}
      </button>
    </div>
  )
}

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const store = useStore()
  const state = useAppState()
  const { t, locale } = useI18n()
  const theme = state.theme

  const shortcuts: [string, string][] = [
    ['↑ / ↓', t('keys.move')],
    ['← / →', t('keys.collapse')],
    ['Enter', t('keys.sibling')],
    ['Tab', t('keys.child')],
    ['F2 or double-click', t('keys.rename')],
    ['E', t('keys.explain')],
    ['Delete', t('keys.delete')],
    ['Ctrl+I', t('keys.important')],
    ['Ctrl+L', t('keys.later')],
    ['Ctrl+K', t('keys.done')],
    ['Ctrl+Shift+C', t('keys.capture')],
    ['Ctrl+Shift+F', t('keys.focus')],
    ['Ctrl+Z / Ctrl+Shift+Z', t('keys.undo')],
    ['Esc', t('keys.escape')],
  ]

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="dialog" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-head">
          <span>{t('help.title')}</span>
          <span className="spacer" style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onClose}>
            {t('help.close')}
          </button>
        </div>
        <div className="dialog-body">
          <div className="field">
            <div className="field-label">{t('help.language')}</div>
            <div className="chips">
              {LOCALES.map((entry) => (
                <button
                  key={entry.value}
                  className={`chip ${locale === entry.value ? 'on' : ''}`}
                  onClick={() => void store.setLocale(entry.value)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <div className="field-label">{t('help.theme')}</div>
            <div className="chips">
              {THEMES.map((entry) => (
                <button
                  key={entry.value}
                  className={`chip ${theme === entry.value ? 'on' : ''}`}
                  onClick={() => void store.setTheme(entry.value)}
                >
                  {t(entry.labelKey)}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <div className="field-label">{t('help.shortcut')}</div>
            <ShortcutRecorder />
            <div className="hint" style={{ marginTop: 6 }}>
              {t('help.shortcut.hint')}
            </div>
          </div>

          <div className="field">
            <div className="field-label">{t('help.inApp')}</div>
            <table className="kbd-table">
              <tbody>
                {shortcuts.map(([keys, description]) => (
                  <tr key={keys}>
                    <td>
                      {keys.split(' / ').map((chord) => (
                        <span key={chord} style={{ marginRight: 6 }}>
                          {chord.split('+').map((part, index) => (
                            <span key={part}>
                              {index > 0 && ' + '}
                              <kbd>{part}</kbd>
                            </span>
                          ))}
                        </span>
                      ))}
                    </td>
                    <td>{description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <div className="field-label">{t('help.data')}</div>
            <div className="hint" style={{ marginBottom: 8 }}>
              {state.dataDir || t('help.dataFolder')}
              <br />
              {t('help.data.hint')}
            </div>
            <button className="btn" onClick={() => void store.exportJson()}>
              {t('help.export')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
