import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, formatDate, formatMoney, unwrap } from '../../lib/api.js'
import { useRemote } from '../../hooks/useRemote.js'
import Icon from '../../components/Icon.jsx'
import { EmptyState, ErrorState, Field, Loading, Modal, PageHeader, StatusPill, Toast } from '../../components/UI.jsx'

const QUOTE_FILTERS = [
  ['todos', 'Todos'],
  ['borrador', 'Borrador'],
  ['entregado', 'Entregado'],
  ['aceptado', 'Aceptado'],
  ['archivado', 'Archivado'],
]

let quoteUid = 0
const nextUid = () => `item-${Date.now()}-${quoteUid++}`
const emptyItem = () => ({ uid: nextUid(), servicio_id: '', nombre: '', cantidad: '1', precio_bs: '', duracion_min: '', notas: '', detalle: [] })
const newQuoteForm = (patientId = '') => ({ paciente_id: patientId, titulo: '', notas: '', items: [emptyItem()] })
const quoteToForm = (quote) => ({
  paciente_id: String(quote.paciente_id),
  titulo: quote.titulo || '',
  notas: quote.notas || '',
  items: quote.items.map((item) => ({
    uid: nextUid(),
    servicio_id: item.servicio_id ? String(item.servicio_id) : '',
    nombre: item.nombre || '',
    cantidad: String(item.cantidad ?? 1),
    precio_bs: item.precio_bs === null || item.precio_bs === undefined ? '' : String(item.precio_bs),
    duracion_min: item.duracion_min === null || item.duracion_min === undefined ? '' : String(item.duracion_min),
    notas: item.notas || '',
    detalle: (item.detalle || []).map((part) => ({ ...part })),
  })),
})
const precioTexto = (value) => (value === null || value === undefined || value === '' ? 'A definir' : formatMoney(value))
const sinPrecio = (value) => value === null || value === undefined || value === ''
const toNumberOrUndefined = (value) => (value === '' ? undefined : Number(value))
const extrasTotal = (item) => (item.detalle || []).reduce((sum, part) => sum + (Number(part.precio_bs) || 0), 0)
function itemTotal(item) {
  const price = sinPrecio(item.precio_bs) ? 0 : Number(item.precio_bs || 0)
  return price * (Number(item.cantidad) || 1) + extrasTotal(item)
}
function quoteTotals(items) {
  return items.reduce((acc, item) => {
    const price = sinPrecio(item.precio_bs) ? null : Number(item.precio_bs)
    if (price !== null && Number.isFinite(price)) acc.total += price * (Number(item.cantidad) || 1) + extrasTotal(item)
    else if (extrasTotal(item) > 0) acc.total += extrasTotal(item)
    else acc.sinPrecio += 1
    return acc
  }, { total: 0, sinPrecio: 0 })
}

export function QuoteEditor({ patient, quote, initialPatientId = '', onClose, onSaved }) {
  const servicesRemote = useRemote('/servicios')
  const patientsRemote = useRemote(patient ? '' : '/pacientes', { enabled: !patient })
  const services = unwrap(servicesRemote.data, 'servicios')
  const patients = unwrap(patientsRemote.data, 'pacientes')
  const [form, setForm] = useState(() => (quote ? quoteToForm(quote) : newQuoteForm(patient ? String(patient.id) : initialPatientId)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const totals = quoteTotals(form.items)

  const setItem = (uid, patch) => setForm((current) => ({ ...current, items: current.items.map((item) => (item.uid === uid ? { ...item, ...patch } : item)) }))
  function pickService(uid, serviceId) {
    const service = services.find((item) => String(item.id) === String(serviceId))
    if (!service) return setItem(uid, { servicio_id: '', nombre: '' })
    setItem(uid, {
      servicio_id: String(service.id),
      nombre: service.nombre,
      precio_bs: sinPrecio(service.precio_bs) ? '' : String(service.precio_bs),
      duracion_min: service.duracion_min ? String(service.duracion_min) : '',
    })
  }
  function addService() { setForm((current) => ({ ...current, items: [...current.items, emptyItem()] })) }
  function removeItem(uid) {
    if (form.items.length <= 1) return
    setForm((current) => ({ ...current, items: current.items.filter((item) => item.uid !== uid) }))
  }
  const setDetail = (uid, index, patch) => setForm((current) => ({
    ...current,
    items: current.items.map((item) => (item.uid === uid
      ? { ...item, detalle: item.detalle.map((part, partIndex) => (partIndex === index ? { ...part, ...patch } : part)) }
      : item)),
  }))
  function addDetail(uid) {
    setForm((current) => ({
      ...current,
      items: current.items.map((item) => (item.uid === uid ? { ...item, detalle: [...item.detalle, { nombre: '', precio_bs: '' }] } : item)),
    }))
  }
  function removeDetail(uid, index) {
    setForm((current) => ({
      ...current,
      items: current.items.map((item) => (item.uid === uid ? { ...item, detalle: item.detalle.filter((_, partIndex) => partIndex !== index) } : item)),
    }))
  }
  async function save(event) {
    event.preventDefault()
    setError('')
    if (!patient && !form.paciente_id) return setError('Selecciona un paciente.')
    if (form.items.some((item) => !item.servicio_id && !String(item.nombre || '').trim()))
      return setError('Cada servicio necesita un nombre o elegir un tratamiento del catálogo.')
    if (form.items.some((item) => item.detalle.some((part) => !String(part.nombre || '').trim())))
      return setError('Cada partida detallada necesita un nombre.')
    const payload = {
      paciente_id: patient ? Number(patient.id) : Number(form.paciente_id),
      titulo: form.titulo.trim() || undefined,
      notas: form.notas.trim() || undefined,
      items: form.items.map((item) => ({
        servicio_id: item.servicio_id ? Number(item.servicio_id) : undefined,
        nombre: String(item.nombre || '').trim() || undefined,
        cantidad: Number(item.cantidad) || 1,
        precio_bs: toNumberOrUndefined(item.precio_bs),
        duracion_min: toNumberOrUndefined(item.duracion_min),
        notas: String(item.notas || '').trim() || undefined,
        detalle: item.detalle.filter((part) => String(part.nombre || '').trim())
          .map((part) => ({ nombre: String(part.nombre).trim(), precio_bs: Number(part.precio_bs) || 0 })),
      })),
    }
    setBusy(true)
    try {
      await api(quote ? `/presupuestos/${quote.id}` : '/presupuestos', {
        method: quote ? 'PATCH' : 'POST',
        body: payload,
      })
      onSaved()
      onClose()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={quote ? 'Editar cotización' : 'Nueva cotización'} onClose={onClose}>
      <form className="modal-form quote-form" onSubmit={save}>
        {!patient && (
          <Field label="Paciente">
            <select value={form.paciente_id} onChange={(event) => setForm({ ...form, paciente_id: event.target.value })} required>
              <option value="">Selecciona un paciente</option>
              {patients.map((item) => (
                <option key={item.id} value={item.id}>{item.codigo} - {item.nombres} {item.apellidos}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Título (opcional)">
          <input value={form.titulo} onChange={(event) => setForm({ ...form, titulo: event.target.value })} placeholder="Plan de ortodoncia" />
        </Field>
        <div className="quote-editor-head">
          <strong>Servicios incluidos</strong>
          <small>El precio es opcional: se define en consulta.</small>
        </div>
        <div className="quote-items">
          {form.items.map((item) => (
            <article className="quote-item" key={item.uid}>
              <select value={item.servicio_id} onChange={(event) => pickService(item.uid, event.target.value)} aria-label="Tratamiento">
                <option value="">Otro (nombre libre)</option>
                {services.map((service) => (
                  <option key={service.id} value={service.id}>{service.nombre}</option>
                ))}
              </select>
              <input value={item.nombre} onChange={(event) => setItem(item.uid, { nombre: event.target.value })} placeholder="Nombre del tratamiento" required={!item.servicio_id} />
              <label className="quote-mini"><span>Precio (Bs)</span><input type="number" min="0" step="0.01" value={item.precio_bs} onChange={(event) => setItem(item.uid, { precio_bs: event.target.value })} placeholder="Sin precio" inputMode="decimal" /></label>
              <label className="quote-mini"><span>Cant.</span><input type="number" min="1" max="999" value={item.cantidad} onChange={(event) => setItem(item.uid, { cantidad: event.target.value })} /></label>
              <label className="quote-mini"><span>Min</span><input type="number" min="1" value={item.duracion_min} onChange={(event) => setItem(item.uid, { duracion_min: event.target.value })} placeholder="—" inputMode="numeric" /></label>
              <input value={item.notas} onChange={(event) => setItem(item.uid, { notas: event.target.value })} placeholder="Nota del servicio" />
              <button type="button" className="icon-button danger" onClick={() => removeItem(item.uid)} disabled={form.items.length <= 1} aria-label="Quitar servicio" title="Quitar servicio"><Icon name="trash" size={15} /></button>
              <div className="quote-extras">
                {item.detalle.map((part, index) => (
                  <div className="quote-extra-row" key={index}>
                    <input value={part.nombre} onChange={(event) => setDetail(item.uid, index, { nombre: event.target.value })} placeholder="Complemento del servicio" />
                    <input type="number" min="0" step="0.01" value={part.precio_bs} onChange={(event) => setDetail(item.uid, index, { precio_bs: event.target.value })} placeholder="Bs" inputMode="decimal" aria-label="Precio de la partida" />
                    <button type="button" className="icon-button danger" onClick={() => removeDetail(item.uid, index)} aria-label="Quitar partida" title="Quitar partida"><Icon name="trash" size={13} /></button>
                  </div>
                ))}
                <div className="quote-extra-foot">
                  <button type="button" className="button button-ghost button-small" onClick={() => addDetail(item.uid)}><Icon name="plus" /> Agregar partida</button>
                  <strong>Subtotal {sinPrecio(item.precio_bs) && !extrasTotal(item) ? 'a definir' : formatMoney(itemTotal(item))}</strong>
                </div>
              </div>
            </article>
          ))}
        </div>
        <button type="button" className="button button-ghost button-small" onClick={addService}><Icon name="plus" /> Añadir otro servicio</button>
        <div className="quote-totals">
          <div><small>Total cotizado</small><strong>{formatMoney(totals.total)}</strong></div>
          {totals.sinPrecio > 0 && <p>+ {totals.sinPrecio} servicio(s) sin precio · se definen en consulta</p>}
        </div>
        <Field label="Notas generales">
          <textarea rows="3" value={form.notas} onChange={(event) => setForm({ ...form, notas: event.target.value })} placeholder="Alcance, garantía, plazos…" />
        </Field>
        {error && <p className="form-error">{error}</p>}
        <button className="button button-primary" disabled={busy}>{busy ? 'Guardando…' : quote ? 'Guardar cambios' : 'Crear cotización'}</button>
      </form>
    </Modal>
  )
}

export function ShareQuoteModal({ detail, onClose, onShared }) {
  const [copied, setCopied] = useState(false)
  const [sending, setSending] = useState(false)
  const url = `${window.location.origin}/cotizacion/${detail.public_token}`
  const centro = detail.estado === 'borrador' || detail.estado === 'archivado'
  const telefono = String(detail.telefono || '').replace(/\D/g, '')
  const waNumber = telefono ? (telefono.startsWith('591') ? telefono : `591${telefono.replace(/^0/, '')}`) : ''
  const total = formatMoney(detail.resumen?.total_bs || 0)
  const price = detail.resumen?.sin_precio > 0 ? `Total publicado: ${total} + servicios por definir.` : `Total cotizado: ${total}.`
  const payment = detail.pago?.pagado_bs > 0 ? ` Pagado a cuenta: ${formatMoney(detail.pago.pagado_bs)}. Saldo: ${formatMoney(detail.pago.saldo_bs)}.` : ''
  const itemLines = (detail.items || []).map((item, index) => {
    const parts = (item.detalle || []).map((part) => `${part.nombre} ${formatMoney(part.precio_bs)}`).join(', ')
    const itemPrice = item.precio_bs === null || item.precio_bs === undefined ? 'a definir' : formatMoney(item.precio_bs)
    return `${index + 1}. ${item.nombre}${item.cantidad > 1 ? ` x${item.cantidad}` : ''}: ${itemPrice}${parts ? ` (${parts})` : ''}`
  }).join('\n')
  const waLink = `https://wa.me/${waNumber}?text=${encodeURIComponent(`Hola ${detail.nombres}, aquí tienes tu cotización:\n\n${itemLines}\n\n${price}${payment}\nPuedes revisar el detalle aquí: ${url}`)}`

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      onShared('No se pudo copiar el enlace.')
    }
  }
  async function sendEmail() {
    setSending(true)
    try {
      await api(`/presupuestos/${detail.id}/enviar`, { method: 'POST' })
      onShared('Cotización enviada por correo al paciente.')
      onClose()
    } catch (requestError) {
      onShared(requestError.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal title="Compartir cotización" onClose={onClose}>
      <div className="share-quote">
        <p className="muted-box">El paciente abre este enlace en su celular <strong>sin necesidad de iniciar sesión</strong> y ve su plan de tratamiento.</p>
        {centro && <p className="form-error">Cotización <strong>{detail.estado}</strong>: el enlace solo se activa con una entregada o aceptada.</p>}
        <div className="share-url">
          <span>{url}</span>
          <button className="button button-ghost button-small" onClick={copy} disabled={centro}><Icon name="file" /> {copied ? 'Copiado' : 'Copiar'}</button>
        </div>
        {detail.visto_en && <p className="share-seen"><Icon name="check" size={15} /> El paciente ya vio la cotización el {formatDate(detail.visto_en)}.</p>}
        <div className="modal-actions">
          <a className="button button-primary" href={!centro && waNumber ? waLink : undefined} target="_blank" rel="noreferrer" onClick={centro || !waNumber ? (event) => event.preventDefault() : undefined} aria-disabled={centro || !waNumber}>
            <Icon name="whatsapp" /> Enviar por WhatsApp
          </a>
          {!waNumber && <p className="form-error">El paciente no tiene un número de WhatsApp registrado.</p>}
          <button className="button button-ghost" onClick={sendEmail} disabled={sending || centro}><Icon name="email" /> {sending ? 'Enviando…' : 'Enviar por correo'}</button>
          <button className="button button-ghost" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </Modal>
  )
}

export default function Quotes() {
  const [filter, setFilter] = useState('todos')
  const query = filter === 'todos' ? '/presupuestos' : `/presupuestos?estado=${filter}`
  const quotesRemote = useRemote(query)
  const [editing, setEditing] = useState(null)
  const [viewId, setViewId] = useState(null)
  const detailRemote = useRemote(viewId ? `/presupuestos/${viewId}` : '', { enabled: Boolean(viewId) })
  const [nextState, setNextState] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [sharing, setSharing] = useState(false)
  const quotes = unwrap(quotesRemote.data, 'presupuestos')
  const detail = detailRemote.data?.presupuesto

  async function changeState(estado) {
    if (!detail) return
    setBusy(true)
    try {
      await api(`/presupuestos/${detail.id}/estado`, { method: 'PATCH', body: { estado } })
      setMessage(estado === 'aceptado' ? 'Cotización marcada como aceptada.' : `Cotización marcada como ${estado}.`)
      setViewId(null)
      quotesRemote.reload()
    } catch (requestError) {
      setMessage(requestError.message)
    } finally {
      setBusy(false)
    }
  }
  async function archive() {
    if (!detail || !window.confirm('¿Archivar esta cotización? Permanecerá en auditoría.')) return
    setBusy(true)
    try {
      await api(`/presupuestos/${detail.id}`, { method: 'DELETE' })
      setMessage('Cotización archivada.')
      setViewId(null)
      quotesRemote.reload()
    } catch (requestError) {
      setMessage(requestError.message)
    } finally {
      setBusy(false)
    }
  }
  async function openShare() {
    if (!detail) return
    setBusy(true)
    try {
      if (detail.estado === 'borrador') {
        await api(`/presupuestos/${detail.id}/estado`, { method: 'PATCH', body: { estado: 'entregado' } })
      }
      await api(`/presupuestos/${detail.id}/compartir`, { method: 'POST' })
      await detailRemote.reload()
      quotesRemote.reload()
      setSharing(true)
    } catch (requestError) {
      setMessage(requestError.message)
    } finally {
      setBusy(false)
    }
  }
  async function saved() {
    quotesRemote.reload()
    setMessage('Cotización guardada.')
  }

  return (
    <>
      <PageHeader
        eyebrow="PLAN DE TRATAMIENTO"
        title="Cotizaciones"
        description="Arma el plan con tus tratamientos, con o sin precio; el costo se define en consulta."
        action={<button className="button button-coral" onClick={() => setEditing({})}><Icon name="plus" /> Nueva cotización</button>}
      />
      <div className="filter-row">
        {QUOTE_FILTERS.map(([value, label]) => (
          <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}</button>
        ))}
      </div>
      {quotesRemote.loading ? (
        <Loading label="Revisando cotizaciones" />
      ) : quotesRemote.error ? (
        <ErrorState message={quotesRemote.error} onRetry={quotesRemote.reload} />
      ) : quotes.length ? (
        <div className="quote-list">
          {quotes.map((quoteItem) => (
            <article className="quote-card" key={quoteItem.id}>
              <header>
                <div>
                  <Link to={`/pacientes/${quoteItem.paciente_id}`}><strong>{quoteItem.nombres} {quoteItem.apellidos}</strong></Link>
                  <small><span className="patient-code">{quoteItem.codigo}</span> · {formatDate(quoteItem.creado_en)}</small>
                </div>
                <StatusPill status={quoteItem.estado} />
              </header>
              <div className="quote-card-body">
                <h3>{quoteItem.titulo || 'Plan de tratamiento'}</h3>
                <p>{quoteItem.resumen.total_items} servicio(s){quoteItem.resumen.sin_precio > 0 ? ` · ${quoteItem.resumen.sin_precio} sin precio` : ''}{quoteItem.pago?.pagado_bs > 0 ? ` · Pagado ${formatMoney(quoteItem.pago.pagado_bs)} · Saldo ${formatMoney(quoteItem.pago.saldo_bs)}` : ''}</p>
              </div>
              <footer>
                <strong className={quoteItem.resumen.sin_precio > 0 ? 'coral-text' : ''}>
                  {quoteItem.resumen.sin_precio > 0 ? `${formatMoney(quoteItem.resumen.total_bs)} + a definir` : formatMoney(quoteItem.resumen.total_bs)}
                </strong>
                <div className="quote-card-actions">
                  <button className="button button-ghost button-small" onClick={() => { setViewId(quoteItem.id); setNextState(quoteItem.estado) }}><Icon name="file" /> Ver</button>
                  <button className="button button-primary button-small" onClick={() => setEditing({ initialPatientId: String(quoteItem.paciente_id) })}><Icon name="plus" /> Copiar</button>
                </div>
              </footer>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon="file"
          title="Sin cotizaciones"
          text={`No hay ${filter === 'todos' ? '' : `${filter} `}presupuestos todavía. Crea el primero con tus tratamientos.`}
          action={<button className="button button-primary" onClick={() => setEditing({})}><Icon name="plus" /> Crear cotización</button>}
        />
      )}
      {editing && <QuoteEditor quote={editing.id ? editing : null} initialPatientId={editing.initialPatientId || ''} onClose={() => setEditing(null)} onSaved={saved} />}
      {viewId && (
        <Modal title="Detalle de la cotización" onClose={() => setViewId(null)}>
          {detailRemote.loading ? <Loading /> : detailRemote.error ? <ErrorState message={detailRemote.error} onRetry={detailRemote.reload} /> : detail ? (
            <div className="quote-detail">
              <div className="modal-avatar">{`${detail.nombres} ${detail.apellidos}`.trim().slice(0, 1)}</div>
              <h3 className="quote-patient">{detail.nombres} {detail.apellidos}</h3>
              <StatusPill status={detail.estado} />
              <p className="muted-box">Creado por {detail.creado_por_nombre} · {formatDate(detail.creado_en)}</p>
              <h4>{detail.titulo || 'Plan de tratamiento'}</h4>
              <div className="quote-items readonly">
                {detail.items.map((item) => (
                  <article className="quote-item" key={item.id}>
                    <div className="quote-item-name"><strong>{item.nombre}</strong>{item.notas && <small>{item.notas}</small>}
                      {item.detalle?.length > 0 && (
                        <small className="quote-item-parts">
                          {item.detalle.map((part, index) => (
                            <span key={index}>{part.nombre} · {formatMoney(part.precio_bs)}</span>
                          ))}
                        </small>
                      )}
                    </div>
                    <span className="quote-item-qty">{item.cantidad > 1 ? `×${item.cantidad}` : ''}</span>
                    <strong>{item.total_bs === null || item.total_bs === undefined ? (item.detalle?.length ? formatMoney(extrasTotal(item)) : 'A definir') : formatMoney(item.total_bs)}</strong>
                  </article>
                ))}
              </div>
              <div className="quote-totals">
                <div><small>Total cotizado</small><strong>{formatMoney(detail.resumen.total_bs)}</strong></div>
                {detail.resumen.sin_precio > 0 && <p>{detail.resumen.sin_precio} servicio(s) sin precio · se definen en consulta</p>}
              </div>
              {detail.notas && <p className="quote-notes">{detail.notas}</p>}
              {detail.timeline?.length > 0 && (
                <div className="quote-timeline">
                  <small className="eyebrow">RECORRIDO</small>
                  <ol>
                    {detail.timeline.map((step, index) => (
                      <li key={index}>
                        <span className={`dot dot-${step.estado}`} />
                        <div>
                          <strong>{({ borrador: 'Borrador', entregado: 'Entregada', aceptado: 'Aceptada', archivado: 'Archivada' })[step.estado] || step.estado}</strong>
                          <small>{formatDate(step.fecha)} {step.usuario ? `· por ${step.usuario}` : ''}</small>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              <div className="modal-actions">
                <button className="button button-ghost" onClick={() => { setEditing(detail); setViewId(null) }}><Icon name="edit" /> Editar</button>
                <button className="button button-primary button-share" disabled={busy || detail.estado === 'archivado'} onClick={openShare}><Icon name="whatsapp" /> Compartir</button>
                <button className="button button-primary" disabled={busy || detail.estado === 'archivado'} onClick={() => changeState(detail.estado === 'aceptado' ? 'entregado' : 'aceptado')}>
                  {detail.estado === 'aceptado' ? 'Volver a entregado' : 'Marcar aceptada'}
                </button>
              </div>
              <div className="quote-state-row">
                <select value={nextState} onChange={(event) => setNextState(event.target.value)} aria-label="Cambiar estado">
                  {QUOTE_FILTERS.slice(1).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <button className="button button-ghost button-small" disabled={busy || nextState === detail.estado} onClick={() => changeState(nextState)}>Cambiar estado</button>
              </div>
              <button className="button button-ghost button-wide danger" onClick={archive} disabled={busy}><Icon name="trash" /> Archivar cotización</button>
            </div>
          ) : null}
        </Modal>
      )}
      {sharing && detail && <ShareQuoteModal detail={detail} onClose={() => setSharing(false)} onShared={setMessage} />}
      <Toast message={message} onClose={() => setMessage('')} />
    </>
  )
}
