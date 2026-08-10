import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'

export function PageHeader({ eyebrow, title, description, action, children }) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action || children}
    </header>
  )
}

export function Loading({ label = 'Preparando todo' }) {
  return <div className="state-card"><span className="loader" /><strong>{label}</strong><small>Solo tomará un momento.</small></div>
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="state-card state-error">
      <span className="state-symbol">!</span>
      <strong>Algo no salió bien</strong>
      <small>{message}</small>
      {onRetry && <button className="button button-ghost button-small" onClick={onRetry}>Intentar de nuevo</button>}
    </div>
  )
}

export function EmptyState({ icon = 'calendar', title, text, action }) {
  return (
    <div className="state-card">
      <span className="empty-icon"><Icon name={icon} size={25} /></span>
      <strong>{title}</strong>
      <small>{text}</small>
      {action}
    </div>
  )
}

export function StatusPill({ status = '' }) {
  const normalized = status.toLowerCase().replaceAll(' ', '-')
  const labels = {
    confirmada: 'Confirmada', confirmado: 'Confirmado', pendiente: 'Pendiente',
    cancelada: 'Cancelada', cancelado: 'Cancelado', completada: 'Completada',
    completado: 'Completado', pagado: 'Pagado', verificado: 'Verificado',
    rechazada: 'Rechazada', rechazado: 'Rechazado', activo: 'Activo', vencido: 'Vencido',
    atendida: 'Atendida', no_asistio: 'No asistió', por_verificar: 'Por verificar',
    valido: 'Válido', anulado: 'Anulado', preautorizado: 'Invitado', suspendido: 'Suspendido',
    borrador: 'Borrador', entregado: 'Entregado', aceptado: 'Aceptado', archivado: 'Archivado',
  }
  return <span className={`status status-${normalized}`}>{labels[normalized] || status || 'Pendiente'}</span>
}

export function Modal({ title, onClose, children }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Cerrar"><Icon name="close" /></button></div>
        {children}
      </section>
    </div>
  )
}

export function Toast({ message, type = 'success', onClose }) {
  if (!message) return null
  return <div className={`toast toast-${type}`}><Icon name={type === 'success' ? 'check' : 'close'} /><span>{message}</span><button onClick={onClose} aria-label="Cerrar"><Icon name="close" size={16} /></button></div>
}

export function Field({ label, hint, children }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}

export function Metric({ label, value, note, icon, tone = '' }) {
  const numeric = typeof value === 'number' && Number.isFinite(value)
  return <article className={`metric ${tone}`}><span className="metric-icon"><Icon name={icon} /></span><div><small>{label}</small><strong>{numeric ? <NumberTicker value={value} /> : value}</strong>{note && <span>{note}</span>}</div></article>
}

function NumberTicker({ value }) {
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setDisplay(value); return }
    const started = performance.now()
    let frame
    const tick = (now) => {
      const progress = Math.min((now - started) / 650, 1)
      setDisplay(Math.round(value * (1 - Math.pow(1 - progress, 3))))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value])

  return <span className="number-ticker">{display.toLocaleString('es-BO')}</span>
}
