import { useEffect, useState } from 'react'
import { api, unwrap } from '../../lib/api.js'
import { useRemote } from '../../hooks/useRemote.js'
import { useAuth } from '../../context/AuthContext.jsx'
import Icon from '../../components/Icon.jsx'
import { ErrorState, Field, Loading, PageHeader, Toast } from '../../components/UI.jsx'

const weekdays = [
  { dia_semana: 1, dia: 'lunes' }, { dia_semana: 2, dia: 'martes' }, { dia_semana: 3, dia: 'miércoles' },
  { dia_semana: 4, dia: 'jueves' }, { dia_semana: 5, dia: 'viernes' }, { dia_semana: 6, dia: 'sábado' },
  { dia_semana: 0, dia: 'domingo' },
]

export default function Settings() {
  const { user, setUser } = useAuth()
  const clinicRemote = useRemote('/consultorio')
  const hoursRemote = useRemote('/horarios')
  const usersRemote = useRemote('/usuarios')
  const [clinic, setClinic] = useState({})
  const [hours, setHours] = useState([])
  const [invite, setInvite] = useState({ nombre: '', email: '', rol: 'operativo' })
  const [qrFile, setQrFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => setClinic(clinicRemote.data?.consultorio || {}), [clinicRemote.data])
  useEffect(() => {
    const loaded = unwrap(hoursRemote.data, 'horarios')
    setHours(weekdays.map((day) => {
      const item = loaded.find((entry) => entry.dia_semana === day.dia_semana)
      return { ...day, id: item?.id, activo: Boolean(item), hora_inicio: item?.hora_inicio || '08:00', hora_fin: item?.hora_fin || '18:00' }
    }))
  }, [hoursRemote.data])

  if (clinicRemote.loading || hoursRemote.loading) return <Loading label="Cargando el consultorio" />
  if (clinicRemote.error || hoursRemote.error) return <ErrorState message={clinicRemote.error || hoursRemote.error} onRetry={() => { clinicRemote.reload(); hoursRemote.reload() }} />

  async function saveClinic(event) {
    event.preventDefault(); setSaving(true)
    try {
      const result = await api('/consultorio', { method: 'PATCH', body: clinic })
      setClinic(result.consultorio); setUser({ ...user, consultorio: result.consultorio }); setMessage('Información actualizada.')
    } catch (error) { setMessage(error.message) } finally { setSaving(false) }
  }

  async function saveHours() {
    setSaving(true)
    try {
      await Promise.all(unwrap(hoursRemote.data, 'horarios').map((item) => api(`/horarios/${item.id}`, { method: 'DELETE' })))
      for (const item of hours.filter((entry) => entry.activo)) {
        await api('/horarios', { method: 'POST', body: { dia_semana: item.dia_semana, hora_inicio: item.hora_inicio, hora_fin: item.hora_fin } })
      }
      await hoursRemote.reload(); setMessage('Horarios actualizados.')
    } catch (error) { setMessage(error.message) } finally { setSaving(false) }
  }

  async function uploadQr() {
    if (!qrFile) return
    setSaving(true)
    const body = new FormData(); body.append('imagen', qrFile)
    try {
      const result = await api('/consultorio/qr', { method: 'POST', body })
      setClinic({ ...clinic, qr_url: result.qr_url }); setQrFile(null); setMessage('QR de pagos actualizado.')
    } catch (error) { setMessage(error.message) } finally { setSaving(false) }
  }

  async function sendInvite(event) {
    event.preventDefault(); setSaving(true)
    try {
      await api('/usuarios/invitaciones', { method: 'POST', body: invite })
      setInvite({ nombre: '', email: '', rol: 'operativo' }); usersRemote.reload(); setMessage('Invitación operativa registrada.')
    } catch (error) { setMessage(error.message) } finally { setSaving(false) }
  }

  return <><PageHeader eyebrow="ADMINISTRACIÓN" title="Tu consultorio" description="Identidad, disponibilidad, equipo y medios de pago." /><div className="settings-grid">
    <form className="settings-card" onSubmit={saveClinic}><div className="settings-card-head"><span><Icon name="settings" /></span><div><h2>Información general</h2><p>Datos visibles para pacientes.</p></div></div><Field label="Nombre"><input value={clinic.nombre || ''} onChange={(e) => setClinic({ ...clinic, nombre: e.target.value })} required /></Field><Field label="Teléfono"><input value={clinic.telefono || ''} onChange={(e) => setClinic({ ...clinic, telefono: e.target.value })} /></Field><Field label="Dirección"><input value={clinic.direccion || ''} onChange={(e) => setClinic({ ...clinic, direccion: e.target.value })} /></Field><button className="button button-primary" disabled={saving}>Guardar información</button></form>
    <section className="settings-card hours-card"><div className="settings-card-head"><span><Icon name="clock" /></span><div><h2>Horarios de atención</h2><p>Disponibilidad del doctor actual.</p></div></div><div className="hours-list">{hours.map((item, index) => <div key={item.dia_semana}><label className="mini-toggle"><input type="checkbox" checked={item.activo} onChange={(e) => setHours(hours.map((x, i) => i === index ? { ...x, activo: e.target.checked } : x))} /><i /></label><strong>{item.dia}</strong>{item.activo ? <><input type="time" value={item.hora_inicio} onChange={(e) => setHours(hours.map((x, i) => i === index ? { ...x, hora_inicio: e.target.value } : x))} /><span>a</span><input type="time" value={item.hora_fin} onChange={(e) => setHours(hours.map((x, i) => i === index ? { ...x, hora_fin: e.target.value } : x))} /></> : <em>Cerrado</em>}</div>)}</div><button className="button button-primary" onClick={saveHours} disabled={saving}>Guardar horarios</button></section>
    <section className="settings-card"><div className="settings-card-head"><span><Icon name="qr" /></span><div><h2>QR de pagos</h2><p>Visible para todos tus pacientes.</p></div></div><div className="qr-setting-body">{clinic.qr_url ? <img src={clinic.qr_url} alt="QR del consultorio" /> : <div className="qr-small-placeholder"><Icon name="qr" size={48} /></div>}<label className="file-button"><Icon name="upload" /><span>{qrFile?.name || 'Seleccionar imagen'}</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setQrFile(e.target.files[0])} /></label></div><button className="button button-primary" onClick={uploadQr} disabled={saving || !qrFile}>Subir QR</button></section>
    <form className="settings-card" onSubmit={sendInvite}><div className="settings-card-head"><span><Icon name="users" /></span><div><h2>Equipo operativo</h2><p>Preautoriza acceso por correo.</p></div></div><Field label="Nombre"><input value={invite.nombre} onChange={(e) => setInvite({ ...invite, nombre: e.target.value })} required /></Field><Field label="Correo"><input type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} required /></Field><button className="button button-primary" disabled={saving}>Invitar operativo</button><small>{unwrap(usersRemote.data, 'usuarios').filter((item) => item.rol === 'operativo').length} usuarios operativos registrados</small></form>
  </div><Toast message={message} onClose={() => setMessage('')} /></>
}
