import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import { useStore } from '../state/context'
import { hideCaptureWindow } from '../storage/desktop-actions'
import { isComposing } from '../util/keyboard'

const SAVED_FLASH_MS = 150

/**
 * The Quick Capture surface. Nothing but an input: no project, no tag, no
 * parent, no priority. Enter files it in the Inbox and the window disappears.
 */
export function Capture() {
  const store = useStore()
  const { t } = useI18n()
  const [text, setText] = useState('')
  const [saved, setSaved] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const textRef = useRef('')

  useEffect(() => {
    textRef.current = text
  }, [text])

  useEffect(() => {
    const focus = () => {
      inputRef.current?.focus()
    }
    focus()
    window.addEventListener('focus', focus)
    return () => window.removeEventListener('focus', focus)
  }, [])

  // An always-on-top window must never linger when the user has moved on.
  useEffect(() => {
    const onBlur = () => {
      if (!textRef.current.trim()) void hideCaptureWindow()
    }
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [])

  const close = () => {
    setText('')
    void hideCaptureWindow()
  }

  const submit = () => {
    const value = text.trim()
    if (!value) {
      close()
      return
    }
    store.capture(value)
    setText('')
    setSaved(true)
    window.setTimeout(() => {
      setSaved(false)
      void hideCaptureWindow()
    }, SAVED_FLASH_MS)
  }

  return (
    <div className="capture-window">
      <div className={`capture-inner ${saved ? 'saved' : ''}`}>
        <span className="capture-dot" />
        <textarea
          ref={inputRef}
          className="capture-input"
          rows={1}
          value={text}
          placeholder={t('quick.placeholder')}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (isComposing(event)) return
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              close()
            }
          }}
        />
        <span className="capture-hint">
          <kbd>Enter</kbd> {t('quick.save')} · <kbd>Esc</kbd> {t('quick.cancel')}
        </span>
      </div>
    </div>
  )
}
