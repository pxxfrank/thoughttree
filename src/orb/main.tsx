import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Orb } from './Orb'
import './orb.css'

const container = document.getElementById('orb-root')
if (container) {
  createRoot(container).render(
    <StrictMode>
      <Orb />
    </StrictMode>,
  )
}
