import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, formatDate, formatMoney, unwrap } from '../../lib/api.js'
import { emailUrl, whatsappUrl } from '../../lib/contact.js'
import { useRemote } from '../../hooks/useRemote.js'
import { useAuth } from '../../context/AuthContext.jsx'
import Icon from '../../components/Icon.jsx'
import { EmptyState, ErrorState, Field, Loading, Modal, StatusPill, Toast } from '../../components/UI.jsx'
import { PatientForm } from './TeamPages.jsx'
import { QuoteEditor } from './Quotes.jsx'

export default function PatientDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const clinicName = user?.consultorio?.marca_nombre || user?.consultorio?.nombre || ''
  const patientRemote = useRemote(`/pacientes/${id}`)
  const recordsRemote = useRemote(`/registros-clinicos/paciente/${id}`)
  const appointmentsRemote = useRemote(`/citas?paciente_id=${id}`)
  const balanceRemote = useRemote(`/saldos?paciente_id=${id}`)
  const notesRemote = useRemote(`/pacientes/${id}/notas`)
  const quotesRemote = useRemote(`/presupuestos?paciente_id=${id}`)
  const paymentsRemote = useRemote(`/pagos?paciente_id=${id}`)
  const doctorsRemote = useRemote('/doctores')
  const [recordOpen, setRecordOpen] = useState(false)
  const [editPatient, setEditPatient] = useState(null)
  const [quoteOpen, setQuoteOpen] = useState(false)
  const [record, setRecord] = useState({ diagnostico: '', tratamiento: '', observaciones: '', doctor_id: '' })
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [cashOpen, setCashOpen] = useState(false)
  const [cash, setCash] = useState({ monto_bs: '', presupuesto_id: '' })
  const loading = patientRemote.loading || recordsRemote.loading || appointmentsRemote.loading || balanceRemote.loading || notesRemote.loading || quotesRemote.loading || paymentsRemote.loading
  const error = patientRemote.error || recordsRemote.error || appointmentsRemote.error || balanceRemote.error || notesRemote.error || quotesRemote.error || paymentsRemote.error

  async function addRecord(event) {
    event.preventDefault()
    try { await api('/registros-clinicos', { method: 'POST', body: { ...record, paciente_id: id } }); setRecordOpen(false); setRecord({ diagnostico: '', tratamiento: '', observaciones: '', doctor_id: '' }); setMessage(user.rol === 'operativo' ? 'Registro pendiente de validación.' : 'Registro clínico añadido.'); recordsRemote.reload() } catch (requestError) { setMessage(requestError.message) }
  }
  async function validate(recordId) {
    try { await api(`/registros-clinicos/${recordId}`, { method: 'PATCH', body: { estado: 'validado' } }); setMessage('Registro validado.'); recordsRemote.reload() } catch (requestError) { setMessage(requestError.message) }
  }
  async function savePatient(event) {
    event.preventDefault(); setSaving(true)
    try { await api(`/pacientes/${id}`, { method: 'PATCH', body: editPatient }); setEditPatient(null); setMessage('Ficha actualizada.'); patientRemote.reload() } catch (requestError) { setMessage(requestError.message) } finally { setSaving(false) }
  }
  async function archivePatient() {
    if (!window.confirm('¿Archivar esta ficha? Los datos permanecerán protegidos en auditoría.')) return
    try { await api(`/pacientes/${id}`, { method: 'DELETE' }); navigate('/pacientes') } catch (requestError) { setMessage(requestError.message) }
  }
  async function addNote(event) {
    event.preventDefault(); if (!note.trim()) return; setSaving(true)
    try { await api(`/pacientes/${id}/notas`, { method: 'POST', body: { texto: note } }); setNote(''); notesRemote.reload() } catch (requestError) { setMessage(requestError.message) } finally { setSaving(false) }
  }
  async function removeNote(item) {
    if (!window.confirm('¿Eliminar esta nota rápida?')) return
    try { await api(`/pacientes/${id}/notas/${item.id}`, { method: 'DELETE' }); notesRemote.reload() } catch (requestError) { setMessage(requestError.message) }
  }
  async function saveCash(event) {
    event.preventDefault(); setSaving(true)
    try {
      await api('/pagos', { method: 'POST', body: { paciente_id: id, monto_bs: cash.monto_bs, metodo: 'efectivo', presupuesto_id: cash.presupuesto_id || undefined } })
      setCashOpen(false); setCash({ monto_bs: '', presupuesto_id: '' }); setMessage('Pago registrado y saldo actualizado.')
      balanceRemote.reload(); quotesRemote.reload(); paymentsRemote.reload()
    } catch (requestError) { setMessage(requestError.message) } finally { setSaving(false) }
  }

  if (loading) return <Loading label="Abriendo expediente" />
  if (error) return <ErrorState message={error} onRetry={() => { patientRemote.reload(); recordsRemote.reload(); appointmentsRemote.reload(); balanceRemote.reload(); notesRemote.reload(); quotesRemote.reload(); paymentsRemote.reload() }} />
  const patient = patientRemote.data.paciente
  const name = `${patient.nombres} ${patient.apellidos}`.trim()
  const records = unwrap(recordsRemote.data, 'registros')
  const appointments = unwrap(appointmentsRemote.data, 'citas')
  const notes = unwrap(notesRemote.data, 'notas')
  const quotes = unwrap(quotesRemote.data, 'presupuestos')
  const payments = unwrap(paymentsRemote.data, 'pagos')
  const balanceRow = unwrap(balanceRemote.data, 'saldos')[0] || {}
  const balance = balanceRow.saldo_bs || 0
  const cobradoSemana = balanceRow.cobrado_semana_bs || 0
  const cobradoMes = balanceRow.cobrado_mes_bs || 0

  return <><Link className="back-link" to="/pacientes"><Icon name="back" /> Volver al directorio</Link><header className="patient-profile-head"><span className="profile-big-avatar">{name[0]}</span><div><span className="eyebrow">EXPEDIENTE CLÍNICO</span><h1>{name}</h1><p>{patient.codigo} · CI {patient.documento || 'sin registrar'}</p></div><div className="profile-head-actions"><button className="button button-ghost" onClick={() => setEditPatient({ ...patient })}><Icon name="edit" /> Editar</button><button className="button button-coral" onClick={() => setRecordOpen(true)}><Icon name="plus" /> Añadir registro</button>{user.rol === 'doctor' && <button className="icon-button danger" onClick={archivePatient} aria-label="Archivar paciente" title="Archivar paciente"><Icon name="trash" /></button>}</div></header>
    <nav className="patient-contact-strip" aria-label="Acciones de contacto">{patient.telefono && <a className="wa-chip" href={whatsappUrl(patient.telefono, patient.nombres, clinicName)} target="_blank" rel="noreferrer" title="Abrir WhatsApp"><Icon name="whatsapp" /><span><small>WhatsApp</small><strong>{patient.telefono}</strong></span></a>}{patient.email && <a href={emailUrl(patient.email, patient.nombres, clinicName)} target="_blank" rel="noreferrer"><Icon name="email" /><span><small>Gmail</small><strong>{patient.email}</strong></span></a>}{patient.telefono && <a href={`tel:${patient.telefono}`}><Icon name="phone" /><span><small>Llamar</small><strong>Contacto directo</strong></span></a>}{!patient.telefono && !patient.email && <span className="no-contact">Sin datos de contacto registrados</span>}</nav>
    <section className="patient-facts"><div><small>Nacimiento</small><strong>{formatDate(patient.fecha_nacimiento)}</strong></div><div><small>Alergias</small><strong>{patient.alergias || 'Ninguna registrada'}</strong></div><div><small>Medicamentos</small><strong>{patient.medicamentos || 'Ninguno registrado'}</strong></div><div><small>Saldo</small><strong className={Number(balance) > 0 ? 'coral-text' : ''}>{formatMoney(balance)}</strong></div></section>
    <div className="detail-columns"><section className="section-block"><div className="section-title"><h2>Historia clínica</h2><span>{records.length}</span></div>{records.length ? <div className="compact-records">{records.map((item) => <article key={item.id}><span><Icon name="tooth" /></span><div><small>{formatDate(item.creado_en)} · {item.doctor}</small><h3>{item.diagnostico}</h3><p>{item.tratamiento || item.observaciones}</p><StatusPill status={item.estado} />{user.rol === 'doctor' && item.estado === 'pendiente' && item.doctor_id === user.id && <button className="button button-primary button-small" onClick={() => validate(item.id)}>Validar registro</button>}</div></article>)}</div> : <EmptyState icon="file" title="Sin historia registrada" text="Añade el primer registro clínico." />}</section>
      <aside><section className="section-block quick-notes"><div className="section-title"><h2>Notas rápidas</h2><span>{notes.length}</span></div><form onSubmit={addNote}><Field label="Nueva nota operativa"><textarea rows="3" maxLength="2000" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Seguimiento, preferencia o recordatorio…" /></Field><button className="button button-primary button-small" disabled={saving || !note.trim()}><Icon name="plus" /> Añadir nota</button></form>{notes.length ? <div className="notes-timeline">{notes.map((item) => <article key={item.id}><div><strong>{item.usuario}</strong><time>{formatDate(item.creado_en)} · {new Date(item.creado_en).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}</time></div><p>{item.texto}</p>{(user.rol === 'doctor' || item.usuario_id === user.id) && <button onClick={() => removeNote(item)} aria-label="Eliminar nota" title="Eliminar nota"><Icon name="trash" size={15} /></button>}</article>)}</div> : <p className="muted-box">Las notas operativas aparecerán aquí. No reemplazan la historia clínica.</p>}</section><section className="section-block"><div className="section-title"><h2>Citas recientes</h2><span>{appointments.length}</span></div>{appointments.length ? <div className="mini-appointments">{appointments.slice(0, 5).map((item) => <article key={item.id}><div><strong>{item.servicio}</strong><small>{formatDate(item.inicio)}</small></div><StatusPill status={item.estado} /></article>)}</div> : <EmptyState title="Sin citas" text="No hay citas registradas." />}</section><section className="section-block"><div className="section-title"><h2>Cotizaciones</h2><span>{quotes.length}</span></div>{quotes.length ? <div className="mini-quotes">{quotes.slice(0, 5).map((item) => <article key={item.id}><div><strong>{item.titulo || 'Plan de tratamiento'}</strong><small>{item.resumen.total_items} servicio(s){item.resumen.sin_precio > 0 ? ` · ${item.resumen.sin_precio} sin precio` : ` · ${formatMoney(item.resumen.total_bs)}`}</small></div><StatusPill status={item.estado} /></article>)}</div> : <EmptyState title="Sin cotizaciones" text="Arma el plan de tratamiento, con o sin precio." />}<button className="button button-primary button-small" onClick={() => setQuoteOpen(true)}><Icon name="plus" /> Nueva cotización</button></section><section className="section-block"><div className="section-title"><h2>Caja y movimientos</h2><span>{payments.length}</span></div><div className="cash-audit-grid"><div><small>Saldo total</small><strong className={Number(balance) > 0 ? 'coral-text' : ''}>{formatMoney(balance)}</strong></div><div><small>Esta semana</small><strong>{formatMoney(cobradoSemana)}</strong></div><div><small>Este mes</small><strong>{formatMoney(cobradoMes)}</strong></div></div><button className="button button-primary button-small" onClick={() => setCashOpen(true)}><Icon name="plus" /> Registrar pago</button>{payments.length ? <>{quotes.filter((quote) => quote.pago?.pagado_bs > 0).length > 0 && <div className="mini-quotes">{quotes.filter((quote) => quote.pago?.pagado_bs > 0).map((quote) => <article key={quote.id}><div><strong>{quote.titulo || 'Plan de tratamiento'}</strong><small>Total {formatMoney(quote.pago.total_bs)} − A cuenta {formatMoney(quote.pago.pagado_bs)} = Saldo {formatMoney(quote.pago.saldo_bs)}</small></div><StatusPill status={quote.pago.estado === 'pagado' ? 'pagado' : 'saldo'} /></article>)}</div>}<div className="mini-payments">{payments.slice(0, 10).map((item) => <article key={item.id}><div><strong>{formatMoney(item.monto_bs)}</strong><small>{formatDate(item.creado_en)} · {item.metodo} · {item.presupuesto_titulo || 'Saldo general'}</small></div><StatusPill status={item.estado} />{item.evidencia_url && <a href={item.evidencia_url} target="_blank" rel="noreferrer" title="Ver comprobante"><Icon name="file" size={16} /></a>}</article>)}</div></> : <p className="muted-box">Los pagos aplicados a cotizaciones o al saldo general aparecerán aquí.</p>}</section></aside></div>
    {recordOpen && <Modal title="Nuevo registro clínico" onClose={() => setRecordOpen(false)}><form className="modal-form" onSubmit={addRecord}>{user.rol === 'operativo' && <Field label="Doctor responsable"><select value={record.doctor_id} onChange={(event) => setRecord({ ...record, doctor_id: event.target.value })} required><option value="">Selecciona un doctor</option>{unwrap(doctorsRemote.data, 'doctores').map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.nombre}</option>)}</select></Field>}<Field label="Diagnóstico"><textarea rows="3" value={record.diagnostico} onChange={(event) => setRecord({ ...record, diagnostico: event.target.value })} required /></Field><Field label="Tratamiento"><textarea rows="3" value={record.tratamiento} onChange={(event) => setRecord({ ...record, tratamiento: event.target.value })} /></Field><Field label="Observaciones"><textarea rows="3" value={record.observaciones} onChange={(event) => setRecord({ ...record, observaciones: event.target.value })} /></Field><button className="button button-primary">Guardar registro</button></form></Modal>}
    {quoteOpen && <QuoteEditor patient={patient} onClose={() => setQuoteOpen(false)} onSaved={() => { quotesRemote.reload(); setMessage('Cotización guardada.') }} />}
    {editPatient && <Modal title="Editar ficha del paciente" onClose={() => setEditPatient(null)}><PatientForm patient={editPatient} setPatient={setEditPatient} onSubmit={savePatient} saving={saving} /></Modal>}
    {cashOpen && <Modal title={`Registrar pago · ${name}`} onClose={() => setCashOpen(false)}><form className="modal-form" onSubmit={saveCash}><Field label="Cotización (opcional)"><select value={cash.presupuesto_id} onChange={(event) => setCash({ ...cash, presupuesto_id: event.target.value })}><option value="">Saldo general (sin cotización)</option>{quotes.filter((quote) => quote.pago?.estado !== 'pagado' && quote.pago?.saldo_bs > 0).map((quote) => <option value={quote.id} key={quote.id}>{quote.titulo || 'Plan de tratamiento'} · saldo {formatMoney(quote.pago.saldo_bs)}</option>)}</select></Field><Field label="Monto (Bs)"><input type="number" min="0.01" step="0.01" value={cash.monto_bs} onChange={(event) => setCash({ ...cash, monto_bs: event.target.value })} required /></Field><button className="button button-primary" disabled={saving}>Registrar pago</button></form></Modal>}<Toast message={message} onClose={() => setMessage('')} /></>
}
