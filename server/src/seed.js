import { db } from './db.js';

const seed = db.transaction(() => {
  let clinic = db.prepare(`SELECT id FROM consultorios WHERE email='contacto@sonrisas.test' AND eliminado_en IS NULL`).get();
  if (!clinic) {
    const result = db.prepare(`INSERT INTO consultorios (nombre,nit,telefono,email,direccion)
      VALUES ('Clínica SONRIDENT Demo','1020304050','+591 70000001','contacto@sonrisas.test','Av. Ficticia 123, La Paz')`).run();
    clinic = { id: Number(result.lastInsertRowid) };
  }
  db.prepare(`UPDATE consultorios SET nombre='Clínica SONRIDENT Demo' WHERE id=? AND nombre='Clínica Sonrisas Andinas'`).run(clinic.id);
  const addUser = db.prepare(`INSERT OR IGNORE INTO usuarios (consultorio_id,email,nombre,rol,estado)
    VALUES (?,?,?,?,'activo')`);
  addUser.run(clinic.id, 'doctora@sonrisas.test', 'Dra. Valeria Flores', 'doctor');
  addUser.run(clinic.id, 'recepcion@sonrisas.test', 'María Quispe', 'operativo');
  addUser.run(clinic.id, 'paciente@sonrisas.test', 'Carlos Mendoza', 'paciente');
  const doctor = db.prepare(`SELECT id FROM usuarios WHERE consultorio_id=? AND email='doctora@sonrisas.test'`).get(clinic.id);
  const operator = db.prepare(`SELECT id FROM usuarios WHERE consultorio_id=? AND email='recepcion@sonrisas.test'`).get(clinic.id);
  const patientUser = db.prepare(`SELECT id FROM usuarios WHERE consultorio_id=? AND email='paciente@sonrisas.test'`).get(clinic.id);

  let patient = db.prepare(`SELECT id FROM pacientes WHERE consultorio_id=? AND email='paciente@sonrisas.test' COLLATE NOCASE`).get(clinic.id);
  if (!patient) {
    const result = db.prepare(`INSERT INTO pacientes
      (consultorio_id,usuario_id,codigo,nombres,apellidos,email,telefono,fecha_nacimiento,documento,direccion,alergias,antecedentes)
      VALUES (?,?,'0001','Carlos','Mendoza','paciente@sonrisas.test','+591 70000002','1990-05-16','FICT-123','Calle Inventada 45','Ninguna conocida','Sin antecedentes relevantes')`)
      .run(clinic.id, patientUser.id);
    patient = { id: Number(result.lastInsertRowid) };
  }
  db.prepare(`UPDATE pacientes SET codigo='0001' WHERE id=? AND codigo='CLI-0001'`).run(patient.id);
  const addService = db.prepare(`INSERT INTO servicios (consultorio_id,nombre,descripcion,precio_bs,duracion_min) VALUES (?,?,?,?,?)`);
  let cleaning = db.prepare(`SELECT id FROM servicios WHERE consultorio_id=? AND nombre='Limpieza dental' AND eliminado_en IS NULL`).get(clinic.id);
  if (!cleaning) cleaning = { id: Number(addService.run(clinic.id, 'Limpieza dental', 'Profilaxis dental completa', 250, 45).lastInsertRowid) };
  if (!db.prepare(`SELECT id FROM servicios WHERE consultorio_id=? AND nombre='Consulta general' AND eliminado_en IS NULL`).get(clinic.id))
    addService.run(clinic.id, 'Consulta general', 'Evaluación odontológica', 120, 30);
  db.prepare(`INSERT OR IGNORE INTO horarios (consultorio_id,usuario_id,dia_semana,hora_inicio,hora_fin) VALUES (?, ?, 1, '08:00', '16:00')`)
    .run(clinic.id, doctor.id);

  let appointment = db.prepare(`SELECT id FROM citas WHERE consultorio_id=? AND paciente_id=? AND motivo='Datos ficticios de demostración'`).get(clinic.id, patient.id);
  if (!appointment) {
    const result = db.prepare(`INSERT INTO citas
      (consultorio_id,paciente_id,doctor_id,servicio_id,inicio,fin,estado,precio_bs,motivo,creado_por)
      VALUES (?,?,?,?,datetime('now','-2 days'),datetime('now','-2 days','+45 minutes'),'atendida',250,'Datos ficticios de demostración',?)`)
      .run(clinic.id, patient.id, doctor.id, cleaning.id, operator.id);
    appointment = { id: Number(result.lastInsertRowid) };
  }
  if (!db.prepare(`SELECT id FROM registros_clinicos WHERE consultorio_id=? AND cita_id=?`).get(clinic.id, appointment.id))
    db.prepare(`INSERT INTO registros_clinicos (consultorio_id,paciente_id,cita_id,doctor_id,diagnostico,tratamiento,observaciones)
      VALUES (?,?,?,?,?,?,?)`).run(clinic.id, patient.id, appointment.id, doctor.id, 'Gingivitis leve', 'Profilaxis y orientación de higiene', 'Control en seis meses');
  if (!db.prepare(`SELECT id FROM pagos WHERE consultorio_id=? AND cita_id=? AND referencia='SEMILLA-EFECTIVO'`).get(clinic.id, appointment.id))
    db.prepare(`INSERT INTO pagos (consultorio_id,paciente_id,cita_id,monto_bs,metodo,estado,referencia,registrado_por)
      VALUES (?,?,?,?, 'efectivo','valido','SEMILLA-EFECTIVO',?)`).run(clinic.id, patient.id, appointment.id, 100, operator.id);
  if (!db.prepare(`SELECT id FROM notificaciones WHERE consultorio_id=? AND usuario_id=? AND mensaje='Datos ficticios listos para probar'`).get(clinic.id, doctor.id))
    db.prepare(`INSERT INTO notificaciones (consultorio_id,usuario_id,tipo,titulo,mensaje) VALUES (?,?,'sistema','Entorno de demostración','Datos ficticios listos para probar')`)
      .run(clinic.id, doctor.id);
  return clinic.id;
});

const clinicId = seed();
console.log(`Semilla ficticia creada para el consultorio ${clinicId}`);
console.log('Acceso de desarrollo: doctora@sonrisas.test, recepcion@sonrisas.test o paciente@sonrisas.test');
