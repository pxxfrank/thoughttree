import { useI18n } from '../i18n/useI18n'
import { useAppState, useStore } from '../state/context'

export function Toast() {
  const store = useStore()
  const state = useAppState()
  const { t } = useI18n()
  if (!state.toast) return null
  return (
    <div className={`toast ${state.toast.kind}`} onClick={store.dismissToast} role="status">
      {t(state.toast.key, state.toast.params)}
    </div>
  )
}
