import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });

const databaseExisted = fs.existsSync(config.dbFile);
export const db = new Database(config.dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
if (databaseExisted) await backupBeforeTenantBrandingMigration();
db.exec(fs.readFileSync(path.join(import.meta.dirname, 'schema.sql'), 'utf8'));

function ensureEnviosFkSoftDelete() {
  const exists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='envios_notificacion'`).get();
  if (!exists) return;
  const fks = db.prepare('PRAGMA foreign_key_list(envios_notificacion)').all();
  const citaFk = fks.find((fk) => fk.from === 'cita_id');
  if (citaFk && citaFk.on_delete === 'SET NULL') return;
  db.exec('DROP TABLE IF EXISTS envios_notificacion');
}

ensureEnviosFkSoftDelete();

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

async function backupBeforeTenantBrandingMigration() {
  const table = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='consultorios'`).get();
  if (!table) return;
  const columns = db.prepare('PRAGMA table_info(consultorios)').all();
  const names = new Set(columns.map((item) => item.name));
  const required = ['slug', 'marca_nombre', 'color_primario', 'color_acento', 'color_fondo', 'fondo_opacidad', 'logo_path', 'fondo_path'];
  if (required.every((column) => names.has(column))) return;
  let hasExistingData = db.prepare('SELECT EXISTS(SELECT 1 FROM consultorios LIMIT 1) existing').get().existing;
  const usersTable = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='usuarios'`).get();
  if (!hasExistingData && usersTable) {
    hasExistingData = db.prepare('SELECT EXISTS(SELECT 1 FROM usuarios LIMIT 1) existing').get().existing;
  }
  if (!hasExistingData) return;
  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[:.]/g, '-');
  const snapshotDir = path.join(config.dataDir, 'backups', `pre-pwa-multiclinica-${stamp}`);
  fs.mkdirSync(snapshotDir, { recursive: true });
  await db.backup(path.join(snapshotDir, 'dentista.sqlite'));
  if (fs.existsSync(config.uploadDir)) fs.cpSync(config.uploadDir, path.join(snapshotDir, 'uploads'), { recursive: true });
  console.log(`Snapshot previo a migración creado: ${snapshotDir}`);
}

ensureColumn('consultorios', 'qr_path', 'TEXT');
ensureColumn('consultorios', 'modo_cobro', "TEXT NOT NULL DEFAULT 'mixto' CHECK (modo_cobro IN ('app','definir','mixto'))");
ensureColumn('consultorios', 'slug', 'TEXT');
ensureColumn('consultorios', 'marca_nombre', 'TEXT');
ensureColumn('consultorios', 'color_primario', "TEXT NOT NULL DEFAULT '#24577a'");
ensureColumn('consultorios', 'color_acento', "TEXT NOT NULL DEFAULT '#6672bd'");
ensureColumn('consultorios', 'color_fondo', "TEXT NOT NULL DEFAULT '#f3fafc'");
ensureColumn('consultorios', 'fondo_opacidad', 'INTEGER NOT NULL DEFAULT 18 CHECK (fondo_opacidad BETWEEN 0 AND 45)');
ensureColumn('consultorios', 'logo_path', 'TEXT');
ensureColumn('consultorios', 'fondo_path', 'TEXT');
ensureColumn('presupuestos', 'token_publico', 'TEXT');
ensureColumn('presupuestos', 'compartido_en', 'TEXT');
ensureColumn('presupuestos', 'visto_en', 'TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_presupuestos_token ON presupuestos(token_publico)');
ensureColumn('pacientes', 'recordatorios_activos', 'INTEGER NOT NULL DEFAULT 1 CHECK (recordatorios_activos IN (0,1))');
ensureColumn('citas', 'reprogramaciones_paciente', 'INTEGER NOT NULL DEFAULT 0 CHECK (reprogramaciones_paciente IN (0,1))');
ensureColumn('citas', 'reprogramada_por_paciente_en', 'TEXT');
ensureColumn('registros_clinicos', 'estado', "TEXT NOT NULL DEFAULT 'validado' CHECK (estado IN ('pendiente','validado'))");
ensureColumn('registros_clinicos', 'creado_por', 'INTEGER REFERENCES usuarios(id)');
ensureColumn('registros_clinicos', 'validado_por', 'INTEGER REFERENCES usuarios(id)');
ensureColumn('registros_clinicos', 'validado_en', 'TEXT');
ensureColumn('auditoria', 'paciente_id', 'INTEGER REFERENCES pacientes(id)');
ensureColumn('pagos', 'presupuesto_id', 'INTEGER REFERENCES presupuestos(id)');
ensureColumn('consultorio_email', 'oauth_provider', "TEXT DEFAULT 'smtp'");
ensureColumn('consultorio_email', 'gmail_user', 'TEXT');
ensureColumn('consultorio_email', 'gmail_refresh_token_cifrado', 'TEXT');
ensureColumn('consultorio_email', 'gmail_access_token_cifrado', 'TEXT');
ensureColumn('consultorio_email', 'gmail_access_token_expira_en', 'TEXT');
db.exec('DROP INDEX IF EXISTS uq_consultorios_slug');
backfillClinicSlugs();
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_consultorios_slug ON consultorios(slug COLLATE NOCASE) WHERE slug IS NOT NULL');
db.exec('CREATE INDEX IF NOT EXISTS idx_auditoria_paciente ON auditoria(consultorio_id, paciente_id, creado_en)');
db.exec('CREATE INDEX IF NOT EXISTS idx_pagos_presupuesto ON pagos(consultorio_id, presupuesto_id, estado, eliminado_en)');

makeColumnNullable('servicios', 'precio_bs', 'REAL');
makeColumnNullable('citas', 'precio_bs', 'REAL');
db.exec(fs.readFileSync(path.join(import.meta.dirname, 'schema.sql'), 'utf8'));

function makeColumnNullable(table, column, type) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  const target = columns.find((item) => item.name === column);
  if (!target || target.notnull === 0) return;
  const record = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(table);
  if (!record?.sql) throw new Error(`Tabla ${table} no encontrada para migrar ${column}`);
  const pattern = `${column} ${type} NOT NULL`;
  if (!record.sql.includes(pattern)) throw new Error(`Definición inesperada de ${table}.${column}: ${record.sql}`);
  const rebuilt = record.sql.replace(pattern, `${column} ${type}`);
  const temporary = `${table}_precio_migracion`;
  fs.copyFileSync(config.dbFile, `${config.dbFile}.respaldo-migracion`);
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(rebuilt.replace(`CREATE TABLE ${table}`, `CREATE TABLE ${temporary}`));
      db.prepare(`INSERT INTO ${temporary} SELECT * FROM ${table}`).run();
      db.exec(`DROP TABLE ${table}`);
      db.exec(`ALTER TABLE ${temporary} RENAME TO ${table}`);
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

function normalizeClinicSlug(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
}

function backfillClinicSlugs() {
  const clinics = db.prepare('SELECT id, nombre, slug FROM consultorios ORDER BY id').all();
  const used = new Set();
  const update = db.prepare('UPDATE consultorios SET slug=? WHERE id=?');
  db.transaction(() => {
    for (const clinic of clinics) {
      const base = normalizeClinicSlug(clinic.slug || clinic.nombre) || `clinica-${clinic.id}`;
      let slug = base;
      let suffix = 2;
      while (used.has(slug)) slug = `${base.slice(0, 43)}-${suffix++}`;
      used.add(slug);
      if (clinic.slug !== slug) update.run(slug, clinic.id);
    }
  })();
}

export function uniqueClinicSlug(name) {
  const base = normalizeClinicSlug(name) || 'clinica';
  let slug = base;
  let suffix = 2;
  const exists = db.prepare('SELECT 1 FROM consultorios WHERE slug=? COLLATE NOCASE');
  while (exists.get(slug)) slug = `${base.slice(0, 43)}-${suffix++}`;
  return slug;
}

export function audit(consultorioId, usuarioId, accion, entidadTipo, entidadId, datos, ip, pacienteId) {
  db.prepare(`INSERT INTO auditoria
    (consultorio_id, usuario_id, paciente_id, accion, entidad_tipo, entidad_id, datos_json, ip)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(consultorioId, usuarioId || null, pacienteId || null, accion, entidadTipo, entidadId || null,
      datos ? JSON.stringify(datos) : null, ip || null);
}
