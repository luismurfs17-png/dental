import { useEffect, useState } from 'react'
import { Navigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api.js'
import { clinicBrand, clinicTheme } from '../lib/branding.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useClinicPortal } from '../hooks/useClinicPortal.js'
import Icon from '../components/Icon.jsx'
import InstallApp from '../components/InstallApp.jsx'
import { ErrorState, Field, Loading } from '../components/UI.jsx'

const NEUTRAL_CLINIC = { marca_nombre: 'PORTAL CLÍNICO' }

export default function Login({ branded = false, installOnly = false, clinicSlug = '' }) {
  const { user, setUser } = useAuth()
  const { slug: routeSlug = '' } = useParams()
  const slug = clinicSlug || routeSlug
  const [searchParams] = useSearchParams()
  const [showDev, setShowDev] = useState(false)
  const [form, setForm] = useState({ email: 'doctora@sonrisas.test' })
  const [error, setError] = useState(searchParams.get('error') || '')
  const [submitting, setSubmitting] = useState(false)
  const isDevelopment = import.meta.env.DEV
  const portal = useClinicPortal(branded ? slug : '')
  const displayClinic = branded ? portal.clinic : NEUTRAL_CLINIC
  const brand = clinicBrand(displayClinic)
  const theme = clinicTheme(displayClinic)

  useEffect(() => {
    const queryError = searchParams.get('error')
    if (queryError) setError(queryError)
  }, [searchParams])

  useEffect(() => {
    if (user) return undefined
    let active = true
    async function recoverSession() {
      try {
        const response = await api('/auth/yo')
        const nextUser = response?.usuario || response
        if (active && nextUser?.id) setUser(nextUser)
      } catch {
        // sin sesión
      }
    }
    recoverSession()
    return () => { active = false }
  }, [user, setUser])

  useEffect(() => {
    if (!portal.clinic) return undefined
    sessionStorage.setItem('clinic_portal_slug', portal.clinic.slug)
    const manifest = document.getElementById('app-manifest')
    const appleIcon = document.getElementById('apple-touch-icon')
    const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]')
    const themeColor = document.querySelector('meta[name="theme-color"]')
    const previous = {
      title: document.title,
      manifest: manifest?.getAttribute('href'),
      manifestRel: manifest?.getAttribute('rel'),
      appleIcon: appleIcon?.getAttribute('href'),
      appleTitle: appleTitle?.getAttribute('content'),
      themeColor: themeColor?.getAttribute('content'),
    }
    document.title = brand.name
    if (manifest) manifest.setAttribute('href', portal.clinic.manifest_url)
    if (manifest) manifest.setAttribute('rel', 'manifest')
    if (appleIcon) appleIcon.setAttribute('href', `/api/publico/clinicas/${portal.clinic.slug}/icon/180.png`)
    if (appleTitle) appleTitle.setAttribute('content', brand.name)
    if (themeColor) themeColor.setAttribute('content', brand.primary)
    return () => {
      document.title = previous.title
      if (manifest && previous.manifest) manifest.setAttribute('href', previous.manifest)
      else if (manifest) manifest.removeAttribute('href')
      if (manifest && previous.manifestRel) manifest.setAttribute('rel', previous.manifestRel)
      else if (manifest) manifest.removeAttribute('rel')
      if (appleIcon && previous.appleIcon) appleIcon.setAttribute('href', previous.appleIcon)
      if (appleTitle && previous.appleTitle) appleTitle.setAttribute('content', previous.appleTitle)
      if (themeColor && previous.themeColor) themeColor.setAttribute('content', previous.themeColor)
    }
  }, [portal.clinic, brand.name, brand.primary])

  if (branded && portal.loading) return <div className="boot-screen"><Loading label="Abriendo la clínica" /></div>
  if (branded && portal.error) return <div className="boot-screen"><ErrorState message={portal.error} /></div>
  const clinicMismatch = Boolean(user && portal.clinic && user.consultorio_slug !== portal.clinic.slug)
  if (user && !installOnly && !clinicMismatch) return <Navigate to={homeFor(user)} replace />

  async function devLogin(event) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const response = await api('/auth/desarrollo', { method: 'POST', body: form })
      setUser(response?.usuario || response)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={`login-page ${branded ? 'branded-login' : 'neutral-login'}`} style={theme}>
      <section className="login-art" aria-hidden="true">
        <LoginBrand brand={brand} />
        <div className="art-copy"><span className="eyebrow light">ACCESO CLÍNICO SEGURO</span><h1>{branded ? 'Tu clínica, siempre contigo.' : 'Tu espacio clínico, en un solo lugar.'}</h1>{branded && brand.eslogan && <p className="art-eslogan">{brand.eslogan}</p>}<p>{branded ? (brand.bienvenida || `Accede al portal de ${brand.name} para gestionar o continuar tu atención.`) : 'Accede a citas, pacientes, pagos e historia clínica según tu perfil.'}</p></div>
        <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
        <ChatCard brand={brand} />
        <div className="art-footer">ACCESO SEGURO · DATOS PROTEGIDOS</div>
      </section>
      <main className="login-panel">
        <LoginBrand brand={brand} mobile />
        <div className="login-form-wrap">
          <span className="login-kicker">{installOnly ? 'APLICACIÓN MÓVIL' : 'PORTAL SEGURO'}</span>
          <h2>{installOnly ? <>Instala tu<br />clínica.</> : <>Ingresa a<br />tu espacio.</>}</h2>
          <p>{installOnly ? 'Añade el portal a tu pantalla de inicio para abrirlo como una aplicación.' : (branded ? (brand.bienvenida || 'Continúa como doctor, equipo operativo o paciente.') : 'Continúa como doctor, equipo operativo o paciente.')}</p>
          {clinicMismatch && <div className="inline-message">Tienes una sesión abierta en otra clínica. Continúa con Google para cambiar a {brand.name}.</div>}
          {error && <div className="inline-error">{error}</div>}
          {installOnly && <InstallApp clinic={portal.clinic} />}
          {!installOnly && <a className="google-button" href={`/api/auth/google${branded ? `?clinica=${encodeURIComponent(slug)}` : ''}`}><span className="google-g">G</span>Continuar con Google</a>}
          {!installOnly && branded && <InstallApp clinic={portal.clinic} compact />}
          {installOnly && <a className="install-login-link" href={`/c/${slug}`}>Continuar al inicio de sesión <Icon name="arrow" size={16} /></a>}
          {isDevelopment && <div className="divider"><span>acceso alternativo</span></div>}
          {isDevelopment && !installOnly && (!showDev ? (
            <button className="dev-toggle" onClick={() => setShowDev(true)}>Ingresar al entorno de desarrollo <Icon name="arrow" size={17} /></button>
          ) : (
            <form className="dev-form" onSubmit={devLogin}>
              <Field label="Correo semilla"><input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></Field>
              <button className="button button-primary" disabled={submitting}>{submitting ? 'Ingresando…' : 'Ingresar con datos semilla'}</button>
            </form>
          ))}
          <small className="privacy-note">Datos protegidos · Tecnología de CopaApp</small>
        </div>
      </main>
    </div>
  )
}

function LoginBrand({ brand, mobile = false }) {
  return <div className={mobile ? 'mobile-login-brand' : 'login-brand'}><span className={`brand-mark ${brand.logo ? 'has-logo' : ''}`}>{brand.logo ? <img src={brand.logo} alt="" /> : <Icon name="tooth" size={mobile ? 22 : 28} />}</span><span>{brand.name}</span></div>
}

function ChatCard({ brand }) {
  const number = String(brand.whatsapp || '').replace(/[^0-9]/g, '')
  const inner = <>
    <span><Icon name="whatsapp" /></span>
    <div>
      <small>Chat de {brand.name}</small>
      <div className="chat-bubbles"><i className="chat-bubble in">¡Hola! ¿Cómo agendo una cita?</i><i className="chat-bubble out">Con un clic y sin llamadas ✓</i></div>
      {number ? <strong className="chat-cta">Escribir por WhatsApp <Icon name="arrow" size={14} /></strong> : <small className="chat-hint">Disponible en tu consultorio</small>}
    </div>
  </>
  return number
    ? <a className="floating-card chat-card" href={`https://wa.me/${number}`} target="_blank" rel="noreferrer" aria-label={`Escribir a ${brand.name} por WhatsApp`}>{inner}</a>
    : <div className="floating-card chat-card" aria-hidden="true">{inner}</div>
}

export function homeFor(user) {
  const role = user?.rol || user?.role
  const hasClinic = Boolean(user?.consultorio || user?.consultorioId || user?.consultorio_id)
  if (user?.es_admin) return hasClinic ? '/agenda' : '/admin'
  if (role === 'doctor' && !hasClinic) return '/crear-consultorio'
  return role === 'paciente' ? '/inicio' : '/agenda'
}
