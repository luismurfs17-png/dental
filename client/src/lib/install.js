let deferredPrompt = null
let capturing = false

export function captureInstallPrompt() {
  if (capturing) return
  capturing = true
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferredPrompt = event
    window.dispatchEvent(new Event('installpromptavailable'))
  })
  window.addEventListener('appinstalled', () => { deferredPrompt = null })
}

export function installPrompt() {
  return deferredPrompt
}

export function clearInstallPrompt() {
  deferredPrompt = null
}
