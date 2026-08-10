import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });

export const db = new Database(config.dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.exec(fs.readFileSync(path.join(import.meta.dirname, 'schema.sql'), 'utf8'));

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

ensureColumn('consultorios', 'qr_path', 'TEXT');
ensureColumn('consultorios', 'modo_cobro', "TEXT NOT NULL DEFAULT 'mixto' CHECK (modo_cobro IN ('app','definir','mixto'))");
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

export function audit(consultorioId, usuarioId, accion, entidadTipo, entidadId, datos, ip, pacienteId) {
  db.prepare(`INSERT INTO auditoria
    (consultorio_id, usuario_id, paciente_id, accion, entidad_tipo, entidad_id, datos_json, ip)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(consultorioId, usuarioId || null, pacienteId || null, accion, entidadTipo, entidadId || null,
      datos ? JSON.stringify(datos) : null, ip || null);
}
