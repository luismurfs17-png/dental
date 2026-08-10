import fs from 'node:fs';
import path from 'node:path';
import cron from 'node-cron';
import { config } from './config.js';
import { db } from './db.js';

function daysAgo(days) {
  return new Date(Date.now() - Math.max(0, days) * 86400000)
    .toISOString().slice(0, 19).replace('T', ' ');
}

function findOrphanUploads() {
  const referenced = new Set();
  for (const row of db.prepare(`SELECT qr_path FROM consultorios
    WHERE qr_path IS NOT NULL AND eliminado_en IS NULL`).all()) {
    if (row.qr_path) referenced.add(path.basename(row.qr_path));
  }
  for (const row of db.prepare(`SELECT evidencia_path FROM pagos
    WHERE evidencia_path IS NOT NULL AND eliminado_en IS NULL`).all()) {
    if (row.evidencia_path) referenced.add(path.basename(row.evidencia_path));
  }
  const orphans = [];
  for (const file of fs.readdirSync(config.uploadDir)) {
    if (file.startsWith('.')) continue;
    if (referenced.has(file)) continue;
    orphans.push(file);
  }
  return orphans;
}

export function runMaintenance(options = {}) {
  const {
    auditoriaDays = config.maintenance.auditoriaDays,
    notificacionesDays = config.maintenance.notificacionesDays,
    vacuum = true,
    limpiarUploads = true,
  } = options;

  const pasos = {};

  try {
    const checkpoint = db.pragma('wal_checkpoint(TRUNCATE)');
    pasos.wal_checkpoint = `truncado (${checkpoint?.busy ? 'ocupado, reintento' : 'OK'})`;
  } catch (error) {
    pasos.wal_checkpoint = `error: ${String(error.message).slice(0, 200)}`;
  }

  try {
    const r = db.prepare(`DELETE FROM notificaciones WHERE creado_en < ?`).run(daysAgo(notificacionesDays));
    pasos.notificaciones = `${r.changes} eliminadas (>${notificacionesDays} días)`;
  } catch (error) {
    pasos.notificaciones = `error: ${String(error.message).slice(0, 200)}`;
  }

  try {
    const r = db.prepare(`DELETE FROM auditoria WHERE creado_en < ?`).run(daysAgo(auditoriaDays));
    pasos.auditoria = `${r.changes} eliminadas (>${auditoriaDays} días)`;
  } catch (error) {
    pasos.auditoria = `error: ${String(error.message).slice(0, 200)}`;
  }

  if (limpiarUploads) {
    try {
      const orphans = findOrphanUploads();
      let removed = 0;
      for (const file of orphans) {
        try { fs.unlinkSync(path.join(config.uploadDir, file)); removed++; } catch {}
      }
      pasos.uploads = `${removed} huérfanos eliminados (de ${orphans.length} candidatos)`;
    } catch (error) {
      pasos.uploads = `error: ${String(error.message).slice(0, 200)}`;
    }
  } else {
    pasos.uploads = 'omitido';
  }

  if (vacuum) {
    try {
      db.exec('VACUUM');
      pasos.vacuum = 'OK';
    } catch (error) {
      pasos.vacuum = `error: ${String(error.message).slice(0, 200)}`;
    }
  } else {
    pasos.vacuum = 'omitido';
  }

  return pasos;
}

export function startMaintenance() {
  const enabled = process.env.MAINTENANCE_ENABLED !== 'false';
  if (!enabled) {
    console.log('Mantenimiento automático desactivado (MAINTENANCE_ENABLED=false)');
    return null;
  }
  const expr = config.maintenance.cron;
  if (!cron.validate(expr)) {
    console.error(`Mantenimiento automático desactivado: cron inválido "${expr}"`);
    return null;
  }
  console.log(`Mantenimiento automático activado: ${expr} (auditoría >${config.maintenance.auditoriaDays}d, notificaciones >${config.maintenance.notificacionesDays}d)`);
  return cron.schedule(expr, () => {
    try {
      const pasos = runMaintenance();
      const detalle = Object.entries(pasos).map(([k, v]) => `${k}=${v}`).join(' · ');
      console.log(`Mantenimiento completado: ${detalle}`);
    } catch (error) {
      console.error('Mantenimiento error:', error);
    }
  });
}
