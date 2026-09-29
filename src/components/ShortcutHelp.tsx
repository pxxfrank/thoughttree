import { useCallback, useEffect, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { LOCALES, useI18n } from '../i18n/useI18n'
import { useAppState, useStore } from '../state/context'
import { DEFAULT_SHORTCUT } from '../state/store'
import { listBackups, restoreBackup, type BackupInfo } from '../storage/desktop-actions'
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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** A locale-aware "3 hours ago" from an epoch-millisecond timestamp. */
function relativeTime(createdAt: number, locale: string): string {
  const seconds = Math.round((createdAt - Date.now()) / 1000)
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const abs = Math.abs(seconds)
  if (abs < 60) return format.format(seconds, 'second')
  if (abs < 3600) return format.format(Math.round(seconds / 60), 'minute')
  if (abs < 86400) return format.format(Math.round(seconds / 3600), 'hour')
  return format.format(Math.round(seconds / 86400), 'day')
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

/** The rotating `.db` snapshots, each restorable in one click. */
function Backups() {
  const store = useStore()
  const { t, locale } = useI18n()
  const [backups, setBackups] = useState<BackupInfo[]>([])

  const refresh = useCallback(async () => {
    try {
      setBackups(await listBackups())
    } catch {
      setBackups([])
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const restore = async (info: BackupInfo) => {
    if (!window.confirm(t('help.restore.confirm'))) return
    try {
      store.restoreSnapshot(await restoreBackup(info.path))
    } catch (error) {
      store.toast('toast.restoreFailed', 'error', { error: String(error) })
    }
  }

  return (
    <div className="field" style={{ marginBottom: 0 }}>
      <div className="field-label">{t('help.backups')}</div>
      <div className="hint" style={{ marginBottom: 8 }}>
        {t('help.backups.hint')}
      </div>
      {backups.length === 0 ? (
        <div className="hint">{t('help.backup.none')}</div>
      ) : (
        backups.map((info) => (
          <div key={info.path} className="settings-row" style={{ marginBottom: 6 }}>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {info.name}
            </span>
            <span className="hint" style={{ whiteSpace: 'nowrap' }}>
              {relativeTime(info.created_at, locale)} · {formatSize(info.size)}
            </span>
            <button className="btn" onClick={() => void restore(info)}>
              {t('help.restore')}
            </button>
          </div>
        ))
      )}
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

  const handleImport = async () => {
    try {
      const selection = await open({
        multiple: false,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (typeof selection !== 'string') return
      store.importSnapshot(await store.readImport(selection))
    } catch (error) {
      // The backend reports a bad file as the `error.importFormat` key; anything
      // else is an unexpected failure.
      const key = String(error)
      store.toast(key.startsWith('error.') ? key : 'toast.importFailed', 'error')
    }
  }

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

          <div className="field">
            <div className="field-label">{t('help.data')}</div>
            <div className="hint" style={{ marginBottom: 8 }}>
              {state.dataDir || t('help.dataFolder')}
              <br />
              {t('help.data.hint')}
            </div>
            <div className="settings-row">
              <button className="btn" onClick={() => void store.exportJson()}>
                {t('help.export')}
              </button>
              <button className="btn" onClick={() => void handleImport()}>
                {t('help.import')}
              </button>
            </div>
          </div>

          <Backups />
        </div>
      </div>
    </div>
  )
}
