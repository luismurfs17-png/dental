import { db, uniqueClinicSlug } from './db.js';

const DEMO_EMAIL = 'demo@sonrident.local';
const DEMO_NAME = 'Clínica Demo SONRIDENT';

const seedDemo = db.transaction(() => {
  let clinic = db.prepare(`SELECT id FROM consultorios WHERE email=? AND eliminado_en IS NULL`).get(DEMO_EMAIL);
  if (!clinic) {
    clinic = { id: Number(db.prepare(`INSERT INTO consultorios (nombre,slug,nit,telefono,email,direccion,ubicacion)
      VALUES (?,?,'900100200','+591 70001111',?,'Av. Demo 100, La Paz','Av. Demo 100, La Paz, Bolivia')`)
      .run(DEMO_NAME, uniqueClinicSlug(DEMO_NAME), DEMO_EMAIL).lastInsertRowid) };
  } else {
    db.prepare(`UPDATE consultorios SET nombre=? WHERE id=?`).run(DEMO_NAME, clinic.id);
  }

  const ensureUser = (email, nombre, rol) => {
    const existing = db.prepare(`SELECT id FROM usuarios WHERE email=? COLLATE NOCASE`).get(email);
    if (existing) {
      db.prepare(`UPDATE usuarios SET consultorio_id=?, nombre=?, rol=?, estado='activo', eliminado_en=NULL WHERE id=?`)
        .run(clinic.id, nombre, rol, existing.id);
      return existing;
    }
    return { id: Number(db.prepare(`INSERT INTO usuarios (consultorio_id,email,nombre,rol,estado)
      VALUES (?,?,?,?,'activo')`).run(clinic.id, email, nombre, rol).lastInsertRowid) };
  };

  const doctor = ensureUser('doctora-demo@sonrident.local', 'Dra. Ana Demo', 'doctor');
  const operative = ensureUser('recepcion-demo@sonrident.local', 'Luis Recepción Demo', 'operativo');
  const patientUser = ensureUser('paciente-demo@sonrident.local', 'María Paciente Demo', 'paciente');

  for (const adminEmail of (process.env.SUPERADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)) {
    ensureUser(adminEmail, `Superadmin (${adminEmail})`, 'doctor');
  }

  let patient = db.prepare(`SELECT id FROM pacientes WHERE consultorio_id=? AND codigo='10001' AND eliminado_en IS NULL`).get(clinic.id);
  if (!patient) {
    patient = { id: Number(db.prepare(`INSERT INTO pacientes
      (consultorio_id,usuario_id,codigo,nombres,apellidos,email,telefono,fecha_nacimiento,documento,direccion,alergias,antecedentes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(clinic.id, patientUser.id, '10001', 'María', 'Paciente Demo', 'paciente-demo@sonrident.local',
        '+591 70002222', '1992-03-12', 'DEMO-10001', 'Calle Demo 45', 'Ninguna conocida', 'Sin antecedentes relevantes').lastInsertRowid) };
  }

  const patients = [
    { codigo: '10002', nombres: 'Pedro', apellidos: 'García Demo', email: 'pedro.demo@sonrident.local' },
    { codigo: '10003', nombres: 'Lucía', apellidos: 'Rojas Demo', email: 'lucia.demo@sonrident.local' },
    { codigo: '10004', nombres: 'Jorge', apellidos: 'Mendoza Demo', email: 'jorge.demo@sonrident.local' }
  ];
  for (const p of patients) {
    if (!db.prepare(`SELECT id FROM pacientes WHERE consultorio_id=? AND codigo=? AND eliminado_en IS NULL`).get(clinic.id, p.codigo)) {
      db.prepare(`INSERT INTO pacientes (consultorio_id,codigo,nombres,apellidos,email,telefono)
        VALUES (?,?,?,?,?,?)`).run(clinic.id, p.codigo, p.nombres, p.apellidos, p.email, '+591 70003333');
    }
  }

  const addService = db.prepare(`INSERT INTO servicios (consultorio_id,nombre,descripcion,precio_bs,duracion_min) VALUES (?,?,?,?,?)`);
  let cleaning = db.prepare(`SELECT id FROM servicios WHERE consultorio_id=? AND nombre='Limpieza dental' AND eliminado_en IS NULL`).get(clinic.id);
  if (!cleaning) cleaning = { id: Number(addService.run(clinic.id, 'Limpieza dental', 'Profilaxis dental completa', 250, 45).lastInsertRowid) };
  let consulta = db.prepare(`SELECT id FROM servicios WHERE consultorio_id=? AND nombre='Consulta general' AND eliminado_en IS NULL`).get(clinic.id);
  if (!consulta) consulta = { id: Number(addService.run(clinic.id, 'Consulta general', 'Evaluación odontológica', 120, 30).lastInsertRowid) };
  if (!db.prepare(`SELECT id FROM servicios WHERE consultorio_id=? AND nombre='Blanqueamiento' AND eliminado_en IS NULL`).get(clinic.id)) {
    addService.run(clinic.id, 'Blanqueamiento', 'Blanqueamiento profesional', 450, 60);
  }

  for (let day = 1; day <= 5; day += 1) {
    db.prepare(`INSERT OR IGNORE INTO horarios (consultorio_id,usuario_id,dia_semana,hora_inicio,hora_fin)
      VALUES (?,?,?,'08:00','17:00')`).run(clinic.id, doctor.id, day);
  }

  const pad = (n) => String(n).padStart(2, '0');
  const dayOffset = (offset, hour, minute = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    d.setHours(hour, minute, 0, 0);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
  };

  const ensureCita = (pacienteId, inicio, fin, estado, precio, motivo, servicioId) => {
    const existing = db.prepare(`SELECT id FROM citas WHERE consultorio_id=? AND paciente_id=? AND motivo=? AND eliminado_en IS NULL`)
      .get(clinic.id, pacienteId, motivo);
    if (existing) return existing;
    return { id: Number(db.prepare(`INSERT INTO citas
      (consultorio_id,paciente_id,doctor_id,servicio_id,inicio,fin,estado,precio_bs,motivo,creado_por)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(clinic.id, pacienteId, doctor.id, servicioId, inicio, fin, estado, precio, motivo, operative.id).lastInsertRowid) };
  };

  const p2 = db.prepare(`SELECT id FROM pacientes WHERE consultorio_id=? AND codigo='10002'`).get(clinic.id);
  const p3 = db.prepare(`SELECT id FROM pacientes WHERE consultorio_id=? AND codigo='10003'`).get(clinic.id);

  ensureCita(patient.id, dayOffset(-2, 10), dayOffset(-2, 10, 45), 'atendida', 250, 'Demo: limpieza atendida', cleaning.id);
  ensureCita(patient.id, dayOffset(1, 9), dayOffset(1, 9, 30), 'confirmada', 120, 'Demo: consulta mañana', consulta.id);
  if (p2) ensureCita(p2.id, dayOffset(0, 11), dayOffset(0, 11, 45), 'confirmada', 250, 'Demo: limpieza hoy', cleaning.id);
  if (p3) ensureCita(p3.id, dayOffset(2, 15), dayOffset(2, 15, 30), 'confirmada', 120, 'Demo: control pasado mañana', consulta.id);

  const past = db.prepare(`SELECT id FROM citas WHERE consultorio_id=? AND motivo='Demo: limpieza atendida'`).get(clinic.id);
  if (past && !db.prepare(`SELECT id FROM pagos WHERE consultorio_id=? AND cita_id=? AND referencia='DEMO-EFECTIVO'`).get(clinic.id, past.id)) {
    db.prepare(`INSERT INTO pagos (consultorio_id,paciente_id,cita_id,monto_bs,metodo,estado,referencia,registrado_por)
      VALUES (?,?,?,?, 'efectivo','valido','DEMO-EFECTIVO',?)`).run(clinic.id, patient.id, past.id, 250, operative.id);
  }

  if (!db.prepare(`SELECT id FROM notificaciones WHERE consultorio_id=? AND usuario_id=? AND mensaje LIKE 'Consultorio demo listo%'`).get(clinic.id, doctor.id)) {
    db.prepare(`INSERT INTO notificaciones (consultorio_id,usuario_id,tipo,titulo,mensaje)
      VALUES (?,?,'sistema','Demo lista','Consultorio demo listo para la presentación de agenda')`)
      .run(clinic.id, doctor.id);
  }

  return clinic.id;
});

const clinicId = seedDemo();
console.log(`Consultorio demo listo (id=${clinicId}, email=${DEMO_EMAIL})`);
console.log('Pacientes: 10001–10004 | Servicios: Limpieza, Consulta, Blanqueamiento');
console.log('Citas: ayer (atendida), hoy, mañana y pasado mañana');
const admins = (process.env.SUPERADMIN_EMAILS || '').split(',').map((e) => e.trim()).filter(Boolean);
if (admins.length) console.log(`Superadmins vinculados como doctor: ${admins.join(', ')}`);
console.log('Para quitarlo: panel /admin → eliminar consultorio, o POST /api/admin/consultorios/:id/reiniciar');
