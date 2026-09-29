import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Orb } from './Orb'
import { applyStoredTheme, watchStoredTheme } from '../theme/theme'
import './orb.css'

// The orb has no store of its own; it follows the theme the main window
// publishes to the shared local storage.
applyStoredTheme()
watchStoredTheme()

const container = document.getElementById('orb-root')
if (container) {
  createRoot(container).render(
    <StrictMode>
      <Orb />
    </StrictMode>,
  )
}
