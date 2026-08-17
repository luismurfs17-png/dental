import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatDate, formatTime, unwrap } from '../../lib/api.js'
import { useRemote } from '../../hooks/useRemote.js'
import { EmptyState, ErrorState, Field, Loading, Modal, PageHeader } from '../../components/UI.jsx'

const EMPTY_FILTERS = { usuario_id: '', paciente_id: '', accion: '', desde: '', hasta: '' }
const ACTIONS = [
  ['crear', 'Creación'], ['actualizar', 'Actualización'], ['eliminar_logico', 'Archivo'],
  ['cancelar', 'Cancelación'], ['reprogramar', 'Reprogramación'], ['verificar', 'Verificación'],
  ['cambiar_estado', 'Cambio de estado'], ['actualizar_perfil', 'Actualización de perfil'],
  ['actualizar_qr', 'Actualización de QR'], ['invitar', 'Invitación'],
]

export default function Audit() {
  const navigate = useNavigate()
  const usersRemote = useRemote('/usuarios')
  const patientsRemote = useRemote('/pacientes')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [patientSearch, setPatientSearch] = useState('')
  const [limit, setLimit] = useState(50)
  const [applied, setApplied] = useState(EMPTY_FILTERS)
  const [selected, setSelected] = useState(null)
  const query = useMemo(() => {
    const params = new URLSearchParams({ limite: String(limit) })
    Object.entries(applied).forEach(([key, value]) => value && params.set(key, value))
    return `/auditoria?${params}`
  }, [applied, limit])
  const auditRemote = useRemote(query)
  const users = unwrap(usersRemote.data, 'usuarios')
  const patients = unwrap(patientsRemote.data, 'pacientes')
  const rows = unwrap(auditRemote.data, 'auditoria')
  const total = Number(auditRemote.data?.total ?? auditRemote.data?.paginacion?.total)
  const matches = patients.filter((patient) => patientLabel(patient).toLocaleLowerCase('es').includes(patientSearch.toLocaleLowerCase('es'))).slice(0, 8)

  function choosePatient(patient) {
    setFilters((current) => ({ ...current, paciente_id: String(patient.id) }))
    setPatientSearch(patientLabel(patient))
  }
  function apply(event) { event.preventDefault(); setLimit(50); setApplied({ ...filters }) }
  function clear() { setFilters(EMPTY_FILTERS); setApplied(EMPTY_FILTERS); setPatientSearch(''); setLimit(50) }

  return <>
    <PageHeader eyebrow="SEGURIDAD Y TRAZABILIDAD" title="Auditoría" description="Consulta la actividad registrada por el equipo clínico." />
    <form className="audit-filters" onSubmit={apply}>
      <Field label="Usuario"><select value={filters.usuario_id} onChange={(event) => setFilters({ ...filters, usuario_id: event.target.value })}><option value="">Todos</option>{users.map((user) => <option key={user.id} value={user.id}>{user.nombre} ({user.rol})</option>)}</select></Field>
      <Field label="Paciente"><div className="patient-search-control"><input value={patientSearch} onChange={(event) => { setPatientSearch(event.target.value); setFilters({ ...filters, paciente_id: '' }) }} placeholder="Código o nombre" autoComplete="off" />{patientSearch && !filters.paciente_id && <div className="patient-suggestions">{matches.map((patient) => <button type="button" key={patient.id} onClick={() => choosePatient(patient)}><strong>{patient.codigo}</strong><span>{patient.nombres} {patient.apellidos}</span></button>)}{!matches.length && <small>Sin coincidencias</small>}</div>}</div></Field>
      <Field label="Acción"><select value={filters.accion} onChange={(event) => setFilters({ ...filters, accion: event.target.value })}><option value="">Todas</option>{ACTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
      <Field label="Desde"><input type="date" value={filters.desde} onChange={(event) => setFilters({ ...filters, desde: event.target.value })} /></Field>
      <Field label="Hasta"><input type="date" value={filters.hasta} onChange={(event) => setFilters({ ...filters, hasta: event.target.value })} /></Field>
      <div className="audit-filter-actions"><button className="button button-primary" type="submit">Aplicar</button><button className="button button-ghost" type="button" onClick={clear}>Limpiar</button></div>
    </form>
    {auditRemote.loading ? <Loading label="Consultando actividad" /> : auditRemote.error ? <ErrorState message={auditRemote.error} onRetry={auditRemote.reload} /> : rows.length ? <>
      <div className="audit-table-scroll" tabIndex="0" aria-label="Registro de auditoría, desplácese horizontalmente"><div className="audit-table"><div className="audit-table-head"><span>Fecha / hora</span><span>Usuario</span><span>Acción</span><span>Entidad</span><span>Paciente</span><span>IP / detalles</span></div>{rows.map((row) => { const patient = patientFor(row, patients); const citaLink = citaAgendaLink(row); return <button className="audit-row" type="button" key={row.id} onClick={() => (citaLink ? navigate(citaLink) : setSelected(row))} title={citaLink ? 'Abrir esta cita en la agenda' : 'Ver detalle'}><span><strong>{formatDate(row.creado_en)}</strong><small>{formatTime(row.creado_en)}</small></span><span><strong>{row.usuario || 'Sistema'}</strong><small>#{row.usuario_id || 'N/A'}</small></span><span className="audit-action">{actionLabel(row.accion)}</span><span><strong>{row.entidad_tipo || 'Sin entidad'}</strong><small>#{row.entidad_id || 'N/A'}</small></span><span>{patient ? <><strong className="patient-code">{patient.codigo}</strong><small>{patient.nombres} {patient.apellidos}</small></> : <small>Sin paciente asociado</small>}</span><span><strong>{row.ip || 'No registrada'}</strong><small>Ver datos</small></span></button> })}</div></div>
      {(Number.isFinite(total) ? rows.length < total : rows.length >= limit) && <div className="load-more"><button className="button button-ghost" onClick={() => setLimit((value) => value + 50)}>Cargar más{Number.isFinite(total) ? ` (${rows.length} de ${total})` : ''}</button></div>}
    </> : <EmptyState icon="history" title="Sin actividad" text="No hay eventos que coincidan con estos filtros." />}
    {selected && <Modal title="Detalle de auditoría" onClose={() => setSelected(null)}><dl className="audit-detail"><div><dt>Acción</dt><dd>{actionLabel(selected.accion)}</dd></div><div><dt>Usuario</dt><dd>{selected.usuario || 'Sistema'}</dd></div><div><dt>Entidad</dt><dd>{selected.entidad_tipo} #{selected.entidad_id || 'N/A'}</dd></div><div><dt>IP</dt><dd>{selected.ip || 'No registrada'}</dd></div></dl><pre className="json-detail">{prettyJson(selected.datos_json)}</pre></Modal>}
  </>
}

function patientLabel(patient) { return `${patient.codigo || 'S/C'} - ${patient.nombres} ${patient.apellidos}`.trim() }
function citaAgendaLink(row) {
  if (row.entidad_tipo !== 'cita' || !row.entidad_id) return null
  const data = parsedData(row.datos_json)
  const inicio = data.inicio || data.despues?.inicio || data.antes?.inicio
  if (!inicio) return `/agenda?cita=${row.entidad_id}`
  const date = new Date(inicio)
  const fecha = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return `/agenda?cita=${row.entidad_id}&fecha=${fecha}`
}
function actionLabel(action) { return ACTIONS.find(([value]) => value === action)?.[1] || String(action || 'Sin acción').replaceAll('_', ' ') }
function parsedData(value) {
  if (value && typeof value === 'object') return value
  try {
    const parsed = JSON.parse(value || '{}')
    return parsed && typeof parsed === 'object' ? parsed : { valor: parsed }
  } catch {
    return { valor_original: String(value || '') }
  }
}
function prettyJson(value) { const data = parsedData(value); return Object.keys(data).length ? JSON.stringify(data, null, 2) : 'Sin datos adicionales.' }
function patientFor(row, patients) {
  if (row.paciente_codigo || row.paciente_nombres || row.paciente_apellidos) {
    return { codigo: row.paciente_codigo || 'S/C', nombres: row.paciente_nombres || '', apellidos: row.paciente_apellidos || '' }
  }
  const data = parsedData(row.datos_json)
  const patientId = row.paciente_id ?? (row.entidad_tipo === 'paciente' ? row.entidad_id : data.paciente_id ?? data.paciente?.id)
  const known = patients.find((patient) => String(patient.id) === String(patientId))
  if (known) return known
  if (data.paciente && typeof data.paciente === 'object') return data.paciente
  if (data.codigo || data.nombres || data.nombre_paciente) return { codigo: data.codigo || 'S/C', nombres: data.nombres || data.nombre_paciente || '', apellidos: data.apellidos || '' }
  return null
}
