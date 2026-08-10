PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS consultorios (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  nit TEXT,
  telefono TEXT,
  email TEXT,
  direccion TEXT,
  zona_horaria TEXT NOT NULL DEFAULT 'America/La_Paz',
  moneda TEXT NOT NULL DEFAULT 'Bs',
  modo_cobro TEXT NOT NULL DEFAULT 'mixto' CHECK (modo_cobro IN ('app','definir','mixto')),
  qr_path TEXT,
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  eliminado_en TEXT
);

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY,
  consultorio_id INTEGER REFERENCES consultorios(id),
  google_sub TEXT UNIQUE,
  email TEXT NOT NULL COLLATE NOCASE,
  nombre TEXT NOT NULL,
  avatar_url TEXT,
  rol TEXT NOT NULL CHECK (rol IN ('doctor','operativo','paciente')),
  estado TEXT NOT NULL DEFAULT 'preautorizado' CHECK (estado IN ('preautorizado','activo','pendiente','suspendido')),
  ultimo_acceso_en TEXT,
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  eliminado_en TEXT,
  UNIQUE(consultorio_id, email)
);

CREATE TABLE IF NOT EXISTS pacientes (
  id INTEGER PRIMARY KEY,
  consultorio_id INTEGER NOT NULL REFERENCES consultorios(id),
  usuario_id INTEGER REFERENCES usuarios(id),
  codigo TEXT NOT NULL,
  nombres TEXT NOT NULL,
  apellidos TEXT NOT NULL,
  email TEXT COLLATE NOCASE,
  telefono TEXT,
  fecha_nacimiento TEXT,
  sexo TEXT,
  documento TEXT,
  direccion TEXT,
  contacto_emergencia TEXT,
  telefono_emergencia TEXT,
  alergias TEXT,
  antecedentes TEXT,
  medicamentos TEXT,
  notas TEXT,
  recordatorios_activos INTEGER NOT NULL DEFAULT 1 CHECK (recordatorios_activos IN (0,1)),
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  eliminado_en TEXT,
  UNIQUE(consultorio_id, codigo),
  UNIQUE(consultorio_id, email)
);

CREATE TABLE IF NOT EXISTS servicios (
  id INTEGER PRIMARY KEY,
  consultorio_id INTEGER NOT NULL REFERENCES consultorios(id),
  nombre TEXT NOT NULL,
  descripcion TEXT,
  precio_bs REAL CHECK (precio_bs IS NULL OR precio_bs >= 0),
  duracion_min INTEGER NOT NULL DEFAULT 30 CHECK (duracion_min > 0),
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  eliminado_en TEXT
);

CREATE TABLE IF NOT EXISTS horarios (
  id INTEGER PRIMARY KEY,
  consultorio_id INTEGER NOT NULL REFERENCES consultorios(id),
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  dia_semana INTEGER NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  hora_inicio TEXT NOT NULL,
  hora_fin TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  eliminado_en TEXT,
  UNIQUE(consultorio_id, usuario_id, dia_semana, hora_inicio)
);

CREATE TABLE IF NOT EXISTS citas (
  id INTEGER PRIMARY KEY,
  consultorio_id INTEGER NOT NULL REFERENCES consultorios(id),
  paciente_id INTEGER NOT NULL REFERENCES pacientes(id),
  doctor_id INTEGER NOT NULL REFERENCES usuarios(id),
  servicio_id INTEGER NOT NULL REFERENCES servicios(id),
  inicio TEXT NOT NULL,
  fin TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'confirmada' CHECK (estado IN ('confirmada','atendida','cancelada','no_asistio')),
  precio_bs REAL CHECK (precio_bs IS NULL OR precio_bs >= 0),
  motivo TEXT,
  notas TEXT,
  reprogramaciones_paciente INTEGER NOT NULL DEFAULT 0 CHECK (reprogramaciones_paciente IN (0,1)),
  reprogramada_por_paciente_en TEXT,
  creado_por INTEGER NOT NULL REFERENCES usuarios(id),
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  eliminado_en TEXT
);

CREATE TABLE IF NOT EXISTS registros_clinicos (
  id INTEGER PRIMARY KEY,
  consultorio_id INTEGER NOT NULL REFERENCES consultorios(id),
  paciente_id INTEGER NOT NULL REFERENCES pacientes(id),
  cita_id INTEGER REFERENCES citas(id),
  doctor_id INTEGER NOT NULL REFERENCES usuarios(id),
  diagnostico TEXT NOT NULL,
  tratamiento TEXT,
  observaciones TEXT,
  estado TEXT NOT NULL DEFAULT 'validado' CHECK (estado IN ('pendiente','validado')),
  creado_por INTEGER REFERENCES usuarios(id),
  validado_por INTEGER REFERENCES usuarios(id),
  validado_en TEXT,
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  eliminado_en TEXT
);

CREATE TABLE IF NOT EXISTS notas_paciente (
  id INTEGER PRIMARY KEY,
  consultorio_id INTEGER NOT NULL REFERENCES consultorios(id),
  paciente_id INTEGER NOT NULL REFERENCES pacientes(id),
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  texto TEXT NOT NULL,
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  eliminado_en TEXT
);

CREATE TABLE IF NOT EXISTS pagos (
  id INTEGER PRIMARY KEY,
  consultorio_id INTEGER NOT NULL REFERENCES consultorios(id),
  paciente_id INTEGER NOT NULL REFERENCES pacientes(id),
  cita_id INTEGER REFERENCES citas(id),
  monto_bs REAL NOT NULL CHECK (monto_bs > 0),
  metodo TEXT NOT NULL CHECK (metodo IN ('efectivo','tarjeta','transferencia','qr')),
  estado TEXT NOT NULL CHECK (estado IN ('por_verificar','valido','anulado')),
  evidencia_path TEXT,
  referencia TEXT,
  registrado_por INTEGER NOT NULL REFERENCES usuarios(id),
  verificado_por INTEGER REFERENCES usuarios(id),
  verificado_en TEXT,
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  eliminado_en TEXT,
  CHECK (metodo = 'qr' OR estado != 'por_verificar')
);

CREATE TABLE IF NOT EXISTS presupuestos (
  id INTEGER PRIMARY KEY,
  consultorio_id INTEGER NOT NULL REFERENCES consultorios(id),
  paciente_id INTEGER NOT NULL REFERENCES pacientes(id),
  titulo TEXT,
  notas TEXT,
  estado TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','entregado','aceptado','archivado')),
  creado_por INTEGER NOT NULL REFERENCES usuarios(id),
  token_publico TEXT,
  compartido_en TEXT,
  visto_en TEXT,
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  eliminado_en TEXT
);

CREATE TABLE IF NOT EXISTS presupuesto_items (
  id INTEGER PRIMARY KEY,
  presupuesto_id INTEGER NOT NULL REFERENCES presupuestos(id),
  servicio_id INTEGER REFERENCES servicios(id),
  nombre TEXT NOT NULL,
  cantidad INTEGER NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  precio_bs REAL CHECK (precio_bs IS NULL OR precio_bs >= 0),
  duracion_min INTEGER CHECK (duracion_min IS NULL OR duracion_min > 0),
  notas TEXT,
  posicion INTEGER NOT NULL DEFAULT 0,
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  eliminado_en TEXT
);

CREATE TABLE IF NOT EXISTS notificaciones (
  id INTEGER PRIMARY KEY,
  consultorio_id INTEGER NOT NULL REFERENCES consultorios(id),
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  tipo TEXT NOT NULL,
  titulo TEXT NOT NULL,
  mensaje TEXT NOT NULL,
  entidad_tipo TEXT,
  entidad_id INTEGER,
  leida_en TEXT,
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  eliminado_en TEXT
);

CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY,
  consultorio_id INTEGER NOT NULL REFERENCES consultorios(id),
  usuario_id INTEGER REFERENCES usuarios(id),
  paciente_id INTEGER REFERENCES pacientes(id),
  accion TEXT NOT NULL,
  entidad_tipo TEXT NOT NULL,
  entidad_id INTEGER,
  datos_json TEXT,
  ip TEXT,
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS email_recordatorios (
  id INTEGER PRIMARY KEY,
  consultorio_id INTEGER NOT NULL REFERENCES consultorios(id),
  cita_id INTEGER NOT NULL REFERENCES citas(id),
  destinatario TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('enviado','error')),
  error TEXT,
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(consultorio_id, cita_id, destinatario)
);

CREATE TABLE IF NOT EXISTS admin_auditoria (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id),
  accion TEXT NOT NULL,
  entidad_tipo TEXT NOT NULL,
  entidad_id INTEGER,
  datos_json TEXT,
  ip TEXT,
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_usuarios_consultorio ON usuarios(consultorio_id, eliminado_en);
CREATE INDEX IF NOT EXISTS idx_pacientes_consultorio ON pacientes(consultorio_id, eliminado_en);
CREATE INDEX IF NOT EXISTS idx_citas_agenda ON citas(consultorio_id, doctor_id, inicio, eliminado_en);
CREATE INDEX IF NOT EXISTS idx_pagos_paciente ON pagos(consultorio_id, paciente_id, estado, eliminado_en);
CREATE INDEX IF NOT EXISTS idx_notificaciones_usuario ON notificaciones(consultorio_id, usuario_id, leida_en, eliminado_en);
CREATE INDEX IF NOT EXISTS idx_notas_paciente ON notas_paciente(consultorio_id, paciente_id, eliminado_en, creado_en);
CREATE INDEX IF NOT EXISTS idx_presupuestos_consultorio ON presupuestos(consultorio_id, paciente_id, estado, eliminado_en, creado_en);
CREATE INDEX IF NOT EXISTS idx_presupuesto_items_quote ON presupuesto_items(presupuesto_id, eliminado_en);
