import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capture } from './Capture'
import { StoreProvider } from '../state/context'
import { createDesktopStore } from '../state/desktop'
import { applyStoredTheme, watchStoredTheme } from '../theme/theme'
import './capture.css'

applyStoredTheme()
watchStoredTheme()

async function bootstrap() {
  const store = await createDesktopStore()
  await store.init()
  const container = document.getElementById('capture-root')
  if (!container) throw new Error('#capture-root is missing')
  createRoot(container).render(
    <StrictMode>
      <StoreProvider store={store}>
        <Capture />
      </StoreProvider>
    </StrictMode>,
  )
}

void bootstrap()
