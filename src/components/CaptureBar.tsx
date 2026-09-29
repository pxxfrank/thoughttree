import { useRef, useState } from 'react'
import { useAppState, useStore } from '../state/context'
import { isComposing } from '../util/keyboard'

export function CaptureBar() {
  const store = useStore()
  const state = useAppState()
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const submit = () => {
    if (!text.trim()) return
    store.capture(text)
    setText('')
  }

  return (
    <div className="capture-bar">
      <input
        ref={inputRef}
        value={text}
        placeholder="Capture a thought or question…"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (isComposing(event)) return
          if (event.key === 'Enter') {
            event.preventDefault()
            submit()
          } else if (event.key === 'Escape') {
            setText('')
            event.currentTarget.blur()
          }
        }}
        data-capture-bar
      />
      <button className="btn primary" onClick={submit} disabled={!text.trim()}>
        Capture
      </button>
      <span className="capture-hint">
        Enter to save · {state.shortcut || 'no shortcut'} from anywhere
      </span>
    </div>
  )
}

export function focusCaptureBar(): void {
  const element = document.querySelector<HTMLInputElement>('[data-capture-bar]')
  element?.focus()
  element?.select()
}
