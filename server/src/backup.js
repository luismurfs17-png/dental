import fs from 'node:fs';
import path from 'node:path';
import cron from 'node-cron';
import { config } from './config.js';
import { db } from './db.js';
import { writeClinicZip } from './exporter.js';

export function backupsDir() {
  return path.join(config.dataDir, config.backup.dirName);
}

export function clinicSnapshotsDir() {
  return path.join(backupsDir(), 'consultorios');
}

function stampNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[:.]/g, '-');
}

export async function createSnapshot(label = 'sonrident') {
  const dir = backupsDir();
  fs.mkdirSync(dir, { recursive: true });
  const snapshotDir = path.join(dir, `${label}-${stampNow()}`);
  fs.mkdirSync(snapshotDir, { recursive: true });
  await db.backup(path.join(snapshotDir, 'dentista.sqlite'));
  if (fs.existsSync(config.uploadDir)) {
    fs.cpSync(config.uploadDir, path.join(snapshotDir, 'uploads'), { recursive: true });
  }
  return snapshotDir;
}

export function pruneSnapshots(label = 'sonrident', keep = config.backup.retention) {
  const dir = backupsDir();
  if (!fs.existsSync(dir)) return 0;
  const prefix = `${label}-`;
  const snapshots = fs.readdirSync(dir).filter((name) => name.startsWith(prefix)).sort();
  const toDelete = snapshots.slice(0, Math.max(0, snapshots.length - keep));
  for (const name of toDelete) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
  return toDelete.length;
}

export async function createClinicSnapshots() {
  const clinics = db.prepare(`SELECT id FROM consultorios WHERE eliminado_en IS NULL`).all();
  const created = [];
  for (const clinic of clinics) {
    const dir = path.join(clinicSnapshotsDir(), `consultorio-${clinic.id}`);
    fs.mkdirSync(dir, { recursive: true });
    const filename = `consultorio-${clinic.id}-${new Date().toISOString().slice(0, 10)}.zip`;
    const zipPath = path.join(dir, filename);
    if (fs.existsSync(zipPath)) continue;
    await writeClinicZip(clinic.id, zipPath);
    created.push(zipPath);
  }
  return created;
}

export function pruneClinicSnapshots(keep = config.backup.retention) {
  const root = clinicSnapshotsDir();
  if (!fs.existsSync(root)) return 0;
  let deleted = 0;
  for (const folder of fs.readdirSync(root)) {
    const match = /^consultorio-(\d+)$/.exec(folder);
    if (!match) continue;
    const dir = path.join(root, folder);
    const zips = fs.readdirSync(dir).filter((name) => name.endsWith('.zip')).sort();
    for (const name of zips.slice(0, Math.max(0, zips.length - keep))) {
      fs.rmSync(path.join(dir, name), { force: true });
      deleted++;
    }
  }
  return deleted;
}

export async function runBackup() {
  const snapshot = await createSnapshot('sonrident');
  const deleted = pruneSnapshots('sonrident', config.backup.retention);
  const result = { snapshot, deleted };
  if (config.backup.porConsultorio) {
    result.clinicas = await createClinicSnapshots();
    result.borradasClinicas = pruneClinicSnapshots(config.backup.retention);
  }
  return result;
}

export function startBackups() {
  if (!config.backup.enabled) {
    console.log('Backups automáticos desactivados: BACKUP_ENABLED no está en true');
    return null;
  }
  if (!cron.validate(config.backup.cron)) {
    console.error('Backups automáticos desactivados: expresión BACKUP_CRON inválida');
    return null;
  }
  console.log(`Backups automáticos activados: ${config.backup.cron} (guardando ${config.backup.retention})`);
  return cron.schedule(config.backup.cron, () => {
    runBackup().then((result) => {
      console.log(`Backup completado: ${result.snapshot} (${result.deleted} anteriores eliminados)`);
    }).catch((error) => {
      console.error('Error en el backup automático:', error);
    });
  });
}