import { useAppState, useStore } from '../state/context'

export function Toast() {
  const store = useStore()
  const state = useAppState()
  if (!state.toast) return null
  return (
    <div className={`toast ${state.toast.kind}`} onClick={store.dismissToast} role="status">
      {state.toast.text}
    </div>
  )
}
