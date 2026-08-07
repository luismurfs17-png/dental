import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../src/app.js';
import { db } from '../src/db.js';
import { config } from '../src/config.js';

process.env.SUPERADMIN_EMAILS = 'admin@test.local';

let fixture;
let auditedPatient;

before(() => {
  const setup = db.transaction(() => {
    let clinic = db.prepare(`SELECT id FROM consultorios WHERE email='integration@clinic.test'`).get();
    if (!clinic) clinic = { id: Number(db.prepare(`INSERT INTO consultorios (nombre,email) VALUES ('Integration Clinic','integration@clinic.test')`).run().lastInsertRowid) };
    const addUser = db.prepare(`INSERT OR IGNORE INTO usuarios (consultorio_id,email,nombre,rol,estado) VALUES (?,?,?,?,'activo')`);
    addUser.run(clinic.id, 'integration-doctor@test.local', 'Doctor Integration', 'doctor');
    addUser.run(clinic.id, 'integration-operative@test.local', 'Operative Integration', 'operativo');
    addUser.run(clinic.id, 'integration-operative-2@test.local', 'Operative Two', 'operativo');
    addUser.run(clinic.id, 'integration-patient@test.local', 'Patient Integration', 'paciente');
    addUser.run(clinic.id, 'admin@test.local', 'Admin Test', 'doctor');
    const doctor = db.prepare(`SELECT id FROM usuarios WHERE consultorio_id=? AND email='integration-doctor@test.local'`).get(clinic.id);
    const operative = db.prepare(`SELECT id FROM usuarios WHERE consultorio_id=? AND email='integration-operative@test.local'`).get(clinic.id);
    const operative2 = db.prepare(`SELECT id FROM usuarios WHERE consultorio_id=? AND email='integration-operative-2@test.local'`).get(clinic.id);
    const admin = db.prepare(`SELECT id FROM usuarios WHERE consultorio_id=? AND email='admin@test.local'`).get(clinic.id);
    const patientUser = db.prepare(`SELECT id FROM usuarios WHERE consultorio_id=? AND email='integration-patient@test.local'`).get(clinic.id);
    let patient = db.prepare(`SELECT id FROM pacientes WHERE consultorio_id=? AND email='integration-patient@test.local'`).get(clinic.id);
    if (!patient) patient = { id: Number(db.prepare(`INSERT INTO pacientes (consultorio_id,usuario_id,codigo,nombres,apellidos,email)
      VALUES (?,?,'CLI-I001','Patient','Integration','integration-patient@test.local')`).run(clinic.id, patientUser.id).lastInsertRowid) };
    let foreignClinic = db.prepare(`SELECT id FROM consultorios WHERE email='foreign@clinic.test'`).get();
    if (!foreignClinic) foreignClinic = { id: Number(db.prepare(`INSERT INTO consultorios (nombre,email) VALUES ('Foreign Clinic','foreign@clinic.test')`).run().lastInsertRowid) };
    if (!db.prepare(`SELECT id FROM pacientes WHERE consultorio_id=? AND codigo='CLI-X001'`).get(foreignClinic.id))
      db.prepare(`INSERT INTO pacientes (consultorio_id,codigo,nombres,apellidos,email) VALUES (?,'CLI-X001','Foreign','Patient','foreign-patient@test.local')`).run(foreignClinic.id);
    addUser.run(foreignClinic.id, 'foreign-doctor@test.local', 'Foreign Doctor', 'doctor');
    const foreignDoctor = db.prepare(`SELECT id FROM usuarios WHERE consultorio_id=? AND email='foreign-doctor@test.local'`).get(foreignClinic.id);
    const foreignPatient = db.prepare(`SELECT id FROM pacientes WHERE consultorio_id=? AND codigo='CLI-X001'`).get(foreignClinic.id);
    let foreignService = db.prepare(`SELECT id FROM servicios WHERE consultorio_id=? AND nombre='Foreign Service'`).get(foreignClinic.id);
    if (!foreignService) foreignService = { id: Number(db.prepare(`INSERT INTO servicios (consultorio_id,nombre,precio_bs,duracion_min) VALUES (?,'Foreign Service',100,30)`).run(foreignClinic.id).lastInsertRowid) };
    let service = db.prepare(`SELECT id FROM servicios WHERE consultorio_id=? AND nombre='Integration Service'`).get(clinic.id);
    if (!service) service = { id: Number(db.prepare(`INSERT INTO servicios (consultorio_id,nombre,precio_bs,duracion_min) VALUES (?,'Integration Service',100,30)`).run(clinic.id).lastInsertRowid) };
    const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    db.prepare(`INSERT OR IGNORE INTO horarios (consultorio_id,usuario_id,dia_semana,hora_inicio,hora_fin) VALUES (?,?,?,'09:00','10:00')`).run(clinic.id, doctor.id, weekday);
    db.prepare(`DELETE FROM citas WHERE consultorio_id=? AND paciente_id=? AND motivo='INTEGRATION-BOOKING'`).run(clinic.id, patient.id);
    return { clinicId: clinic.id, doctorId: doctor.id, operativeId: operative.id, operative2Id: operative2.id, adminId: admin.id,
      patientId: patient.id, serviceId: service.id, foreignClinicId: foreignClinic.id, foreignDoctorId: foreignDoctor.id,
      foreignPatientId: foreignPatient.id, foreignServiceId: foreignService.id, date };
  });
  fixture = setup();
});

test('GET /api/health informa estado saludable', async () => {
  const response = await request(app).get('/api/health').expect(200);
  assert.equal(response.body.estado, 'saludable');
  assert.equal(response.body.base_de_datos, 'sqlite');
});

test('las rutas desconocidas responden en español', async () => {
  const response = await request(app).get('/no-existe').expect(404);
  assert.equal(response.body.mensaje, 'Ruta no encontrada');
});

test('login de desarrollo y listado de pacientes quedan limitados al consultorio', async () => {
  const agent = request.agent(app);
  const login = await agent.post('/api/auth/desarrollo').send({ email: 'integration-doctor@test.local' }).expect(200);
  assert.equal(login.body.usuario.id, fixture.doctorId);
  const response = await agent.get('/api/pacientes').expect(200);
  assert.ok(response.body.pacientes.some((patient) => patient.id === fixture.patientId));
  assert.ok(response.body.pacientes.every((patient) => patient.email !== 'foreign-patient@test.local'));
});

test('paciente reporta QR y solo el doctor del consultorio lo valida', async () => {
  const patientAgent = request.agent(app);
  await patientAgent.post('/api/auth/desarrollo').send({ email: 'integration-patient@test.local' }).expect(200);
  const image = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]);
  const created = await patientAgent.post('/api/pagos')
    .field('paciente_id', String(fixture.patientId)).field('monto_bs', '75').field('metodo', 'qr')
    .attach('evidencia', image, { filename: 'evidencia.png', contentType: 'image/png' }).expect(201);
  assert.equal(created.body.estado, 'por_verificar');
  await patientAgent.patch(`/api/pagos/${created.body.id}/verificacion`).send({ estado: 'valido' }).expect(403);
  const doctorAgent = request.agent(app);
  await doctorAgent.post('/api/auth/desarrollo').send({ email: 'integration-doctor@test.local' }).expect(200);
  await doctorAgent.patch(`/api/pagos/${created.body.id}/verificacion`).send({ estado: 'valido' }).expect(200);
  const payment = db.prepare('SELECT estado,verificado_por FROM pagos WHERE id=? AND consultorio_id=?').get(created.body.id, fixture.clinicId);
  assert.deepEqual(payment, { estado: 'valido', verificado_por: fixture.doctorId });
});

test('disponibilidad considera horario y conflicto, y el paciente reserva y cancela', async () => {
  const agent = request.agent(app);
  await agent.post('/api/auth/desarrollo').send({ email: 'integration-patient@test.local' }).expect(200);
  const availability = await agent.get('/api/disponibilidad').query({
    fecha: fixture.date, servicio_id: fixture.serviceId, doctor_id: fixture.doctorId
  }).expect(200);
  assert.ok(availability.body.disponibilidad.length >= 1);
  const slot = availability.body.disponibilidad[0];
  const booking = await agent.post('/api/citas').send({
    paciente_id: fixture.patientId, doctor_id: fixture.doctorId, servicio_id: fixture.serviceId,
    inicio: slot.inicio, motivo: 'INTEGRATION-BOOKING'
  }).expect(201);
  const afterBooking = await agent.get('/api/disponibilidad').query({
    fecha: fixture.date, servicio_id: fixture.serviceId, doctor_id: fixture.doctorId
  }).expect(200);
  assert.ok(afterBooking.body.disponibilidad.every((item) => item.inicio !== slot.inicio));
  const occupied = afterBooking.body.horarios.find((item) => item.inicio === slot.inicio);
  assert.equal(occupied.estado, 'ocupado');
  assert.deepEqual(Object.keys(occupied).sort(), ['doctor_id', 'estado', 'fin', 'inicio']);
  await agent.patch(`/api/citas/${booking.body.id}/cancelar`).send({}).expect(200);
  const appointment = db.prepare('SELECT estado FROM citas WHERE id=?').get(booking.body.id);
  assert.equal(appointment.estado, 'cancelada');
  const audit = db.prepare(`SELECT id FROM auditoria WHERE entidad_tipo='cita' AND entidad_id=? AND accion='cancelar'`).get(booking.body.id);
  assert.ok(audit);
});

test('operativo agenda manualmente una visita y genera notificación y auditoría', async () => {
  db.prepare(`DELETE FROM citas WHERE consultorio_id=? AND motivo='MANUAL-AGENDA'`).run(fixture.clinicId);
  const agent = request.agent(app);
  await agent.post('/api/auth/desarrollo').send({ email: 'integration-operative@test.local' }).expect(200);
  const created = await agent.post('/api/citas').send({
    paciente_id: fixture.patientId,
    doctor_id: fixture.doctorId,
    servicio_id: fixture.serviceId,
    inicio: `${fixture.date}T09:00:00-04:00`,
    motivo: 'MANUAL-AGENDA'
  }).expect(201);
  const appointment = db.prepare(`SELECT creado_por,estado FROM citas WHERE id=? AND consultorio_id=?`).get(created.body.id, fixture.clinicId);
  assert.deepEqual(appointment, { creado_por: fixture.operativeId, estado: 'confirmada' });
  assert.ok(db.prepare(`SELECT id FROM auditoria WHERE entidad_tipo='cita' AND entidad_id=? AND paciente_id=? AND accion='crear'`)
    .get(created.body.id, fixture.patientId));
  assert.ok(db.prepare(`SELECT id FROM notificaciones WHERE entidad_tipo='cita' AND entidad_id=? AND usuario_id=?`)
    .get(created.body.id, fixture.doctorId));
  db.prepare('DELETE FROM citas WHERE id=?').run(created.body.id);
});

test('notas rápidas respetan consultorio, autor y permiso de doctor', async () => {
  const author = request.agent(app);
  await author.post('/api/auth/desarrollo').send({ email: 'integration-operative@test.local' }).expect(200);
  const created = await author.post(`/api/pacientes/${fixture.patientId}/notas`).send({ texto: 'Llamar para seguimiento' }).expect(201);
  const list = await author.get(`/api/pacientes/${fixture.patientId}/notas`).expect(200);
  assert.ok(list.body.notas.some((note) => note.id === created.body.id && note.usuario_id === fixture.operativeId));
  await author.get(`/api/pacientes/${fixture.foreignPatientId}/notas`).expect(404);
  await author.post(`/api/pacientes/${fixture.foreignPatientId}/notas`).send({ texto: 'No debe crearse' }).expect(404);

  const other = request.agent(app);
  await other.post('/api/auth/desarrollo').send({ email: 'integration-operative-2@test.local' }).expect(200);
  await other.delete(`/api/pacientes/${fixture.patientId}/notas/${created.body.id}`).expect(404);

  const doctor = request.agent(app);
  await doctor.post('/api/auth/desarrollo').send({ email: 'integration-doctor@test.local' }).expect(200);
  await doctor.delete(`/api/pacientes/${fixture.patientId}/notas/${created.body.id}`).expect(200);
  const row = db.prepare('SELECT eliminado_en FROM notas_paciente WHERE id=?').get(created.body.id);
  assert.ok(row.eliminado_en);
});

test('reprogramación de cita detecta conflictos y no cruza consultorios', async () => {
  db.prepare(`DELETE FROM citas WHERE consultorio_id=? AND motivo IN ('REPROGRAM-A','REPROGRAM-B')`).run(fixture.clinicId);
  const agent = request.agent(app);
  await agent.post('/api/auth/desarrollo').send({ email: 'integration-doctor@test.local' }).expect(200);
  const firstStart = `${fixture.date}T09:00:00-04:00`;
  const secondStart = `${fixture.date}T09:30:00-04:00`;
  const first = await agent.post('/api/citas').send({ paciente_id: fixture.patientId, doctor_id: fixture.doctorId,
    servicio_id: fixture.serviceId, inicio: firstStart, motivo: 'REPROGRAM-A' }).expect(201);
  const second = await agent.post('/api/citas').send({ paciente_id: fixture.patientId, doctor_id: fixture.doctorId,
    servicio_id: fixture.serviceId, inicio: secondStart, motivo: 'REPROGRAM-B' }).expect(201);
  await agent.patch(`/api/citas/${second.body.id}`).send({ inicio: firstStart }).expect(409);
  await agent.patch(`/api/citas/${second.body.id}`).send({ inicio: secondStart, notas: 'Horario confirmado' }).expect(200);
  const operative = request.agent(app);
  await operative.post('/api/auth/desarrollo').send({ email: 'integration-operative@test.local' }).expect(200);
  await operative.patch(`/api/citas/${second.body.id}`).send({ notas: 'Confirmado por personal operativo' }).expect(200);
  assert.equal(db.prepare('SELECT reprogramaciones_paciente FROM citas WHERE id=?').get(second.body.id).reprogramaciones_paciente, 0);
  const audit = db.prepare(`SELECT id FROM auditoria WHERE entidad_tipo='cita' AND entidad_id=? AND accion='reprogramar'`).get(second.body.id);
  assert.ok(audit);

  const foreign = db.prepare(`INSERT INTO citas (consultorio_id,paciente_id,doctor_id,servicio_id,inicio,fin,estado,precio_bs,creado_por)
    VALUES (?,?,?,?,?,?,'confirmada',100,?)`).run(fixture.foreignClinicId, fixture.foreignPatientId, fixture.foreignDoctorId,
    fixture.foreignServiceId, new Date(firstStart).toISOString(), new Date(new Date(firstStart).getTime() + 1800000).toISOString(), fixture.foreignDoctorId);
  await agent.patch(`/api/citas/${foreign.lastInsertRowid}`).send({ inicio: secondStart }).expect(404);
  const untouched = db.prepare('SELECT consultorio_id FROM citas WHERE id=?').get(foreign.lastInsertRowid);
  assert.equal(untouched.consultorio_id, fixture.foreignClinicId);
  db.prepare('DELETE FROM citas WHERE id=?').run(foreign.lastInsertRowid);
  db.prepare('DELETE FROM citas WHERE id IN (?,?)').run(first.body.id, second.body.id);
});

test('paciente reprograma una cita propia exactamente una vez', async (t) => {
  db.prepare(`DELETE FROM citas WHERE consultorio_id=? AND motivo='PATIENT-REPROGRAM'`).run(fixture.clinicId);
  const start = new Date(`${fixture.date}T09:00:00-04:00`);
  const created = db.prepare(`INSERT INTO citas
    (consultorio_id,paciente_id,doctor_id,servicio_id,inicio,fin,estado,precio_bs,motivo,creado_por)
    VALUES (?,?,?,?,?,?,'confirmada',100,'PATIENT-REPROGRAM',?)`).run(fixture.clinicId, fixture.patientId,
    fixture.doctorId, fixture.serviceId, start.toISOString(), new Date(start.getTime() + 1800000).toISOString(), fixture.doctorId);
  const appointmentId = Number(created.lastInsertRowid);
  t.after(() => db.transaction(() => {
    db.prepare(`DELETE FROM notificaciones WHERE entidad_tipo='cita' AND entidad_id=?`).run(appointmentId);
    db.prepare(`DELETE FROM auditoria WHERE entidad_tipo='cita' AND entidad_id=?`).run(appointmentId);
    db.prepare('DELETE FROM citas WHERE id=?').run(appointmentId);
  })());

  const patient = request.agent(app);
  await patient.post('/api/auth/desarrollo').send({ email: 'integration-patient@test.local' }).expect(200);
  const nextStart = new Date(`${fixture.date}T09:30:00-04:00`).toISOString();
  await patient.patch(`/api/citas/${appointmentId}/reprogramar`).send({ inicio: nextStart }).expect(200);

  const updated = db.prepare(`SELECT inicio,fin,reprogramaciones_paciente,reprogramada_por_paciente_en,paciente_id,doctor_id,servicio_id
    FROM citas WHERE id=?`).get(appointmentId);
  assert.equal(updated.inicio, nextStart);
  assert.equal(updated.reprogramaciones_paciente, 1);
  assert.ok(updated.reprogramada_por_paciente_en);
  assert.equal(updated.paciente_id, fixture.patientId);
  assert.equal(updated.doctor_id, fixture.doctorId);
  assert.equal(updated.servicio_id, fixture.serviceId);
  assert.equal(new Date(updated.fin).getTime() - new Date(updated.inicio).getTime(), 1800000);
  const audit = db.prepare(`SELECT datos_json FROM auditoria WHERE entidad_tipo='cita' AND entidad_id=? AND accion='reprogramar'
    ORDER BY id DESC`).get(appointmentId);
  assert.equal(JSON.parse(audit.datos_json).origen, 'paciente');
  assert.ok(db.prepare(`SELECT id FROM notificaciones WHERE entidad_tipo='cita' AND entidad_id=? AND usuario_id=?
    AND tipo='cita_reprogramada'`).get(appointmentId, fixture.doctorId));

  const second = await patient.patch(`/api/citas/${appointmentId}/reprogramar`)
    .send({ inicio: start.toISOString() }).expect(409);
  assert.match(second.body.mensaje, /ya fue reprogramada/i);
});

test('paciente debe coordinar por teléfono una reprogramación con menos de cinco horas', async (t) => {
  db.prepare(`DELETE FROM citas WHERE consultorio_id=? AND motivo='PATIENT-UNDER-FIVE-HOURS'`).run(fixture.clinicId);
  const start = new Date(Date.now() + 4 * 60 * 60 * 1000);
  const created = db.prepare(`INSERT INTO citas
    (consultorio_id,paciente_id,doctor_id,servicio_id,inicio,fin,estado,precio_bs,motivo,creado_por)
    VALUES (?,?,?,?,?,?,'confirmada',100,'PATIENT-UNDER-FIVE-HOURS',?)`).run(fixture.clinicId, fixture.patientId,
    fixture.doctorId, fixture.serviceId, start.toISOString(), new Date(start.getTime() + 1800000).toISOString(), fixture.doctorId);
  const appointmentId = Number(created.lastInsertRowid);
  t.after(() => db.prepare('DELETE FROM citas WHERE id=?').run(appointmentId));

  const patient = request.agent(app);
  await patient.post('/api/auth/desarrollo').send({ email: 'integration-patient@test.local' }).expect(200);
  const response = await patient.patch(`/api/citas/${appointmentId}/reprogramar`)
    .send({ inicio: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() }).expect(409);
  assert.match(response.body.mensaje, /coordinado por teléfono/i);
  assert.equal(db.prepare('SELECT reprogramaciones_paciente FROM citas WHERE id=?').get(appointmentId).reprogramaciones_paciente, 0);
});

test('código de paciente es numérico, manual, único por consultorio y prioriza búsquedas exactas', async () => {
  const doctor = request.agent(app);
  await doctor.post('/api/auth/desarrollo').send({ email: 'integration-doctor@test.local' }).expect(200);
  const base = `${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;

  await doctor.post('/api/pacientes').send({ nombres: 'Sin', apellidos: 'Código' }).expect(400);
  await doctor.post('/api/pacientes').send({ codigo: '12A3', nombres: 'Código', apellidos: 'Inválido' }).expect(400);
  await doctor.post('/api/pacientes').send({ codigo: '1'.repeat(33), nombres: 'Código', apellidos: 'Largo' }).expect(400);

  const exact = await doctor.post('/api/pacientes').send({ codigo: base, nombres: 'Exacto', apellidos: 'Código' }).expect(201);
  const prefix = await doctor.post('/api/pacientes').send({ codigo: `${base}9`, nombres: 'Prefijo', apellidos: 'Código' }).expect(201);
  const nameCode = `${base.slice(0, -1)}${base.endsWith('7') ? '6' : '7'}`;
  const byName = await doctor.post('/api/pacientes').send({ codigo: nameCode, nombres: base, apellidos: 'Nombre' }).expect(201);
  const duplicate = await doctor.post('/api/pacientes').send({ codigo: base, nombres: 'Código', apellidos: 'Duplicado' }).expect(409);
  assert.equal(duplicate.body.mensaje, 'El código del paciente ya está registrado en el consultorio');

  const search = await doctor.get('/api/pacientes').query({ buscar: base }).expect(200);
  assert.deepEqual(search.body.pacientes.slice(0, 3).map((patient) => patient.id),
    [exact.body.paciente.id, prefix.body.paciente.id, byName.body.paciente.id]);

  const foreignDoctor = request.agent(app);
  await foreignDoctor.post('/api/auth/desarrollo').send({ email: 'foreign-doctor@test.local' }).expect(200);
  const foreign = await foreignDoctor.post('/api/pacientes').send({ codigo: base, nombres: 'Mismo', apellidos: 'Otro Consultorio' }).expect(201);
  assert.equal(foreign.body.paciente.codigo, base);

  const operative = request.agent(app);
  await operative.post('/api/auth/desarrollo').send({ email: 'integration-operative@test.local' }).expect(200);
  const leadingZeroCode = `0${base}`;
  await operative.patch(`/api/pacientes/${exact.body.paciente.id}`).send({ codigo: leadingZeroCode }).expect(200);
  assert.equal(db.prepare('SELECT codigo FROM pacientes WHERE id=?').get(exact.body.paciente.id).codigo, leadingZeroCode);
  const codeAudit = db.prepare(`SELECT datos_json FROM auditoria WHERE paciente_id=? AND usuario_id=? AND accion='actualizar' ORDER BY id DESC`)
    .get(exact.body.paciente.id, fixture.operativeId);
  assert.deepEqual(JSON.parse(codeAudit.datos_json).codigo, { anterior: base, nuevo: leadingZeroCode });
  await operative.patch(`/api/pacientes/${exact.body.paciente.id}`).send({ codigo: 'LEGACY-NEW' }).expect(400);
  await operative.patch(`/api/pacientes/${fixture.patientId}`).send({ telefono: '+591 70009999' }).expect(200);
  assert.equal(db.prepare('SELECT codigo FROM pacientes WHERE id=?').get(fixture.patientId).codigo, 'CLI-I001');

  auditedPatient = { id: exact.body.paciente.id, code: leadingZeroCode, foreignId: foreign.body.paciente.id };
});

test('auditoría filtra con alcance de consultorio y enriquece pacientes archivados', async () => {
  const doctor = request.agent(app);
  await doctor.post('/api/auth/desarrollo').send({ email: 'integration-doctor@test.local' }).expect(200);
  await doctor.delete(`/api/pacientes/${auditedPatient.id}`).expect(200);
  const today = new Date().toISOString().slice(0, 10);
  const response = await doctor.get('/api/auditoria').query({
    usuario_id: fixture.doctorId,
    paciente_id: auditedPatient.id,
    accion: 'crear',
    desde: today,
    hasta: today,
    limite: 10
  }).expect(200);
  assert.equal(response.body.total, 1);
  assert.equal(response.body.auditoria.length, 1);
  assert.equal(response.body.auditoria[0].paciente_id, auditedPatient.id);
  assert.equal(response.body.auditoria[0].paciente_codigo, auditedPatient.code);
  assert.equal(response.body.auditoria[0].usuario, 'Doctor Integration');

  const foreignPatientFilter = await doctor.get('/api/auditoria').query({ paciente_id: auditedPatient.foreignId }).expect(200);
  assert.equal(foreignPatientFilter.body.total, 0);
  await doctor.get('/api/auditoria').query({ usuario_id: 'no-numérico' }).expect(400);
  await doctor.get('/api/auditoria').query({ accion: 'DROP TABLE auditoria' }).expect(400);
  await doctor.get('/api/auditoria').query({ desde: '2026/01/01' }).expect(400);
  await doctor.get('/api/auditoria').query({ limite: 501 }).expect(400);

  const operative = request.agent(app);
  await operative.post('/api/auth/desarrollo').send({ email: 'integration-operative@test.local' }).expect(200);
  await operative.get('/api/auditoria').expect(403);
  const patient = request.agent(app);
  await patient.post('/api/auth/desarrollo').send({ email: 'integration-patient@test.local' }).expect(200);
  await patient.get('/api/auditoria').expect(403);
});

test('el doctor puede eliminar y recrear el mismo horario sin conflicto', async () => {
  const doctor = request.agent(app);
  await doctor.post('/api/auth/desarrollo').send({ email: 'integration-doctor@test.local' }).expect(200);
  const date = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const schedule = db.prepare(`SELECT id FROM horarios WHERE consultorio_id=? AND usuario_id=? AND dia_semana=? AND eliminado_en IS NULL`)
    .get(fixture.clinicId, fixture.doctorId, weekday);
  if (schedule) await doctor.delete(`/api/horarios/${schedule.id}`).expect(200);
  await doctor.post('/api/horarios').send({ dia_semana: weekday, hora_inicio: '09:00', hora_fin: '10:00' }).expect(201);
  const first = db.prepare(`SELECT id FROM horarios WHERE consultorio_id=? AND usuario_id=? AND dia_semana=? AND eliminado_en IS NULL`)
    .get(fixture.clinicId, fixture.doctorId, weekday);
  await doctor.delete(`/api/horarios/${first.id}`).expect(200);
  const recreated = await doctor.post('/api/horarios').send({ dia_semana: weekday, hora_inicio: '09:00', hora_fin: '10:00' }).expect(201);
  assert.ok(recreated.body.id);
  const rows = db.prepare(`SELECT COUNT(*) total FROM horarios WHERE consultorio_id=? AND usuario_id=? AND dia_semana=? AND hora_inicio='09:00' AND eliminado_en IS NULL`)
    .get(fixture.clinicId, fixture.doctorId, weekday);
  assert.equal(rows.total, 1);
});

test('solo el superadministrador puede invitar y administrar consultorios', async () => {
  const doctor = request.agent(app);
  await doctor.post('/api/auth/desarrollo').send({ email: 'integration-doctor@test.local' }).expect(200);
  await doctor.get('/api/admin/resumen').expect(403);
  await doctor.post('/api/admin/invitaciones').send({ email: 'nuevo@test.local' }).expect(403);

  const admin = request.agent(app);
  const login = await admin.post('/api/auth/desarrollo').send({ email: 'admin@test.local' }).expect(200);
  assert.equal(login.body.usuario.es_admin, true);

  const resumen = await admin.get('/api/admin/resumen').expect(200);
  assert.ok(resumen.body.resumen.consultorios >= 2);
  assert.ok(resumen.body.resumen.invitaciones >= 0);

  const clinics = await admin.get('/api/admin/consultorios').expect(200);
  assert.ok(clinics.body.consultorios.some((clinic) => clinic.id === fixture.clinicId));

  const invited = await admin.post('/api/admin/invitaciones').send({ email: 'new-clinic@test.local', nombre: 'Nueva Clínica' }).expect(201);
  assert.deepEqual(db.prepare('SELECT rol, estado, consultorio_id FROM usuarios WHERE id=?').get(invited.body.id),
    { rol: 'doctor', estado: 'preautorizado', consultorio_id: null });

  await admin.post('/api/admin/invitaciones').send({ email: 'new-clinic@test.local' }).expect(200);
  await admin.post('/api/admin/invitaciones').send({ email: 'integration-doctor@test.local' }).expect(409);
  await admin.post('/api/admin/invitaciones').send({ email: 'admin@test.local' }).expect(400);

  await admin.patch(`/api/admin/usuarios/${fixture.adminId}/estado`).send({ estado: 'suspendido' }).expect(400);
  await admin.delete(`/api/admin/usuarios/${fixture.adminId}`).expect(400);

  await admin.patch(`/api/admin/usuarios/${invited.body.id}/estado`).send({ estado: 'suspendido' }).expect(200);
  const suspended = await admin.get('/api/admin/usuarios').query({ estado: 'suspendido' }).expect(200);
  assert.ok(suspended.body.usuarios.some((user) => user.id === invited.body.id));

  await admin.delete(`/api/admin/usuarios/${invited.body.id}`).expect(200);
  assert.ok(db.prepare('SELECT eliminado_en FROM usuarios WHERE id=?').get(invited.body.id).eliminado_en);

  const temporary = db.prepare(`INSERT INTO consultorios (nombre, email) VALUES ('Clínica Temporal','temporal@test.local')`).run();
  await admin.delete(`/api/admin/consultorios/${temporary.lastInsertRowid}`).expect(200);
  assert.ok(db.prepare('SELECT eliminado_en FROM consultorios WHERE id=?').get(temporary.lastInsertRowid).eliminado_en);

  const first = clinics.body.consultorios.find((clinic) => clinic.id === fixture.clinicId);
  assert.ok(['activo', 'inactivo', 'abandonado', 'vacio', 'sinusuario'].includes(first.estado_actividad));
  assert.equal(typeof first.ingresos_total, 'number');

  const detalle = await admin.get(`/api/admin/consultorios/${fixture.clinicId}`).expect(200);
  assert.equal(detalle.body.consultorio.id, fixture.clinicId);
  assert.ok(Array.isArray(detalle.body.proximas_citas));
  assert.equal(typeof detalle.body.archivos, 'number');

  const exportData = await admin.get(`/api/admin/consultorios/${fixture.clinicId}/exportar`)
    .parse((res, callback) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    }).expect(200);
  assert.match(exportData.headers['content-type'], /application\/zip/);
  assert.ok(Buffer.isBuffer(exportData.body) && exportData.body.length > 0);

  await admin.post(`/api/admin/consultorios/${fixture.clinicId}/reiniciar`).send({ confirmar: false }).expect(400);
  const reinicio = await admin.post(`/api/admin/consultorios/${fixture.clinicId}/reiniciar`).send({ confirmar: true }).expect(200);
  assert.ok(String(reinicio.body.snapshot).startsWith('consultorio-'));
  assert.ok(reinicio.body.pacientes >= 1);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM pacientes WHERE consultorio_id=? AND eliminado_en IS NULL`).get(fixture.clinicId).n, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM citas WHERE consultorio_id=? AND eliminado_en IS NULL`).get(fixture.clinicId).n, 0);

  const audit = await admin.get('/api/admin/auditoria').expect(200);
  assert.ok(audit.body.auditoria.some((entry) => entry.accion === 'exportar'));
  assert.ok(audit.body.auditoria.some((entry) => entry.accion === 'reiniciar'));
});

test('solo con invitación se puede crear un consultorio', async (t) => {
  const agent = request.agent(app);

  const blocked = db.prepare(`INSERT INTO usuarios (email, nombre, rol, estado) VALUES ('auto-registrado@test.local','Auto','doctor','pendiente')`).run();
  const blockedToken = jwt.sign({ sub: String(blocked.lastInsertRowid), consultorioId: null, rol: 'doctor' }, config.jwtSecret, { expiresIn: '1d' });
  await agent.get('/api/agenda').set('Cookie', `dentista_token=${blockedToken}`).expect(403);
  await agent.post('/api/consultorio/onboarding').set('Cookie', `dentista_token=${blockedToken}`).send({ nombre: 'Sin invitación' }).expect(403);
  db.prepare('DELETE FROM usuarios WHERE id=?').run(blocked.lastInsertRowid);

  const invited = db.prepare(`INSERT INTO usuarios (email, nombre, rol, estado) VALUES ('invitado@test.local','Invitado','doctor','preautorizado')`).run();
  const invitedId = invited.lastInsertRowid;
  t.after(() => {
    db.prepare(`UPDATE consultorios SET eliminado_en=CURRENT_TIMESTAMP WHERE nombre='Clínica Invitación'`).run();
    db.prepare('UPDATE usuarios SET eliminado_en=CURRENT_TIMESTAMP WHERE id=?').run(invitedId);
  });
  db.prepare(`UPDATE usuarios SET estado='activo' WHERE id=?`).run(invitedId);
  const invitedToken = jwt.sign({ sub: String(invitedId), consultorioId: null, rol: 'doctor' }, config.jwtSecret, { expiresIn: '1d' });
  const created = await agent.post('/api/consultorio/onboarding').set('Cookie', `dentista_token=${invitedToken}`).send({ nombre: 'Clínica Invitación' }).expect(201);
  assert.ok(created.body.consultorio_id);
  const active = db.prepare('SELECT estado, consultorio_id FROM usuarios WHERE id=?').get(invitedId);
  assert.equal(active.estado, 'activo');
});
