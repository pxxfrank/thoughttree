import { createContext, useContext, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { AppStore, AppState } from './store'

const StoreContext = createContext<AppStore | null>(null)

export function StoreProvider({ store, children }: { store: AppStore; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}

export function useStore(): AppStore {
  const store = useContext(StoreContext)
  if (!store) throw new Error('StoreProvider is missing')
  return store
}

export function useAppState(): AppState {
  const store = useStore()
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}
