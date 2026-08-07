import { useEffect, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api.js'
import { useAuth } from '../context/AuthContext.jsx'
import Icon from '../components/Icon.jsx'
import { Field } from '../components/UI.jsx'

export default function Login() {
  const { user, setUser } = useAuth()
  const [searchParams] = useSearchParams()
  const [showDev, setShowDev] = useState(false)
  const [form, setForm] = useState({ email: 'doctora@sonrisas.test' })
  const [error, setError] = useState(searchParams.get('error') || '')
  const [submitting, setSubmitting] = useState(false)
  const isDevelopment = import.meta.env.DEV

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

  if (user) return <Navigate to={homeFor(user)} replace />

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
    <div className="login-page">
      <section className="login-art" aria-hidden="true">
        <div className="login-brand"><span className="brand-mark"><Icon name="tooth" size={28} /></span><span>SONRIDENT</span></div>
        <div className="art-copy"><span className="eyebrow light">CUIDADO QUE SE SIENTE</span><h1>Una sonrisa sana empieza con tiempo para ti.</h1><p>Tu consultorio, tus citas y tu historia clínica en un solo lugar.</p></div>
        <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
        <div className="floating-card"><span><Icon name="calendar" /></span><div><small>Próxima visita</small><strong>Hoy · 15:30</strong></div><i><Icon name="check" size={14} /></i></div>
        <div className="art-footer">ATENCIÓN SIMPLE · SONRISAS REALES</div>
      </section>
      <main className="login-panel">
        <div className="mobile-login-brand"><span className="brand-mark"><Icon name="tooth" /></span><span>SONRIDENT</span></div>
        <div className="login-form-wrap">
          <span className="login-kicker">PORTAL SEGURO</span>
          <h2>Qué bueno<br />verte de nuevo.</h2>
          <p>Ingresa para cuidar sonrisas o continuar con tu tratamiento.</p>
          {error && <div className="inline-error">{error}</div>}
          <a className="google-button" href="/api/auth/google"><span className="google-g">G</span>Continuar con Google</a>
          {isDevelopment && <div className="divider"><span>acceso alternativo</span></div>}
          {isDevelopment && (!showDev ? (
            <button className="dev-toggle" onClick={() => setShowDev(true)}>Ingresar al entorno de desarrollo <Icon name="arrow" size={17} /></button>
          ) : (
            <form className="dev-form" onSubmit={devLogin}>
              <Field label="Correo semilla"><input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></Field>
              <button className="button button-primary" disabled={submitting}>{submitting ? 'Ingresando…' : 'Ingresar con datos semilla'}</button>
            </form>
          ))}
          <small className="privacy-note">Al continuar aceptas el tratamiento seguro de tus datos clínicos.</small>
        </div>
      </main>
    </div>
  )
}

export function homeFor(user) {
  const role = user?.rol || user?.role
  const hasClinic = Boolean(user?.consultorio || user?.consultorioId || user?.consultorio_id)
  if (user?.es_admin) return hasClinic ? '/agenda' : '/admin'
  if (role === 'doctor' && !hasClinic) return '/crear-consultorio'
  return role === 'paciente' ? '/inicio' : '/agenda'
}
