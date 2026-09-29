import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

/**
 * True while an IME (Chinese / Japanese / Korean input method) is composing.
 * During composition Enter confirms a candidate and Escape cancels it — treating
 * either as "submit" or "cancel" would truncate what the user is typing.
 */
export function isComposing(event: ReactKeyboardEvent | KeyboardEvent): boolean {
  const native = 'nativeEvent' in event ? event.nativeEvent : event
  return native.isComposing || native.keyCode === 229
}
