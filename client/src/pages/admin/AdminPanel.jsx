import { useState } from 'react'
import { api, unwrap, formatDate, formatMoney } from '../../lib/api.js'
import { useRemote } from '../../hooks/useRemote.js'
import Icon from '../../components/Icon.jsx'
import { EmptyState, ErrorState, Field, Loading, Metric, Modal, PageHeader, StatusPill, Toast } from '../../components/UI.jsx'

const stateOptions = [
  { value: '', label: 'Todos los estados' },
  { value: 'preautorizado', label: 'Invitados' },
  { value: 'activo', label: 'Activos' },
  { value: 'pendiente', label: 'Sin invitación' },
  { value: 'suspendido', label: 'Suspendidos' },
]

const activityLabels = {
  activo: 'Activo', inactivo: 'Inactivo', abandonado: 'Abandonado',
  vacio: 'Sin datos', sinusuario: 'Sin usuarios',
}

export default function AdminPanel() {
  const resumenRemote = useRemote('/admin/resumen')
  const clinicsRemote = useRemote('/admin/consultorios')
  const usersRemote = useRemote('/admin/usuarios')
  const [invite, setInvite] = useState({ email: '', nombre: '' })
  const [stateFilter, setStateFilter] = useState('')
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [detail, setDetail] = useState(null)
  const [resetting, setResetting] = useState(null)
  const [busyId, setBusyId] = useState(null)

  if (resumenRemote.loading || clinicsRemote.loading || usersRemote.loading) return <Loading label="Cargando el centro de control" />
  if (resumenRemote.error || clinicsRemote.error || usersRemote.error) {
    return <ErrorState message={resumenRemote.error || clinicsRemote.error || usersRemote.error} onRetry={() => { resumenRemote.reload(); clinicsRemote.reload(); usersRemote.reload() }} />
  }

  const resumen = resumenRemote.data?.resumen || {}
  const clinics = unwrap(clinicsRemote.data, 'consultorios')
  const term = search.trim().toLowerCase()
  const users = unwrap(usersRemote.data, 'usuarios').filter((user) =>
    (!stateFilter || user.estado === stateFilter)
    && (!term || user.email.toLowerCase().includes(term) || user.nombre.toLowerCase().includes(term) || (user.consultorio || '').toLowerCase().includes(term)))

  async function reloadAll() {
    resumenRemote.reload(); clinicsRemote.reload(); usersRemote.reload()
  }

  async function sendInvite(event) {
    event.preventDefault(); setSaving(true)
    try {
      const result = await api('/admin/invitaciones', { method: 'POST', body: invite })
      setInvite({ email: '', nombre: '' }); setMessage(result.mensaje); reloadAll()
    } catch (error) { setMessage(error.message) } finally { setSaving(false) }
  }

  async function changeState(user, estado) {
    setSaving(true)
    try {
      await api(`/admin/usuarios/${user.id}/estado`, { method: 'PATCH', body: { estado } })
      setMessage(estado === 'suspendido' ? `${user.email} quedó suspendido y sin acceso.` : `${user.email} quedó activo.`); reloadAll()
    } catch (error) { setMessage(error.message) } finally { setSaving(false) }
  }

  async function removeUser(user) {
    if (!window.confirm(`¿Eliminar a ${user.email}? Perderá el acceso de inmediato.`)) return
    setSaving(true)
    try {
      await api(`/admin/usuarios/${user.id}`, { method: 'DELETE' })
      setMessage(`${user.email} fue eliminado.`); reloadAll()
    } catch (error) { setMessage(error.message) } finally { setSaving(false) }
  }

  async function openDetail(clinic) {
    setDetail({ loading: true, clinic })
    try {
      const data = await api(`/admin/consultorios/${clinic.id}`)
      setDetail({ ...data, clinic })
    } catch (error) {
      setDetail({ loading: false, clinic, error: error.message })
    }
  }

  async function exportClinic(clinic) {
    setBusyId(clinic.id)
    try {
      const response = await fetch(`/api/admin/consultorios/${clinic.id}/exportar`, { credentials: 'include' })
      if (!response.ok) throw new Error('No se pudo generar la exportación')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `consultorio-${clinic.id}-${new Date().toISOString().slice(0, 10)}.zip`
      document.body.appendChild(anchor); anchor.click(); anchor.remove()
      URL.revokeObjectURL(url)
      setMessage(`Exportación de "${clinic.nombre}" descargada.`)
    } catch (error) { setMessage(error.message) } finally { setBusyId(null) }
  }

  async function resetClinic() {
    if (!resetting) return
    setBusyId(resetting.id); setSaving(true)
    try {
      const result = await api(`/admin/consultorios/${resetting.id}/reiniciar`, { method: 'POST', body: { confirmar: true } })
      setMessage(`${result.mensaje} (${result.pacientes} pacientes liberados)`)
      setResetting(null); reloadAll()
    } catch (error) { setMessage(error.message) } finally { setSaving(false); setBusyId(null) }
  }

  async function removeClinic(clinic) {
    if (!window.confirm(`¿Eliminar el consultorio "${clinic.nombre}"? Sus usuarios perderán el acceso.`)) return
    setSaving(true)
    try {
      await api(`/admin/consultorios/${clinic.id}`, { method: 'DELETE' })
      setMessage(`El consultorio "${clinic.nombre}" fue eliminado.`); reloadAll()
    } catch (error) { setMessage(error.message) } finally { setSaving(false) }
  }

  return <>
    <PageHeader eyebrow="SUPERADMINISTRACIÓN" title="Centro de control" description="Invita consultorios nuevos, supervisa actividad, exporta datos y reinicia consultorios cuando lo necesites." />
    <section className="metrics-grid admin-metrics">
      <Metric label="Consultorios" value={resumen.consultorios || 0} icon="tooth" />
      <Metric label="Usuarios" value={resumen.usuarios || 0} icon="users" />
      <Metric label="Invitaciones abiertas" value={resumen.invitaciones || 0} icon="email" tone="warm" />
      <Metric label="Pacientes" value={resumen.pacientes || 0} icon="file" />
    </section>

    <div className="settings-grid">
      <form className="settings-card" onSubmit={sendInvite}>
        <div className="settings-card-head"><span><Icon name="email" /></span><div><h2>Invitar un consultorio</h2><p>El correo podrá iniciar sesión con Google y crear su propio consultorio.</p></div></div>
        <Field label="Correo del consultorio"><input type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} placeholder="consultorio@correo.com" required /></Field>
        <Field label="Nombre (opcional)"><input value={invite.nombre} onChange={(e) => setInvite({ ...invite, nombre: e.target.value })} placeholder="Clínica Sonrisas" /></Field>
        <button className="button button-primary" disabled={saving}>Enviar invitación</button>
        <small>Solo los correos invitados pueden crear consultorios. Los demás quedan en espera.</small>
      </form>

      <section className="settings-card">
        <div className="settings-card-head"><span><Icon name="tooth" /></span><div><h2>Consultorios ({clinics.length})</h2><p>Cada consultorio mantiene sus datos aislados. Reiniciar libera pacientes y citas conservando usuarios y configuración.</p></div></div>
        {clinics.length ? <div className="admin-list">{clinics.map((clinic) => (
          <article key={clinic.id}>
            <div>
              <strong>{clinic.nombre}</strong>
              <small>{clinic.email || 'Sin correo'} · {clinic.doctores} doctor(es) · {clinic.operativos} operativo(s) · {clinic.pacientes} paciente(s)</small>
              <small>Creado el {formatDate(clinic.creado_en)} · Ingresos: <strong>{formatMoney(clinic.ingresos_total)}</strong></small>
            </div>
            <StatusPill status={activityLabels[clinic.estado_actividad] || clinic.estado_actividad || 'Pendiente'} />
            <div className="row-actions">
              <button onClick={() => openDetail(clinic)} disabled={busyId === clinic.id} aria-label={`Ver detalle de ${clinic.nombre}`} title="Detalle"><Icon name="history" /></button>
              <button onClick={() => exportClinic(clinic)} disabled={busyId === clinic.id} aria-label={`Exportar ${clinic.nombre}`} title="Exportar como ZIP"><Icon name="upload" /></button>
              <button onClick={() => setResetting(clinic)} disabled={busyId === clinic.id} aria-label={`Reiniciar ${clinic.nombre}`} title="Reiniciar a cero"><Icon name="clock" /></button>
              <button onClick={() => removeClinic(clinic)} disabled={saving || busyId === clinic.id} aria-label={`Eliminar ${clinic.nombre}`} title="Eliminar consultorio"><Icon name="trash" /></button>
            </div>
          </article>
        ))}</div> : <EmptyState icon="tooth" title="Sin consultorios" text="Invita un correo para crear el primero." />}
      </section>
    </div>

    <section className="settings-card admin-users-card">
      <div className="settings-card-head"><span><Icon name="users" /></span><div><h2>Usuarios ({users.length})</h2><p>Activa, suspende o elimina cuentas de cualquier consultorio.</p></div></div>
      <div className="filter-row admin-filters">
        <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} aria-label="Filtrar por estado">
          {stateOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por correo, nombre o consultorio" aria-label="Buscar usuarios" />
      </div>
      {users.length ? <div className="admin-list">{users.map((user) => (
        <article key={user.id}>
          <div>
            <strong>{user.nombre}</strong>
            <small>{user.email} · {user.consultorio || 'Sin consultorio'} · rol {user.rol}</small>
            <small>{user.ultimo_acceso_en ? `Último acceso ${formatDate(user.ultimo_acceso_en)}` : 'Nunca ingresó'}</small>
          </div>
          <StatusPill status={user.estado} />
          <div className="row-actions">
            {user.estado === 'suspendido'
              ? <button onClick={() => changeState(user, 'activo')} disabled={saving} aria-label={`Activar a ${user.email}`} title="Activar"><Icon name="check" /></button>
              : <button onClick={() => changeState(user, 'suspendido')} disabled={saving} aria-label={`Suspender a ${user.email}`} title="Suspender"><Icon name="close" /></button>}
            <button onClick={() => removeUser(user)} disabled={saving} aria-label={`Eliminar a ${user.email}`} title="Eliminar"><Icon name="trash" /></button>
          </div>
        </article>
      ))}</div> : <EmptyState icon="users" title="Sin resultados" text="Ajusta los filtros o invita un correo nuevo." />}
    </section>

    {detail && (
      <Modal title={`Detalle: ${detail.clinic.nombre}`} onClose={() => setDetail(null)}>
        {detail.loading ? <p>Cargando…</p> : detail.error ? <ErrorState message={detail.error} /> : (
          <div className="detail-content">
            <section className="detail-section">
              <h3>Próximas citas</h3>
              {detail.proximas_citas?.length ? detail.proximas_citas.map((appoint) => (
                <article key={appoint.id}><strong>{formatDate(appoint.inicio)} · {appoint.servicio}</strong><small>{appoint.paciente}</small><StatusPill status={appoint.estado} /></article>
              )) : <p className="muted-box">Sin citas futuras</p>}
            </section>
            <section className="detail-section">
              <h3>Últimos pagos</h3>
              {detail.ultimos_pagos?.length ? detail.ultimos_pagos.map((payment) => (
                <article key={payment.id}><strong>{formatMoney(payment.monto_bs)} · {payment.metodo}</strong><small>{payment.paciente} · {formatDate(payment.creado_en)}</small></article>
              )) : <p className="muted-box">Sin pagos</p>}
            </section>
            <p className="muted-box">Evidencias almacenadas: {detail.archivos || 0}</p>
          </div>
        )}
      </Modal>
    )}

    {resetting && (
      <Modal title={`Reiniciar ${resetting.nombre}`} onClose={() => setResetting(null)}>
        <p>Esto vaciará pacientes, citas, registros, notas, pagos y auditoría del consultorio. Se conservan usuarios, servicios, horarios y configuración.</p>
        <p><strong>Antes se guarda un snapshot completo</strong> (base + evidencias) en backups del servidor, por seguridad.</p>
        <div className="modal-actions">
          <button className="button button-ghost" onClick={() => setResetting(null)} disabled={saving}>Cancelar</button>
          <button className="button button-primary danger" onClick={resetClinic} disabled={saving}>Reiniciar a cero</button>
        </div>
      </Modal>
    )}

    <Toast message={message} onClose={() => setMessage('')} />
  </>
}