import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { useAuth } from '../context/AuthContext.jsx'
import Icon from '../components/Icon.jsx'
import { Field } from '../components/UI.jsx'

export default function Onboarding() {
  const { user, setUser } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ nombre: '', telefono: '', direccion: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const role = user?.rol || user?.role

  if (role !== 'doctor') return <Navigate to={role === 'paciente' ? '/inicio' : '/agenda'} replace />

  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const response = await api('/consultorio/onboarding', { method: 'POST', body: form })
      setUser({ ...user, consultorio_id: response.consultorio_id })
      navigate('/agenda', { replace: true })
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="onboarding-page">
      <div className="onboarding-brand"><span className="brand-mark"><Icon name="tooth" /></span><span>SONRIDENT</span></div>
      <main className="onboarding-card">
        <div className="step-count">01 <span>/ 01</span></div>
        <span className="eyebrow">TU NUEVO ESPACIO</span><h1>Dale identidad a tu consultorio.</h1><p>Esta información será visible para pacientes y equipo. Podrás cambiarla más adelante.</p>
        {error && <div className="inline-error">{error}</div>}
        <form onSubmit={submit} className="form-grid">
          <Field label="Nombre del consultorio"><input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} placeholder="Ej. Sonrisa Central" required /></Field>
          <Field label="Teléfono"><input type="tel" value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} placeholder="Ej. 71234567" required /></Field>
          <Field label="Dirección"><input value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} placeholder="Calle, número y zona" required /></Field>
          <button className="button button-coral form-full" disabled={saving}>{saving ? 'Creando consultorio…' : 'Abrir mi consultorio'} <Icon name="arrow" /></button>
        </form>
      </main>
      <aside className="onboarding-note"><Icon name="check" /><span><strong>Configuración rápida</strong> Después añadiremos horarios, servicios y QR de pagos.</span></aside>
    </div>
  )
}
