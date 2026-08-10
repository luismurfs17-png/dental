import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  formatDate,
  formatMoney,
  formatTime,
  unwrap,
} from "../../lib/api.js";
import { useRemote } from "../../hooks/useRemote.js";
import { useAuth } from "../../context/AuthContext.jsx";
import Icon from "../../components/Icon.jsx";
import {
  EmptyState,
  ErrorState,
  Field,
  Loading,
  Metric,
  Modal,
  PageHeader,
  StatusPill,
  Toast,
} from "../../components/UI.jsx";
import { emailUrl, whatsappUrl } from "../../lib/contact.js";

export function Agenda() {
  const { user } = useAuth();
  const [viewMode, setViewMode] = useState('week');
  const [week, setWeek] = useState(() => mondayOf(new Date()));
  const days = Array.from({ length: viewMode === 'week' ? 7 : viewMode === 'biweek' ? 14 : 28 }, (_, index) => addDays(week, index));
  const rangeEnd = viewMode === 'week' ? 7 : viewMode === 'biweek' ? 14 : 28;
  const { data, loading, error, reload } = useRemote(
    `/citas?desde=${encodeURIComponent(week.toISOString())}&hasta=${encodeURIComponent(addDays(week, rangeEnd).toISOString())}`,
  );
  const servicesRemote = useRemote("/servicios");
  const doctorsRemote = useRemote("/doctores");
  const patientsRemote = useRemote("/pacientes");
  const [selectedState, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(null);
  const [dragOverDay, setDragOverDay] = useState(null);
  const [editSlots, setEditSlots] = useState([]);
  const [editSlotsLoading, setEditSlotsLoading] = useState(false);
  const selected = editing ? null : selectedState;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const appointments = unwrap(data, "citas");
  const services = unwrap(servicesRemote.data, "servicios");
  const doctors = unwrap(doctorsRemote.data, "doctores");
  const patients = unwrap(patientsRemote.data, "pacientes");
  const editDate = editing ? String(editing.inicio_local || "").slice(0, 10) : "";
  useEffect(() => {
    if (!editing || !editDate || !editing.servicio_id || !editing.doctor_id) { setEditSlots([]); return; }
    let active = true;
    setEditSlotsLoading(true);
    api(`/disponibilidad?fecha=${encodeURIComponent(editDate)}&servicio_id=${encodeURIComponent(editing.servicio_id)}&doctor_id=${encodeURIComponent(editing.doctor_id)}`)
      .then((result) => { if (active) setEditSlots(Array.isArray(result?.horarios) ? result.horarios : []); })
      .catch(() => { if (active) setEditSlots([]); })
      .finally(() => { if (active) setEditSlotsLoading(false); });
    return () => { active = false; };
  }, [editing, editDate]);
  function openCreate(start = defaultAppointmentStart(week)) {
    setCreating({
      paciente_id: "",
      doctor_id: user?.rol === "doctor" ? user.id : doctors[0]?.id || "",
      servicio_id: services[0]?.id || "",
      inicio_local: toLocalInput(start),
      motivo: "",
      notas: "",
    });
  }
  function openCreateAt(day, event) {
    if (event.target !== event.currentTarget) return;
    const offset = event.clientY - event.currentTarget.getBoundingClientRect().top;
    const minutes = Math.min(660, Math.max(0, Math.round(offset / 30) * 30));
    const start = calendarStart(day, minutes);
    openCreate(start);
  }
  async function createAppointment(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await api("/citas", {
        method: "POST",
        body: {
          paciente_id: Number(creating.paciente_id),
          doctor_id: Number(creating.doctor_id),
          servicio_id: Number(creating.servicio_id),
          inicio: new Date(creating.inicio_local).toISOString(),
          motivo: creating.motivo,
          notas: creating.notas,
        },
      });
      setCreating(null);
      setMessage("Visita añadida a la agenda.");
      reload();
    } catch (requestError) {
      setMessage(requestError.message);
    } finally {
      setBusy(false);
    }
  }
  async function changeStatus(estado) {
    setBusy(true);
    try {
      await api(`/citas/${selected.id}/estado`, {
        method: "PATCH",
        body: { estado },
      });
      setSelected(null);
      reload();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function saveAppointment(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await api(`/citas/${editing.id}`, {
        method: "PATCH",
        body: {
          doctor_id: editing.doctor_id,
          servicio_id: editing.servicio_id,
          inicio: new Date(editing.inicio_local).toISOString(),
          fin: new Date(new Date(editing.inicio_local).getTime() + Number(editing.duracion_min || 30) * 60000).toISOString(),
          motivo: editing.motivo,
          notas: editing.notas,
        },
      });
      setEditing(null);
      setSelected(null);
      setMessage("Cita actualizada.");
      reload();
    } catch (requestError) {
      setMessage(requestError.message);
    } finally {
      setBusy(false);
    }
  }
  async function dropAppointment(event, day) {
    event.preventDefault();
    setDragOverDay(null);
    const appointmentId = Number(event.dataTransfer.getData("text/plain"));
    const appointment = appointments.find((item) => item.id === appointmentId);
    if (!appointment) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const offset = event.clientY - rect.top;
    const minutes = Math.min(660, Math.max(0, Math.round(offset / 30) * 30));
    const start = calendarStart(day, minutes);
    if (sameDay(new Date(appointment.inicio), day) && formatTime(appointment.inicio) === formatTime(start.toISOString())) return;
    setBusy(true);
    try {
      await api(`/citas/${appointmentId}`, {
        method: "PATCH",
        body: { inicio: start.toISOString() },
      });
      setMessage("Cita reprogramada.");
      reload();
    } catch (requestError) {
      setMessage(requestError.message);
    } finally {
      setBusy(false);
    }
  }
  async function archiveAppointment() {
    if (!window.confirm("¿Archivar esta cita? Permanecerá en auditoría."))
      return;
    try {
      await api(`/citas/${selected.id}`, { method: "DELETE" });
      setSelected(null);
      setMessage("Cita archivada.");
      reload();
    } catch (requestError) {
      setMessage(requestError.message);
    }
  }
  const currentWeek = mondayOf(new Date()).getTime() === week.getTime();
  return (
    <>
      <PageHeader
        eyebrow="OPERACIÓN SEMANAL"
        title="Agenda clínica"
        description={`${appointments.length} citas del ${formatDate(days[0], { short: true })} al ${formatDate(days[6])}.`}
        action={<button className="button button-coral" onClick={() => openCreate()}><Icon name="plus" /> Nueva visita</button>}
      />
      <section className="agenda-toolbar" aria-label="Navegación de agenda">
        <select
          className="button button-small button-ghost"
          value={viewMode}
          onChange={(e) => setViewMode(e.target.value)}
          aria-label="Modo de vista"
        >
          <option value="week">Semana</option>
          <option value="biweek">2 semanas</option>
          <option value="month">Mes</option>
        </select>
        <button
          className="icon-button"
          onClick={() => setWeek(addDays(week, -rangeEnd))}
          aria-label="Período anterior"
          title="Período anterior"
        >
          <Icon name="chevronLeft" />
        </button>
        <button
          className={`button button-small ${currentWeek ? "button-primary" : "button-ghost"}`}
          onClick={() => setWeek(mondayOf(new Date()))}
        >
          Hoy
        </button>
        <button
          className="icon-button"
          onClick={() => setWeek(addDays(week, rangeEnd))}
          aria-label="Período siguiente"
          title="Período siguiente"
        >
          <Icon name="chevronRight" />
        </button>
        <span>
          {formatDate(days[0])} - {formatDate(days[days.length - 1])}
        </span>
      </section>
      <section className="metrics-grid agenda-metrics">
        <Metric
          label="Citas"
          value={appointments.length}
          note="En la semana"
          icon="calendar"
        />
        <Metric
          label="Confirmadas"
          value={
            appointments.filter((item) => item.estado === "confirmada").length
          }
          note="Pendientes de atención"
          icon="check"
        />
        <Metric
          label="Atendidas"
          value={
            appointments.filter((item) => item.estado === "atendida").length
          }
          note="Trabajo completado"
          icon="tooth"
        />
        <Metric
          label="Por definir"
          value={
            appointments.filter(
              (item) => item.estado === "atendida" && item.precio_bs === null,
            ).length
          }
          note="Atendidas sin precio"
          icon="wallet"
          tone="warm"
        />
      </section>
      {loading ? (
        <Loading label="Organizando la semana" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <div
          className="weekly-calendar-scroll"
          tabIndex="0"
          aria-label="Calendario de agenda, desplácese horizontalmente"
        >
          <div className="weekly-calendar" style={{ gridTemplateColumns: `65px repeat(${days.length}, minmax(${days.length > 7 ? 96 : 125}px, 1fr))` }}>
            <div className="calendar-corner">HORA</div>
            {days.map((day) => (
              <div
                className={`calendar-day-head ${sameDay(day, new Date()) ? "today" : ""}`}
                key={day.toISOString()}
              >
                <span>
                  {new Intl.DateTimeFormat("es-BO", {
                    weekday: "short",
                  }).format(day)}
                </span>
                <strong>{day.getDate()}</strong>
              </div>
            ))}
            <div className="time-rail">
              {Array.from({ length: 12 }, (_, index) => (
                <span key={index}>{String(index + 8).padStart(2, "0")}:00</span>
              ))}
            </div>
            {days.map((day) => (
              <div
                className={`calendar-day-column ${dragOverDay && sameDay(dragOverDay, day) ? "drop-target" : ""}`}
                key={day.toISOString()}
                onClick={(event) => openCreateAt(day, event)}
                onDragOver={(event) => { event.preventDefault(); setDragOverDay(day); }}
                onDragLeave={() => setDragOverDay(null)}
                onDrop={(event) => dropAppointment(event, day)}
                title="Haz clic en un horario vacío o arrastra una cita aquí"
              >
                {appointments
                  .filter((item) => sameDay(new Date(item.inicio), day))
                  .map((item, index) => (
                    <button
                      key={item.id}
                      draggable
                      onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.setData("text/plain", String(item.id)); event.dataTransfer.effectAllowed = "move"; }}
                      className={`calendar-appointment state-${item.estado} tone-${index % 4}`}
                      style={appointmentPosition(item)}
                      onClick={(event) => { event.stopPropagation(); setSelected(item); }}
                      aria-label={`${formatTime(item.inicio)} a ${formatTime(item.fin)}, ${item.nombres} ${item.apellidos}, ${item.servicio}. Arrastra para reprogramar`}
                      title="Clic para acciones, arrastra para reprogramar"
                    >
                      <time>{formatTime(item.inicio)} - {formatTime(item.fin)}</time>
                      <strong>
                        {item.nombres} {item.apellidos}
                      </strong>
                      <span>{item.servicio}</span>
                    </button>
                  ))}
              </div>
            ))}
          </div>
        </div>
      )}
      {selected && (
        <Modal title="Acciones de la cita" onClose={() => setSelected(null)}>
          <div className="appointment-detail operational">
            <div className="modal-avatar">
              {initials(`${selected.nombres} ${selected.apellidos}`)}
            </div>
            <h3>
              {selected.nombres} {selected.apellidos}
            </h3>
            <StatusPill status={selected.estado} />
            <dl>
              <div>
                <dt>Servicio</dt>
                <dd>{selected.servicio}</dd>
              </div>
              <div>
                <dt>Horario</dt>
                <dd>
                  {formatDate(selected.inicio)} · {formatTime(selected.inicio)}{" "}
                  - {formatTime(selected.fin)}
                </dd>
              </div>
              <div>
                <dt>Doctor</dt>
                <dd>{selected.doctor}</dd>
              </div>
            </dl>
            <div className="contact-actions">
              {selected.telefono && (
                <a
                  className="button button-ghost button-small"
                  href={whatsappUrl(selected.telefono, selected.nombres)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Icon name="whatsapp" /> WhatsApp
                </a>
              )}
              {selected.email && (
                <a
                  className="button button-ghost button-small"
                  href={emailUrl(selected.email, selected.nombres)}
                >
                  <Icon name="email" /> Email
                </a>
              )}
              <Link
                className="button button-ghost button-small"
                to={`/pacientes/${selected.paciente_id}`}
              >
                <Icon name="file" /> Ficha
              </Link>
            </div>
            <div className="status-action-grid">
              {["confirmada", "atendida", "no_asistio", "cancelada"].map(
                (estado) => (
                  <button
                    key={estado}
                    className="button button-primary button-small"
                    disabled={busy || estado === selected.estado}
                    onClick={() => changeStatus(estado)}
                  >
                    {statusLabel(estado)}
                  </button>
                ),
              )}
            </div>
            <button
              className="button button-coral button-wide"
              onClick={() =>
                  setEditing({
                    ...selected,
                    inicio_local: toLocalInput(selected.inicio),
                    duracion_min: Math.round((new Date(selected.fin).getTime() - new Date(selected.inicio).getTime()) / 60000),
                  })
              }
            >
              <Icon name="edit" /> Editar o reprogramar
            </button>
            {user?.rol === "doctor" && (
              <button
                className="button button-ghost button-wide danger"
                onClick={archiveAppointment}
              >
                <Icon name="trash" /> Archivar cita
              </button>
            )}
          </div>
        </Modal>
      )}
      {editing && (
        <Modal title="Editar o reprogramar" onClose={() => setEditing(null)}>
          <form className="modal-form" onSubmit={saveAppointment}>
            <Field label="Fecha y hora">
              <input
                type="datetime-local"
                value={editing.inicio_local}
                onChange={(event) =>
                  setEditing({ ...editing, inicio_local: event.target.value })
                }
                required
              />
            </Field>
            <Field label="Duración">
              <select
                value={editing.duracion_min || 30}
                onChange={(event) => setEditing({ ...editing, duracion_min: Number(event.target.value) })}
              >
                {!([30, 60].includes(Number(editing.duracion_min))) && <option value={editing.duracion_min}>{editing.duracion_min} minutos</option>}
                <option value="30">30 minutos</option>
                <option value="60">1 hora</option>
              </select>
            </Field>
            <div className="availability-panel">
              <div className="availability-head">
                <strong>Disponibilidad del doctor</strong>
                <span className="slot-legend"><span><i className="available" /> Libre</span><span><i className="occupied" /> Ocupado</span></span>
              </div>
              {editSlotsLoading ? (
                <div className="inline-loading">Buscando horarios…</div>
              ) : editSlots.length ? (
                <div className="time-slots">
                  {editSlots.map((slot) => {
                    const occupied = slot.estado === "ocupado";
                    const current = new Date(slot.inicio).toISOString() === new Date(editing.inicio_local).toISOString();
                    return (
                      <label key={slot.inicio} className={`${occupied ? "occupied" : ""} ${current ? "selected" : ""}`}>
                        <input type="radio" name="edit-slot" disabled={occupied} checked={current} onChange={() => setEditing({ ...editing, inicio_local: toLocalInput(slot.inicio) })} />
                        <strong>{formatTime(slot.inicio)}</strong>
                        {occupied && <small>Ocupado</small>}
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p className="muted-box">Sin horarios para este día. Ajusta la fecha o el doctor.</p>
              )}
            </div>
            <Field label="Servicio">
              <select
                value={editing.servicio_id}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    servicio_id: Number(event.target.value),
                  })
                }
                required
              >
                {unwrap(servicesRemote.data, "servicios").map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.nombre}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Doctor">
              <select
                value={editing.doctor_id}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    doctor_id: Number(event.target.value),
                  })
                }
                disabled={user?.rol === "doctor"}
                required
              >
                {unwrap(doctorsRemote.data, "doctores").map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>
                    {doctor.nombre}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Motivo">
              <input
                value={editing.motivo || ""}
                onChange={(event) =>
                  setEditing({ ...editing, motivo: event.target.value })
                }
              />
            </Field>
            <Field label="Notas">
              <textarea
                rows="3"
                value={editing.notas || ""}
                onChange={(event) =>
                  setEditing({ ...editing, notas: event.target.value })
                }
              />
            </Field>
            <button className="button button-primary" disabled={busy}>
              Guardar cambios
            </button>
          </form>
        </Modal>
      )}
      {creating && (
        <Modal title="Nueva visita" onClose={() => setCreating(null)}>
          <form className="modal-form" onSubmit={createAppointment}>
            <Field label="Paciente">
              <select value={creating.paciente_id} onChange={(event) => setCreating({ ...creating, paciente_id: event.target.value })} required>
                <option value="">Selecciona por código o nombre</option>
                {patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.codigo} - {patient.nombres} {patient.apellidos}</option>)}
              </select>
            </Field>
            <Field label="Fecha y hora">
              <input type="datetime-local" value={creating.inicio_local} onChange={(event) => setCreating({ ...creating, inicio_local: event.target.value })} required />
            </Field>
            <Field label="Servicio">
              <select value={creating.servicio_id} onChange={(event) => setCreating({ ...creating, servicio_id: event.target.value })} required>
                <option value="">Selecciona un tratamiento</option>
                {services.map((service) => <option key={service.id} value={service.id}>{service.nombre} · {service.duracion_min} min</option>)}
              </select>
            </Field>
            <Field label="Doctor">
              <select value={creating.doctor_id} onChange={(event) => setCreating({ ...creating, doctor_id: event.target.value })} disabled={user?.rol === "doctor"} required>
                <option value="">Selecciona un doctor</option>
                {doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.nombre}</option>)}
              </select>
            </Field>
            <Field label="Motivo"><input value={creating.motivo} onChange={(event) => setCreating({ ...creating, motivo: event.target.value })} placeholder="Control, dolor, seguimiento…" /></Field>
            <Field label="Notas"><textarea rows="3" value={creating.notas} onChange={(event) => setCreating({ ...creating, notas: event.target.value })} /></Field>
            <button className="button button-primary" disabled={busy || !creating.paciente_id || !creating.doctor_id || !creating.servicio_id}>{busy ? "Guardando…" : "Añadir a la agenda"}</button>
          </form>
        </Modal>
      )}
      <Toast message={message} onClose={() => setMessage("")} />
    </>
  );
}

export function Patients() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("todos");
  const { data, loading, error, reload } = useRemote(
    `/pacientes${search ? `?buscar=${encodeURIComponent(search)}` : ""}`,
  );
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const patients = unwrap(data, "pacientes");
  const visible = patients.filter((patient) =>
    filter === "contacto"
      ? patient.telefono || patient.email
      : filter === "saldo"
        ? Number(patient.saldo_bs) > 0
        : filter === "sin_cita"
          ? !patient.ultima_cita
          : true,
  );
  async function savePatient(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await api(editing.id ? `/pacientes/${editing.id}` : "/pacientes", {
        method: editing.id ? "PATCH" : "POST",
        body: editing,
      });
      setEditing(null);
      setMessage(editing.id ? "Paciente actualizado." : "Paciente creado.");
      reload();
    } catch (requestError) {
      setMessage(requestError.message);
    } finally {
      setSaving(false);
    }
  }
  async function archivePatient(patient) {
    if (
      !window.confirm(
        `¿Archivar la ficha de ${patient.nombres} ${patient.apellidos}?`,
      )
    )
      return;
    try {
      await api(`/pacientes/${patient.id}`, { method: "DELETE" });
      setMessage("Paciente archivado.");
      reload();
    } catch (requestError) {
      setMessage(requestError.message);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="CRM OPERATIVO"
        title="Directorio de pacientes"
        description={`${visible.length} fichas visibles. Contacto, seguimiento y gestión en un solo lugar.`}
        action={
          <button
            className="button button-coral"
            onClick={() => setEditing(emptyPatient())}
          >
            <Icon name="plus" /> Nuevo paciente
          </button>
        }
      />
      <div className="crm-controls">
        <label className="search-box">
          <Icon name="search" />
          <input
            aria-label="Buscar pacientes"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Código, nombre, CI o teléfono…"
          />
        </label>
        <div className="filter-row" aria-label="Filtros de pacientes">
          {[
            ["todos", "Todos"],
            ["contacto", "Con contacto"],
            ["saldo", "Saldo pendiente"],
            ["sin_cita", "Sin citas"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={filter === value ? "active" : ""}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <Loading label="Buscando pacientes" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : visible.length ? (
        <div
          className="crm-table-scroll"
          tabIndex="0"
          aria-label="Directorio de pacientes, desplácese horizontalmente"
        >
          <div className="crm-table">
            <div className="crm-table-head">
              <span>Paciente</span>
              <span>Contacto</span>
              <span>Última cita</span>
              <span>Saldo</span>
              <span>Acciones</span>
            </div>
            {visible.map((patient) => {
              const name = `${patient.nombres} ${patient.apellidos}`.trim();
              return (
                <article className="crm-row" key={patient.id}>
                  <div className="crm-person">
                    <span className="avatar large">{initials(name)}</span>
                    <div>
                      <Link to={`/pacientes/${patient.id}`}>{name}</Link>
                      <small>
                        <strong className="patient-code">{patient.codigo}</strong> · CI{" "}
                        {patient.documento || "sin registrar"}
                      </small>
                    </div>
                  </div>
                  <div className="crm-contact">
                    <strong>{patient.telefono || "Sin teléfono"}</strong>
                    <small>{patient.email || "Sin correo"}</small>
                  </div>
                  <div>
                    <strong>
                      {patient.ultima_cita
                        ? formatDate(patient.ultima_cita)
                        : "Sin citas"}
                    </strong>
                    <small>
                      {patient.alergias
                        ? "Alergias registradas"
                        : "Sin alertas"}
                    </small>
                  </div>
                  <strong
                    className={Number(patient.saldo_bs) > 0 ? "coral-text" : ""}
                  >
                    {formatMoney(patient.saldo_bs)}
                  </strong>
                  <div className="row-actions">
                    {patient.telefono && (
                      <a
                        href={whatsappUrl(patient.telefono, patient.nombres)}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`WhatsApp a ${name}`}
                        title="WhatsApp"
                      >
                        <Icon name="whatsapp" />
                      </a>
                    )}
                    {patient.email && (
                      <a
                        href={emailUrl(patient.email, patient.nombres)}
                        aria-label={`Email a ${name}`}
                        title="Enviar email"
                      >
                        <Icon name="email" />
                      </a>
                    )}
                    <Link
                      to={`/pacientes/${patient.id}`}
                      aria-label={`Abrir ficha de ${name}`}
                      title="Abrir ficha"
                    >
                      <Icon name="file" />
                    </Link>
                    <button
                      onClick={() => setEditing({ ...patient })}
                      aria-label={`Editar a ${name}`}
                      title="Editar"
                    >
                      <Icon name="edit" />
                    </button>
                    {user?.rol === "doctor" && (
                      <button
                        className="danger"
                        onClick={() => archivePatient(patient)}
                        aria-label={`Archivar a ${name}`}
                        title="Archivar"
                      >
                        <Icon name="trash" />
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ) : (
        <EmptyState
          icon="users"
          title="No encontramos pacientes"
          text="Ajusta la búsqueda o los filtros."
          action={
            <button
              className="button button-primary"
              onClick={() => setEditing(emptyPatient())}
            >
              Crear paciente
            </button>
          }
        />
      )}
      {editing && (
        <Modal
          title={editing.id ? "Editar paciente" : "Nuevo paciente"}
          onClose={() => setEditing(null)}
        >
          <PatientForm
            patient={editing}
            setPatient={setEditing}
            onSubmit={savePatient}
            saving={saving}
          />
        </Modal>
      )}
      <Toast message={message} onClose={() => setMessage("")} />
    </>
  );
}

export function PatientForm({ patient, setPatient, onSubmit, saving }) {
  const { user } = useAuth();
  const field = (name) => ({
    value: patient[name] || "",
    onChange: (event) => setPatient({ ...patient, [name]: event.target.value }),
  });
  const codeField = (
    <Field label="Código del sistema anterior">
      <input
        inputMode="numeric"
        pattern="[0-9]+"
        maxLength="32"
        {...field("codigo")}
        required
      />
    </Field>
  );
  if (user?.rol === "operativo")
    return (
      <form className="modal-form patient-form" onSubmit={onSubmit}>
        {codeField}
        <div className="two-fields">
          <Field label="Nombres">
            <input {...field("nombres")} required />
          </Field>
          <Field label="Apellidos">
            <input {...field("apellidos")} required />
          </Field>
        </div>
        <div className="two-fields">
          <Field label="Teléfono">
            <input inputMode="tel" {...field("telefono")} />
          </Field>
          <Field label="Fecha de nacimiento">
            <input type="date" {...field("fecha_nacimiento")} />
          </Field>
        </div>
        <Field label="Documento / CI">
          <input {...field("documento")} />
        </Field>
        <Field label="Dirección">
          <input {...field("direccion")} />
        </Field>
        <div className="two-fields">
          <Field label="Contacto de emergencia">
            <input {...field("contacto_emergencia")} />
          </Field>
          <Field label="Teléfono de emergencia">
            <input inputMode="tel" {...field("telefono_emergencia")} />
          </Field>
        </div>
        <p className="muted-box">
          El doctor autoriza el correo de acceso y modifica los datos clínicos
          protegidos.
        </p>
        <button className="button button-primary" disabled={saving}>
          {patient.id ? "Guardar cambios" : "Crear paciente"}
        </button>
      </form>
    );
  return (
    <form className="modal-form patient-form" onSubmit={onSubmit}>
      {codeField}
      <div className="two-fields">
        <Field label="Nombres">
          <input {...field("nombres")} required />
        </Field>
        <Field label="Apellidos">
          <input {...field("apellidos")} required />
        </Field>
      </div>
      <div className="two-fields">
        <Field label="Email">
          <input type="email" {...field("email")} />
        </Field>
        <Field label="Teléfono">
          <input inputMode="tel" {...field("telefono")} />
        </Field>
      </div>
      <div className="two-fields">
        <Field label="Fecha de nacimiento">
          <input type="date" {...field("fecha_nacimiento")} />
        </Field>
        <Field label="Documento / CI">
          <input {...field("documento")} />
        </Field>
      </div>
      <Field label="Dirección">
        <input {...field("direccion")} />
      </Field>
      <div className="two-fields">
        <Field label="Contacto de emergencia">
          <input {...field("contacto_emergencia")} />
        </Field>
        <Field label="Teléfono de emergencia">
          <input inputMode="tel" {...field("telefono_emergencia")} />
        </Field>
      </div>
      <Field label="Alergias">
        <textarea rows="2" {...field("alergias")} />
      </Field>
      <Field label="Antecedentes">
        <textarea rows="2" {...field("antecedentes")} />
      </Field>
      <Field label="Medicamentos">
        <textarea rows="2" {...field("medicamentos")} />
      </Field>
      <Field label="Notas generales">
        <textarea rows="3" {...field("notas")} />
      </Field>
      <button className="button button-primary" disabled={saving}>
        {patient.id ? "Guardar cambios" : "Crear paciente"}
      </button>
    </form>
  );
}

export function Services() {
  const { data, loading, error, reload } = useRemote("/servicios");
  const clinicRemote = useRemote("/consultorio");
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const services = unwrap(data, "servicios");
  const modoCobro = clinicRemote.data?.consultorio?.modo_cobro || "mixto";
  const emptyService = {
    nombre: "",
    precio_bs: "",
    duracion_min: 30,
    descripcion: "",
  };
  async function save(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await api(editing.id ? `/servicios/${editing.id}` : "/servicios", {
        method: editing.id ? "PATCH" : "POST",
        body: editing,
      });
      setEditing(null);
      setMessage("Tratamiento guardado.");
      reload();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  }
  async function remove(service) {
    if (window.confirm(`¿Desactivar “${service.nombre}”?`))
      try {
        await api(`/servicios/${service.id}`, { method: "DELETE" });
        reload();
      } catch (error) {
        setMessage(error.message);
      }
  }
  return (
    <>
      <PageHeader
        eyebrow="CATÁLOGO CLÍNICO"
        title="Tratamientos y precios"
        description="Define servicios, precios y duración."
        action={
          <button
            className="button button-coral"
            onClick={() => setEditing(emptyService)}
          >
            <Icon name="plus" /> Nuevo tratamiento
          </button>
        }
      />
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : services.length ? (
        <div className="service-grid">
          {services.map((service, index) => (
            <article className="service-card" key={service.id}>
              <span className={`service-index tone-${index % 4}`}>
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <h3>{service.nombre}</h3>
                <p>{service.descripcion}</p>
              </div>
              <div className="service-price">
                <strong>{service.precio_bs === null ? "A definir" : formatMoney(service.precio_bs)}</strong>
                <span>{service.duracion_min} min</span>
              </div>
              <div className="card-actions">
                <button onClick={() => setEditing({ ...service, precio_bs: service.precio_bs ?? "" })}>Editar</button>
                <button className="danger" onClick={() => remove(service)}>
                  Desactivar
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="Sin tratamientos"
          text="Agrega el primer servicio."
        />
      )}
      {editing && (
        <Modal
          title={editing.id ? "Editar tratamiento" : "Nuevo tratamiento"}
          onClose={() => setEditing(null)}
        >
          <form className="modal-form" onSubmit={save}>
            <Field label="Nombre">
              <input
                value={editing.nombre}
                onChange={(e) =>
                  setEditing({ ...editing, nombre: e.target.value })
                }
                required
              />
            </Field>
            <Field
              label="Precio (Bs)"
              hint={modoCobro === "app" ? "Obligatorio en modo cobro por la app." : "Vacío si el precio se define en la consulta."}
            >
              <input
                type="number"
                min="0"
                step="0.01"
                value={editing.precio_bs}
                onChange={(e) =>
                  setEditing({ ...editing, precio_bs: e.target.value })
                }
                required={modoCobro === "app"}
              />
            </Field>
            <Field label="Duración">
              <input
                type="number"
                min="5"
                value={editing.duracion_min}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    duracion_min: Number(e.target.value),
                  })
                }
                required
              />
            </Field>
            <Field label="Descripción">
              <textarea
                value={editing.descripcion || ""}
                onChange={(e) =>
                  setEditing({ ...editing, descripcion: e.target.value })
                }
              />
            </Field>
            <button className="button button-primary" disabled={saving}>
              Guardar
            </button>
          </form>
        </Modal>
      )}
      <Toast message={message} onClose={() => setMessage("")} />
    </>
  );
}

export function PaymentsDesk() {
  const { user } = useAuth();
  const [filter, setFilter] = useState("por_verificar");
  const query = filter === "todos" ? "/pagos" : `/pagos?estado=${filter}`;
  const paymentsRemote = useRemote(query);
  const patientsRemote = useRemote("/pacientes");
  const [cashOpen, setCashOpen] = useState(false);
  const [cash, setCash] = useState({ paciente_id: "", monto_bs: "", cita_id: "", presupuesto_id: "" });
  const [cashCitas, setCashCitas] = useState([]);
  const [message, setMessage] = useState("");
  const quotesRemote = useRemote(cash.paciente_id ? `/presupuestos?paciente_id=${encodeURIComponent(cash.paciente_id)}` : "", { enabled: Boolean(cash.paciente_id) });
  const payments = unwrap(paymentsRemote.data, "pagos");
  async function loadCashCitas(pacienteId) {
    setCash((current) => ({ ...current, paciente_id: pacienteId, cita_id: "", presupuesto_id: "" }));
    if (!pacienteId) { setCashCitas([]); return; }
    try {
      const result = await api(`/citas?paciente_id=${encodeURIComponent(pacienteId)}`);
      const citas = unwrap(result, "citas")
        .filter((cita) => cita.estado === "confirmada" || cita.estado === "atendida")
        .sort((a, b) => String(b.inicio).localeCompare(String(a.inicio)));
      setCashCitas(citas);
    } catch {
      setCashCitas([]);
    }
  }
  async function verify(payment, estado) {
    try {
      await api(`/pagos/${payment.id}/verificacion`, {
        method: "PATCH",
        body: { estado },
      });
      setMessage(estado === "valido" ? "Pago validado." : "Pago anulado.");
      paymentsRemote.reload();
    } catch (error) {
      setMessage(error.message);
    }
  }
  async function saveCash(event) {
    event.preventDefault();
    try {
      await api("/pagos", {
        method: "POST",
        body: { ...cash, metodo: "efectivo" },
      });
      setCashOpen(false);
      setCash({ paciente_id: "", monto_bs: "", cita_id: "", presupuesto_id: "" });
      setCashCitas([]);
      setMessage("Cobro registrado.");
      paymentsRemote.reload();
    } catch (error) {
      setMessage(error.message);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="CONTROL DE CAJA"
        title="Cobros y pagos"
        description="Registra efectivo; solo un doctor puede verificar QR."
        action={
          <button
            className="button button-coral"
            onClick={() => setCashOpen(true)}
          >
            <Icon name="plus" /> Registrar efectivo
          </button>
        }
      />
      <div className="filter-row">
        {["por_verificar", "valido", "anulado", "todos"].map((state) => (
          <button
            key={state}
            className={filter === state ? "active" : ""}
            onClick={() => setFilter(state)}
          >
            {state.replace("_", " ")}
          </button>
        ))}
      </div>
      {paymentsRemote.loading ? (
        <Loading />
      ) : paymentsRemote.error ? (
        <ErrorState
          message={paymentsRemote.error}
          onRetry={paymentsRemote.reload}
        />
      ) : payments.length ? (
        <div className="payment-review-list">
          {payments.map((payment) => (
            <article className={payment.estado === "por_verificar" ? "payment-pending" : ""} key={payment.id}>
              <button
                className="evidence-thumb"
                onClick={() =>
                  payment.evidencia_url &&
                  window.open(payment.evidencia_url, "_blank")
                }
              >
                {payment.evidencia_url ? (
                  <img src={payment.evidencia_url} alt="Comprobante" />
                ) : (
                  <Icon name="wallet" />
                )}
              </button>
              <div>
                <strong>
                  {payment.nombres} {payment.apellidos}
                </strong>
                <small>
                  {payment.metodo} · {formatDate(payment.creado_en)}
                </small>
              </div>
              <strong className="amount">
                {formatMoney(payment.monto_bs)}
              </strong>
              <StatusPill status={payment.estado} />
              {user?.rol === "doctor" && payment.estado === "por_verificar" && (
                <div className="verify-actions">
                  <button onClick={() => verify(payment, "valido")}>
                    Validar
                  </button>
                  <button onClick={() => verify(payment, "anulado")}>
                    Anular
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="Sin pagos"
          text="No hay movimientos con este estado."
        />
      )}
      {cashOpen && (
        <Modal title="Registrar efectivo" onClose={() => setCashOpen(false)}>
          <form className="modal-form" onSubmit={saveCash}>
            <Field label="Paciente">
              <select
                value={cash.paciente_id}
                onChange={(e) => loadCashCitas(e.target.value)}
                required
              >
                <option value="">Selecciona</option>
                {unwrap(patientsRemote.data, "pacientes").map((patient) => (
                  <option value={patient.id} key={patient.id}>
                    {patient.codigo} - {patient.nombres} {patient.apellidos}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Cita (opcional)">
              <select
                value={cash.cita_id || ""}
                onChange={(e) => setCash({ ...cash, cita_id: e.target.value })}
              >
                <option value="">Pago general (sin cita)</option>
                {cashCitas.map((cita) => (
                  <option value={cita.id} key={cita.id}>
                    {formatDate(cita.inicio)} · {cita.servicio}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Cotización (opcional)">
              <select
                value={cash.presupuesto_id || ""}
                onChange={(e) => setCash({ ...cash, presupuesto_id: e.target.value })}
              >
                <option value="">Pago general (sin cotización)</option>
                {unwrap(quotesRemote.data, "presupuestos").filter((quote) => quote.pago?.estado !== "pagado").map((quote) => (
                  <option value={quote.id} key={quote.id}>
                    {quote.titulo || "Plan de tratamiento"} · saldo {formatMoney(quote.pago?.saldo_bs)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Monto (Bs)">
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={cash.monto_bs}
                onChange={(e) => setCash({ ...cash, monto_bs: e.target.value })}
                required
              />
            </Field>
            <button className="button button-primary">Registrar</button>
          </form>
        </Modal>
      )}
      <Toast message={message} onClose={() => setMessage("")} />
    </>
  );
}

export function Notifications() {
  const { data, loading, error, reload } = useRemote("/notificaciones");
  const [message, setMessage] = useState("");
  const notifications = unwrap(data, "notificaciones");
  async function read(note) {
    if (note.leida_en) return;
    try {
      await api(`/notificaciones/${note.id}/leer`, { method: "PATCH" });
      reload();
    } catch (requestError) {
      setMessage(requestError.message);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="COMUNICACIÓN"
        title="Notificaciones"
        description="Avisos automáticos del consultorio."
      />
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : notifications.length ? (
        <div className="notification-list">
          {notifications.map((note) => (
            <article
              key={note.id}
              className={!note.leida_en ? "unread" : ""}
              onClick={() => read(note)}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); read(note); } }}
              role="button"
              tabIndex={0}
            >
              <span>
                <Icon name="bell" />
              </span>
              <div>
                <div>
                  <strong>{note.titulo}</strong>
                  <small>{formatDate(note.creado_en)}</small>
                </div>
                <p>{note.mensaje}</p>
                <em>{note.tipo}</em>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon="bell"
          title="Bandeja tranquila"
          text="Los avisos aparecerán aquí."
        />
      )}
      <Toast message={message} onClose={() => setMessage("")} />
    </>
  );
}

function initials(name = "P") {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}
function mondayOf(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  return result;
}
function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}
function calendarStart(day, minutes) {
  const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  const hour = String(8 + Math.floor(minutes / 60)).padStart(2, "0");
  const minute = String(minutes % 60).padStart(2, "0");
  return new Date(`${date}T${hour}:${minute}:00-04:00`);
}
function sameDay(left, right) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}
function appointmentPosition(item) {
  const start = new Date(item.inicio);
  const end = new Date(item.fin);
  const minutes = Math.min(
    690,
    Math.max(0, start.getHours() * 60 + start.getMinutes() - 8 * 60),
  );
  const duration = Math.max(30, (end - start) / 60000);
  return {
    top: `${minutes}px`,
    height: `${Math.max(30, Math.min(duration, 720 - minutes))}px`,
  };
}
function toLocalInput(value) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
function defaultAppointmentStart(week) {
  const now = new Date();
  const inWeek = now >= week && now < addDays(week, 7);
  const date = inWeek ? now : new Date(week);
  date.setSeconds(0, 0);
  date.setMinutes(Math.ceil((date.getMinutes() + 1) / 30) * 30);
  if (date.getHours() < 8) date.setHours(8, 0, 0, 0);
  if (date.getHours() >= 20) { date.setDate(date.getDate() + 1); date.setHours(8, 0, 0, 0); }
  return date;
}
function statusLabel(value) {
  return {
    confirmada: "Confirmar",
    atendida: "Atendida",
    no_asistio: "No asistió",
    cancelada: "Cancelar",
  }[value];
}
function emptyPatient() {
  return {
    codigo: "",
    nombres: "",
    apellidos: "",
    email: "",
    telefono: "",
    fecha_nacimiento: "",
    documento: "",
    direccion: "",
    contacto_emergencia: "",
    telefono_emergencia: "",
    alergias: "",
    antecedentes: "",
    medicamentos: "",
    notas: "",
  };
}
