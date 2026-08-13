import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { captureInstallPrompt } from './lib/install.js'
import './styles/global.css'

captureInstallPrompt()

const clinicMatch = window.location.pathname.match(/^\/c\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\/|$)/)
const clinicSlug = clinicMatch?.[1] || ''

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter basename={clinicSlug ? `/c/${clinicSlug}` : undefined}>
      <App clinicSlug={clinicSlug} />
    </BrowserRouter>
  </StrictMode>,
)
