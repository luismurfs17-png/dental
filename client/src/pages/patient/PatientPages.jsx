import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, formatDate, formatMoney, formatTime, unwrap } from '../../lib/api.js'
import { mapsUrl } from '../../lib/branding.js'
import { useRemote } from '../../hooks/useRemote.js'
import { useAuth } from '../../context/AuthContext.jsx'
import Icon from '../../components/Icon.jsx'
import { EmptyState, ErrorState, Field, Loading, Metric, Modal, PageHeader, StatusPill, Toast } from '../../components/UI.jsx'

function availabilitySlots(result) {
  return Array.isArray(result?.horarios) ? result.horarios : unwrap(result, 'disponibilidad')
}

function slotEnd(slot, durationMinutes) {
  if (slot.fin) return slot.fin
  const start = new Date(slot.inicio)
  return Number.isNaN(start.getTime()) ? '' : new Date(start.getTime() + Number(durationMinutes || 0) * 60000).toISOString()
}

function localDateInput(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

function SlotPicker({ slots, selected, onSelect, durationMinutes, name = 'appointment-start' }) {
  return <div className="slot-picker">
    <div className="slot-legend" aria-label="Estados de los horarios"><span><i className="available" /> Disponible</span><span><i className="occupied" /> Ocupado</span></div>
    <div className="time-slots">{slots.map((slot) => {
      const occupied = slot.estado === 'ocupado'
      const end = slotEnd(slot, durationMinutes)
      return <label key={`${slot.doctor_id}-${slot.inicio}`} className={`${selected === slot.inicio ? 'selected' : ''} ${occupied ? 'occupied' : ''}`}>
        <input type="radio" name={name} value={slot.inicio} checked={selected === slot.inicio} onChange={() => onSelect(slot)} disabled={occupied} required />
        <span>{formatTime(slot.inicio)} - {formatTime(end)}</span>{occupied && <strong>Ocupado</strong>}
      </label>
    })}</div>
  </div>
}

export function PatientDashboard() {
  const { user } = useAuth()
  const { data, loading, error, reload } = useRemote('/dashboard')
  if (loading) return <Loading label="Preparando tu resumen" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  const next = data?.proximas_citas?.[0]
  return <><PageHeader eyebrow="TU ESPACIO PERSONAL" title={`Hola, ${(user?.nombre || 'paciente').split(' ')[0]}.`} description={user?.consultorio?.bienvenida || 'Tu salud dental, clara y siempre a mano.'} action={<Link className="button button-coral desktop-action" to="/reservar"><Icon name="plus" /> Reservar cita</Link>} />
    <section className="patient-hero"><div className="hero-copy"><span className="eyebrow light">PRÓXIMA VISITA</span>{next ? <><h2>{formatDate(next.inicio, { weekday: 'long' })}</h2><div className="appointment-time"><Icon name="clock" /> {formatTime(next.inicio)}</div><p>{next.servicio} · {next.doctor}</p><Link to="/citas">Ver detalles <Icon name="arrow" size={17} /></Link></> : <><h2>Aún no tienes una cita</h2><p>Elige el mejor momento para cuidar tu sonrisa.</p><Link to="/reservar">Reservar ahora <Icon name="arrow" size={17} /></Link></>}</div><div className="hero-tooth"><Icon name="tooth" size={84} /></div></section>
    <section className="metrics-grid patient-metrics"><Metric label="Saldo pendiente" value={formatMoney(data?.saldo_bs)} note={Number(data?.saldo_bs) > 0 ? 'Puedes reportar tu pago' : 'Todo está al día'} icon="wallet" /><Metric label="Próximas citas" value={data?.proximas_citas?.length || 0} note="Visitas confirmadas" icon="calendar" /></section></>
}

export function BookAppointment() {
  const navigate = useNavigate()
  const servicesRemote = useRemote('/servicios')
  const doctorsRemote = useRemote('/doctores')
  const profileRemote = useRemote('/pacientes/me')
  const clinicRemote = useRemote('/consultorio')
  const [form, setForm] = useState({ servicio_id: '', doctor_id: '', fecha: '', inicio: '', notas: '' })
  const [slots, setSlots] = useState([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const services = unwrap(servicesRemote.data, 'servicios')
  const doctors = unwrap(doctorsRemote.data, 'doctores')
  const mode = clinicRemote.data?.consultorio?.modo_cobro || 'mixto'
  const mapsLink = mapsUrl(clinicRemote.data?.consultorio?.ubicacion)
  const selectedService = services.find((service) => String(service.id) === String(form.servicio_id))

  useEffect(() => {
    if (!form.fecha || !form.servicio_id) { setSlots([]); return }
    let active = true
    const doctorQuery = form.doctor_id ? `&doctor_id=${encodeURIComponent(form.doctor_id)}` : ''
    setSlotsLoading(true); setError('')
    api(`/disponibilidad?fecha=${encodeURIComponent(form.fecha)}&servicio_id=${encodeURIComponent(form.servicio_id)}${doctorQuery}`)
      .then((result) => active && setSlots(availabilitySlots(result)))
      .catch((requestError) => active && setError(requestError.message))
      .finally(() => active && setSlotsLoading(false))
    return () => { active = false }
  }, [form.fecha, form.servicio_id, form.doctor_id])

  async function submit(event) {
    event.preventDefault(); setSaving(true); setError('')
    try {
      await api('/citas', { method: 'POST', body: { paciente_id: profileRemote.data.paciente.id, doctor_id: form.doctor_id, servicio_id: form.servicio_id, inicio: form.inicio, notas: form.notas } })
      navigate('/citas', { state: { message: 'Tu cita quedó confirmada.' } })
    } catch (requestError) { setError(requestError.message) } finally { setSaving(false) }
  }

  if (servicesRemote.loading || doctorsRemote.loading || profileRemote.loading || clinicRemote.loading) return <Loading label="Preparando la reserva" />
  return <><PageHeader eyebrow="RESERVA EN LÍNEA" title="Un momento para tu sonrisa." description={mode === 'definir' ? 'Elige tratamiento y horario; el precio se define en tu consulta.' : 'Elige tratamiento, doctor y un horario realmente disponible.'} />{mapsLink && <a className="maps-link" href={mapsLink} target="_blank" rel="noreferrer"><Icon name="pin" /> ¿Cómo llegar? Ver el consultorio en el mapa</a>}<div className="booking-layout"><form className="booking-card" onSubmit={submit} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setForm({ ...form, servicio_id: '', doctor_id: '', fecha: '', inicio: '', notas: '' }); setError(''); } }}>
    <div className="form-step"><span>1</span><div><strong>¿Qué necesitas?</strong><small>Selecciona un tratamiento</small></div></div>
    <div className="service-options" role="radiogroup" aria-label="Tratamientos disponibles">
      {services.map((service) => (
        <label key={service.id} className={String(form.servicio_id) === String(service.id) ? 'selected' : ''}>
          <input type="radio" name="servicio" value={service.id} checked={String(form.servicio_id) === String(service.id)} onChange={(e) => setForm({ ...form, servicio_id: e.target.value, inicio: '' })} required />
          <span className="service-icon"><Icon name="tooth" /></span>
          <span><strong>{service.nombre}</strong><small>{mode === 'definir' ? `${service.duracion_min} min` : `${service.duracion_min} min · ${service.precio_bs === null ? 'A definir' : formatMoney(service.precio_bs)}`}</small></span>
          <i><Icon name="check" size={13} /></i>
        </label>
      ))}
    </div>
    {selectedService?.precio_bs === null && mode !== 'definir' && <p className="muted-box">Este tratamiento no tiene un precio publicado: el importe se confirma en tu consulta.</p>}
    <Field label="Doctor"><select value={form.doctor_id} onChange={(e) => setForm({ ...form, doctor_id: e.target.value, inicio: '' })} required><option value="">Selecciona un doctor</option>{doctors.map((doctor) => <option value={doctor.id} key={doctor.id}>{doctor.nombre}</option>)}</select></Field>
    <Field label="Fecha"><input type="date" min={localDateInput()} value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value, inicio: '' })} required /></Field>
    {slotsLoading ? <div className="inline-loading">Buscando horarios…</div> : form.fecha && form.servicio_id && form.doctor_id && (slots.length ? <SlotPicker slots={slots} selected={form.inicio} durationMinutes={selectedService?.duracion_min} onSelect={(slot) => setForm({ ...form, inicio: slot.inicio, doctor_id: String(slot.doctor_id) })} /> : <p className="muted-box">No hay horarios para este día.</p>)}
    <Field label="Nota (opcional)"><textarea rows="3" value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (form.inicio) submit(e); } }} placeholder="Ctrl+Enter para enviar" /></Field>{error && <div className="inline-error">{error}</div>}<button className="button button-coral button-wide" type="submit" disabled={saving || !form.inicio}>{saving ? 'Confirmando…' : 'Confirmar mi cita'}</button>
  </form></div></>
}

export function PatientAppointments() {
  const { data, loading, error, reload } = useRemote('/citas')
  const clinicRemote = useRemote('/consultorio')
  const [busy, setBusy] = useState(null)
  const [toast, setToast] = useState('')
  const [rescheduling, setRescheduling] = useState(null)
  const [rescheduleDate, setRescheduleDate] = useState('')
  const [rescheduleStart, setRescheduleStart] = useState('')
  const [rescheduleSlots, setRescheduleSlots] = useState([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [rescheduleError, setRescheduleError] = useState('')
  const [rescheduleSaving, setRescheduleSaving] = useState(false)
  const appointments = unwrap(data, 'citas')

  useEffect(() => {
    if (!rescheduling || !rescheduleDate) { setRescheduleSlots([]); return }
    let active = true
    setSlotsLoading(true); setRescheduleError(''); setRescheduleStart('')
    api(`/disponibilidad?fecha=${encodeURIComponent(rescheduleDate)}&servicio_id=${encodeURIComponent(rescheduling.servicio_id)}&doctor_id=${encodeURIComponent(rescheduling.doctor_id)}`)
      .then((result) => active && setRescheduleSlots(availabilitySlots(result)))
      .catch((requestError) => active && setRescheduleError(requestError.message))
      .finally(() => active && setSlotsLoading(false))
    return () => { active = false }
  }, [rescheduling, rescheduleDate])

  function openReschedule(item) {
    setRescheduling(item); setRescheduleDate(''); setRescheduleStart(''); setRescheduleSlots([]); setRescheduleError('')
  }

  function closeReschedule() {
    if (rescheduleSaving) return
    setRescheduling(null); setRescheduleDate(''); setRescheduleStart(''); setRescheduleError('')
  }

  async function submitReschedule(event) {
    event.preventDefault(); setRescheduleSaving(true); setRescheduleError('')
    try {
      await api(`/citas/${rescheduling.id}/reprogramar`, { method: 'PATCH', body: { inicio: rescheduleStart } })
      setRescheduling(null); setToast('Tu cita fue reprogramada.'); reload()
    } catch (requestError) { setRescheduleError(requestError.message) } finally { setRescheduleSaving(false) }
  }

  async function cancel(item) {
    const under24 = new Date(item.inicio).getTime() - Date.now() < 86400000
    const reason = under24 ? window.prompt('Esta cita comienza en menos de 24 horas. Indica el motivo de cancelación:') : ''
    if (under24 && !reason?.trim()) return
    if (!under24 && !window.confirm('¿Quieres cancelar esta cita?')) return
    setBusy(item.id)
    try { await api(`/citas/${item.id}/cancelar`, { method: 'PATCH', body: { motivo_cancelacion: reason } }); setToast('La cita fue cancelada.'); reload() } catch (requestError) { setToast(requestError.message) } finally { setBusy(null) }
  }
  if (loading) return <Loading label="Buscando tus citas" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  const upcoming = appointments.filter((item) => item.estado === 'confirmada')
  const past = appointments.filter((item) => item.estado !== 'confirmada')
  const clinicPhone = clinicRemote.data?.consultorio?.telefono
  return <><PageHeader eyebrow="TU AGENDA" title="Mis citas" description="Revisa tus próximas visitas y el historial de atención." action={<Link className="button button-coral" to="/reservar">Nueva cita</Link>} /><AppointmentGroup title="Próximas" items={upcoming} onCancel={cancel} onReschedule={openReschedule} clinicPhone={clinicPhone} busy={busy} /><AppointmentGroup title="Anteriores" items={past} /><Toast message={toast} onClose={() => setToast('')} />
    {rescheduling && <Modal title="Cambiar horario" onClose={closeReschedule}><form className="modal-form reschedule-form" onSubmit={submitReschedule}><p className="modal-intro">Elige otra fecha para tu cita con {rescheduling.doctor}.</p><Field label="Nueva fecha"><input type="date" min={localDateInput()} value={rescheduleDate} onChange={(event) => setRescheduleDate(event.target.value)} required /></Field>{slotsLoading ? <div className="inline-loading">Buscando horarios…</div> : rescheduleDate && (rescheduleSlots.length ? <SlotPicker slots={rescheduleSlots} selected={rescheduleStart} durationMinutes={(new Date(rescheduling.fin).getTime() - new Date(rescheduling.inicio).getTime()) / 60000} name="reschedule-start" onSelect={(slot) => setRescheduleStart(slot.inicio)} /> : <p className="muted-box">No hay horarios para este día.</p>)}{rescheduleError && <div className="inline-error">{rescheduleError}</div>}<div className="modal-actions"><button type="button" className="button button-ghost" onClick={closeReschedule} disabled={rescheduleSaving}>Volver</button><button className="button button-coral" disabled={rescheduleSaving || !rescheduleStart}>{rescheduleSaving ? 'Guardando…' : 'Confirmar cambio'}</button></div></form></Modal>}
  </>
}

function AppointmentGroup({ title, items, onCancel, onReschedule, clinicPhone, busy }) {
  return <section className="section-block appointment-group"><div className="section-title"><h2>{title}</h2><span>{items.length}</span></div>{items.length ? <div className="appointment-list">{items.map((item) => {
    const timeRemaining = new Date(item.inicio).getTime() - Date.now()
    const upcoming = timeRemaining > 0
    const alreadyChanged = Number(item.reprogramaciones_paciente || 0) >= 1
    const underFiveHours = upcoming && timeRemaining < 5 * 60 * 60 * 1000
    const eligible = onReschedule && upcoming && !alreadyChanged && !underFiveHours
    return <article className="appointment-card" key={item.id}><div className="date-tile"><strong>{new Date(item.inicio).getDate()}</strong><span>{formatDate(item.inicio, { month: 'short', year: undefined })}</span></div><div className="appointment-main"><StatusPill status={item.estado} /><h3>{item.servicio}</h3><p><Icon name="clock" size={17} /> {formatTime(item.inicio)} - {formatTime(item.fin)} · {item.doctor}</p>{onReschedule && upcoming && alreadyChanged && <small className="appointment-help">Ya utilizaste el cambio de horario disponible para esta cita.</small>}{onReschedule && underFiveHours && !alreadyChanged && <small className="appointment-help urgent">Para cambiar esta cita debes llamar al consultorio{clinicPhone && <>: <a href={`tel:${clinicPhone}`}>{clinicPhone}</a></>}</small>}</div>{onCancel && <div className="appointment-actions">{eligible && <button className="button button-primary button-small" onClick={() => onReschedule(item)}>Cambiar horario</button>}<button className="button button-ghost button-small danger" onClick={() => onCancel(item)} disabled={busy === item.id}>Cancelar</button></div>}</article>
  })}</div> : <EmptyState title={`Sin citas ${title.toLowerCase()}`} text="No hay citas en esta sección." />}</section>
}

export function PatientPayments() {
  const paymentsRemote = useRemote('/pagos')
  const balanceRemote = useRemote('/saldos')
  const quotesRemote = useRemote('/presupuestos')
  const clinicRemote = useRemote('/consultorio')
  const profileRemote = useRemote('/pacientes/me')
  const [file, setFile] = useState(null)
  const [amount, setAmount] = useState('')
  const [quoteId, setQuoteId] = useState('')
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState('')
  if ([paymentsRemote, balanceRemote, quotesRemote, clinicRemote, profileRemote].some((remote) => remote.loading)) return <Loading label="Consultando tu saldo" />
  const error = paymentsRemote.error || balanceRemote.error || quotesRemote.error || clinicRemote.error || profileRemote.error
  if (error) return <ErrorState message={error} onRetry={() => { paymentsRemote.reload(); balanceRemote.reload(); quotesRemote.reload(); clinicRemote.reload(); profileRemote.reload() }} />
  const payments = unwrap(paymentsRemote.data, 'pagos')
  const quotes = unwrap(quotesRemote.data, 'presupuestos')
  const balance = unwrap(balanceRemote.data, 'saldos')[0]?.saldo_bs || 0
  const qr = clinicRemote.data?.consultorio?.qr_url
  async function upload(event) {
    event.preventDefault(); setSending(true); setMessage('')
    const body = new FormData(); body.append('monto_bs', amount); body.append('metodo', 'qr'); body.append('paciente_id', profileRemote.data.paciente.id); if (quoteId) body.append('presupuesto_id', quoteId); body.append('evidencia', file)
    try { await api('/pagos', { method: 'POST', body }); setMessage('Comprobante enviado para verificación.'); setFile(null); setAmount(''); setQuoteId(''); paymentsRemote.reload(); balanceRemote.reload(); quotesRemote.reload() } catch (requestError) { setMessage(requestError.message) } finally { setSending(false) }
  }
  return <><PageHeader eyebrow="CUENTA PERSONAL" title="Saldo y pagos" description="Paga con el QR del consultorio y reporta tu comprobante." /><section className="balance-banner"><div><small>SALDO PENDIENTE</small><strong>{formatMoney(Math.max(0, Number(balance)))}</strong></div><Icon name="wallet" size={50} /></section>{quotes.length > 0 && <section className="section-block"><div className="section-title"><h2>Mis cotizaciones</h2></div><div className="mini-quotes">{quotes.map((quote) => <article key={quote.id}><div><strong>{quote.titulo || 'Plan de tratamiento'}</strong><small>Total {formatMoney(quote.pago.total_bs)} · Pagado a cuenta {formatMoney(quote.pago.pagado_bs)} · Saldo {formatMoney(quote.pago.saldo_bs)}</small></div><StatusPill status={quote.pago.estado === 'pagado' ? 'pagado' : quote.estado} /><strong>{formatMoney(quote.pago.saldo_bs)}</strong></article>)}</div></section>}<div className="payments-layout"><section className="qr-card"><h2>Escanea y paga</h2>{qr ? <img src={qr} alt="Código QR del consultorio" /> : <div className="qr-placeholder"><Icon name="qr" size={90} /><small>El consultorio aún no cargó su QR</small></div>}</section><form className="upload-card" onSubmit={upload}><h2>Sube tu comprobante</h2>{quotes.length > 0 && <Field label="Aplicar a cotización"><select value={quoteId} onChange={(e) => setQuoteId(e.target.value)}><option value="">Saldo general</option>{quotes.filter((quote) => quote.pago.estado !== 'pagado').map((quote) => <option value={quote.id} key={quote.id}>{quote.titulo || 'Plan de tratamiento'} · saldo {formatMoney(quote.pago.saldo_bs)}</option>)}</select></Field>}<Field label="Monto pagado (Bs)"><input type="number" min="1" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required /></Field><label className={`file-drop ${file ? 'has-file' : ''}`}><Icon name="upload" size={28} /><strong>{file?.name || 'Selecciona el comprobante'}</strong><small>JPG, PNG o WEBP · máximo 5 MB</small><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files[0])} required /></label>{message && <div className="inline-message">{message}</div>}<button className="button button-primary button-wide" disabled={sending || !file}>Enviar para verificar</button></form></div><section className="section-block"><div className="section-title"><h2>Movimientos</h2></div>{payments.length ? <div className="simple-table">{payments.map((payment) => <article key={payment.id}><span className="table-icon"><Icon name="card" /></span><div><strong>{payment.metodo}</strong><small>{payment.presupuesto_titulo || 'Saldo general'} · {formatDate(payment.creado_en)}</small></div><strong>{formatMoney(payment.monto_bs)}</strong><div className="payment-row-actions"><StatusPill status={payment.estado} />{payment.evidencia_url && <a href={payment.evidencia_url} target="_blank" rel="noreferrer">Evidencia</a>}</div></article>)}</div> : <EmptyState title="Sin movimientos" text="Tus pagos aparecerán aquí." />}</section></>
}

export function PatientHealth() {
  const recordsRemote = useRemote('/registros-clinicos/me')
  const profileRemote = useRemote('/pacientes/me')
  const { user, setUser } = useAuth()
  const [tab, setTab] = useState('historia')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [form, setForm] = useState({})
  useEffect(() => setForm(profileRemote.data?.paciente || {}), [profileRemote.data])
  async function saveProfile(event) {
    event.preventDefault(); setSaving(true); setMessage('')
    try { const result = await api('/pacientes/me', { method: 'PATCH', body: form }); setForm(result.paciente); setUser({ ...user, nombre: `${result.paciente.nombres} ${result.paciente.apellidos}` }); setMessage('Tus datos fueron actualizados.') } catch (error) { setMessage(error.message) } finally { setSaving(false) }
  }
  const records = unwrap(recordsRemote.data, 'registros')
  return <><PageHeader eyebrow="EXPEDIENTE PERSONAL" title="Mi salud" description="Historia clínica y datos personales." /><div className="tabs"><button className={tab === 'historia' ? 'active' : ''} onClick={() => setTab('historia')}>Historia clínica</button><button className={tab === 'perfil' ? 'active' : ''} onClick={() => setTab('perfil')}>Mi perfil</button></div>{tab === 'historia' ? (recordsRemote.loading ? <Loading /> : recordsRemote.error ? <ErrorState message={recordsRemote.error} onRetry={recordsRemote.reload} /> : records.length ? <div className="timeline">{records.map((record) => <article key={record.id}><span className="timeline-dot"><Icon name="tooth" size={17} /></span><div className="timeline-content"><small>{formatDate(record.creado_en)}</small><h3>{record.diagnostico}</h3><p>{record.tratamiento || record.observaciones}</p><span>Atendió: {record.doctor}</span></div></article>)}</div> : <EmptyState icon="file" title="Sin registros clínicos" text="Tu odontólogo añadirá aquí diagnósticos y tratamientos." />) : (profileRemote.loading ? <Loading /> : <form className="profile-card" onSubmit={saveProfile}><div className="form-grid"><Field label="Nombres"><input value={form.nombres || ''} onChange={(e) => setForm({ ...form, nombres: e.target.value })} required /></Field><Field label="Apellidos"><input value={form.apellidos || ''} onChange={(e) => setForm({ ...form, apellidos: e.target.value })} required /></Field><Field label="Teléfono"><input value={form.telefono || ''} onChange={(e) => setForm({ ...form, telefono: e.target.value })} /></Field><Field label="Fecha de nacimiento"><input type="date" value={form.fecha_nacimiento || ''} onChange={(e) => setForm({ ...form, fecha_nacimiento: e.target.value })} /></Field><Field label="Alergias"><input value={form.alergias || ''} onChange={(e) => setForm({ ...form, alergias: e.target.value })} /></Field></div>{message && <div className="inline-message">{message}</div>}<button className="button button-primary" disabled={saving}>Guardar cambios</button></form>)}</>
}
