import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../src/app.js';
import { db, uniqueClinicSlug } from '../src/db.js';
import { config } from '../src/config.js';

process.env.SUPERADMIN_EMAILS = 'admin@test.local';

let fixture;
let auditedPatient;

before(() => {
  const setup = db.transaction(() => {
    const ensureClinic = (nombre, email) => {
      let clinic = db.prepare(`SELECT id, slug FROM consultorios WHERE email=? AND eliminado_en IS NULL`).get(email);
      if (!clinic) {
        const slug = uniqueClinicSlug(nombre);
        clinic = { id: Number(db.prepare(`INSERT INTO consultorios (nombre,email,slug) VALUES (?,?,?)`).run(nombre, email, slug).lastInsertRowid), slug };
      } else if (!clinic.slug) {
        clinic.slug = uniqueClinicSlug(nombre);
        db.prepare('UPDATE consultorios SET slug=? WHERE id=?').run(clinic.slug, clinic.id);
      }
      return clinic;
    };
    const ensureUser = (clinicId, email, nombre, rol) => {
      const existing = db.prepare(`SELECT id FROM usuarios WHERE email=? COLLATE NOCASE ORDER BY id LIMIT 1`).get(email);
      if (existing) {
        db.prepare(`UPDATE usuarios SET consultorio_id=?, nombre=?, rol=?, estado='activo', eliminado_en=NULL WHERE id=?`)
          .run(clinicId, nombre, rol, existing.id);
        return existing;
      }
      return { id: Number(db.prepare(`INSERT INTO usuarios (consultorio_id,email,nombre,rol,estado) VALUES (?,?,?,?,'activo')`)
        .run(clinicId, email, nombre, rol).lastInsertRowid) };
    };
    const clinic = ensureClinic('Integration Clinic', 'integration@clinic.test');
    const doctor = ensureUser(clinic.id, 'integration-doctor@test.local', 'Doctor Integration', 'doctor');
    const operative = ensureUser(clinic.id, 'integration-operative@test.local', 'Operative Integration', 'operativo');
    const operative2 = ensureUser(clinic.id, 'integration-operative-2@test.local', 'Operative Two', 'operativo');
    const patientUser = ensureUser(clinic.id, 'integration-patient@test.local', 'Patient Integration', 'paciente');
    const admin = ensureUser(clinic.id, 'admin@test.local', 'Admin Test', 'doctor');
    let patient = db.prepare(`SELECT id FROM pacientes WHERE consultorio_id=? AND email='integration-patient@test.local' AND eliminado_en IS NULL`).get(clinic.id);
    if (!patient) {
      const archived = db.prepare(`SELECT id FROM pacientes WHERE consultorio_id=? AND email='integration-patient@test.local'`).get(clinic.id);
      if (archived) {
        db.prepare(`UPDATE pacientes SET eliminado_en=NULL, usuario_id=?, codigo='CLI-I001' WHERE id=?`).run(patientUser.id, archived.id);
        patient = archived;
      } else {
        patient = { id: Number(db.prepare(`INSERT INTO pacientes (consultorio_id,usuario_id,codigo,nombres,apellidos,email)
          VALUES (?,?,'CLI-I001','Patient','Integration','integration-patient@test.local')`).run(clinic.id, patientUser.id).lastInsertRowid) };
      }
    }
    const foreignClinic = ensureClinic('Foreign Clinic', 'foreign@clinic.test');
    let foreignPatient = db.prepare(`SELECT id FROM pacientes WHERE consultorio_id=? AND codigo='CLI-X001' AND eliminado_en IS NULL`).get(foreignClinic.id);
    if (!foreignPatient) {
      foreignPatient = { id: Number(db.prepare(`INSERT INTO pacientes (consultorio_id,codigo,nombres,apellidos,email) VALUES (?,'CLI-X001','Foreign','Patient','foreign-patient@test.local')`).run(foreignClinic.id).lastInsertRowid) };
    }
    const foreignDoctor = ensureUser(foreignClinic.id, 'foreign-doctor@test.local', 'Foreign Doctor', 'doctor');
    let foreignService = db.prepare(`SELECT id FROM servicios WHERE consultorio_id=? AND nombre='Foreign Service' AND eliminado_en IS NULL`).get(foreignClinic.id);
    if (!foreignService) foreignService = { id: Number(db.prepare(`INSERT INTO servicios (consultorio_id,nombre,precio_bs,duracion_min) VALUES (?,'Foreign Service',100,30)`).run(foreignClinic.id).lastInsertRowid) };
    let service = db.prepare(`SELECT id FROM servicios WHERE consultorio_id=? AND nombre='Integration Service' AND eliminado_en IS NULL`).get(clinic.id);
    if (!service) service = { id: Number(db.prepare(`INSERT INTO servicios (consultorio_id,nombre,precio_bs,duracion_min) VALUES (?,'Integration Service',100,30)`).run(clinic.id).lastInsertRowid) };
    const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    db.prepare(`INSERT OR IGNORE INTO horarios (consultorio_id,usuario_id,dia_semana,hora_inicio,hora_fin) VALUES (?,?,?,'09:00','10:00')`).run(clinic.id, doctor.id, weekday);
    db.prepare(`DELETE FROM citas WHERE consultorio_id=? AND paciente_id=? AND motivo='INTEGRATION-BOOKING'`).run(clinic.id, patient.id);
    return { clinicId: clinic.id, clinicSlug: clinic.slug, doctorId: doctor.id, operativeId: operative.id, operative2Id: operative2.id, adminId: admin.id,
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
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWP4DwUMMAYAj4IP8cvlVgcAAAAASUVORK5CYII=', 'base64');
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

test('tratamiento sin costo: el paciente lo ve, reserva sin pago y no genera saldo', async () => {
  const doctor = request.agent(app);
  await doctor.post('/api/auth/desarrollo').send({ email: 'integration-doctor@test.local' }).expect(200);

  const created = await doctor.post('/api/servicios').send({ nombre: 'Valoración Inicial' }).expect(201);
  const serviceId = created.body.id;
  assert.equal(db.prepare('SELECT precio_bs FROM servicios WHERE id=?').get(serviceId).precio_bs, null);

  await doctor.patch(`/api/servicios/${serviceId}`).send({ precio_bs: 45 }).expect(200);
  assert.equal(db.prepare('SELECT precio_bs FROM servicios WHERE id=?').get(serviceId).precio_bs, 45);
  await doctor.patch(`/api/servicios/${serviceId}`).send({ precio_bs: '' }).expect(200);
  assert.equal(db.prepare('SELECT precio_bs FROM servicios WHERE id=?').get(serviceId).precio_bs, null);
  await doctor.post('/api/servicios').send({ nombre: 'Sin Precio', precio_bs: -5 }).expect(400);

  const patient = request.agent(app);
  await patient.post('/api/auth/desarrollo').send({ email: 'integration-patient@test.local' }).expect(200);
  const catalog = await patient.get('/api/servicios').expect(200);
  assert.ok(catalog.body.servicios.some((service) => service.id === serviceId && service.precio_bs === null));

  const date = new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10);
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  db.prepare(`INSERT OR IGNORE INTO horarios (consultorio_id,usuario_id,dia_semana,hora_inicio,hora_fin) VALUES (?,?,?,'09:00','10:00')`).run(fixture.clinicId, fixture.doctorId, weekday);
  const booking = await patient.post('/api/citas').send({
    paciente_id: fixture.patientId, doctor_id: fixture.doctorId, servicio_id: serviceId,
    inicio: `${date}T09:00:00-04:00`, motivo: 'SIN-COSTO-BOOKING'
  }).expect(201);
  const appointment = db.prepare('SELECT precio_bs,servicio_id FROM citas WHERE id=? AND consultorio_id=?').get(booking.body.id, fixture.clinicId);
  assert.deepEqual(appointment, { precio_bs: null, servicio_id: serviceId });

  const patientsBefore = await doctor.get('/api/pacientes').expect(200);
  const saldoBefore = patientsBefore.body.pacientes.find((item) => item.id === fixture.patientId).saldo_bs;
  await doctor.patch(`/api/citas/${booking.body.id}/estado`).send({ estado: 'atendida' }).expect(200);
  const patients = await doctor.get('/api/pacientes').expect(200);
  const saldoAfter = patients.body.pacientes.find((item) => item.id === fixture.patientId).saldo_bs;
  assert.equal(saldoAfter, saldoBefore);

  db.prepare('DELETE FROM citas WHERE id=?').run(booking.body.id);
  await doctor.delete(`/api/servicios/${serviceId}`).expect(200);
});

test('modo de cobro: por la app exige precio, definir lo libera, y el dashboard cuenta "por definir"', async () => {
  const doctor = request.agent(app);
  await doctor.post('/api/auth/desarrollo').send({ email: 'integration-doctor@test.local' }).expect(200);
  const clinic = await doctor.get('/api/consultorio').expect(200);
  const previousMode = clinic.body.consultorio.modo_cobro;

  try {
    await doctor.patch('/api/consultorio').send({ modo_cobro: 'app' }).expect(200);
    await doctor.post('/api/servicios').send({ nombre: 'App Sin Precio' }).expect(400);
    const paid = await doctor.post('/api/servicios').send({ nombre: 'App Con Precio', precio_bs: 60 }).expect(201);
    await doctor.patch(`/api/servicios/${paid.body.id}`).send({ precio_bs: '' }).expect(400);
    assert.equal(db.prepare('SELECT precio_bs FROM servicios WHERE id=?').get(paid.body.id).precio_bs, 60);
    await doctor.delete(`/api/servicios/${paid.body.id}`).expect(200);

    await doctor.patch('/api/consultorio').send({ modo_cobro: 'definir' }).expect(200);
    const free = await doctor.post('/api/servicios').send({ nombre: 'Definir Sin Precio' }).expect(201);
    assert.equal(db.prepare('SELECT precio_bs FROM servicios WHERE id=?').get(free.body.id).precio_bs, null);
    await doctor.delete(`/api/servicios/${free.body.id}`).expect(200);

    await doctor.patch('/api/consultorio').send({ modo_cobro: 'inventado' }).expect(400);
  } finally {
    await doctor.patch('/api/consultorio').send({ modo_cobro: previousMode }).expect(200);
  }

  const date = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  db.prepare(`INSERT OR IGNORE INTO horarios (consultorio_id,usuario_id,dia_semana,hora_inicio,hora_fin) VALUES (?,?,?,'09:00','10:00')`).run(fixture.clinicId, fixture.doctorId, weekday);
  const fixed = await doctor.post('/api/servicios').send({ nombre: 'Por Definir Dashboard', precio_bs: 30 }).expect(201);
  const monthStart = new Date();
  const inicioCita = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}-02T13:00:00.000Z`;
  const finCita = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}-02T13:30:00.000Z`;
  db.prepare(`DELETE FROM citas WHERE consultorio_id=? AND motivo='DASHBOARD-POR-DEFINIR'`).run(fixture.clinicId);
  const dashboardBefore = await doctor.get('/api/dashboard').expect(200);
  const inserted = db.prepare(`INSERT INTO citas (consultorio_id,paciente_id,doctor_id,servicio_id,inicio,fin,estado,precio_bs,creado_por,motivo)
    VALUES (?,?,?,?,?,?,'atendida',NULL,?,?)`).run(fixture.clinicId, fixture.patientId, fixture.doctorId, fixed.body.id,
    inicioCita, finCita, fixture.doctorId, 'DASHBOARD-POR-DEFINIR');
  const dashboardAfter = await doctor.get('/api/dashboard').expect(200);
  assert.ok(dashboardAfter.body.resumen.por_definir >= dashboardBefore.body.resumen.por_definir + 1, 'debe contarse la cita atendida sin precio');
  db.prepare('DELETE FROM citas WHERE id=?').run(inserted.lastInsertRowid);
  await doctor.delete(`/api/servicios/${fixed.body.id}`).expect(200);
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

test('volver a crear un paciente con un correo archivado reactiva la ficha y la cuenta', async () => {
  const doctor = request.agent(app);
  await doctor.post('/api/auth/desarrollo').send({ email: 'integration-doctor@test.local' }).expect(200);
  const codigo = `${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
  const email = `reuso-${codigo}@test.local`;

  const first = await doctor.post('/api/pacientes').send({ codigo, nombres: 'Reutilizable', apellidos: 'Correo', email }).expect(201);
  const firstId = first.body.paciente.id;
  const firstUserId = first.body.paciente.usuario_id;
  assert.ok(firstUserId);

  await doctor.delete(`/api/pacientes/${firstId}`).expect(200);
  assert.ok(db.prepare('SELECT eliminado_en FROM pacientes WHERE id=?').get(firstId).eliminado_en);

  const again = await doctor.post('/api/pacientes').send({ codigo, nombres: 'Reutilizado', apellidos: 'Correo', email }).expect(201);
  assert.equal(again.body.paciente.id, firstId);
  assert.equal(again.body.paciente.usuario_id, firstUserId);
  assert.equal(again.body.paciente.nombres, 'Reutilizado');
  assert.ok(!db.prepare('SELECT eliminado_en FROM usuarios WHERE id=?').get(firstUserId).eliminado_en);
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

test('identidad visual: solo doctores editan y los archivos no cruzan consultorios', async (t) => {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const temporary = db.transaction(() => {
    const clinicSlug = uniqueClinicSlug(`Clínica Marca ${stamp}`);
    const foreignSlug = uniqueClinicSlug(`Clínica Marca Externa ${stamp}`);
    const clinic = db.prepare(`INSERT INTO consultorios (nombre,email,slug) VALUES (?,?,?)`)
      .run('Clínica Marca', `marca-${stamp}@test.local`, clinicSlug).lastInsertRowid;
    const foreignClinic = db.prepare(`INSERT INTO consultorios (nombre,email,slug) VALUES (?,?,?)`)
      .run('Clínica Marca Externa', `marca-externa-${stamp}@test.local`, foreignSlug).lastInsertRowid;
    const doctor = db.prepare(`INSERT INTO usuarios (consultorio_id,email,nombre,rol,estado) VALUES (?,?,?,'doctor','activo')`)
      .run(clinic, `doctor-marca-${stamp}@test.local`, 'Doctor Marca').lastInsertRowid;
    const operative = db.prepare(`INSERT INTO usuarios (consultorio_id,email,nombre,rol,estado) VALUES (?,?,?,'operativo','activo')`)
      .run(clinic, `operativo-marca-${stamp}@test.local`, 'Operativo Marca').lastInsertRowid;
    const foreignDoctor = db.prepare(`INSERT INTO usuarios (consultorio_id,email,nombre,rol,estado) VALUES (?,?,?,'doctor','activo')`)
      .run(foreignClinic, `doctor-externo-${stamp}@test.local`, 'Doctor Externo').lastInsertRowid;
    return { clinic: Number(clinic), clinicSlug, foreignClinic: Number(foreignClinic), foreignSlug, doctor: Number(doctor), operative: Number(operative), foreignDoctor: Number(foreignDoctor) };
  })();
  t.after(async () => {
    const assets = db.prepare(`SELECT slug, logo_path, fondo_path FROM consultorios WHERE id IN (?,?)`)
      .all(temporary.clinic, temporary.foreignClinic);
    for (const asset of assets) {
      for (const file of [asset.logo_path, asset.fondo_path]) {
        if (file) fs.rmSync(path.join(config.uploadDir, path.basename(file)), { force: true });
      }
      for (const size of [180, 192, 512]) {
        const icon = path.join(config.uploadDir, `brand-${asset.slug}-${size}.png`);
        for (let attempt = 0; attempt < 5; attempt++) {
          try { fs.rmSync(icon, { force: true, maxRetries: 3, retryDelay: 25 }); break; }
          catch (error) {
            if (attempt === 4) throw error;
            await new Promise((resolve) => setTimeout(resolve, 30));
          }
        }
      }
    }
    db.transaction(() => {
      db.prepare(`DELETE FROM admin_auditoria WHERE entidad_tipo='consultorio' AND entidad_id IN (?,?)`)
        .run(temporary.clinic, temporary.foreignClinic);
      db.prepare(`DELETE FROM auditoria WHERE consultorio_id IN (?,?)`).run(temporary.clinic, temporary.foreignClinic);
      db.prepare(`DELETE FROM usuarios WHERE id IN (?,?,?)`).run(temporary.doctor, temporary.operative, temporary.foreignDoctor);
      db.prepare(`DELETE FROM consultorios WHERE id IN (?,?)`).run(temporary.clinic, temporary.foreignClinic);
    })();
  });

  const doctor = request.agent(app);
  const operative = request.agent(app);
  const foreignDoctor = request.agent(app);
  await doctor.post('/api/auth/desarrollo').send({ email: `doctor-marca-${stamp}@test.local` }).expect(200);
  await operative.post('/api/auth/desarrollo').send({ email: `operativo-marca-${stamp}@test.local` }).expect(200);
  await foreignDoctor.post('/api/auth/desarrollo').send({ email: `doctor-externo-${stamp}@test.local` }).expect(200);

  const updated = await doctor.patch('/api/consultorio').send({
    marca_nombre: 'Sonrisa Norte', color_primario: '#173f5f', color_acento: '#d05a43',
    color_fondo: '#f7f4ed', fondo_opacidad: 24
  }).expect(200);
  assert.equal(updated.body.consultorio.marca_nombre, 'Sonrisa Norte');
  assert.equal(updated.body.consultorio.color_primario, '#173f5f');
  assert.equal(updated.body.consultorio.fondo_opacidad, 24);
  assert.equal('logo_path' in updated.body.consultorio, false);
  assert.equal('fondo_path' in updated.body.consultorio, false);
  await doctor.patch('/api/consultorio').send({ color_primario: '#fff' }).expect(400);
  await doctor.patch('/api/consultorio').send({ color_primario: '#eeeeee' }).expect(400);
  await doctor.patch('/api/consultorio').send({ color_acento: '#ffff00' }).expect(400);
  await doctor.patch('/api/consultorio').send({ marca_nombre: 'M'.repeat(61) }).expect(400);
  await doctor.patch('/api/consultorio').send({ fondo_opacidad: 60 }).expect(400);
  await operative.patch('/api/consultorio').send({ marca_nombre: 'Sin permiso' }).expect(403);
  await operative.post('/api/consultorio/identidad/logo').expect(403);
  await doctor.post('/api/consultorio/identidad/logo')
    .attach('imagen', Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]),
      { filename: 'logo-corrupto.png', contentType: 'image/png' }).expect(400);
  assert.equal(db.prepare('SELECT logo_path FROM consultorios WHERE id=?').get(temporary.clinic).logo_path, null);

  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWP4DwUMMAYAj4IP8cvlVgcAAAAASUVORK5CYII=', 'base64');
  const logo = await doctor.post('/api/consultorio/identidad/logo')
    .attach('imagen', image, { filename: 'logo.png', contentType: 'image/png' }).expect(200);
  const background = await doctor.post('/api/consultorio/identidad/fondo')
    .attach('imagen', image, { filename: 'fondo.png', contentType: 'image/png' }).expect(200);
  assert.match(logo.body.consultorio.logo_url, /^\/api\/consultorio\/identidad\/logo\/imagen\?v=/);
  assert.match(background.body.consultorio.fondo_url, /^\/api\/consultorio\/identidad\/fondo\/imagen\?v=/);
  assert.equal(logo.body.consultorio.app_path, `/c/${temporary.clinicSlug}`);

  const publicClinic = await request(app).get(`/api/publico/clinicas/${temporary.clinicSlug}`).expect(200);
  assert.equal(publicClinic.body.consultorio.marca_nombre, 'Sonrisa Norte');
  assert.equal(publicClinic.body.consultorio.app_path, `/c/${temporary.clinicSlug}`);
  assert.match(publicClinic.body.consultorio.logo_url, new RegExp(`/api/publico/clinicas/${temporary.clinicSlug}/logo`));
  assert.equal('email' in publicClinic.body.consultorio, false);
  const manifest = await request(app).get(`/api/publico/clinicas/${temporary.clinicSlug}/manifest.webmanifest`).expect(200);
  assert.match(manifest.headers['content-type'], /application\/manifest\+json/);
  assert.equal(manifest.body.id, `/c/${temporary.clinicSlug}/`);
  assert.equal(manifest.body.name, 'Sonrisa Norte');
  assert.equal(manifest.body.start_url, `/c/${temporary.clinicSlug}/?origen=app`);
  assert.equal(manifest.body.scope, `/c/${temporary.clinicSlug}/`);
  assert.ok(manifest.body.icons.some((icon) => icon.sizes === '512x512' && icon.purpose.includes('maskable')));
  await request(app).get(`/api/publico/clinicas/${temporary.clinicSlug}/icon/180.png`).expect(200).expect('Content-Type', /image\/png/);
  await request(app).get(`/api/publico/clinicas/${temporary.clinicSlug}/icon/192.png`).expect(200).expect('Content-Type', /image\/png/);
  await request(app).get(`/api/publico/clinicas/${temporary.clinicSlug}/icon/512.png`).expect(200).expect('Content-Type', /image\/png/);
  await request(app).get(`/api/publico/clinicas/${temporary.clinicSlug}/logo`).expect(200).expect('Content-Type', /image\/png/);
  await request(app).get('/api/publico/clinicas/no-existe').expect(404);

  await doctor.patch('/api/consultorio').send({ nombre: 'Clínica Renombrada' }).expect(200);
  const stableSlug = await doctor.get('/api/consultorio').expect(200);
  assert.equal(stableSlug.body.consultorio.slug, temporary.clinicSlug);

  const shared = await operative.get('/api/consultorio').expect(200);
  assert.equal(shared.body.consultorio.marca_nombre, 'Sonrisa Norte');
  assert.ok(shared.body.consultorio.logo_url);
  assert.ok(shared.body.consultorio.fondo_url);
  await operative.get(shared.body.consultorio.logo_url).expect(200).expect('Content-Type', /image\/png/);
  await foreignDoctor.get('/api/consultorio/identidad/logo/imagen').expect(404);
  const foreignBrand = await foreignDoctor.get('/api/consultorio').expect(200);
  assert.notEqual(foreignBrand.body.consultorio.marca_nombre, 'Sonrisa Norte');

  await doctor.delete('/api/consultorio/identidad/logo').expect(200);
  await doctor.delete('/api/consultorio/identidad/fondo').expect(200);
  await doctor.get('/api/consultorio/identidad/logo/imagen').expect(404);
  await request(app).get(`/api/publico/clinicas/${temporary.clinicSlug}/logo?v=${encodeURIComponent('archivo-anterior.png')}`).expect(404);
  const audit = db.prepare(`SELECT COUNT(*) total FROM auditoria WHERE consultorio_id=? AND accion IN ('actualizar_logo','actualizar_fondo')`)
    .get(temporary.clinic);
  assert.equal(audit.total, 2);
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
  const deletedUser = db.prepare('SELECT estado,google_sub,eliminado_en FROM usuarios WHERE id=?').get(invited.body.id);
  assert.equal(deletedUser.estado, 'suspendido');
  assert.equal(deletedUser.google_sub, null);
  assert.ok(deletedUser.eliminado_en);
  const { findOrCreateGoogleUser } = await import('../src/routes/auth.js');
  assert.throws(() => findOrCreateGoogleUser({ sub: 'deleted-user-sub', email: 'new-clinic@test.local', email_verified: true, name: 'Eliminado' }), /eliminada/i);

  const temporarySlug = uniqueClinicSlug('Clínica Temporal');
  const temporary = db.prepare(`INSERT INTO consultorios (nombre, email, slug) VALUES ('Clínica Temporal','temporal@test.local',?)`)
    .run(temporarySlug);
  await admin.delete(`/api/admin/consultorios/${temporary.lastInsertRowid}`).expect(200);
  assert.ok(db.prepare('SELECT eliminado_en FROM consultorios WHERE id=?').get(temporary.lastInsertRowid).eliminado_en);
  await request(app).get(`/api/publico/clinicas/${temporarySlug}`).expect(404);

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
  const clinic = db.prepare('SELECT slug FROM consultorios WHERE id=?').get(created.body.consultorio_id);
  assert.match(clinic.slug, /^clinica-invitacion(?:-\d+)?$/);
  await request(app).get(`/api/publico/clinicas/${clinic.slug}`).expect(200);
});

test('un superadmin que tenía rol paciente recupera el portal de doctor', async (t) => {
  const { findOrCreateGoogleUser } = await import('../src/routes/auth.js');
  const clinic = db.prepare(`SELECT id FROM consultorios WHERE email='foreign@clinic.test'`).get();
  const existing = db.prepare(`SELECT id FROM usuarios WHERE email='admin@test.local' AND consultorio_id=?`).get(clinic.id);
  const userId = existing?.id || Number(db.prepare(`INSERT INTO usuarios (consultorio_id,email,nombre,rol,estado) VALUES (?,?,?,'paciente','activo')`)
    .run(clinic.id, 'admin@test.local', 'Admin Paciente').lastInsertRowid);
  db.prepare(`UPDATE usuarios SET rol='paciente', estado='activo', google_sub=NULL, eliminado_en=NULL WHERE id=?`).run(userId);
  t.after(() => db.prepare('UPDATE usuarios SET eliminado_en=CURRENT_TIMESTAMP WHERE id=?').run(userId));

  const user = findOrCreateGoogleUser({
    sub: `sub-admin-${userId}`,
    email: 'admin@test.local',
    email_verified: true,
    name: 'Admin Paciente'
  });
  assert.equal(user.rol, 'doctor');
  assert.equal(user.es_admin, true);
  const row = db.prepare('SELECT rol, google_sub FROM usuarios WHERE id=?').get(user.id);
  assert.equal(row.rol, 'doctor');
  assert.equal(row.google_sub, `sub-admin-${userId}`);
});

test('el acceso marcado selecciona la membresía de la clínica correcta', async (t) => {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `multiclinica-${stamp}@test.local`;
  const slugA = uniqueClinicSlug(`Clínica OAuth A ${stamp}`);
  const slugB = uniqueClinicSlug(`Clínica OAuth B ${stamp}`);
  const clinicA = Number(db.prepare(`INSERT INTO consultorios (nombre,email,slug) VALUES (?,?,?)`)
    .run('Clínica OAuth A', `oauth-a-${stamp}@test.local`, slugA).lastInsertRowid);
  const clinicB = Number(db.prepare(`INSERT INTO consultorios (nombre,email,slug) VALUES (?,?,?)`)
    .run('Clínica OAuth B', `oauth-b-${stamp}@test.local`, slugB).lastInsertRowid);
  const userA = Number(db.prepare(`INSERT INTO usuarios (consultorio_id,email,nombre,rol,estado) VALUES (?,?,?,'doctor','preautorizado')`)
    .run(clinicA, email, 'Doctor Multi A').lastInsertRowid);
  const userB = Number(db.prepare(`INSERT INTO usuarios (consultorio_id,email,nombre,rol,estado) VALUES (?,?,?,'doctor','preautorizado')`)
    .run(clinicB, email, 'Doctor Multi B').lastInsertRowid);
  let adminPatient;
  t.after(() => db.transaction(() => {
    if (adminPatient) db.prepare('DELETE FROM usuarios WHERE id=?').run(adminPatient);
    db.prepare('DELETE FROM usuarios WHERE id IN (?,?)').run(userA, userB);
    db.prepare('DELETE FROM consultorios WHERE id IN (?,?)').run(clinicA, clinicB);
  })());
  const { findOrCreateGoogleUser } = await import('../src/routes/auth.js');
  const profile = { sub: `sub-${stamp}`, email, email_verified: true, name: 'Doctor Multi' };

  const selectedB = findOrCreateGoogleUser(profile, slugB);
  assert.equal(selectedB.id, userB);
  assert.equal(selectedB.consultorio_id, clinicB);
  assert.equal(selectedB.consultorio_slug, slugB);
  const selectedA = findOrCreateGoogleUser(profile, slugA);
  assert.equal(selectedA.id, userA);
  assert.equal(selectedA.consultorio_id, clinicA);
  assert.equal(selectedA.consultorio_slug, slugA);
  assert.throws(() => findOrCreateGoogleUser(profile, fixture.clinicSlug), /no tiene acceso autorizado/i);

  const adminEmail = 'admin@test.local';
  adminPatient = Number(db.prepare(`INSERT INTO usuarios (consultorio_id,email,nombre,rol,estado)
    VALUES (?,?,?,'paciente','preautorizado')`).run(clinicB, adminEmail, 'Admin Paciente B').lastInsertRowid);
  const selectedPatient = findOrCreateGoogleUser({ sub: `sub-admin-patient-${stamp}`, email: adminEmail,
    email_verified: true, name: 'Admin Paciente B' }, slugB);
  assert.equal(selectedPatient.id, adminPatient);
  assert.equal(selectedPatient.consultorio_id, clinicB);
  assert.equal(selectedPatient.rol, 'paciente');
});

test('cotizaciones: servicios del catálogo con o sin precio, edición y aislamiento por consultorio', async () => {
  const doctor = request.agent(app);
  await doctor.post('/api/auth/desarrollo').send({ email: 'integration-doctor@test.local' }).expect(200);
  const codigo = `${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
  const patient = await doctor.post('/api/pacientes').send({ codigo, nombres: 'Cotizable', apellidos: 'Paciente' }).expect(201);
  const patientId = patient.body.paciente.id;
  const extraServiceId = Number(db.prepare(`INSERT INTO servicios (consultorio_id,nombre,precio_bs,duracion_min)
    VALUES (?,?,0,60)`).run(fixture.clinicId, 'Ortodoncia').lastInsertRowid);

  const created = await doctor.post('/api/presupuestos').send({
    paciente_id: patientId,
    titulo: 'Plan integral',
    items: [
      { servicio_id: fixture.serviceId, cantidad: 2, precio_bs: 120 },
      { servicio_id: extraServiceId },
      { nombre: 'Férula de descarga', cantidad: 1, duracion_min: 45 },
    ],
  }).expect(201);
  const quoteId = created.body.id;

  const detail = await doctor.get(`/api/presupuestos/${quoteId}`).expect(200);
  assert.equal(detail.body.presupuesto.paciente_id, patientId);
  assert.equal(detail.body.presupuesto.estado, 'borrador');
  assert.equal(detail.body.presupuesto.items.length, 3);
  const priced = detail.body.presupuesto.items.find((item) => item.servicio_id === fixture.serviceId);
  assert.equal(priced.nombre, 'Integration Service');
  assert.equal(priced.cantidad, 2);
  assert.equal(priced.precio_bs, 120);
  const unpriced = detail.body.presupuesto.items.find((item) => item.servicio_id === extraServiceId);
  assert.equal(unpriced.precio_bs, null);
  assert.equal(detail.body.presupuesto.resumen.total_bs, 240);
  assert.equal(detail.body.presupuesto.resumen.sin_precio, 2);

  await doctor.patch(`/api/presupuestos/${quoteId}/estado`).send({ estado: 'entregado' }).expect(200);
  await doctor.patch(`/api/presupuestos/${quoteId}/estado`).send({ estado: 'aceptado' }).expect(200);
  await doctor.patch(`/api/presupuestos/${quoteId}/estado`).send({ estado: 'invalido' }).expect(400);
  assert.equal(db.prepare('SELECT estado FROM presupuestos WHERE id=?').get(quoteId).estado, 'aceptado');

  await doctor.patch(`/api/presupuestos/${quoteId}`).send({
    titulo: 'Plan ajustado',
    items: [{ servicio_id: fixture.serviceId, precio_bs: 150 }],
  }).expect(200);
  const after = await doctor.get(`/api/presupuestos/${quoteId}`).expect(200);
  assert.equal(after.body.presupuesto.titulo, 'Plan ajustado');
  assert.equal(after.body.presupuesto.items.length, 1);
  assert.equal(after.body.presupuesto.resumen.total_bs, 150);
  assert.equal(after.body.presupuesto.resumen.sin_precio, 0);

  await doctor.post('/api/presupuestos').send({ paciente_id: patientId, items: [] }).expect(400);
  await doctor.post('/api/presupuestos').send({ paciente_id: patientId }).expect(400);
  await doctor.post('/api/presupuestos').send({ paciente_id: fixture.foreignPatientId, items: [{ nombre: 'X' }] }).expect(404);

  const list = await doctor.get('/api/presupuestos').query({ paciente_id: patientId, estado: 'aceptado' }).expect(200);
  assert.ok(list.body.presupuestos.some((quote) => quote.id === quoteId));
  assert.equal(typeof list.body.presupuestos[0].resumen.total_bs, 'number');

  assert.ok(db.prepare(`SELECT id FROM auditoria WHERE entidad_tipo='presupuesto' AND entidad_id=? AND accion='crear'`).get(quoteId));
  assert.ok(db.prepare(`SELECT id FROM auditoria WHERE entidad_tipo='presupuesto' AND entidad_id=? AND accion='cambiar_estado'`).get(quoteId));

  const operative = request.agent(app);
  await operative.post('/api/auth/desarrollo').send({ email: 'integration-operative@test.local' }).expect(200);
  const byOperative = await operative.post('/api/presupuestos').send({ paciente_id: patientId, items: [{ nombre: 'Evaluación inicial' }] }).expect(201);
  await operative.delete(`/api/presupuestos/${byOperative.body.id}`).expect(200);
  assert.ok(db.prepare('SELECT eliminado_en FROM presupuestos WHERE id=?').get(byOperative.body.id).eliminado_en);

  const foreign = request.agent(app);
  await foreign.post('/api/auth/desarrollo').send({ email: 'foreign-doctor@test.local' }).expect(200);
  await foreign.get(`/api/presupuestos/${quoteId}`).expect(404);
  await foreign.patch(`/api/presupuestos/${quoteId}`).send({ titulo: 'Ajeno' }).expect(404);
  await foreign.patch(`/api/presupuestos/${quoteId}/estado`).send({ estado: 'aceptado' }).expect(404);
  const foreignList = await foreign.get('/api/presupuestos').expect(200);
  assert.equal(foreignList.body.presupuestos.length, 0);
});

test('cotizaciones: enlace público, borrador oculto, estado entregado visible y visto_en', async () => {
  const doctor = request.agent(app);
  await doctor.post('/api/auth/desarrollo').send({ email: 'integration-doctor@test.local' }).expect(200);
  const codigo = `${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
  const patient = await doctor.post('/api/pacientes').send({ codigo, nombres: 'Vista', apellidos: 'Publica' }).expect(201);
  const patientId = patient.body.paciente.id;

  const created = await doctor.post('/api/presupuestos').send({
    paciente_id: patientId,
    titulo: 'Plan compartido',
    items: [{ nombre: 'Blanqueamiento', cantidad: 1, precio_bs: 350, duracion_min: 60 }],
  }).expect(201);
  let quoteId = created.body.id;

  const detail = await doctor.get(`/api/presupuestos/${quoteId}`).expect(200);
  const token = detail.body.presupuesto.public_token;
  assert.ok(token && token.length >= 20, 'se genera un token público');

  await request(app).get(`/api/presupuestos/publico/${token}`).expect(404).expect((res) => {
    assert.match(res.body.mensaje, /no disponible/i, 'borrador no se comparte todavía');
  });

  await doctor.post(`/api/presupuestos/${quoteId}/compartir`).expect(200);
  assert.ok(db.prepare('SELECT compartido_en FROM presupuestos WHERE id=?').get(quoteId).compartido_en, 'se marca compartido');
  assert.ok(db.prepare(`SELECT id FROM auditoria WHERE entidad_tipo='presupuesto' AND entidad_id=? AND accion='compartir'`).get(quoteId), 'audita el compartir');

  await doctor.patch(`/api/presupuestos/${quoteId}/estado`).send({ estado: 'entregado' }).expect(200);

  let pub = await request(app).get(`/api/presupuestos/publico/${token}`).expect(200);
  assert.equal(pub.body.paciente.nombres, 'Vista');
  assert.equal(pub.body.consultorio.nombre, 'Integration Clinic');
  assert.equal(pub.body.cotizacion.estado, 'entregado');
  assert.equal(pub.body.cotizacion.items.length, 1);
  assert.equal(pub.body.cotizacion.total_bs, 350);
  assert.ok(db.prepare('SELECT visto_en FROM presupuestos WHERE id=?').get(quoteId).visto_en, 'primer visto marca visto_en');
  assert.ok(db.prepare(`SELECT id FROM auditoria WHERE entidad_tipo='presupuesto' AND entidad_id=? AND accion='presupuesto_publico_visto'`).get(quoteId), 'audita el primer visto');

  await request(app).get(`/api/presupuestos/publico/${token}`).expect(200);
  assert.equal(db.prepare(`SELECT COUNT(*) total FROM auditoria WHERE entidad_tipo='presupuesto' AND entidad_id=? AND accion='presupuesto_publico_visto'`).get(quoteId).total, 1, 'no re-audita segundos vistos');

  const ghost = await doctor.get(`/api/presupuestos`).expect(200);
  const ghostQuote = ghost.body.presupuestos.find((quote) => quote.id === quoteId);
  assert.equal(ghostQuote.public_token, token, 'el listado devuelve el mismo token');

  await doctor.patch(`/api/presupuestos/${quoteId}/estado`).send({ estado: 'archivado' }).expect(200);
  await request(app).get(`/api/presupuestos/publico/${token}`).expect(404);
  await request(app).get(`/api/presupuestos/publico/token-inventado-1234567890`).expect(404);
});

test('eliminar un consultorio revoca sesión y cotizaciones públicas', async (t) => {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const slug = uniqueClinicSlug(`Clínica Eliminada ${stamp}`);
  const clinicId = Number(db.prepare(`INSERT INTO consultorios (nombre,email,slug) VALUES (?,?,?)`)
    .run('Clínica Eliminada', `eliminada-${stamp}@test.local`, slug).lastInsertRowid);
  const doctorId = Number(db.prepare(`INSERT INTO usuarios (consultorio_id,email,nombre,rol,estado) VALUES (?,?,?,'doctor','activo')`)
    .run(clinicId, `doctor-eliminado-${stamp}@test.local`, 'Doctor Eliminado').lastInsertRowid);
  const patientId = Number(db.prepare(`INSERT INTO pacientes (consultorio_id,codigo,nombres,apellidos)
    VALUES (?,?,?,?)`).run(clinicId, `9${Date.now()}`, 'Paciente', 'Eliminado').lastInsertRowid);
  const quoteId = Number(db.prepare(`INSERT INTO presupuestos (consultorio_id,paciente_id,titulo,estado,token_publico,creado_por)
    VALUES (?,?,?,'entregado',?,?)`).run(clinicId, patientId, 'Cotización eliminada', `token-eliminado-${stamp}`, doctorId).lastInsertRowid);
  db.prepare(`INSERT INTO presupuesto_items (presupuesto_id,nombre,cantidad,precio_bs,posicion)
    VALUES (?,?,1,100,0)`).run(quoteId, 'Servicio eliminado');
  t.after(() => db.transaction(() => {
    db.prepare('DELETE FROM auditoria WHERE consultorio_id=?').run(clinicId);
    db.prepare('DELETE FROM presupuesto_items WHERE presupuesto_id=?').run(quoteId);
    db.prepare('DELETE FROM presupuestos WHERE id=?').run(quoteId);
    db.prepare('DELETE FROM pacientes WHERE id=?').run(patientId);
    db.prepare('DELETE FROM usuarios WHERE id=?').run(doctorId);
    db.prepare('DELETE FROM consultorios WHERE id=?').run(clinicId);
  })());

  const token = jwt.sign({ sub: String(doctorId), consultorioId: clinicId, rol: 'doctor' }, config.jwtSecret, { expiresIn: '1d' });
  await request(app).get(`/api/presupuestos/publico/token-eliminado-${stamp}`).expect(200);
  db.prepare(`UPDATE consultorios SET eliminado_en=CURRENT_TIMESTAMP WHERE id=?`).run(clinicId);
  await request(app).get(`/api/presupuestos/publico/token-eliminado-${stamp}`).expect(404);
  await request(app).get('/api/agenda').set('Cookie', `dentista_token=${token}`).expect(401);
});

test('un archivo público faltante responde 404 sin interrumpir el servidor', async (t) => {
  const slug = uniqueClinicSlug(`Clínica Archivo Faltante ${Date.now()}`);
  const clinicId = Number(db.prepare(`INSERT INTO consultorios (nombre,email,slug,logo_path)
    VALUES (?,?,?,?)`).run('Clínica Archivo Faltante', `faltante-${Date.now()}@test.local`, slug, 'no-existe.png').lastInsertRowid);
  t.after(() => db.prepare('DELETE FROM consultorios WHERE id=?').run(clinicId));
  await request(app).get(`/api/publico/clinicas/${slug}/logo?v=no-existe.png`).expect(404);
  await request(app).get('/api/health').expect(200);
});

test('correo: el enlace con Google exige sesión y la desconexión limpia la configuración', async () => {
  await request(app).get('/api/auth/google/gmail').expect(401);

  const doctor = request.agent(app);
  await doctor.post('/api/auth/desarrollo').send({ email: 'integration-doctor@test.local' }).expect(200);

  const config = await doctor.get('/api/correo/configuracion').expect(200);
  assert.equal(config.body.configuracion.oauth_conectado, false);
  assert.equal(config.body.configuracion.modo, 'global');
  assert.equal(config.body.configuracion.gmail_disponible, false);

  await doctor.get('/api/auth/google/gmail').expect(503);

  const callback = await doctor.get('/api/auth/google/gmail/callback').expect(303);
  assert.match(callback.headers.location, /\/configuracion\?correo=error/);
  assert.match(callback.headers.location, /motivo=/);

  await doctor.post('/api/correo/gmail/desconectar').expect(200);
  const after = await doctor.get('/api/correo/configuracion').expect(200);
  assert.equal(after.body.configuracion.modo, 'global');
  assert.equal(after.body.configuracion.oauth_conectado, false);

  await doctor.put('/api/correo/configuracion').send({ modo: 'propio', smtp_user: 'clinica@gmail.com' }).expect(400);

  const operative = request.agent(app);
  await operative.post('/api/auth/desarrollo').send({ email: 'integration-operative@test.local' }).expect(200);
  await operative.post('/api/correo/gmail/desconectar').expect(403);
  await operative.get('/api/correo/configuracion').expect(403);
});

test('mantenimiento: conserva archivos de marca y limpia uploads huérfanos', async () => {
  const { runMaintenance } = await import('../src/maintenance.js');
  const { config } = await import('../src/config.js');
  const oldDate = new Date(Date.now() - 200 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const recentDate = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 19).replace('T', ' ');

  const oldNotif = db.prepare(`INSERT INTO notificaciones (consultorio_id, usuario_id, tipo, titulo, mensaje, creado_en)
    VALUES (?, ?, 'm', 'm', 'm', ?)`).run(fixture.clinicId, fixture.doctorId, oldDate).lastInsertRowid;
  const newNotif = db.prepare(`INSERT INTO notificaciones (consultorio_id, usuario_id, tipo, titulo, mensaje, creado_en)
    VALUES (?, ?, 'm', 'm', 'm', ?)`).run(fixture.clinicId, fixture.doctorId, recentDate).lastInsertRowid;
  const oldAudit = db.prepare(`INSERT INTO auditoria (consultorio_id, usuario_id, accion, entidad_tipo, creado_en)
    VALUES (?, ?, 'm', 'm', ?)`).run(fixture.clinicId, fixture.doctorId, oldDate).lastInsertRowid;
  const newAudit = db.prepare(`INSERT INTO auditoria (consultorio_id, usuario_id, accion, entidad_tipo, creado_en)
    VALUES (?, ?, 'm', 'm', ?)`).run(fixture.clinicId, fixture.doctorId, recentDate).lastInsertRowid;

  fs.mkdirSync(config.uploadDir, { recursive: true });
  const orphanName = `orphan-test-${Date.now()}.png`;
  const orphanPath = path.join(config.uploadDir, orphanName);
  fs.writeFileSync(orphanPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const brandName = `brand-test-${Date.now()}.png`;
  const brandPath = path.join(config.uploadDir, brandName);
  fs.writeFileSync(brandPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const previousBrand = db.prepare('SELECT logo_path FROM consultorios WHERE id=?').get(fixture.clinicId).logo_path;
  db.prepare('UPDATE consultorios SET logo_path=? WHERE id=?').run(brandName, fixture.clinicId);

  try {
    const pasos = runMaintenance({ auditoriaDays: 100, notificacionesDays: 90, vacuum: false });
    assert.ok(/eliminadas/.test(pasos.notificaciones), `notificaciones: ${pasos.notificaciones}`);
    assert.ok(/eliminadas/.test(pasos.auditoria), `auditoria: ${pasos.auditoria}`);
    assert.ok(/huérfanos/.test(pasos.uploads), `uploads: ${pasos.uploads}`);
    assert.ok(/OK|truncado/.test(pasos.wal_checkpoint), `wal: ${pasos.wal_checkpoint}`);

    assert.equal(db.prepare('SELECT id FROM notificaciones WHERE id=?').get(oldNotif), undefined);
    assert.ok(db.prepare('SELECT id FROM notificaciones WHERE id=?').get(newNotif));
    assert.equal(db.prepare('SELECT id FROM auditoria WHERE id=?').get(oldAudit), undefined);
    assert.ok(db.prepare('SELECT id FROM auditoria WHERE id=?').get(newAudit));
    assert.equal(fs.existsSync(orphanPath), false, 'huérfano debe ser eliminado');
    assert.equal(fs.existsSync(brandPath), true, 'logo referenciado debe conservarse');
  } finally {
    if (fs.existsSync(orphanPath)) fs.unlinkSync(orphanPath);
    if (fs.existsSync(brandPath)) fs.unlinkSync(brandPath);
    db.prepare('UPDATE consultorios SET logo_path=? WHERE id=?').run(previousBrand, fixture.clinicId);
    db.prepare('DELETE FROM notificaciones WHERE id IN (?, ?)').run(oldNotif, newNotif);
    db.prepare('DELETE FROM auditoria WHERE id IN (?, ?)').run(oldAudit, newAudit);
  }
});
