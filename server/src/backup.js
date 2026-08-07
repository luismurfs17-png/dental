import fs from 'node:fs';
import path from 'node:path';
import cron from 'node-cron';
import { config } from './config.js';
import { db } from './db.js';

export function backupsDir() {
  return path.join(config.dataDir, config.backup.dirName);
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

export async function runBackup() {
  const snapshot = await createSnapshot('sonrident');
  const deleted = pruneSnapshots('sonrident', config.backup.retention);
  return { snapshot, deleted };
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