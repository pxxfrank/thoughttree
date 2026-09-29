import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './components/App'
import { StoreProvider } from './state/context'
import { createDesktopStore } from './state/desktop'
import './styles.css'

async function bootstrap() {
  const store = await createDesktopStore()
  await store.init()
  const container = document.getElementById('root')
  if (!container) throw new Error('#root is missing')
  createRoot(container).render(
    <StrictMode>
      <StoreProvider store={store}>
        <App />
      </StoreProvider>
    </StrictMode>,
  )
}

void bootstrap()
