import { useEffect, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useAppState, useStore } from '../state/context'

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

const SHORTCUTS: [string, string][] = [
  ['↑ / ↓', 'Move between questions'],
  ['← / →', 'Collapse / expand'],
  ['Enter', 'New question below'],
  ['Tab', 'New sub-question'],
  ['F2 or double-click', 'Rename a question'],
  ['Delete', 'Delete question and its subtree'],
  ['Ctrl+I', 'Toggle ★ Important'],
  ['Ctrl+L', 'Toggle Later'],
  ['Ctrl+K', 'Toggle Done'],
  ['Ctrl+Shift+C', 'Focus the capture bar'],
  ['Ctrl+Shift+F', 'Toggle Focus mode'],
  ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
  ['Esc', 'Deselect, or close a popover'],
]

function ShortcutRecorder() {
  const store = useStore()
  const state = useAppState()
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
        placeholder="Click and press a key combination"
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
      <button className="btn" onClick={() => void store.setShortcut('Alt+Space')}>
        Reset
      </button>
    </div>
  )
}

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const store = useStore()
  const state = useAppState()

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="dialog" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-head">
          <span>Keyboard &amp; settings</span>
          <span className="spacer" style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="dialog-body">
          <div className="field">
            <div className="field-label">Global quick capture shortcut</div>
            <ShortcutRecorder />
            <div className="hint" style={{ marginTop: 6 }}>
              Works from any application. Leave empty to disable.
            </div>
          </div>

          <div className="field">
            <div className="field-label">In-app shortcuts</div>
            <table className="kbd-table">
              <tbody>
                {SHORTCUTS.map(([keys, description]) => (
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
            <div className="field-label">Where your data lives</div>
            <div className="hint" style={{ marginBottom: 8 }}>
              {state.dataDir || 'Local application data folder'}
              <br />
              Everything is stored locally in SQLite. A rotating backup is taken on every launch.
            </div>
            <button className="btn" onClick={() => void store.exportJson()}>
              Export JSON
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
