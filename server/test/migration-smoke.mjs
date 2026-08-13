import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clinicas-migration-'));
const dbFile = path.join(dataDir, 'dentista.sqlite');
const legacy = new Database(dbFile);
const schema = fs.readFileSync(path.join(import.meta.dirname, '../src/schema.sql'), 'utf8')
  .replace(/^\s*slug TEXT,\s*$/m, '')
  .replace(/^\s*marca_nombre TEXT,\s*$/m, '')
  .replace(/^\s*color_primario TEXT[^\n]*\n/m, '')
  .replace(/^\s*color_acento TEXT[^\n]*\n/m, '')
  .replace(/^\s*color_fondo TEXT[^\n]*\n/m, '')
  .replace(/^\s*fondo_opacidad INTEGER[^\n]*\n/m, '')
  .replace(/^\s*logo_path TEXT,\s*$/m, '')
  .replace(/^\s*fondo_path TEXT,\s*$/m, '');
legacy.exec(schema);
legacy.prepare(`INSERT INTO consultorios (nombre,email) VALUES ('Clínica Antigua','antigua@test.local')`).run();
legacy.close();

process.env.NODE_ENV = 'development';
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'prueba-migracion-clinicas-32-caracteres-minimo';

const { db } = await import('../src/db.js');
try {
  const migrated = db.prepare('SELECT slug, logo_path, fondo_path FROM consultorios WHERE email=?').get('antigua@test.local');
  assert.equal(migrated.slug, 'clinica-antigua');
  assert.equal(migrated.logo_path, null);
  assert.equal(migrated.fondo_path, null);
  const backups = fs.readdirSync(path.join(dataDir, 'backups')).filter((name) => name.startsWith('pre-pwa-multiclinica-'));
  assert.equal(backups.length, 1);
  const backupFile = path.join(dataDir, 'backups', backups[0], 'dentista.sqlite');
  assert.ok(fs.existsSync(backupFile));
  const snapshot = new Database(backupFile, { readonly: true });
  try {
    const oldColumns = snapshot.prepare('PRAGMA table_info(consultorios)').all().map((item) => item.name);
    assert.equal(oldColumns.includes('slug'), false);
    assert.equal(snapshot.prepare('SELECT nombre FROM consultorios WHERE email=?').get('antigua@test.local').nombre, 'Clínica Antigua');
  } finally { snapshot.close(); }
  console.log('Migración smoke: snapshot previo, slug e identidad visual OK');
} finally {
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
