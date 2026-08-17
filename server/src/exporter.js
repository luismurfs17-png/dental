import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { config } from './config.js';
import { db } from './db.js';

const require = createRequire(import.meta.url);
const archiver = require('archiver');

export function buildClinicExport(clinicId) {
  const consultorio = db.prepare(`SELECT * FROM consultorios WHERE id = ?`).get(clinicId);
  if (!consultorio) return null;
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
    pagos: exportart(`SELECT * FROM pagos WHERE consultorio_id = ? AND eliminado_en IS NULL`),
    presupuestos: exportart(`SELECT * FROM presupuestos WHERE consultorio_id = ? AND eliminado_en IS NULL`),
    presupuesto_items: exportart(`SELECT pi.* FROM presupuesto_items pi
      JOIN presupuestos pr ON pr.id = pi.presupuesto_id
      WHERE pr.consultorio_id = ? AND pi.eliminado_en IS NULL`)
  };
  const totales = {
    usuarios: payload.usuarios.length,
    servicios: payload.servicios.length,
    horarios: payload.horarios.length,
    pacientes: payload.pacientes.length,
    citas: payload.citas.length,
    registros: payload.registros.length,
    notas: payload.notas.length,
    pagos: payload.pagos.length,
    presupuestos: payload.presupuestos.length
  };
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
    <title>Exportación · ${consultorio.nombre}</title></head>
    <body style="font-family:sans-serif;max-width:680px;margin:2rem auto">
    <h1>Exportación del consultorio: ${consultorio.nombre}</h1>
    <p>Generada el ${new Date().toISOString()}. Contiene los datos de pacientes, citas, registros clínicos, notas e ingresos.</p>
    <ul>${payload.usuarios.map((u) => `<li>${u.nombre} — ${u.email} (${u.rol})</li>`).join('')}</ul>
    <p>Totales: ${Object.entries(totales).map(([key, value]) => `${key}: ${value}`).join(' · ')}</p>
  </body></html>`;
  const entries = [
    ...db.prepare(`SELECT evidencia_path AS ruta, id FROM pagos
      WHERE consultorio_id = ? AND evidencia_path IS NOT NULL AND eliminado_en IS NULL`).all(clinicId),
    { ruta: consultorio.qr_path, base: consultorio.qr_path ? `QR${path.extname(consultorio.qr_path)}` : null },
    { ruta: consultorio.logo_path, base: consultorio.logo_path ? `Logo${path.extname(consultorio.logo_path)}` : null },
    { ruta: consultorio.fondo_path, base: consultorio.fondo_path ? `Fondo${path.extname(consultorio.fondo_path)}` : null }
  ].filter((file) => file.ruta);
  const used = new Set();
  const files = [];
  for (const file of entries) {
    const base = file.base || path.basename(String(file.ruta).replace(/\\/g, '/'));
    const full = path.join(config.uploadDir, path.basename(String(file.ruta).replace(/\\/g, '/')));
    if (!fs.existsSync(full)) continue;
    let name = base;
    if (used.has(name) || (used.has(base) && file.id)) name = `pago-${file.id}-${base}`;
    used.add(name);
    files.push({ full, name });
  }
  return { payload, html, files };
}

export function writeClinicZip(clinicId, zipPath) {
  const data = buildClinicExport(clinicId);
  if (!data) return Promise.reject(new Error(`Consultorio ${clinicId} no encontrado para exportar`));
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('error', reject);
    archive.on('error', reject);
    output.on('close', () => resolve(zipPath));
    archive.pipe(output);
    archive.append(JSON.stringify(data.payload, null, 2), { name: 'index.json' });
    archive.append(data.html, { name: 'index.html' });
    for (const file of data.files) {
      archive.file(file.full, { name: `archivos/${file.name}` });
    }
    archive.finalize();
  });
}
