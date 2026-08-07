import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Router } from 'express';
import { authenticate, requireAdmin } from '../auth.js';
import { config } from '../config.js';
import { db } from '../db.js';
import { ApiError, asyncRoute, required } from '../http.js';
import { createSnapshot } from '../backup.js';

const require = createRequire(import.meta.url);
const archiver = require('archiver');

const router = Router();
router.use(authenticate, requireAdmin);

const id = (value) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new ApiError(400, 'Identificador inválido');
  return parsed;
};

function adminLog(user, accion, entidadTipo, entidadId, datos, ip) {
  db.prepare(`INSERT INTO admin_auditoria (usuario_id, accion, entidad_tipo, entidad_id, datos_json, ip)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(user.id, accion, entidadTipo, entidadId || null, datos ? JSON.stringify(datos) : null, ip || null);
}

const userById = (userId) => db.prepare(`SELECT id, consultorio_id, email, nombre, rol, estado
  FROM usuarios WHERE id = ? AND eliminado_en IS NULL`).get(userId);

const clinicById = (clinicId) => db.prepare(`SELECT id, nombre, email, qr_path FROM consultorios
  WHERE id = ? AND eliminado_en IS NULL`).get(clinicId);

function clinicActivity(clinic) {
  const now = Date.now();
  const days = (value) => (value ? (now - new Date(value).getTime()) / 86400000 : null);
  if (clinic.cita_futuras > 0) return 'activo';
  if (!clinic.pacientes && !clinic.citas && !clinic.doctores) return 'vacio';
  const values = [days(clinic.ultima_actividad), days(clinic.ultima_cita)].filter((value) => value !== null);
  if (!values.length) return clinic.doctores ? 'inactivo' : 'sinusuario';
  const menor = Math.min(...values);
  if (menor < 7) return 'activo';
  if (menor < 30) return 'inactivo';
  return 'abandonado';
}

router.get('/resumen', (req, res) => {
  const counts = {
    consultorios: db.prepare(`SELECT COUNT(*) total FROM consultorios WHERE eliminado_en IS NULL`).get().total,
    usuarios: db.prepare(`SELECT COUNT(*) total FROM usuarios WHERE eliminado_en IS NULL`).get().total,
    invitaciones: db.prepare(`SELECT COUNT(*) total FROM usuarios
      WHERE consultorio_id IS NULL AND estado IN ('preautorizado','pendiente') AND eliminado_en IS NULL`).get().total,
    pacientes: db.prepare(`SELECT COUNT(*) total FROM pacientes WHERE eliminado_en IS NULL`).get().total,
    citas: db.prepare(`SELECT COUNT(*) total FROM citas WHERE eliminado_en IS NULL`).get().total
  };
  res.json({ resumen: counts });
});

router.get('/consultorios', (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.nombre, c.email, c.telefono, c.direccion, c.creado_en,
      (SELECT COUNT(*) FROM usuarios u WHERE u.consultorio_id = c.id AND u.eliminado_en IS NULL AND u.rol = 'doctor') doctores,
      (SELECT COUNT(*) FROM usuarios u WHERE u.consultorio_id = c.id AND u.eliminado_en IS NULL AND u.rol = 'operativo') operativos,
      (SELECT COUNT(*) FROM pacientes p WHERE p.consultorio_id = c.id AND p.eliminado_en IS NULL) pacientes,
      (SELECT COUNT(*) FROM citas ci WHERE ci.consultorio_id = c.id AND ci.eliminado_en IS NULL) citas,
      (SELECT COUNT(*) FROM pagos pg WHERE pg.consultorio_id = c.id AND pg.eliminado_en IS NULL AND pg.estado = 'pagado') pagos,
      COALESCE((SELECT SUM(pg.monto_bs) FROM pagos pg WHERE pg.consultorio_id = c.id AND pg.eliminado_en IS NULL AND pg.estado = 'pagado'), 0) ingresos_total,
      COALESCE((SELECT MAX(ci.inicio) FROM citas ci WHERE ci.consultorio_id = c.id AND ci.eliminado_en IS NULL), c.creado_en) ultima_cita,
      COALESCE((SELECT MAX(ci.inicio) FROM citas ci WHERE ci.consultorio_id = c.id AND ci.eliminado_en IS NULL AND ci.inicio >= datetime('now')), NULL) cita_actual,
      COALESCE((SELECT MAX(pg.creado_en) FROM pagos pg WHERE pg.consultorio_id = c.id AND pg.eliminado_en IS NULL), NULL) ultima_actividad,
      COALESCE((SELECT COUNT(*) FROM citas ci WHERE ci.consultorio_id = c.id AND ci.eliminado_en IS NULL AND ci.inicio >= datetime('now')), 0) citas_futuras
    FROM consultorios c WHERE c.eliminado_en IS NULL ORDER BY c.creado_en DESC`).all();
  for (const row of rows) {
    row.estado_actividad = clinicActivity(row);
  }
  res.json({ consultorios: rows });
});

router.get('/auditoria', (req, res) => {
  const filters = [];
  const values = [];
  const from = String(req.query.desde || '').trim();
  const to = String(req.query.hasta || '').trim();
  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new ApiError(400, 'Formato de fecha desde inválido');
  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new ApiError(400, 'Formato de fecha hasta inválido');
  if (from) {
    filters.push(`a.creado_en >= ?`);
    values.push(`${from} 00:00:00`);
  }
  if (to) {
    filters.push(`a.creado_en <= ?`);
    values.push(`${to} 23:59:59`);
  }
  if (req.query.accion) {
    filters.push('a.accion = ?');
    values.push(String(req.query.accion));
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT a.id, a.usuario_id, u.email, a.accion, a.entidad_tipo, a.entidad_id, a.datos_json, a.ip, a.creado_en
    FROM admin_auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
    ${where} ORDER BY a.id DESC LIMIT 500`).all(...values);
  res.json({ auditoria: rows });
});

router.get('/consultorios/:id', (req, res) => {
  const clinic = clinicById(id(req.params.id));
  if (!clinic) throw new ApiError(404, 'Consultorio no encontrado');
  const proximasCitas = db.prepare(`
    SELECT ci.id, ci.inicio, ci.fin, ci.estado, s.nombre servicio, p.nombres || ' ' || p.apellidos AS paciente
    FROM citas ci JOIN servicios s ON s.id = ci.servicio_id AND s.eliminado_en IS NULL
    JOIN pacientes p ON p.id = ci.paciente_id AND p.eliminado_en IS NULL
    WHERE ci.consultorio_id = ? AND ci.eliminado_en IS NULL AND ci.inicio >= datetime('now')
    ORDER BY ci.inicio LIMIT 10`).all(clinic.id);
  const ultimosPagos = db.prepare(`
    SELECT pg.id, pg.monto_bs, pg.metodo, pg.estado, pg.creado_en,
      p.nombres || ' ' || p.apellidos AS paciente
    FROM pagos pg JOIN pacientes p ON p.id = pg.paciente_id AND p.eliminado_en IS NULL
    WHERE pg.consultorio_id = ? AND pg.eliminado_en IS NULL
    ORDER BY pg.creado_en DESC LIMIT 8`).all(clinic.id);
  const archivos = db.prepare(`SELECT evidencia_path arquivo FROM pagos
    WHERE consultorio_id = ? AND evidencia_path IS NOT NULL AND eliminado_en IS NULL`).all(clinic.id);
  res.json({
    consultorio: clinic,
    proximas_citas: proximasCitas,
    ultimos_pagos: ultimosPagos,
    archivos: archivos.length
  });
});

router.get('/consultorios/:id/exportar', asyncRoute(async (req, res) => {
  const clinic = clinicById(id(req.params.id));
  if (!clinic) throw new ApiError(404, 'Consultorio no encontrado');
  const clinicId = clinic.id;
  const consultorio = db.prepare(`SELECT * FROM consultorios WHERE id = ?`).get(clinicId);
  const exportart = (sql) => db.prepare(sql).all(clinicId);
  const payload = {
    exportado_en: new Date().toISOString(),
    consultorio,
    usuarios: db.prepare(`SELECT id, email, nombre, rol, estado, creado_en, ultimo_acceso_en FROM usuarios
      WHERE consultorio_id = ? AND eliminado_en IS NULL`).all(clinicId),
    servicios: exportart(`SELECT * FROM servicios WHERE consultorio_id = ? AND eliminado_en IS NULL`),
    horarios: exportart(`SELECT * FROM horarios WHERE consultorio_id = ? AND eliminado_en IS NULL`),
    pacientes: exportart(`SELECT * FROM pacientes WHERE consultorio_id = ? AND eliminado_en IS NULL`),
    citas: exportart(`SELECT * FROM citas WHERE consultorio_id = ? AND eliminado_en IS NULL`),
    registros: exportart(`SELECT * FROM registros_clinicos WHERE consultorio_id = ? AND eliminado_en IS NULL`),
    notas: exportart(`SELECT * FROM notas_paciente WHERE consultorio_id = ? AND eliminado_en IS NULL`),
    pagos: exportart(`SELECT * FROM pagos WHERE consultorio_id = ? AND eliminado_en IS NULL`)
  };
  const totales = {
    usuarios: payload.usuarios.length,
    servicios: payload.servicios.length,
    horarios: payload.horarios.length,
    pacientes: payload.pacientes.length,
    citas: payload.citas.length,
    registros: payload.registros.length,
    notas: payload.notas.length,
    pagos: payload.pagos.length
  };
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
    <title>Exportación · ${consultorio.nombre}</title></head>
    <body style="font-family:sans-serif;max-width:680px;margin:2rem auto">
    <h1>Exportación del consultorio: ${consultorio.nombre}</h1>
    <p>Generada el ${new Date().toISOString()}. Contiene los datos de pacientes, citas, registros clínicos, notas e ingresos.</p>
    <ul>${payload.usuarios.map((u) => `<li>${u.nombre} — ${u.email} (${u.rol})</li>`).join('')}</ul>
    <p>Totales: ${Object.entries(totales).map(([key, value]) => `${key}: ${value}`).join(' · ')}</p>
  </body></html>`;
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', () => {
    res.status(500).json({ mensaje: 'No se pudo generar la exportación' });
  });
  const filename = `consultorio-${clinicId}-${new Date().toISOString().slice(0, 10)}.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  archive.pipe(res);
  archive.append(JSON.stringify(payload, null, 2), { name: 'index.json' });
  archive.append(html, { name: 'index.html' });
  const files = [
    ...db.prepare(`SELECT evidencia_path AS ruta, id FROM pagos
      WHERE consultorio_id = ? AND evidencia_path IS NOT NULL AND eliminado_en IS NULL`).all(clinicId),
    { ruta: consultorio.qr_path, base: 'QR.png' }
  ].filter((file) => file.ruta);
  const used = new Set();
  for (const file of files) {
    const base = file.base || path.basename(String(file.ruta).replace(/\\/g, '/'));
    const full = path.join(config.uploadDir, path.basename(String(file.ruta).replace(/\\/g, '/')));
    if (!fs.existsSync(full)) continue;
    let name = base;
    if (used.has(name) || (used.has(base) && file.id)) name = `pago-${file.id}-${base}`;
    used.add(name);
    archive.file(full, { name: `archivos/${name}` });
  }
  adminLog(req.user, 'exportar', 'consultorio', clinic.id, { nombre: clinic.nombre }, req.ip);
  await archive.finalize();
}));

router.post('/consultorios/:id/reiniciar', asyncRoute(async (req, res) => {
  const clinic = clinicById(id(req.params.id));
  if (!clinic) throw new ApiError(404, 'Consultorio no encontrado');
  if (req.body.confirmar !== true) throw new ApiError(400, 'Debe confirmar la operación de reinicio');
  const clinicId = clinic.id;
  const snapshot = await createSnapshot(`consultorio-${clinicId}-reinicio`);
  const evidencia = db.prepare(`SELECT evidencia_path ruta FROM pagos
    WHERE consultorio_id = ? AND evidencia_path IS NOT NULL AND eliminado_en IS NULL`).all(clinicId);
  const counts = db.transaction(() => {
    const del = (sql) => db.prepare(sql).run(clinicId).changes;
    return {
      pagos: del('DELETE FROM pagos WHERE consultorio_id = ?'),
      notas: del('DELETE FROM notas_paciente WHERE consultorio_id = ?'),
      registros: del('DELETE FROM registros_clinicos WHERE consultorio_id = ?'),
      recordatorios: del('DELETE FROM email_recordatorios WHERE consultorio_id = ?'),
      notificaciones: del('DELETE FROM notificaciones WHERE consultorio_id = ?'),
      citas: del('DELETE FROM citas WHERE consultorio_id = ?'),
      auditoria: del('DELETE FROM auditoria WHERE consultorio_id = ?'),
      pacientes: del('DELETE FROM pacientes WHERE consultorio_id = ?')
    };
  })();
  for (const file of evidencia) {
    try {
      fs.rmSync(path.join(config.uploadDir, path.basename(file.ruta.replace(/\\/g, '/'))), { force: true });
    } catch (error) {
      console.warn('No se pudo eliminar evidencia del reinicio:', error.message);
    }
  }
  adminLog(req.user, 'reiniciar', 'consultorio', clinicId, { nombre: clinic.nombre, snapshot: path.basename(snapshot), ...counts }, req.ip);
  res.json({
    mensaje: 'Consultorio reiniciado; se conservaron usuarios, servicios, horarios y configuración',
    snapshot: path.basename(snapshot),
    ...counts
  });
}));

router.get('/usuarios', (req, res) => {
  const filters = [];
  const values = [];
  if (req.query.estado) {
    const allowed = ['preautorizado', 'activo', 'pendiente', 'suspendido'];
    if (!allowed.includes(req.query.estado)) throw new ApiError(400, 'Filtro de estado inválido');
    filters.push('u.estado = ?');
    values.push(req.query.estado);
  }
  if (req.query.consultorio_id) {
    filters.push('u.consultorio_id = ?');
    values.push(id(req.query.consultorio_id));
  }
  const term = String(req.query.buscar || '').trim();
  if (term) {
    filters.push('(u.email LIKE ? OR u.nombre LIKE ?)');
    const search = `%${term}%`;
    values.push(search, search);
  }
  const where = filters.length ? `WHERE u.eliminado_en IS NULL AND ${filters.join(' AND ')}` : 'WHERE u.eliminado_en IS NULL';
  const rows = db.prepare(`
    SELECT u.id, u.consultorio_id, u.email, u.nombre, u.avatar_url, u.rol, u.estado, u.ultimo_acceso_en, u.creado_en,
      c.nombre consultorio
    FROM usuarios u LEFT JOIN consultorios c ON c.id = u.consultorio_id AND c.eliminado_en IS NULL
    ${where} ORDER BY u.creado_en DESC LIMIT 300`).all(...values);
  res.json({ usuarios: rows });
});

router.post('/invitaciones', asyncRoute(async (req, res) => {
  required(req.body, ['email']);
  const email = String(req.body.email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'Correo inválido');
  if (config.adminEmails.includes(email)) throw new ApiError(400, 'Ese correo es del administrador; inicie sesión con él para crear su consultorio directamente');
  const existing = db.prepare(`SELECT id, consultorio_id, estado FROM usuarios
    WHERE email = ? COLLATE NOCASE AND eliminado_en IS NULL ORDER BY id LIMIT 1`).get(email);
  if (existing) {
    if (existing.consultorio_id) throw new ApiError(409, 'El correo ya forma parte de un consultorio');
    db.prepare(`UPDATE usuarios SET estado = 'preautorizado', actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`).run(existing.id);
    adminLog(req.user, 'invitar', 'usuario', existing.id, { email, renovada: true }, req.ip);
    return res.json({ mensaje: 'Invitación renovada; el correo podrá crear su consultorio', id: existing.id });
  }
  const nombre = String(req.body.nombre || '').trim() || email;
  const result = db.prepare(`INSERT INTO usuarios (email, nombre, rol, estado) VALUES (?, ?, 'doctor', 'preautorizado')`)
    .run(email, nombre);
  adminLog(req.user, 'invitar', 'usuario', result.lastInsertRowid, { email }, req.ip);
  res.status(201).json({ mensaje: 'Invitación registrada; el correo podrá crear su consultorio', id: Number(result.lastInsertRowid) });
}));

router.patch('/usuarios/:id/estado', (req, res) => {
  const estados = ['preautorizado', 'activo', 'pendiente', 'suspendido'];
  if (!estados.includes(req.body.estado)) throw new ApiError(400, 'Estado de usuario inválido');
  const user = userById(id(req.params.id));
  if (!user) throw new ApiError(404, 'Usuario no encontrado');
  if (config.adminEmails.includes(user.email.toLowerCase())) throw new ApiError(400, 'No puede modificar al administrador');
  db.prepare(`UPDATE usuarios SET estado = ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`).run(req.body.estado, user.id);
  adminLog(req.user, 'cambiar_estado', 'usuario', user.id, { email: user.email, estado: req.body.estado }, req.ip);
  res.json({ mensaje: 'Estado del usuario actualizado' });
});

router.delete('/usuarios/:id', (req, res) => {
  const user = userById(id(req.params.id));
  if (!user) throw new ApiError(404, 'Usuario no encontrado');
  if (config.adminEmails.includes(user.email.toLowerCase())) throw new ApiError(400, 'No puede eliminar al administrador');
  db.prepare(`UPDATE usuarios SET eliminado_en = CURRENT_TIMESTAMP, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`).run(user.id);
  adminLog(req.user, 'eliminar', 'usuario', user.id, { email: user.email }, req.ip);
  res.json({ mensaje: 'Usuario eliminado; ya no podrá acceder' });
});

router.delete('/consultorios/:id', (req, res) => {
  const clinic = clinicById(id(req.params.id));
  if (!clinic) throw new ApiError(404, 'Consultorio no encontrado');
  db.transaction(() => {
    db.prepare(`UPDATE consultorios SET eliminado_en = CURRENT_TIMESTAMP, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`).run(clinic.id);
    db.prepare(`UPDATE usuarios SET eliminado_en = CURRENT_TIMESTAMP, actualizado_en = CURRENT_TIMESTAMP
      WHERE consultorio_id = ? AND eliminado_en IS NULL`).run(clinic.id);
  })();
  adminLog(req.user, 'eliminar', 'consultorio', clinic.id, { nombre: clinic.nombre }, req.ip);
  res.json({ mensaje: 'Consultorio eliminado; sus usuarios ya no podrán acceder' });
});

export default router;
