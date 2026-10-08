import { useRef, useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import { useAppState, useStore } from '../state/context'
import { captureSourceContext } from '../storage/desktop-actions'
import { isComposing } from '../util/keyboard'

export function CaptureBar() {
  const store = useStore()
  const state = useAppState()
  const { t } = useI18n()
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const submit = async () => {
    if (!text.trim()) return
    // Never let a context lookup failure block the save.
    const source = await captureSourceContext().catch(() => ({ app: null, title: null, url: null }))
    store.capture(text, source)
    setText('')
  }

  return (
    <div className="capture-bar">
      <div className="capture-composer">
        <input
          ref={inputRef}
          value={text}
          placeholder={t('capture.placeholder')}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (isComposing(event)) return
            if (event.key === 'Enter') {
              event.preventDefault()
              void submit()
            } else if (event.key === 'Escape') {
              setText('')
              event.currentTarget.blur()
            }
          }}
          data-capture-bar
        />
        <span className="capture-hint">
          {t('capture.hint', { shortcut: state.shortcut || t('capture.noShortcut') })}
        </span>
        <button className="btn primary" onClick={() => void submit()} disabled={!text.trim()}>
          {t('capture.button')}
        </button>
      </div>
    </div>
  )
}

export function focusCaptureBar(): void {
  const element = document.querySelector<HTMLInputElement>('[data-capture-bar]')
  element?.focus()
  element?.select()
}
