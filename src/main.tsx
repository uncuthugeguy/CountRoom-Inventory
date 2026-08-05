import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { AuthGate } from './AuthGate'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element in index.html')

createRoot(container).render(
  <StrictMode>
    <AuthGate />
  </StrictMode>,
)

// autoUpdate: a new build is fetched in the background and applied on reload.
registerSW({ immediate: true })
