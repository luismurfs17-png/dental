import { useEffect, useState } from 'react'
import { clearInstallPrompt, installPrompt } from '../lib/install.js'
import Icon from './Icon.jsx'

export default function InstallApp({ clinic, compact = false }) {
  const [prompt, setPrompt] = useState(() => installPrompt())
  const [installed, setInstalled] = useState(() => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true)
  const [showHelp, setShowHelp] = useState(false)
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

  useEffect(() => {
    const promptAvailable = () => setPrompt(installPrompt())
    const appInstalled = () => { setInstalled(true); setPrompt(null); setShowHelp(false) }
    window.addEventListener('installpromptavailable', promptAvailable)
    window.addEventListener('appinstalled', appInstalled)
    return () => {
      window.removeEventListener('installpromptavailable', promptAvailable)
      window.removeEventListener('appinstalled', appInstalled)
    }
  }, [])

  async function install() {
    if (!prompt) { setShowHelp(true); return }
    await prompt.prompt()
    await prompt.userChoice
    clearInstallPrompt()
    setPrompt(null)
  }

  if (installed) return compact ? null : <div className="install-ready"><Icon name="check" /><span><strong>Aplicación instalada</strong><small>Ya puedes abrirla desde tu pantalla de inicio.</small></span></div>

  return <div className={`install-app ${compact ? 'compact' : ''}`}><button type="button" className="button button-primary" onClick={install}><Icon name="upload" /> Instalar aplicación</button>{showHelp && <div className="install-help"><strong>{isIos ? 'Instalar en iPhone o iPad' : 'Instalar desde el navegador'}</strong><p>{isIos ? 'Toca Compartir y después “Agregar a pantalla de inicio”.' : 'Abre el menú del navegador y elige “Instalar aplicación” o “Agregar a pantalla principal”.'}</p></div>}{!compact && clinic && <small>Se instalará como <strong>{clinic.marca_nombre || clinic.nombre}</strong>.</small>}</div>
}
