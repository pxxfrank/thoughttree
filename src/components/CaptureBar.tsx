import { useRef, useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import { useAppState, useStore } from '../state/context'
import { isComposing } from '../util/keyboard'

export function CaptureBar() {
  const store = useStore()
  const state = useAppState()
  const { t } = useI18n()
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
        placeholder={t('capture.placeholder')}
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
        {t('capture.button')}
      </button>
      <span className="capture-hint">
        {t('capture.hint', { shortcut: state.shortcut || t('capture.noShortcut') })}
      </span>
    </div>
  )
}

export function focusCaptureBar(): void {
  const element = document.querySelector<HTMLInputElement>('[data-capture-bar]')
  element?.focus()
  element?.select()
}
