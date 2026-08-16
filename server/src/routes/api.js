import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { authenticate, allowRoles, requireTenant } from '../auth.js';
import { config } from '../config.js';
import { audit, db, uniqueClinicSlug } from '../db.js';
import { createClinicIcons, removeClinicIcons, validateClinicImage } from '../branding.js';
import { sendAppointmentEmail, sendClinicEmail, sendTestEmail, sendWelcomeEmail, getClinicEmailConfig, clearClinicTransporter } from '../email.js';
import { encryptSecret } from '../crypto.js';
import { ApiError, asyncRoute, positiveNumber, required } from '../http.js';

const router = Router();
router.get('/presupuestos/publico/:token', (req, res) => {
  const match = lookupQuoteToken(req.params.token);
  if (!match) throw new ApiError(404, 'Cotización no encontrada o ya no está disponible');
  const quote = db.prepare(`SELECT pr.*, p.codigo, p.nombres, p.apellidos, c.nombre consultorio,
      c.marca_nombre, c.color_primario, c.color_acento, c.color_fondo, c.logo_path, c.slug, c.telefono consultorio_telefono
    FROM presupuestos pr
    JOIN pacientes p ON p.id=pr.paciente_id AND p.consultorio_id=pr.consultorio_id AND p.eliminado_en IS NULL
    JOIN consultorios c ON c.id=pr.consultorio_id AND c.eliminado_en IS NULL
    WHERE pr.id=? AND pr.consultorio_id=? AND pr.eliminado_en IS NULL`).get(match.id, match.consultorio_id);
  if (!quote || quote.estado === 'borrador' || quote.estado === 'archivado')
    throw new ApiError(404, 'Cotización no disponible para compartir');
  if (!quote.visto_en) {
    db.prepare(`UPDATE presupuestos SET visto_en=CURRENT_TIMESTAMP WHERE id=?`).run(quote.id);
    audit(match.consultorio_id, null, 'presupuesto_publico_visto', 'presupuesto', quote.id,
      { paciente_id: quote.paciente_id }, req.ip, quote.paciente_id);
  }
  const items = db.prepare(`SELECT nombre, cantidad, precio_bs, duracion_min, notas FROM presupuesto_items
    WHERE presupuesto_id=? AND eliminado_en IS NULL ORDER BY posicion,id`).all(quote.id);
  res.json({
    cotizacion: {
      id: quote.id,
      titulo: quote.titulo,
      notas: quote.notas,
      estado: quote.estado,
      creado_en: quote.creado_en,
      compartido_en: quote.compartido_en,
      visto_en: quote.visto_en,
      items,
       total_bs: quoteSummary(quote.id).total_bs,
       sin_precio: quoteSummary(quote.id).sin_precio,
       pago: quotePayments(quote.id),
     },
    paciente: { codigo: quote.codigo, nombres: quote.nombres, apellidos: quote.apellidos },
    consultorio: {
      nombre: quote.consultorio,
      marca_nombre: quote.marca_nombre,
      telefono: quote.consultorio_telefono,
      color_primario: quote.color_primario,
      color_acento: quote.color_acento,
      color_fondo: quote.color_fondo,
      logo_url: quote.logo_path ? `/api/publico/clinicas/${quote.slug}/logo?v=${encodeURIComponent(quote.logo_path)}` : null
    },
  });
});
router.use(authenticate);

const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const imageExtensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (_req, file, callback) => callback(null, `${Date.now()}-${randomUUID()}${imageExtensions[file.mimetype] || ''}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => imageTypes.has(file.mimetype)
    ? callback(null, true)
    : callback(new ApiError(400, `${file.fieldname === 'evidencia' ? 'La evidencia' : 'El archivo'} debe ser una imagen JPG, PNG o WEBP`))
});
const imageUpload = upload.single('imagen');

function hasValidImageSignature(file) {
  if (!file) return false;
  const bytes = Buffer.alloc(12);
  const descriptor = fs.openSync(file.path, 'r');
  try { fs.readSync(descriptor, bytes, 0, bytes.length, 0); } finally { fs.closeSync(descriptor); }
  if (file.mimetype === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (file.mimetype === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  return file.mimetype === 'image/webp' && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
}

const tenant = (req) => req.user.consultorio_id;
const clinicMode = (req) => db.prepare('SELECT modo_cobro FROM consultorios WHERE id=?').get(tenant(req))?.modo_cobro || 'mixto';
const servicePrice = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new ApiError(400, 'precio_bs debe ser un número mayor o igual a cero');
  return parsed;
};
const id = (value) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new ApiError(400, 'Identificador inválido');
  return parsed;
};
const ensureFound = (result, message = 'Registro no encontrado') => {
  if (!result.changes) throw new ApiError(404, message);
};
const patientForUser = (req) => {
  const patient = db.prepare(`SELECT id FROM pacientes WHERE consultorio_id = ? AND usuario_id = ? AND eliminado_en IS NULL`).get(tenant(req), req.user.id);
  if (!patient) throw new ApiError(403, 'No existe una ficha de paciente asociada');
  return patient.id;
};
const restrictPatient = (req, requestedId) => {
  if (req.user.rol === 'paciente' && patientForUser(req) !== Number(requestedId)) throw new ApiError(403, 'Solo puede consultar su propia información');
};
const log = (req, action, type, entityId, data, patientId) => audit(tenant(req), req.user.id, action, type, entityId, data, req.ip, patientId);
const patientCode = (value) => {
  const code = String(value);
  if (!/^\d{1,32}$/.test(code)) throw new ApiError(400, 'El código del paciente debe contener solo dígitos y un máximo de 32 caracteres');
  return code;
};
const duplicatePatientCode = (error) => String(error.message).includes('pacientes.consultorio_id, pacientes.codigo');
const clinicJson = (row) => {
  if (!row) return row;
  const { qr_path: qrPath, logo_path: logoPath, fondo_path: backgroundPath, ...clinic } = row;
  return {
    ...clinic,
    qr_url: qrPath ? '/api/consultorio/qr' : null,
    logo_url: logoPath ? `/api/consultorio/identidad/logo/imagen?v=${encodeURIComponent(logoPath)}` : null,
    fondo_url: backgroundPath ? `/api/consultorio/identidad/fondo/imagen?v=${encodeURIComponent(backgroundPath)}` : null,
    manifest_url: clinic.slug ? `/api/publico/clinicas/${clinic.slug}/manifest.webmanifest` : '/manifest.webmanifest',
    app_path: clinic.slug ? `/c/${clinic.slug}` : null
  };
};
const brandDefaults = {
  color_primario: '#24577a',
  color_acento: '#6672bd',
  color_fondo: '#f3fafc',
  fondo_opacidad: 18
};
const brandAsset = (value) => {
  const assets = {
    logo: { column: 'logo_path', action: 'actualizar_logo' },
    fondo: { column: 'fondo_path', action: 'actualizar_fondo' }
  };
  const asset = assets[value];
  if (!asset) throw new ApiError(404, 'Tipo de imagen de marca no válido');
  return asset;
};
const hexColor = (value, label) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(normalized)) throw new ApiError(400, `${label} debe ser un color hexadecimal válido`);
  return normalized;
};
const normalizeSender = (from, user) => {
  if (!from) return null;
  if (from.includes('<') && from.includes('>')) return from;
  return `${from.replace(/[<>]/g, '').trim()} <${user}>`;
};
const SMTP_PROVIDERS = {
  gmail: { host: 'smtp.gmail.com', port: 587, secure: 0 },
  googlemail: { host: 'smtp.gmail.com', port: 587, secure: 0 },
  hotmail: { host: 'smtp-mail.outlook.com', port: 587, secure: 0 },
  outlook: { host: 'smtp-mail.outlook.com', port: 587, secure: 0 },
  live: { host: 'smtp-mail.outlook.com', port: 587, secure: 0 },
  msn: { host: 'smtp-mail.outlook.com', port: 587, secure: 0 },
  yahoo: { host: 'smtp.mail.yahoo.com', port: 465, secure: 1 },
  icloud: { host: 'smtp.mail.me.com', port: 587, secure: 0 },
  me: { host: 'smtp.mail.me.com', port: 587, secure: 0 },
  zoho: { host: 'smtp.zoho.com', port: 465, secure: 1 },
  aol: { host: 'smtp.aol.com', port: 587, secure: 0 }
};
const smtpDefaultsFor = (email) => {
  const domain = String(email || '').split('@')[1]?.trim().toLowerCase() || '';
  return SMTP_PROVIDERS[domain.split('.')[0]] || null;
};
const colorLuminance = (hex) => {
  const channels = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};
const colorContrast = (first, second) => {
  const light = Math.max(colorLuminance(first), colorLuminance(second));
  const dark = Math.min(colorLuminance(first), colorLuminance(second));
  return (light + 0.05) / (dark + 0.05);
};

router.post('/consultorio/onboarding', allowRoles('doctor'), (req, res, next) => {
  try {
    if (req.user.consultorio_id) throw new ApiError(409, 'El usuario ya pertenece a un consultorio');
    if (req.user.estado === 'pendiente') throw new ApiError(403, 'Su correo no tiene una invitación para crear un consultorio');
    required(req.body, ['nombre']);
    const result = db.transaction(() => {
      const clinic = db.prepare(`INSERT INTO consultorios (nombre, slug, nit, telefono, email, direccion, zona_horaria)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(req.body.nombre, uniqueClinicSlug(req.body.nombre), req.body.nit || null,
        req.body.telefono || null, req.body.email || req.user.email, req.body.direccion || null,
        req.body.zona_horaria || 'America/La_Paz');
      db.prepare(`UPDATE usuarios SET consultorio_id = ?, estado = 'activo', actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(clinic.lastInsertRowid, req.user.id);
      audit(clinic.lastInsertRowid, req.user.id, 'crear', 'consultorio', clinic.lastInsertRowid, { nombre: req.body.nombre }, req.ip);
      return clinic.lastInsertRowid;
    })();
    const clinic = db.prepare(`SELECT * FROM consultorios WHERE id=?`).get(result);
    void sendWelcomeEmail({
      consultorioId: result,
      to: req.user.email,
      patientName: req.user.nombre || 'doctor',
      portalUrl: `${config.clientUrl}${clinic.slug ? `/c/${clinic.slug}` : ''}`,
      installUrl: `${config.clientUrl}${clinic.slug ? `/c/${clinic.slug}/instalar` : '/instalar'}`
    }).catch(() => {});
    res.status(201).json({ mensaje: 'Consultorio creado correctamente', consultorio_id: result });
  } catch (error) { next(error); }
});

router.use(requireTenant);

router.get('/consultorio', (req, res) => {
  const row = db.prepare(`SELECT * FROM consultorios WHERE id = ? AND eliminado_en IS NULL`).get(tenant(req));
  if (!row) throw new ApiError(404, 'Consultorio no encontrado');
  res.json({ consultorio: clinicJson(row) });
});
router.patch('/consultorio', allowRoles('doctor'), async (req, res) => {
  const current = db.prepare('SELECT * FROM consultorios WHERE id = ? AND eliminado_en IS NULL').get(tenant(req));
  if (!current) throw new ApiError(404, 'Consultorio no encontrado');
  if (req.body.modo_cobro !== undefined && !['app', 'definir', 'mixto'].includes(req.body.modo_cobro)) {
    throw new ApiError(400, 'Modo de cobro inválido');
  }
  const requestedBrandName = req.body.marca_nombre === undefined ? null : String(req.body.marca_nombre || '').trim();
  if (requestedBrandName && requestedBrandName.length > 60) {
    throw new ApiError(400, 'El nombre de marca no puede superar 60 caracteres');
  }
  const brandName = req.body.marca_nombre === undefined ? current.marca_nombre : requestedBrandName || null;
  const primary = req.body.color_primario === undefined
    ? (current.color_primario || brandDefaults.color_primario)
    : hexColor(req.body.color_primario, 'El color principal');
  const accent = req.body.color_acento === undefined
    ? (current.color_acento || brandDefaults.color_acento)
    : hexColor(req.body.color_acento, 'El color de acento');
  const background = req.body.color_fondo === undefined
    ? (current.color_fondo || brandDefaults.color_fondo)
    : hexColor(req.body.color_fondo, 'El color de fondo');
  const backgroundOpacity = req.body.fondo_opacidad === undefined
    ? (current.fondo_opacidad ?? brandDefaults.fondo_opacidad)
    : Number(req.body.fondo_opacidad);
  if (!Number.isInteger(backgroundOpacity) || backgroundOpacity < 0 || backgroundOpacity > 45) {
    throw new ApiError(400, 'La intensidad del fondo debe estar entre 0 y 45');
  }
  if (colorContrast(primary, '#ffffff') < 4.5) {
    throw new ApiError(400, 'El color principal debe ser más oscuro para mantener legible la aplicación');
  }
  if (colorContrast(accent, '#ffffff') < 3) {
    throw new ApiError(400, 'El color de acento debe ser más oscuro para mantener visibles los detalles');
  }
  if (colorContrast(background, '#17354a') < 4.5) {
    throw new ApiError(400, 'El color de fondo debe ser claro para mantener legible la aplicación');
  }
  const primaryChanged = primary !== current.color_primario;
  const fields = ['nombre', 'nit', 'telefono', 'email', 'direccion', 'zona_horaria', 'modo_cobro'];
  const values = fields.map((field) => req.body[field] ?? current[field]);
  if (primaryChanged) {
    try { await createClinicIcons({ ...current, color_primario: primary }); }
    catch { throw new ApiError(400, 'No se pudo actualizar el color con el logo actual'); }
  }
  db.transaction(() => {
    db.prepare(`UPDATE consultorios SET nombre=?, nit=?, telefono=?, email=?, direccion=?, zona_horaria=?, modo_cobro=?,
        marca_nombre=?, color_primario=?, color_acento=?, color_fondo=?, fondo_opacidad=?, actualizado_en=CURRENT_TIMESTAMP WHERE id=?`)
      .run(...values, brandName, primary, accent, background, backgroundOpacity, tenant(req));
    log(req, 'actualizar', 'consultorio', tenant(req), req.body);
  })();
  const updated = db.prepare('SELECT * FROM consultorios WHERE id=?').get(tenant(req));
  res.json({ mensaje: 'Consultorio actualizado correctamente', consultorio: clinicJson(updated) });
});
router.post('/consultorio/qr', allowRoles('doctor'), (req, res, next) => {
  imageUpload(req, res, (error) => {
    if (error) return next(error);
    try {
      if (!req.file) throw new ApiError(400, 'La imagen QR es obligatoria');
      if (!hasValidImageSignature(req.file)) throw new ApiError(400, 'El archivo no contiene una imagen válida');
      const current = db.prepare('SELECT qr_path FROM consultorios WHERE id=?').get(tenant(req));
      db.prepare('UPDATE consultorios SET qr_path=?,actualizado_en=CURRENT_TIMESTAMP WHERE id=?').run(req.file.filename, tenant(req));
      if (current?.qr_path) fs.unlink(path.join(config.uploadDir, path.basename(current.qr_path)), () => {});
      log(req, 'actualizar_qr', 'consultorio', tenant(req));
      res.json({ mensaje: 'QR actualizado correctamente', qr_url: '/api/consultorio/qr' });
    } catch (caught) {
      if (req.file) fs.unlink(req.file.path, () => {});
      next(caught);
    }
  });
});
router.get('/consultorio/qr', (req, res) => {
  const clinic = db.prepare('SELECT qr_path FROM consultorios WHERE id=? AND eliminado_en IS NULL').get(tenant(req));
  if (!clinic?.qr_path) throw new ApiError(404, 'El consultorio no ha cargado un QR');
  res.sendFile(path.join(config.uploadDir, path.basename(clinic.qr_path)));
});

function emailConfigJson(consultorioId) {
  const row = db.prepare(`SELECT modo, oauth_provider, smtp_host, smtp_port, smtp_secure, smtp_user,
      smtp_from, gmail_user, activo, verificado_en, ultimo_error
    FROM consultorio_email WHERE consultorio_id = ?`).get(consultorioId);
  const clinic = db.prepare(`SELECT email FROM consultorios WHERE id=? AND eliminado_en IS NULL`).get(consultorioId);
  const oauthConectado = row?.oauth_provider === 'gmail_oauth';
  return {
    configurado: Boolean(row),
    modo: oauthConectado ? 'propio' : (row?.modo || 'global'),
    smtp_host: row?.smtp_host || null,
    smtp_port: row?.smtp_port || null,
    smtp_secure: Boolean(row?.smtp_secure),
    smtp_user: row?.smtp_user || null,
    smtp_from: row?.smtp_from || null,
    activo: row?.activo ?? 1,
    verificado_en: row?.verificado_en || null,
    ultimo_error: row?.ultimo_error || null,
    oauth_conectado: oauthConectado,
    oauth_email: oauthConectado ? (row?.gmail_user || null) : null,
    gmail_disponible: Boolean(config.google.clientId && config.google.clientSecret),
    global_activo: Boolean(config.smtp.host && config.smtp.user && config.smtp.pass),
    global_remitente: config.smtp.from || null,
    correo_consultorio: clinic?.email || null
  };
}

router.get('/correo/configuracion', allowRoles('doctor'), (req, res) => {
  res.json({ configuracion: emailConfigJson(tenant(req)) });
});

router.put('/correo/configuracion', allowRoles('doctor'), (req, res) => {
  const consultorioId = tenant(req);
  const clinic = db.prepare(`SELECT id FROM consultorios WHERE id=? AND eliminado_en IS NULL`).get(consultorioId);
  if (!clinic) throw new ApiError(404, 'Consultorio no encontrado');
  const modo = req.body.modo === 'propio' ? 'propio' : 'global';
  if (modo === 'propio') {
    if (!req.body.smtp_user) {
      throw new ApiError(400, 'Para usar el correo propio debe indicar el usuario SMTP');
    }
    const userEmail = String(req.body.smtp_user).trim();
    const defaults = smtpDefaultsFor(userEmail);
    const port = defaults ? defaults.port : Number(req.body.smtp_port || 587);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new ApiError(400, 'El puerto SMTP es inválido');
    }
    const existing = db.prepare(`SELECT smtp_pass_cifrado FROM consultorio_email WHERE consultorio_id=? AND modo='propio'`)
      .get(consultorioId);
    const pass = String(req.body.smtp_pass || '').trim();
    if (!pass && !existing?.smtp_pass_cifrado) {
      throw new ApiError(400, 'Debe indicar la contraseña de aplicación la primera vez');
    }
    db.prepare(`INSERT INTO consultorio_email
      (consultorio_id, modo, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass_cifrado, smtp_from, activo, ultimo_error, actualizado_en)
      VALUES (?, 'propio', ?, ?, ?, ?, ?, ?, 1, NULL, CURRENT_TIMESTAMP)
      ON CONFLICT(consultorio_id) DO UPDATE SET
        modo='propio', smtp_host=excluded.smtp_host, smtp_port=excluded.smtp_port, smtp_secure=excluded.smtp_secure,
        smtp_user=excluded.smtp_user, smtp_pass_cifrado=excluded.smtp_pass_cifrado, smtp_from=excluded.smtp_from,
        oauth_provider='smtp', gmail_user=NULL, gmail_refresh_token_cifrado=NULL,
        gmail_access_token_cifrado=NULL, gmail_access_token_expira_en=NULL,
        activo=1, ultimo_error=NULL, verificado_en=NULL, actualizado_en=CURRENT_TIMESTAMP`)
      .run(consultorioId, defaults ? defaults.host : String(req.body.smtp_host || 'smtp.gmail.com').trim(),
        port, defaults ? defaults.secure : (req.body.smtp_secure === true ? 1 : 0),
        userEmail, pass ? encryptSecret(pass) : existing.smtp_pass_cifrado,
        normalizeSender(String(req.body.smtp_from || '').trim(), userEmail));
    clearClinicTransporter(consultorioId);
    log(req, 'configurar_correo', 'consultorio', consultorioId, { modo: 'propio' });
  } else {
    db.prepare(`INSERT INTO consultorio_email (consultorio_id, modo, activo, ultimo_error, actualizado_en)
      VALUES (?, 'global', 1, NULL, CURRENT_TIMESTAMP)
      ON CONFLICT(consultorio_id) DO UPDATE SET modo='global', smtp_user=NULL, smtp_pass_cifrado=NULL,
        oauth_provider='smtp', gmail_user=NULL, gmail_refresh_token_cifrado=NULL,
        gmail_access_token_cifrado=NULL, gmail_access_token_expira_en=NULL,
        activo=1, ultimo_error=NULL, verificado_en=NULL, actualizado_en=CURRENT_TIMESTAMP`)
      .run(consultorioId);
    clearClinicTransporter(consultorioId);
    log(req, 'configurar_correo', 'consultorio', consultorioId, { modo: 'global' });
  }
  res.json({ mensaje: 'Configuración de correo actualizada', configuracion: emailConfigJson(consultorioId) });
});

router.post('/correo/gmail/desconectar', allowRoles('doctor'), (req, res) => {
  const consultorioId = tenant(req);
  db.prepare(`INSERT INTO consultorio_email (consultorio_id, modo, activo, ultimo_error, actualizado_en)
    VALUES (?, 'global', 1, NULL, CURRENT_TIMESTAMP)
    ON CONFLICT(consultorio_id) DO UPDATE SET modo='global', smtp_user=NULL, smtp_pass_cifrado=NULL,
      oauth_provider='smtp', gmail_user=NULL, gmail_refresh_token_cifrado=NULL,
      gmail_access_token_cifrado=NULL, gmail_access_token_expira_en=NULL,
      activo=1, ultimo_error=NULL, verificado_en=NULL, actualizado_en=CURRENT_TIMESTAMP`)
    .run(consultorioId);
  clearClinicTransporter(consultorioId);
  log(req, 'desconectar_correo', 'consultorio', consultorioId, { proveedor: 'gmail' });
  res.json({ mensaje: 'Correo de Google desconectado', configuracion: emailConfigJson(consultorioId) });
});

router.post('/correo/probar', allowRoles('doctor'), asyncRoute(async (req, res) => {
  const consultorioId = tenant(req);
  const to = String(req.body.correo || '').trim();
  if (!to) throw new ApiError(400, 'Indique el correo de destino de la prueba');
  const sent = await sendTestEmail(consultorioId, to);
  if (!sent) throw new ApiError(400, 'No se pudo enviar el correo de prueba. Revise la configuración o que el correo global esté activo.');
  log(req, 'correo_prueba', 'consultorio', consultorioId, { destino: to });
  res.json({ mensaje: 'Correo de prueba enviado correctamente' });
}));

router.get('/correo/envios', allowRoles('doctor'), (req, res) => {
  const rows = db.prepare(`SELECT id, destinatario, tipo, canal, estado, error, intentos, creado_en
    FROM envios_notificacion WHERE consultorio_id = ?
    ORDER BY id DESC LIMIT 100`).all(tenant(req));
  res.json({ envios: rows });
});
router.post('/consultorio/identidad/:tipo', allowRoles('doctor'), (req, res, next) => {
  let asset;
  try { asset = brandAsset(req.params.tipo); } catch (error) { return next(error); }
  imageUpload(req, res, async (error) => {
    if (error) return next(error);
    try {
      if (!req.file) throw new ApiError(400, 'Debe seleccionar una imagen');
      if (!hasValidImageSignature(req.file)) throw new ApiError(400, 'El archivo no contiene una imagen válida');
      try { await validateClinicImage(req.file.path); }
      catch { throw new ApiError(400, 'El archivo no contiene una imagen válida'); }
      if (req.params.tipo === 'logo') {
        const pending = db.prepare('SELECT * FROM consultorios WHERE id=? AND eliminado_en IS NULL').get(tenant(req));
        if (!pending) throw new ApiError(404, 'Consultorio no encontrado');
        await createClinicIcons({ ...pending, logo_path: req.file.filename });
      }
      const current = db.prepare(`SELECT *, ${asset.column} AS path FROM consultorios WHERE id=?`).get(tenant(req));
      const updatedAsset = db.prepare(`UPDATE consultorios SET ${asset.column}=?, actualizado_en=CURRENT_TIMESTAMP
        WHERE id=? AND eliminado_en IS NULL`).run(req.file.filename, tenant(req));
      ensureFound(updatedAsset, 'Consultorio no encontrado');
      const updated = db.prepare('SELECT * FROM consultorios WHERE id=?').get(tenant(req));
      if (current?.path) fs.unlink(path.join(config.uploadDir, path.basename(current.path)), () => {});
      log(req, asset.action, 'consultorio', tenant(req));
      res.json({ mensaje: 'Identidad visual actualizada', consultorio: clinicJson(updated) });
    } catch (caught) {
      if (req.file) fs.unlink(req.file.path, () => {});
      next(caught);
    }
  });
});
router.delete('/consultorio/identidad/:tipo', allowRoles('doctor'), (req, res) => {
  const asset = brandAsset(req.params.tipo);
  const current = db.prepare(`SELECT ${asset.column} AS path FROM consultorios WHERE id=?`).get(tenant(req));
  const deleted = db.prepare(`UPDATE consultorios SET ${asset.column}=NULL, actualizado_en=CURRENT_TIMESTAMP
    WHERE id=? AND eliminado_en IS NULL`).run(tenant(req));
  ensureFound(deleted, 'Consultorio no encontrado');
  if (current?.path) fs.unlink(path.join(config.uploadDir, path.basename(current.path)), () => {});
  log(req, `eliminar_${req.params.tipo}`, 'consultorio', tenant(req));
  const updated = db.prepare('SELECT * FROM consultorios WHERE id=?').get(tenant(req));
  if (req.params.tipo === 'logo') removeClinicIcons(updated.slug);
  res.json({ mensaje: 'Imagen eliminada', consultorio: clinicJson(updated) });
});
router.get('/consultorio/identidad/:tipo/imagen', (req, res, next) => {
  const asset = brandAsset(req.params.tipo);
  const clinic = db.prepare(`SELECT ${asset.column} AS path FROM consultorios WHERE id=? AND eliminado_en IS NULL`).get(tenant(req));
  if (!clinic?.path) throw new ApiError(404, 'El consultorio no ha cargado esta imagen');
  const requestedVersion = String(req.query.v || '');
  if (requestedVersion && requestedVersion !== clinic.path) throw new ApiError(404, 'La imagen ya no está disponible');
  res.setHeader('Cache-Control', requestedVersion ? 'private, max-age=31536000, immutable' : 'private, max-age=300');
  res.sendFile(path.join(config.uploadDir, path.basename(clinic.path)), (error) => {
    if (error) { res.removeHeader('Cache-Control'); next(new ApiError(404, 'La imagen ya no está disponible')); }
  });
});

router.get('/usuarios', allowRoles('doctor'), (req, res) => {
  const rows = db.prepare(`SELECT id, email, nombre, avatar_url, rol, estado, ultimo_acceso_en, creado_en
    FROM usuarios WHERE consultorio_id = ? AND eliminado_en IS NULL ORDER BY nombre`).all(tenant(req));
  res.json({ usuarios: rows });
});
router.post('/usuarios/invitaciones', allowRoles('doctor'), (req, res) => {
  required(req.body, ['email', 'nombre']);
  const role = req.body.rol || 'operativo';
  if (role !== 'operativo') throw new ApiError(400, 'Solo se pueden invitar usuarios operativos desde esta ruta');
  try {
    const result = db.prepare(`INSERT INTO usuarios (consultorio_id, email, nombre, rol, estado)
      VALUES (?, ?, ?, 'operativo', 'preautorizado')`).run(tenant(req), req.body.email.trim(), req.body.nombre.trim());
    log(req, 'invitar', 'usuario', result.lastInsertRowid, { email: req.body.email, rol: role });
    res.status(201).json({ mensaje: 'Invitación registrada; el usuario podrá acceder con Google', id: result.lastInsertRowid });
  } catch (error) {
    if (String(error.code).startsWith('SQLITE_CONSTRAINT')) throw new ApiError(409, 'El correo ya está registrado en el consultorio');
    throw error;
  }
});
router.patch('/usuarios/:id/estado', allowRoles('doctor'), (req, res) => {
  if (!['activo', 'suspendido'].includes(req.body.estado)) throw new ApiError(400, 'Estado de usuario inválido');
  if (id(req.params.id) === req.user.id) throw new ApiError(400, 'No puede suspender su propio usuario');
  const result = db.prepare(`UPDATE usuarios SET estado=?, actualizado_en=CURRENT_TIMESTAMP
    WHERE id=? AND consultorio_id=? AND rol='operativo' AND eliminado_en IS NULL`).run(req.body.estado, id(req.params.id), tenant(req));
  ensureFound(result, 'Usuario operativo no encontrado');
  log(req, 'cambiar_estado', 'usuario', id(req.params.id), { estado: req.body.estado });
  res.json({ mensaje: 'Estado del usuario actualizado' });
});

router.get('/pacientes', allowRoles('doctor', 'operativo'), (req, res) => {
  const term = String(req.query.buscar || '').trim();
  const search = `%${term}%`;
  const prefix = `${term}%`;
  const rows = db.prepare(`SELECT p.*,
      (SELECT MAX(c.inicio) FROM citas c WHERE c.consultorio_id=p.consultorio_id AND c.paciente_id=p.id AND c.eliminado_en IS NULL) ultima_cita,
      COALESCE((SELECT SUM(c.precio_bs) FROM citas c WHERE c.consultorio_id=p.consultorio_id AND c.paciente_id=p.id AND c.estado='atendida' AND c.eliminado_en IS NULL),0)
      - COALESCE((SELECT SUM(pg.monto_bs) FROM pagos pg WHERE pg.consultorio_id=p.consultorio_id AND pg.paciente_id=p.id AND pg.estado='valido' AND pg.eliminado_en IS NULL),0) saldo_bs
    FROM pacientes p WHERE p.consultorio_id=? AND p.eliminado_en IS NULL
      AND (? = '%%' OR p.codigo LIKE ? OR p.nombres LIKE ? OR p.apellidos LIKE ? OR p.email LIKE ? OR p.telefono LIKE ? OR p.documento LIKE ?)
    ORDER BY CASE WHEN ?<>'' AND p.codigo=? THEN 0 WHEN ?<>'' AND p.codigo LIKE ? THEN 1 ELSE 2 END,
      p.apellidos, p.nombres LIMIT 200`).all(tenant(req), search, search, search, search, search, search, search,
      term, term, term, prefix);
  res.json({ pacientes: rows });
});
router.get('/pacientes/me', allowRoles('paciente'), (req, res) => {
  const row = db.prepare(`SELECT * FROM pacientes WHERE id=? AND consultorio_id=? AND eliminado_en IS NULL`)
    .get(patientForUser(req), tenant(req));
  res.json({ paciente: row });
});
router.patch('/pacientes/me', allowRoles('paciente'), (req, res) => {
  const patientId = patientForUser(req);
  const current = db.prepare('SELECT * FROM pacientes WHERE id=? AND consultorio_id=?').get(patientId, tenant(req));
  const fields = ['nombres','apellidos','telefono','fecha_nacimiento','direccion','contacto_emergencia','telefono_emergencia','alergias','antecedentes','medicamentos','recordatorios_activos'];
  db.prepare(`UPDATE pacientes SET nombres=?,apellidos=?,telefono=?,fecha_nacimiento=?,direccion=?,contacto_emergencia=?,
    telefono_emergencia=?,alergias=?,antecedentes=?,medicamentos=?,recordatorios_activos=?,actualizado_en=CURRENT_TIMESTAMP WHERE id=? AND consultorio_id=?`)
    .run(...fields.map((field) => req.body[field] ?? current[field]), patientId, tenant(req));
  db.prepare(`UPDATE usuarios SET nombre=?,actualizado_en=CURRENT_TIMESTAMP WHERE id=? AND consultorio_id=?`)
    .run(`${req.body.nombres ?? current.nombres} ${req.body.apellidos ?? current.apellidos}`.trim(), req.user.id, tenant(req));
  log(req, 'actualizar_perfil', 'paciente', patientId, req.body, patientId);
  const patient = db.prepare('SELECT * FROM pacientes WHERE id=?').get(patientId);
  res.json({ mensaje: 'Perfil actualizado correctamente', paciente: patient });
});
router.get('/pacientes/:id', (req, res) => {
  restrictPatient(req, id(req.params.id));
  const row = db.prepare(`SELECT * FROM pacientes WHERE id=? AND consultorio_id=? AND eliminado_en IS NULL`).get(id(req.params.id), tenant(req));
  if (!row) throw new ApiError(404, 'Paciente no encontrado');
  res.json({ paciente: row });
});
router.post('/pacientes', allowRoles('doctor', 'operativo'), (req, res) => {
  required(req.body, ['codigo', 'nombres', 'apellidos']);
  const code = patientCode(req.body.codigo);
  if (req.user.rol === 'operativo' && req.body.email) throw new ApiError(403, 'Solo el doctor puede autorizar el correo de acceso');
  if (req.user.rol === 'operativo' && ['alergias','antecedentes','medicamentos','notas'].some((field) => req.body[field]))
    throw new ApiError(403, 'El personal operativo debe registrar observaciones clínicas mediante un registro pendiente de validación');
  try {
    const patientId = db.transaction(() => {
      let userId = null;
      if (req.body.email) {
        const email = String(req.body.email).trim();
        const existing = db.prepare(`SELECT id, rol FROM usuarios WHERE consultorio_id=? AND email=? COLLATE NOCASE AND eliminado_en IS NULL`)
          .get(tenant(req), email);
        if (existing && existing.rol !== 'paciente') throw new ApiError(409, 'El correo pertenece a un usuario interno');
        if (existing) userId = existing.id;
        else {
          const archivado = db.prepare(`SELECT id FROM usuarios WHERE consultorio_id=? AND email=? COLLATE NOCASE AND eliminado_en IS NOT NULL ORDER BY id LIMIT 1`)
            .get(tenant(req), email);
          if (archivado) {
            db.prepare(`UPDATE usuarios SET rol='paciente', estado='preautorizado', nombre=?, google_sub=NULL,
              eliminado_en=NULL, actualizado_en=CURRENT_TIMESTAMP WHERE id=?`)
              .run(`${req.body.nombres} ${req.body.apellidos}`, archivado.id);
            userId = archivado.id;
          } else {
            userId = db.prepare(`INSERT INTO usuarios (consultorio_id,email,nombre,rol,estado) VALUES (?,?,?,'paciente','preautorizado')`)
              .run(tenant(req), email, `${req.body.nombres} ${req.body.apellidos}`).lastInsertRowid;
          }
        }
      }
      const archivedPatient = req.body.email ? db.prepare(`SELECT id, usuario_id, codigo FROM pacientes
        WHERE consultorio_id=? AND email=? COLLATE NOCASE AND eliminado_en IS NOT NULL ORDER BY id LIMIT 1`)
        .get(tenant(req), String(req.body.email).trim()) : null;
      let patientId;
      if (archivedPatient) {
        db.prepare(`UPDATE pacientes SET codigo=?, nombres=?, apellidos=?, email=?, telefono=?, fecha_nacimiento=?, sexo=?, documento=?,
          direccion=?, contacto_emergencia=?, telefono_emergencia=?, alergias=?, antecedentes=?, medicamentos=?, notas=?,
          usuario_id=COALESCE(?, usuario_id), eliminado_en=NULL, actualizado_en=CURRENT_TIMESTAMP WHERE id=?`)
          .run(code, req.body.nombres, req.body.apellidos, req.body.email || null, req.body.telefono || null,
            req.body.fecha_nacimiento || null, req.body.sexo || null, req.body.documento || null, req.body.direccion || null,
            req.body.contacto_emergencia || null, req.body.telefono_emergencia || null, req.body.alergias || null,
            req.body.antecedentes || null, req.body.medicamentos || null, req.body.notas || null, userId, archivedPatient.id);
        patientId = archivedPatient.id;
      } else {
        patientId = db.prepare(`INSERT INTO pacientes
          (consultorio_id,usuario_id,codigo,nombres,apellidos,email,telefono,fecha_nacimiento,sexo,documento,direccion,
           contacto_emergencia,telefono_emergencia,alergias,antecedentes,medicamentos,notas)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(tenant(req), userId, code, req.body.nombres,
          req.body.apellidos, req.body.email || null, req.body.telefono || null, req.body.fecha_nacimiento || null,
          req.body.sexo || null, req.body.documento || null, req.body.direccion || null, req.body.contacto_emergencia || null,
          req.body.telefono_emergencia || null, req.body.alergias || null, req.body.antecedentes || null,
          req.body.medicamentos || null, req.body.notas || null).lastInsertRowid;
      }
      return patientId;
    })();
    log(req, 'crear', 'paciente', patientId, { codigo: code, nombres: req.body.nombres, apellidos: req.body.apellidos }, patientId);
    const patient = db.prepare('SELECT * FROM pacientes WHERE id=? AND consultorio_id=?').get(patientId, tenant(req));
    if (patient?.email) {
      const clinic = db.prepare(`SELECT slug FROM consultorios WHERE id=?`).get(tenant(req));
      void sendWelcomeEmail({
        consultorioId: tenant(req),
        to: patient.email,
        patientName: `${patient.nombres} ${patient.apellidos || ''}`.trim(),
        portalUrl: `${config.clientUrl}${clinic?.slug ? `/c/${clinic.slug}` : ''}`,
        installUrl: `${config.clientUrl}${clinic?.slug ? `/c/${clinic.slug}/instalar` : '/instalar'}`
      }).catch(() => {});
    }
    res.status(201).json({ mensaje: 'Paciente registrado correctamente', paciente: patient });
  } catch (error) {
    if (duplicatePatientCode(error)) throw new ApiError(409, 'El código del paciente ya está registrado en el consultorio');
    if (String(error.code).startsWith('SQLITE_CONSTRAINT')) throw new ApiError(409, 'El correo del paciente ya está registrado');
    throw error;
  }
});
router.patch('/pacientes/:id', allowRoles('doctor', 'operativo'), (req, res) => {
  const patientId = id(req.params.id);
  const current = db.prepare(`SELECT * FROM pacientes WHERE id=? AND consultorio_id=? AND eliminado_en IS NULL`).get(patientId, tenant(req));
  if (!current) throw new ApiError(404, 'Paciente no encontrado');
  const code = req.body.codigo === undefined || req.body.codigo === current.codigo ? current.codigo : patientCode(req.body.codigo);
  const fields = ['codigo','nombres','apellidos','email','telefono','fecha_nacimiento','sexo','documento','direccion','contacto_emergencia',
    'telefono_emergencia','alergias','antecedentes','medicamentos','notas'];
  const protectedFields = ['email','alergias','antecedentes','medicamentos','notas'];
  if (req.user.rol === 'operativo' && protectedFields.some((field) => req.body[field] !== undefined && req.body[field] !== current[field]))
    throw new ApiError(403, 'Solo el doctor puede modificar acceso o información clínica protegida');
  try {
    const values = fields.map((field) => field === 'codigo' ? code : field === 'email' && req.body.email !== undefined
      ? String(req.body.email).trim() || null
      : req.body[field] ?? current[field]);
    db.transaction(() => {
      db.prepare(`UPDATE pacientes SET codigo=?,nombres=?,apellidos=?,email=?,telefono=?,fecha_nacimiento=?,sexo=?,documento=?,direccion=?,
        contacto_emergencia=?,telefono_emergencia=?,alergias=?,antecedentes=?,medicamentos=?,notas=?,actualizado_en=CURRENT_TIMESTAMP
        WHERE id=? AND consultorio_id=?`).run(...values, patientId, tenant(req));
      if (req.user.rol === 'doctor' && req.body.email !== undefined) {
        const nextEmail = String(req.body.email || '').trim() || null;
        const nextName = `${req.body.nombres ?? current.nombres} ${req.body.apellidos ?? current.apellidos}`.trim();
        if (current.usuario_id && nextEmail) {
          const emailChanged = String(current.email || '').toLowerCase() !== nextEmail.toLowerCase();
          db.prepare(`UPDATE usuarios SET email=?,nombre=?,google_sub=CASE WHEN ?=1 THEN NULL ELSE google_sub END,
            estado=CASE WHEN ?=1 THEN 'preautorizado' ELSE estado END,actualizado_en=CURRENT_TIMESTAMP
            WHERE id=? AND consultorio_id=? AND rol='paciente'`)
            .run(nextEmail, nextName, Number(emailChanged), Number(emailChanged), current.usuario_id, tenant(req));
        } else if (current.usuario_id && !nextEmail) {
          db.prepare(`UPDATE usuarios SET google_sub=NULL,estado='suspendido',actualizado_en=CURRENT_TIMESTAMP
            WHERE id=? AND consultorio_id=? AND rol='paciente'`).run(current.usuario_id, tenant(req));
        } else if (!current.usuario_id && nextEmail) {
          const userId = db.prepare(`INSERT INTO usuarios (consultorio_id,email,nombre,rol,estado)
            VALUES (?,?,?,'paciente','preautorizado')`).run(tenant(req), nextEmail, nextName).lastInsertRowid;
          db.prepare(`UPDATE pacientes SET usuario_id=? WHERE id=? AND consultorio_id=?`).run(userId, patientId, tenant(req));
        }
      }
    })();
  } catch (error) {
    if (duplicatePatientCode(error)) throw new ApiError(409, 'El código del paciente ya está registrado en el consultorio');
    if (String(error.code).startsWith('SQLITE_CONSTRAINT')) throw new ApiError(409, 'El correo del paciente ya está registrado');
    throw error;
  }
  const auditData = code === current.codigo ? req.body : { ...req.body, codigo: { anterior: current.codigo, nuevo: code } };
  log(req, 'actualizar', 'paciente', patientId, auditData, patientId);
  res.json({ mensaje: 'Paciente actualizado correctamente' });
});
router.delete('/pacientes/:id', allowRoles('doctor'), (req, res) => {
  const patientId = id(req.params.id);
  const result = db.prepare(`UPDATE pacientes SET eliminado_en=CURRENT_TIMESTAMP, actualizado_en=CURRENT_TIMESTAMP
    WHERE id=? AND consultorio_id=? AND eliminado_en IS NULL`).run(patientId, tenant(req));
  ensureFound(result, 'Paciente no encontrado');
  log(req, 'eliminar_logico', 'paciente', patientId, undefined, patientId);
  res.json({ mensaje: 'Paciente archivado correctamente' });
});

router.get('/pacientes/:id/notas', allowRoles('doctor', 'operativo'), (req, res) => {
  const patientId = id(req.params.id);
  const patient = db.prepare(`SELECT id FROM pacientes WHERE id=? AND consultorio_id=? AND eliminado_en IS NULL`).get(patientId, tenant(req));
  if (!patient) throw new ApiError(404, 'Paciente no encontrado');
  const rows = db.prepare(`SELECT n.*,u.nombre usuario FROM notas_paciente n
    JOIN usuarios u ON u.id=n.usuario_id AND u.consultorio_id=n.consultorio_id
    WHERE n.consultorio_id=? AND n.paciente_id=? AND n.eliminado_en IS NULL ORDER BY n.creado_en DESC LIMIT 100`)
    .all(tenant(req), patientId);
  res.json({ notas: rows });
});
router.post('/pacientes/:id/notas', allowRoles('doctor', 'operativo'), (req, res) => {
  const patientId = id(req.params.id);
  const text = String(req.body.texto || '').trim();
  if (!text) throw new ApiError(400, 'La nota no puede estar vacía');
  if (text.length > 2000) throw new ApiError(400, 'La nota no puede superar 2000 caracteres');
  const patient = db.prepare(`SELECT id FROM pacientes WHERE id=? AND consultorio_id=? AND eliminado_en IS NULL`).get(patientId, tenant(req));
  if (!patient) throw new ApiError(404, 'Paciente no encontrado');
  const result = db.prepare(`INSERT INTO notas_paciente (consultorio_id,paciente_id,usuario_id,texto) VALUES (?,?,?,?)`)
    .run(tenant(req), patientId, req.user.id, text);
  log(req, 'crear', 'nota_paciente', result.lastInsertRowid, { paciente_id: patientId }, patientId);
  res.status(201).json({ mensaje: 'Nota añadida correctamente', id: result.lastInsertRowid });
});
router.delete('/pacientes/:patientId/notas/:noteId', allowRoles('doctor', 'operativo'), (req, res) => {
  const patientId = id(req.params.patientId);
  const noteId = id(req.params.noteId);
  const authorFilter = req.user.rol === 'doctor' ? '' : ' AND usuario_id=?';
  const values = [noteId, patientId, tenant(req)];
  if (req.user.rol !== 'doctor') values.push(req.user.id);
  const result = db.prepare(`UPDATE notas_paciente SET eliminado_en=CURRENT_TIMESTAMP,actualizado_en=CURRENT_TIMESTAMP
    WHERE id=? AND paciente_id=? AND consultorio_id=? AND eliminado_en IS NULL${authorFilter}`).run(...values);
  ensureFound(result, 'Nota no encontrada o sin permiso para eliminarla');
  log(req, 'eliminar_logico', 'nota_paciente', noteId, { paciente_id: patientId }, patientId);
  res.json({ mensaje: 'Nota eliminada correctamente' });
});

router.get('/servicios', (req, res) => {
  const rows = db.prepare(`SELECT * FROM servicios WHERE consultorio_id=? AND eliminado_en IS NULL
    ${req.user.rol === 'paciente' ? 'AND activo=1' : ''} ORDER BY nombre`).all(tenant(req));
  res.json({ servicios: rows });
});
router.get('/doctores', (req, res) => {
  const rows = db.prepare(`SELECT id,nombre,avatar_url FROM usuarios
    WHERE consultorio_id=? AND rol='doctor' AND estado='activo' AND eliminado_en IS NULL ORDER BY nombre`).all(tenant(req));
  res.json({ doctores: rows });
});
router.get('/disponibilidad', (req, res) => {
  required(req.query, ['fecha','servicio_id']);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.fecha))) throw new ApiError(400, 'Fecha inválida');
  const service = db.prepare(`SELECT duracion_min FROM servicios WHERE id=? AND consultorio_id=? AND activo=1 AND eliminado_en IS NULL`)
    .get(id(req.query.servicio_id), tenant(req));
  if (!service) throw new ApiError(404, 'Servicio no encontrado');
  const doctorId = req.query.doctor_id ? id(req.query.doctor_id) : 0;
  const weekday = new Date(`${req.query.fecha}T12:00:00Z`).getUTCDay();
  const schedules = db.prepare(`SELECT h.*,u.nombre doctor FROM horarios h JOIN usuarios u ON u.id=h.usuario_id
    WHERE h.consultorio_id=? AND h.dia_semana=? AND h.activo=1 AND h.eliminado_en IS NULL
      AND u.consultorio_id=h.consultorio_id AND u.rol='doctor' AND u.estado='activo' AND u.eliminado_en IS NULL
      AND (?=0 OR h.usuario_id=?) ORDER BY h.usuario_id,h.hora_inicio`).all(tenant(req), weekday, doctorId, doctorId);
  const slots = [];
  const allSlots = [];
  for (const schedule of schedules) {
    const [startHour, startMinute] = schedule.hora_inicio.split(':').map(Number);
    const [endHour, endMinute] = schedule.hora_fin.split(':').map(Number);
    for (let minute = startHour * 60 + startMinute; minute + service.duracion_min <= endHour * 60 + endMinute; minute += service.duracion_min) {
      const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
      const start = new Date(`${req.query.fecha}T${time}:00-04:00`);
      const end = new Date(start.getTime() + service.duracion_min * 60000);
      if (start <= new Date()) continue;
      const conflict = db.prepare(`SELECT id FROM citas WHERE consultorio_id=? AND doctor_id=? AND estado='confirmada'
        AND eliminado_en IS NULL AND inicio < ? AND fin > ?`).get(tenant(req), schedule.usuario_id, end.toISOString(), start.toISOString());
      const slot = { doctor_id: schedule.usuario_id, inicio: start.toISOString(), fin: end.toISOString(),
        estado: conflict ? 'ocupado' : 'disponible' };
      if (!conflict) slot.doctor = schedule.doctor;
      allSlots.push(slot);
      if (!conflict) slots.push({ doctor_id: schedule.usuario_id, doctor: schedule.doctor, inicio: start.toISOString() });
    }
  }
  res.json({ disponibilidad: slots, horarios: allSlots });
});
router.post('/servicios', allowRoles('doctor'), (req, res) => {
  required(req.body, ['nombre']);
  const price = servicePrice(req.body.precio_bs);
  if (clinicMode(req) === 'app' && price === null) throw new ApiError(400, 'En modo de cobro por la app, el precio del tratamiento es obligatorio');
  const result = db.prepare(`INSERT INTO servicios (consultorio_id,nombre,descripcion,precio_bs,duracion_min)
    VALUES (?,?,?,?,?)`).run(tenant(req), req.body.nombre, req.body.descripcion || null, price, Number(req.body.duracion_min || 30));
  log(req, 'crear', 'servicio', result.lastInsertRowid, req.body);
  res.status(201).json({ mensaje: 'Servicio creado correctamente', id: result.lastInsertRowid });
});
router.patch('/servicios/:id', allowRoles('doctor'), (req, res) => {
  const serviceId = id(req.params.id);
  const current = db.prepare(`SELECT * FROM servicios WHERE id=? AND consultorio_id=? AND eliminado_en IS NULL`).get(serviceId, tenant(req));
  if (!current) throw new ApiError(404, 'Servicio no encontrado');
  const price = req.body.precio_bs === undefined ? current.precio_bs : servicePrice(req.body.precio_bs);
  if (clinicMode(req) === 'app' && price === null) throw new ApiError(400, 'En modo de cobro por la app, el precio del tratamiento es obligatorio');
  db.prepare(`UPDATE servicios SET nombre=?,descripcion=?,precio_bs=?,duracion_min=?,activo=?,actualizado_en=CURRENT_TIMESTAMP
    WHERE id=? AND consultorio_id=?`).run(req.body.nombre ?? current.nombre, req.body.descripcion ?? current.descripcion,
    price,
    Number(req.body.duracion_min ?? current.duracion_min), req.body.activo === undefined ? current.activo : Number(Boolean(req.body.activo)),
    serviceId, tenant(req));
  log(req, 'actualizar', 'servicio', serviceId, req.body);
  res.json({ mensaje: 'Servicio actualizado correctamente' });
});
router.delete('/servicios/:id', allowRoles('doctor'), (req, res) => {
  const serviceId = id(req.params.id);
  const result = db.prepare(`UPDATE servicios SET eliminado_en=CURRENT_TIMESTAMP,activo=0,actualizado_en=CURRENT_TIMESTAMP
    WHERE id=? AND consultorio_id=? AND eliminado_en IS NULL`).run(serviceId, tenant(req));
  ensureFound(result, 'Servicio no encontrado');
  log(req, 'eliminar_logico', 'servicio', serviceId);
  res.json({ mensaje: 'Servicio archivado correctamente' });
});

const QUOTE_STATES = ['borrador', 'entregado', 'aceptado', 'archivado'];
const parseQuoteItems = (req) => {
  if (req.body.items === undefined) return null;
  if (!Array.isArray(req.body.items) || req.body.items.length > 50)
    throw new ApiError(400, 'Los servicios deben ser una lista de hasta 50 elementos');
  return req.body.items.map((item, position) => {
    let serviceId = null;
    let name = String(item.nombre || '').trim();
    if (item.servicio_id !== undefined && item.servicio_id !== null && item.servicio_id !== '') {
      serviceId = id(item.servicio_id);
      const service = db.prepare(`SELECT nombre FROM servicios WHERE id=? AND consultorio_id=? AND eliminado_en IS NULL`)
        .get(serviceId, tenant(req));
      if (!service) throw new ApiError(404, 'Servicio de catálogo no encontrado');
      if (!name) name = service.nombre;
    }
    if (!name) throw new ApiError(400, 'Cada servicio del presupuesto requiere nombre');
    if (name.length > 200) throw new ApiError(400, 'El nombre del servicio no puede superar 200 caracteres');
    let price = null;
    if (item.precio_bs !== undefined && item.precio_bs !== null && item.precio_bs !== '') {
      const parsedPrice = Number(item.precio_bs);
      if (!Number.isFinite(parsedPrice) || parsedPrice < 0) throw new ApiError(400, 'El precio debe ser un número mayor o igual a cero');
      price = parsedPrice;
    }
    const amount = item.cantidad === undefined ? 1 : Number(item.cantidad);
    if (!Number.isInteger(amount) || amount < 1 || amount > 999) throw new ApiError(400, 'La cantidad debe ser un entero entre 1 y 999');
    let duration = null;
    if (item.duracion_min !== undefined && item.duracion_min !== null && item.duracion_min !== '') {
      const parsedDuration = Number(item.duracion_min);
      if (!Number.isInteger(parsedDuration) || parsedDuration < 1) throw new ApiError(400, 'La duración debe ser un entero mayor que cero');
      duration = parsedDuration;
    }
    return { serviceId, name, amount, price, duration, notes: String(item.notas || '').trim().slice(0, 500) || null, position };
  });
};
const replaceQuoteItems = (quoteId, clinicId, items) => {
  db.prepare(`UPDATE presupuesto_items SET eliminado_en=CURRENT_TIMESTAMP WHERE presupuesto_id=? AND eliminado_en IS NULL`).run(quoteId);
  const insert = db.prepare(`INSERT INTO presupuesto_items (presupuesto_id,servicio_id,nombre,cantidad,precio_bs,duracion_min,notas,posicion)
    VALUES (?,?,?,?,?,?,?,?)`);
  for (const item of items) insert.run(quoteId, item.serviceId, item.name, item.amount, item.price, item.duration, item.notes, item.position);
};
const quoteSummary = (quoteId) => db.prepare(`SELECT
    COUNT(*) total_items,
    COALESCE(SUM(CASE WHEN precio_bs IS NULL THEN 0 ELSE precio_bs * cantidad END), 0) total_bs,
    COALESCE(SUM(CASE WHEN precio_bs IS NULL THEN 1 ELSE 0 END), 0) sin_precio
  FROM presupuesto_items WHERE presupuesto_id=? AND eliminado_en IS NULL`).get(quoteId);
const quotePayments = (quoteId) => {
  const total = Number(quoteSummary(quoteId).total_bs || 0);
  const paid = Number(db.prepare(`SELECT COALESCE(SUM(monto_bs),0) total FROM pagos
    WHERE presupuesto_id=? AND estado='valido' AND eliminado_en IS NULL`).get(quoteId).total || 0);
  return { total_bs: total, pagado_bs: paid, saldo_bs: Math.max(0, total - paid),
    estado: total <= 0 ? 'sin_precio' : paid >= total ? 'pagado' : paid > 0 ? 'saldo' : 'pendiente' };
};

const newQuoteToken = () => randomBytes(24).toString('base64url');
const ensureQuoteToken = (quoteId) => {
  const current = db.prepare(`SELECT token_publico FROM presupuestos WHERE id=?`).get(quoteId);
  if (current?.token_publico) return current.token_publico;
  for (let attempt = 0; attempt < 5; attempt++) {
    const token = newQuoteToken();
    try {
      db.prepare(`UPDATE presupuestos SET token_publico=? WHERE id=?`).run(token, quoteId);
      return token;
    } catch (error) {
      if (error.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw error;
    }
  }
  throw new Error('No se pudo generar un token único para la cotización');
};
const lookupQuoteToken = (token) => {
  if (!token || typeof token !== 'string' || token.length < 8 || token.length > 80) return null;
  return db.prepare(`SELECT pr.id, pr.consultorio_id, pr.paciente_id FROM presupuestos pr
    WHERE token_publico=? AND eliminado_en IS NULL`).get(token);
};
const quoteTimeline = (quoteId) => db.prepare(`SELECT a.creado_en, a.datos_json, u.nombre usuario
  FROM auditoria a LEFT JOIN usuarios u ON u.id=a.usuario_id AND u.consultorio_id=a.consultorio_id
  WHERE a.entidad_tipo='presupuesto' AND a.entidad_id=? AND a.accion='cambiar_estado'
  ORDER BY a.creado_en ASC`).all(quoteId)
  .map((row) => {
    try {
      const datos = JSON.parse(row.datos_json || '{}');
      return { estado: datos.estado, fecha: row.creado_en, usuario: row.usuario || null };
    } catch { return null; }
  })
  .filter(Boolean);

router.post('/presupuestos/:id/compartir', allowRoles('doctor', 'operativo'), (req, res) => {
  const quoteId = id(req.params.id);
  const quote = db.prepare(`SELECT * FROM presupuestos WHERE id=? AND consultorio_id=? AND eliminado_en IS NULL`)
    .get(quoteId, tenant(req));
  if (!quote) throw new ApiError(404, 'Presupuesto no encontrado');
  const token = ensureQuoteToken(quoteId);
  const newlyShared = !quote.compartido_en;
  if (!quote.compartido_en) {
    db.prepare(`UPDATE presupuestos SET compartido_en=CURRENT_TIMESTAMP WHERE id=?`).run(quoteId);
  }
  const patientUser = db.prepare(`SELECT usuario_id FROM pacientes WHERE id=? AND consultorio_id=?`).get(quote.paciente_id, tenant(req));
  if (newlyShared && patientUser?.usuario_id) {
    const summary = quoteSummary(quoteId);
    const price = summary.sin_precio > 0 ? `Total publicado: Bs ${summary.total_bs} + servicios por definir.` : `Total cotizado: Bs ${summary.total_bs}.`;
    db.prepare(`INSERT INTO notificaciones (consultorio_id,usuario_id,tipo,titulo,mensaje,entidad_tipo,entidad_id)
      VALUES (?,?,'cotizacion_compartida','Cotización disponible',?,'presupuesto',?)`).run(tenant(req), patientUser.usuario_id,
      `Tu cotización está disponible. ${price}`, quoteId);
  }
  log(req, 'compartir', 'presupuesto', quoteId, { paciente_id: quote.paciente_id }, quote.paciente_id);
  res.json({ mensaje: 'Enlace público listo para compartir', public_token: token, compartido_en: quote.compartido_en });
});

router.get('/presupuestos', allowRoles('doctor', 'operativo', 'paciente'), (req, res) => {
  const conditions = ['pr.consultorio_id=?', 'pr.eliminado_en IS NULL'];
  const values = [tenant(req)];
  if (req.user.rol === 'paciente') {
    conditions.push('pr.paciente_id=?', `pr.estado IN ('entregado','aceptado')`, 'pr.compartido_en IS NOT NULL');
    values.push(patientForUser(req));
  } else if (req.query.paciente_id) { conditions.push('pr.paciente_id=?'); values.push(id(req.query.paciente_id)); }
  if (req.query.estado) {
    if (!QUOTE_STATES.includes(req.query.estado)) throw new ApiError(400, 'Estado de presupuesto inválido');
    conditions.push('pr.estado=?'); values.push(req.query.estado);
  }
  const rows = db.prepare(`SELECT pr.*,p.codigo,p.nombres,p.apellidos,p.telefono,u.nombre creado_por_nombre
    FROM presupuestos pr
    JOIN pacientes p ON p.id=pr.paciente_id AND p.consultorio_id=pr.consultorio_id
    JOIN usuarios u ON u.id=pr.creado_por AND u.consultorio_id=pr.consultorio_id
    WHERE ${conditions.join(' AND ')} ORDER BY pr.creado_en DESC LIMIT 500`).all(...values);
  for (const row of rows) row.public_token = ensureQuoteToken(row.id);
  res.json({ presupuestos: rows.map((row) => ({ ...row, resumen: quoteSummary(row.id), pago: quotePayments(row.id) })) });
});
router.post('/presupuestos', allowRoles('doctor', 'operativo'), (req, res) => {
  required(req.body, ['paciente_id']);
  const patientId = id(req.body.paciente_id);
  const patient = db.prepare(`SELECT id FROM pacientes WHERE id=? AND consultorio_id=? AND eliminado_en IS NULL`).get(patientId, tenant(req));
  if (!patient) throw new ApiError(404, 'Paciente no encontrado');
  const items = parseQuoteItems(req);
  if (!items || !items.length) throw new ApiError(400, 'El presupuesto requiere al menos un servicio');
  const quoteId = db.transaction(() => {
    const result = db.prepare(`INSERT INTO presupuestos (consultorio_id,paciente_id,titulo,notas,estado,creado_por)
      VALUES (?,?,?,?,'borrador',?)`).run(tenant(req), patientId,
      req.body.titulo ? String(req.body.titulo).trim().slice(0, 120) : null,
      req.body.notas ? String(req.body.notas).trim().slice(0, 2000) : null, req.user.id);
    replaceQuoteItems(result.lastInsertRowid, tenant(req), items);
    ensureQuoteToken(result.lastInsertRowid);
    return result.lastInsertRowid;
  })();
  log(req, 'crear', 'presupuesto', quoteId, { paciente_id: patientId, titulo: req.body.titulo, items: items.map((item) => ({ nombre: item.name, precio_bs: item.price })) }, patientId);
  res.status(201).json({ mensaje: 'Presupuesto creado correctamente', id: quoteId });
});
router.get('/presupuestos/:id', allowRoles('doctor', 'operativo', 'paciente'), (req, res) => {
  const quoteId = id(req.params.id);
  const quote = db.prepare(`SELECT pr.*,p.codigo,p.nombres,p.apellidos,p.telefono,u.nombre creado_por_nombre
    FROM presupuestos pr
    JOIN pacientes p ON p.id=pr.paciente_id AND p.consultorio_id=pr.consultorio_id
    JOIN usuarios u ON u.id=pr.creado_por AND u.consultorio_id=pr.consultorio_id
    WHERE pr.id=? AND pr.consultorio_id=? AND pr.eliminado_en IS NULL
      AND (? <> 'paciente' OR (pr.paciente_id=? AND pr.estado IN ('entregado','aceptado') AND pr.compartido_en IS NOT NULL))`).get(
        quoteId, tenant(req), req.user.rol, req.user.rol === 'paciente' ? patientForUser(req) : 0);
  if (!quote) throw new ApiError(404, 'Presupuesto no encontrado');
  const items = db.prepare(`SELECT * FROM presupuesto_items WHERE presupuesto_id=? AND eliminado_en IS NULL ORDER BY posicion,id`).all(quoteId);
  const publicToken = ensureQuoteToken(quoteId);
  res.json({
    presupuesto: {
      ...quote,
       resumen: quoteSummary(quoteId),
       pago: quotePayments(quoteId),
      items,
      timeline: quoteTimeline(quoteId),
      public_token: publicToken,
    }
  });
});
router.patch('/presupuestos/:id', allowRoles('doctor', 'operativo'), (req, res) => {
  const quoteId = id(req.params.id);
  const current = db.prepare(`SELECT * FROM presupuestos WHERE id=? AND consultorio_id=? AND eliminado_en IS NULL`).get(quoteId, tenant(req));
  if (!current) throw new ApiError(404, 'Presupuesto no encontrado');
  const items = parseQuoteItems(req);
  db.transaction(() => {
    db.prepare(`UPDATE presupuestos SET titulo=?,notas=?,actualizado_en=CURRENT_TIMESTAMP WHERE id=? AND consultorio_id=?`).run(
      req.body.titulo === undefined ? current.titulo : String(req.body.titulo).trim().slice(0, 120) || null,
      req.body.notas === undefined ? current.notas : String(req.body.notas).trim().slice(0, 2000) || null,
      quoteId, tenant(req));
    if (items !== null) replaceQuoteItems(quoteId, tenant(req), items);
  })();
  if (current.compartido_en) {
    const patientUser = db.prepare(`SELECT usuario_id FROM pacientes WHERE id=? AND consultorio_id=?`).get(current.paciente_id, tenant(req));
    if (patientUser?.usuario_id) {
      const summary = quoteSummary(quoteId);
      const price = summary.sin_precio > 0 ? `Total publicado: Bs ${summary.total_bs} + servicios por definir.` : `Nuevo total cotizado: Bs ${summary.total_bs}.`;
      db.prepare(`INSERT INTO notificaciones (consultorio_id,usuario_id,tipo,titulo,mensaje,entidad_tipo,entidad_id)
        VALUES (?,?,'cotizacion_actualizada','Cotización actualizada',?,'presupuesto',?)`).run(tenant(req), patientUser.usuario_id,
        `El doctor actualizó tu cotización. ${price}`, quoteId);
    }
  }
  const auditData = items !== null
    ? { ...(req.body.titulo !== undefined ? { titulo: req.body.titulo } : {}), items: items.map((item) => ({ nombre: item.name, precio_bs: item.price })) }
    : { ...(req.body.titulo !== undefined ? { titulo: req.body.titulo } : {}) };
  log(req, 'actualizar', 'presupuesto', quoteId, auditData, current.paciente_id);
  res.json({ mensaje: 'Presupuesto actualizado correctamente' });
});
router.patch('/presupuestos/:id/estado', allowRoles('doctor', 'operativo'), (req, res) => {
  if (!QUOTE_STATES.includes(req.body.estado)) throw new ApiError(400, 'Estado de presupuesto inválido');
  const quoteId = id(req.params.id);
  const quote = db.prepare(`SELECT paciente_id FROM presupuestos WHERE id=? AND consultorio_id=? AND eliminado_en IS NULL`).get(quoteId, tenant(req));
  if (!quote) throw new ApiError(404, 'Presupuesto no encontrado');
  const result = db.prepare(`UPDATE presupuestos SET estado=?,actualizado_en=CURRENT_TIMESTAMP
    WHERE id=? AND consultorio_id=? AND eliminado_en IS NULL`).run(req.body.estado, quoteId, tenant(req));
  ensureFound(result, 'Presupuesto no encontrado');
  log(req, 'cambiar_estado', 'presupuesto', quoteId, { estado: req.body.estado }, quote.paciente_id);
  res.json({ mensaje: 'Estado del presupuesto actualizado' });
});
router.delete('/presupuestos/:id', allowRoles('doctor', 'operativo'), (req, res) => {
  const quoteId = id(req.params.id);
  const quote = db.prepare(`SELECT paciente_id FROM presupuestos WHERE id=? AND consultorio_id=? AND eliminado_en IS NULL`).get(quoteId, tenant(req));
  if (!quote) throw new ApiError(404, 'Presupuesto no encontrado');
  const result = db.prepare(`UPDATE presupuestos SET eliminado_en=CURRENT_TIMESTAMP,actualizado_en=CURRENT_TIMESTAMP
    WHERE id=? AND consultorio_id=? AND eliminado_en IS NULL`).run(quoteId, tenant(req));
  ensureFound(result, 'Presupuesto no encontrado');
  log(req, 'eliminar_logico', 'presupuesto', quoteId, undefined, quote.paciente_id);
  res.json({ mensaje: 'Presupuesto archivado correctamente' });
});

router.get('/horarios', (req, res) => {
  const doctorId = req.user.rol === 'doctor' ? Number(req.query.doctor_id || req.user.id) : Number(req.query.doctor_id || 0);
  const rows = db.prepare(`SELECT h.*,u.nombre doctor FROM horarios h JOIN usuarios u ON u.id=h.usuario_id AND u.consultorio_id=h.consultorio_id
    WHERE h.consultorio_id=? AND h.eliminado_en IS NULL AND (?=0 OR h.usuario_id=?) ORDER BY h.dia_semana,h.hora_inicio`)
    .all(tenant(req), doctorId, doctorId);
  res.json({ horarios: rows });
});
router.post('/horarios', allowRoles('doctor'), (req, res) => {
  required(req.body, ['dia_semana','hora_inicio','hora_fin']);
  const doctorId = Number(req.body.doctor_id || req.user.id);
  const doctor = db.prepare(`SELECT id FROM usuarios WHERE id=? AND consultorio_id=? AND rol='doctor' AND estado='activo' AND eliminado_en IS NULL`)
    .get(doctorId, tenant(req));
  if (!doctor) throw new ApiError(404, 'Doctor no encontrado');
  if (req.body.hora_inicio >= req.body.hora_fin) throw new ApiError(400, 'La hora final debe ser posterior a la inicial');
  db.prepare(`DELETE FROM horarios WHERE eliminado_en IS NOT NULL AND consultorio_id=? AND usuario_id=?`)
    .run(tenant(req), doctorId);
  try {
    const result = db.prepare(`INSERT INTO horarios (consultorio_id,usuario_id,dia_semana,hora_inicio,hora_fin)
      VALUES (?,?,?,?,?)`).run(tenant(req), doctorId, Number(req.body.dia_semana), req.body.hora_inicio, req.body.hora_fin);
    log(req, 'crear', 'horario', result.lastInsertRowid, req.body);
    res.status(201).json({ mensaje: 'Horario registrado correctamente', id: result.lastInsertRowid });
  } catch (error) {
    if (String(error.code).startsWith('SQLITE_CONSTRAINT')) throw new ApiError(409, 'El horario ya existe o sus datos no son válidos');
    throw error;
  }
});
router.delete('/horarios/:id', allowRoles('doctor'), (req, res) => {
  const scheduleId = id(req.params.id);
  const result = db.prepare(`DELETE FROM horarios
    WHERE id=? AND consultorio_id=? AND eliminado_en IS NULL`).run(scheduleId, tenant(req));
  ensureFound(result, 'Horario no encontrado');
  log(req, 'eliminar', 'horario', scheduleId);
  res.json({ mensaje: 'Horario eliminado correctamente' });
});

router.get('/citas', (req, res) => {
  const conditions = ['c.consultorio_id=?', 'c.eliminado_en IS NULL'];
  const values = [tenant(req)];
  if (req.user.rol === 'doctor') { conditions.push('c.doctor_id=?'); values.push(req.user.id); }
  if (req.user.rol === 'paciente') { conditions.push('c.paciente_id=?'); values.push(patientForUser(req)); }
  if (req.query.desde) { conditions.push('c.inicio>=?'); values.push(req.query.desde); }
  if (req.query.hasta) { conditions.push('c.inicio<?'); values.push(req.query.hasta); }
  if (req.query.estado) { conditions.push('c.estado=?'); values.push(req.query.estado); }
  if (req.query.fecha) { conditions.push('date(c.inicio,\'-4 hours\')=?'); values.push(req.query.fecha); }
  if (req.query.paciente_id) {
    const patientId = id(req.query.paciente_id);
    restrictPatient(req, patientId);
    conditions.push('c.paciente_id=?'); values.push(patientId);
  }
  const rows = db.prepare(`SELECT c.*,p.codigo,p.nombres,p.apellidos,p.email,p.telefono,u.nombre doctor,s.nombre servicio
    FROM citas c JOIN pacientes p ON p.id=c.paciente_id AND p.consultorio_id=c.consultorio_id
    JOIN usuarios u ON u.id=c.doctor_id AND u.consultorio_id=c.consultorio_id
    JOIN servicios s ON s.id=c.servicio_id AND s.consultorio_id=c.consultorio_id
    WHERE ${conditions.join(' AND ')} ORDER BY c.inicio DESC LIMIT 500`).all(...values);
  res.json({ citas: rows });
});
router.post('/citas', (req, res) => {
  required(req.body, ['paciente_id','doctor_id','servicio_id','inicio']);
  const patientId = id(req.body.paciente_id);
  const doctorId = id(req.body.doctor_id);
  const serviceId = id(req.body.servicio_id);
  restrictPatient(req, patientId);
  const patient = db.prepare(`SELECT id FROM pacientes WHERE id=? AND consultorio_id=? AND eliminado_en IS NULL`).get(patientId, tenant(req));
  const doctor = db.prepare(`SELECT id FROM usuarios WHERE id=? AND consultorio_id=? AND rol='doctor' AND estado='activo' AND eliminado_en IS NULL`).get(doctorId, tenant(req));
  const service = db.prepare(`SELECT * FROM servicios WHERE id=? AND consultorio_id=? AND activo=1 AND eliminado_en IS NULL`).get(serviceId, tenant(req));
  if (!patient) throw new ApiError(404, 'Paciente no encontrado');
  if (!doctor) throw new ApiError(404, 'Doctor no encontrado');
  if (req.user.rol === 'doctor' && doctorId !== req.user.id) throw new ApiError(403, 'El doctor solo puede gestionar su propia agenda');
  if (!service) throw new ApiError(404, 'Servicio no encontrado');
  const start = new Date(req.body.inicio);
  if (Number.isNaN(start.getTime())) throw new ApiError(400, 'Fecha de inicio inválida');
  const end = req.body.fin ? new Date(req.body.fin) : new Date(start.getTime() + service.duracion_min * 60000);
  if (Number.isNaN(end.getTime()) || end <= start) throw new ApiError(400, 'Fecha de finalización inválida');
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(start);
  const localTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/La_Paz', hour: '2-digit', minute: '2-digit', hour12: false }).format(start);
  const weekday = new Date(`${localDate}T12:00:00Z`).getUTCDay();
  const schedule = db.prepare(`SELECT id FROM horarios WHERE consultorio_id=? AND usuario_id=? AND dia_semana=? AND activo=1
    AND eliminado_en IS NULL AND hora_inicio<=? AND hora_fin>=?`).get(tenant(req), doctorId, weekday, localTime, new Intl.DateTimeFormat('en-GB', { timeZone: 'America/La_Paz', hour: '2-digit', minute: '2-digit', hour12: false }).format(end));
  if (!schedule) throw new ApiError(409, 'El horario no está disponible para este doctor');
  const conflict = db.prepare(`SELECT id FROM citas WHERE consultorio_id=? AND doctor_id=? AND estado='confirmada'
    AND eliminado_en IS NULL AND inicio < ? AND fin > ?`).get(tenant(req), doctorId, endIso, startIso);
  if (conflict) throw new ApiError(409, 'El doctor ya tiene una cita en ese horario');
  const appointmentId = db.transaction(() => {
    const result = db.prepare(`INSERT INTO citas
      (consultorio_id,paciente_id,doctor_id,servicio_id,inicio,fin,estado,precio_bs,motivo,notas,creado_por)
      VALUES (?,?,?,?,?,?,'confirmada',?,?,?,?)`).run(tenant(req), patientId, doctorId, serviceId, startIso, endIso,
      service.precio_bs, req.body.motivo || null, req.body.notas || null, req.user.id);
    db.prepare(`INSERT INTO notificaciones (consultorio_id,usuario_id,tipo,titulo,mensaje,entidad_tipo,entidad_id)
      VALUES (?,?,'nueva_cita','Nueva cita confirmada',?,'cita',?)`)
      .run(tenant(req), doctorId, `Se confirmó una cita para ${startIso}`, result.lastInsertRowid);
    return result.lastInsertRowid;
  })();
  log(req, 'crear', 'cita', appointmentId, { paciente_id: patientId, doctor_id: doctorId, inicio: startIso }, patientId);
  void sendAppointmentEmail(appointmentId, 'confirmacion')
    .catch((error) => console.error(`No se pudo enviar la confirmación de la cita ${appointmentId}:`, error));
  res.status(201).json({ mensaje: 'Cita confirmada correctamente', id: appointmentId, estado: 'confirmada' });
});
router.patch('/citas/:id', allowRoles('doctor', 'operativo'), (req, res) => {
  const appointmentId = id(req.params.id);
  const doctorScope = req.user.rol === 'doctor' ? ' AND doctor_id=?' : '';
  const currentValues = [appointmentId, tenant(req)];
  if (req.user.rol === 'doctor') currentValues.push(req.user.id);
  const current = db.prepare(`SELECT * FROM citas WHERE id=? AND consultorio_id=? AND eliminado_en IS NULL${doctorScope}`).get(...currentValues);
  if (!current) throw new ApiError(404, 'Cita no encontrada');
  const patientId = req.body.paciente_id === undefined ? current.paciente_id : id(req.body.paciente_id);
  const doctorId = req.body.doctor_id === undefined ? current.doctor_id : id(req.body.doctor_id);
  const serviceId = req.body.servicio_id === undefined ? current.servicio_id : id(req.body.servicio_id);
  if (req.user.rol === 'doctor' && doctorId !== req.user.id) throw new ApiError(403, 'El doctor solo puede gestionar su propia agenda');
  const patient = db.prepare(`SELECT id FROM pacientes WHERE id=? AND consultorio_id=? AND eliminado_en IS NULL`).get(patientId, tenant(req));
  const doctor = db.prepare(`SELECT id FROM usuarios WHERE id=? AND consultorio_id=? AND rol='doctor' AND estado='activo' AND eliminado_en IS NULL`).get(doctorId, tenant(req));
  const service = db.prepare(`SELECT * FROM servicios WHERE id=? AND consultorio_id=? AND activo=1 AND eliminado_en IS NULL`).get(serviceId, tenant(req));
  if (!patient) throw new ApiError(404, 'Paciente no encontrado');
  if (!doctor) throw new ApiError(404, 'Doctor no encontrado');
  if (!service) throw new ApiError(404, 'Servicio no encontrado');
  const start = new Date(req.body.inicio ?? current.inicio);
  const explicitEnd = req.body.fin === undefined ? null : new Date(req.body.fin);
  const duration = serviceId === current.servicio_id
    ? new Date(current.fin).getTime() - new Date(current.inicio).getTime()
    : service.duracion_min * 60000;
  const end = explicitEnd || new Date(start.getTime() + duration);
  if (Number.isNaN(start.getTime())) throw new ApiError(400, 'Fecha de inicio inválida');
  if (Number.isNaN(end.getTime()) || end <= start) throw new ApiError(400, 'Fecha de finalización inválida');
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(start);
  const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/La_Paz', hour: '2-digit', minute: '2-digit', hour12: false });
  const weekday = new Date(`${localDate}T12:00:00Z`).getUTCDay();
  const schedule = db.prepare(`SELECT id FROM horarios WHERE consultorio_id=? AND usuario_id=? AND dia_semana=? AND activo=1
    AND eliminado_en IS NULL AND hora_inicio<=? AND hora_fin>=?`).get(tenant(req), doctorId, weekday, timeFormat.format(start), timeFormat.format(end));
  if (!schedule) throw new ApiError(409, 'El horario no está disponible para este doctor');
  const conflict = db.prepare(`SELECT id FROM citas WHERE consultorio_id=? AND doctor_id=? AND id<>? AND estado='confirmada'
    AND eliminado_en IS NULL AND inicio < ? AND fin > ?`).get(tenant(req), doctorId, appointmentId, endIso, startIso);
  if (conflict) throw new ApiError(409, 'El doctor ya tiene una cita en ese horario');
  db.transaction(() => {
    db.prepare(`UPDATE citas SET paciente_id=?,doctor_id=?,servicio_id=?,inicio=?,fin=?,precio_bs=?,motivo=?,notas=?,actualizado_en=CURRENT_TIMESTAMP
      WHERE id=? AND consultorio_id=?`).run(patientId, doctorId, serviceId, startIso, endIso,
      serviceId === current.servicio_id ? current.precio_bs : service.precio_bs, req.body.motivo ?? current.motivo,
      req.body.notas ?? current.notas, appointmentId, tenant(req));
    db.prepare(`INSERT INTO notificaciones (consultorio_id,usuario_id,tipo,titulo,mensaje,entidad_tipo,entidad_id)
      VALUES (?,?,'cita_reprogramada','Cita actualizada',?,'cita',?)`)
      .run(tenant(req), doctorId, `La cita fue programada para ${startIso}`, appointmentId);
    db.prepare(`DELETE FROM email_recordatorios WHERE consultorio_id=? AND cita_id=?`).run(tenant(req), appointmentId);
  })();
  log(req, 'reprogramar', 'cita', appointmentId, { antes: { inicio: current.inicio, fin: current.fin }, despues: { inicio: startIso, fin: endIso }, doctor_id: doctorId }, patientId);
  void sendAppointmentEmail(appointmentId, 'reprogramacion')
    .catch((error) => console.error(`No se pudo enviar la reprogramación de la cita ${appointmentId}:`, error));
  res.json({ mensaje: 'Cita actualizada correctamente' });
});
router.patch('/citas/:id/reprogramar', allowRoles('paciente'), (req, res) => {
  required(req.body, ['inicio']);
  const appointmentId = id(req.params.id);
  const patientId = patientForUser(req);
  const current = db.prepare(`SELECT * FROM citas WHERE id=? AND consultorio_id=? AND paciente_id=?
    AND estado='confirmada' AND eliminado_en IS NULL`).get(appointmentId, tenant(req), patientId);
  if (!current) throw new ApiError(404, 'Cita confirmada no encontrada');
  if (current.reprogramaciones_paciente >= 1) throw new ApiError(409, 'Esta cita ya fue reprogramada por el paciente');
  if (new Date(current.inicio).getTime() - Date.now() < 5 * 60 * 60 * 1000)
    throw new ApiError(409, 'Con menos de 5 horas de anticipación, el cambio debe ser coordinado por teléfono');

  const start = new Date(req.body.inicio);
  if (Number.isNaN(start.getTime())) throw new ApiError(400, 'Fecha de inicio inválida');
  if (start.getTime() <= Date.now()) throw new ApiError(409, 'La nueva fecha de inicio debe ser futura');
  const duration = new Date(current.fin).getTime() - new Date(current.inicio).getTime();
  const end = new Date(start.getTime() + duration);
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(start);
  const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/La_Paz', hour: '2-digit', minute: '2-digit', hour12: false });
  const weekday = new Date(`${localDate}T12:00:00Z`).getUTCDay();
  const schedule = db.prepare(`SELECT id FROM horarios WHERE consultorio_id=? AND usuario_id=? AND dia_semana=? AND activo=1
    AND eliminado_en IS NULL AND hora_inicio<=? AND hora_fin>=?`).get(tenant(req), current.doctor_id, weekday,
    timeFormat.format(start), timeFormat.format(end));
  if (!schedule) throw new ApiError(409, 'El horario no está disponible para este doctor');
  const conflict = db.prepare(`SELECT id FROM citas WHERE consultorio_id=? AND doctor_id=? AND id<>? AND estado='confirmada'
    AND eliminado_en IS NULL AND inicio < ? AND fin > ?`).get(tenant(req), current.doctor_id, appointmentId, endIso, startIso);
  if (conflict) throw new ApiError(409, 'El doctor ya tiene una cita en ese horario');

  db.transaction(() => {
    const updated = db.prepare(`UPDATE citas SET inicio=?,fin=?,reprogramaciones_paciente=reprogramaciones_paciente+1,
      reprogramada_por_paciente_en=CURRENT_TIMESTAMP,actualizado_en=CURRENT_TIMESTAMP
      WHERE id=? AND consultorio_id=? AND paciente_id=? AND estado='confirmada' AND reprogramaciones_paciente=0 AND eliminado_en IS NULL`)
      .run(startIso, endIso, appointmentId, tenant(req), patientId);
    if (!updated.changes) throw new ApiError(409, 'Esta cita ya fue reprogramada por el paciente');
    db.prepare(`INSERT INTO notificaciones (consultorio_id,usuario_id,tipo,titulo,mensaje,entidad_tipo,entidad_id)
      VALUES (?,?,'cita_reprogramada','Cita reprogramada por paciente',?,'cita',?)`)
      .run(tenant(req), current.doctor_id, `El paciente reprogramó la cita para ${startIso}`, appointmentId);
    db.prepare(`DELETE FROM email_recordatorios WHERE consultorio_id=? AND cita_id=?`).run(tenant(req), appointmentId);
    log(req, 'reprogramar', 'cita', appointmentId, {
      antes: { inicio: current.inicio, fin: current.fin },
      despues: { inicio: startIso, fin: endIso },
      origen: 'paciente'
    }, patientId);
  })();
  void sendAppointmentEmail(appointmentId, 'reprogramacion')
    .catch((error) => console.error(`No se pudo enviar la reprogramación de la cita ${appointmentId}:`, error));
  res.json({ mensaje: 'Cita reprogramada correctamente' });
});
router.patch('/citas/:id/cancelar', allowRoles('paciente'), (req, res) => {
  const appointmentId = id(req.params.id);
  const appointment = db.prepare(`SELECT * FROM citas WHERE id=? AND consultorio_id=? AND paciente_id=? AND estado='confirmada' AND eliminado_en IS NULL`)
    .get(appointmentId, tenant(req), patientForUser(req));
  if (!appointment) throw new ApiError(404, 'Cita confirmada no encontrada');
  const under24Hours = new Date(appointment.inicio).getTime() - Date.now() < 24 * 60 * 60 * 1000;
  const reason = String(req.body.motivo_cancelacion || '').trim();
  if (under24Hours && !reason) throw new ApiError(400, 'Debe indicar un motivo para cancelar con menos de 24 horas de anticipación');
  db.transaction(() => {
    db.prepare(`UPDATE citas SET estado='cancelada',notas=CASE WHEN ?='' THEN notas ELSE COALESCE(notas||' | ','')||'Cancelación: '||? END,
      actualizado_en=CURRENT_TIMESTAMP WHERE id=? AND consultorio_id=?`).run(reason, reason, appointmentId, tenant(req));
    db.prepare(`INSERT INTO notificaciones (consultorio_id,usuario_id,tipo,titulo,mensaje,entidad_tipo,entidad_id)
      VALUES (?,?,'cita_cancelada','Cita cancelada',?,'cita',?)`)
      .run(tenant(req), appointment.doctor_id,
        under24Hours ? `El paciente canceló con menos de 24 horas de anticipación. Motivo: ${reason}` : 'El paciente canceló una cita programada.',
        appointmentId);
  })();
  log(req, 'cancelar', 'cita', appointmentId, { motivo_cancelacion: reason, menos_de_24_horas: under24Hours }, appointment.paciente_id);
  const doctorForEmail = db.prepare(`SELECT u.email, u.nombre doctor, s.nombre servicio, co.nombre consultorio,
      co.marca_nombre, p.nombres paciente
    FROM citas c
    JOIN pacientes p ON p.id=c.paciente_id AND p.consultorio_id=c.consultorio_id
    JOIN usuarios u ON u.id=c.doctor_id AND u.consultorio_id=c.consultorio_id
    JOIN servicios s ON s.id=c.servicio_id AND s.consultorio_id=c.consultorio_id
    JOIN consultorios co ON co.id=c.consultorio_id
    WHERE c.id=? AND c.consultorio_id=?`).get(appointmentId, tenant(req));
  if (doctorForEmail?.email) {
    void sendClinicEmail({
      consultorioId: tenant(req),
      to: doctorForEmail.email,
      patientName: doctorForEmail.doctor,
      subject: `Cita cancelada - ${doctorForEmail.marca_nombre || doctorForEmail.consultorio}`,
      heading: 'Un paciente canceló una cita',
      lines: [
        `Paciente: ${doctorForEmail.paciente}`,
        `Servicio: ${doctorForEmail.servicio}`,
        `Motivo: ${reason || 'Sin motivo indicado'}`,
        under24Hours ? 'La cancelación ocurrió con menos de 24 horas de anticipación.' : null
      ].filter(Boolean),
      tipo: 'cancelacion_doctor'
    }).catch(() => {});
  }
  res.json({ mensaje: 'Cita cancelada correctamente' });
});
router.patch('/citas/:id/estado', allowRoles('doctor', 'operativo'), (req, res) => {
  if (!['confirmada','atendida','cancelada','no_asistio'].includes(req.body.estado)) throw new ApiError(400, 'Estado de cita inválido');
  const appointmentId = id(req.params.id);
  const extra = req.user.rol === 'doctor' ? ' AND doctor_id=?' : '';
  const lookupValues = [appointmentId, tenant(req)];
  if (req.user.rol === 'doctor') lookupValues.push(req.user.id);
  const appointment = db.prepare(`SELECT paciente_id FROM citas WHERE id=? AND consultorio_id=? AND eliminado_en IS NULL${extra}`).get(...lookupValues);
  if (!appointment) throw new ApiError(404, 'Cita no encontrada');
  const values = [req.body.estado, req.body.notas || null, appointmentId, tenant(req)];
  if (req.user.rol === 'doctor') values.push(req.user.id);
  const result = db.prepare(`UPDATE citas SET estado=?,notas=COALESCE(?,notas),actualizado_en=CURRENT_TIMESTAMP
    WHERE id=? AND consultorio_id=? AND eliminado_en IS NULL${extra}`).run(...values);
  ensureFound(result, 'Cita no encontrada');
  log(req, 'cambiar_estado', 'cita', appointmentId, { estado: req.body.estado }, appointment.paciente_id);
  res.json({ mensaje: 'Estado de la cita actualizado' });
});
router.delete('/citas/:id', allowRoles('doctor'), (req, res) => {
  const appointmentId = id(req.params.id);
  const appointment = db.prepare(`SELECT paciente_id FROM citas WHERE id=? AND consultorio_id=? AND eliminado_en IS NULL`)
    .get(appointmentId, tenant(req));
  if (!appointment) throw new ApiError(404, 'Cita no encontrada');
  const result = db.prepare(`UPDATE citas SET eliminado_en=CURRENT_TIMESTAMP,actualizado_en=CURRENT_TIMESTAMP
    WHERE id=? AND consultorio_id=? AND eliminado_en IS NULL`).run(appointmentId, tenant(req));
  ensureFound(result, 'Cita no encontrada');
  log(req, 'eliminar_logico', 'cita', appointmentId, undefined, appointment.paciente_id);
  res.json({ mensaje: 'Cita archivada correctamente' });
});

router.get('/registros-clinicos/me', allowRoles('paciente'), (req, res) => {
  const rows = db.prepare(`SELECT r.*,u.nombre doctor FROM registros_clinicos r JOIN usuarios u ON u.id=r.doctor_id AND u.consultorio_id=r.consultorio_id
    WHERE r.paciente_id=? AND r.consultorio_id=? AND r.estado='validado' AND r.eliminado_en IS NULL ORDER BY r.creado_en DESC`)
    .all(patientForUser(req), tenant(req));
  res.json({ registros: rows });
});
router.get('/registros-clinicos/paciente/:pacienteId', allowRoles('doctor', 'operativo'), (req, res) => {
  const rows = db.prepare(`SELECT r.*,u.nombre doctor FROM registros_clinicos r
    JOIN usuarios u ON u.id=r.doctor_id AND u.consultorio_id=r.consultorio_id
    WHERE r.paciente_id=? AND r.consultorio_id=? AND r.eliminado_en IS NULL ORDER BY r.creado_en DESC`)
    .all(id(req.params.pacienteId), tenant(req));
  res.json({ registros: rows });
});
router.post('/registros-clinicos', allowRoles('doctor', 'operativo'), (req, res) => {
  required(req.body, ['paciente_id','diagnostico']);
  const patientId = id(req.body.paciente_id);
  const patient = db.prepare(`SELECT id FROM pacientes WHERE id=? AND consultorio_id=? AND eliminado_en IS NULL`).get(patientId, tenant(req));
  if (!patient) throw new ApiError(404, 'Paciente no encontrado');
  let appointmentId = null;
  const doctorId = req.user.rol === 'doctor' ? req.user.id : id(req.body.doctor_id);
  const doctor = db.prepare(`SELECT id FROM usuarios WHERE id=? AND consultorio_id=? AND rol='doctor' AND estado='activo' AND eliminado_en IS NULL`).get(doctorId, tenant(req));
  if (!doctor) throw new ApiError(404, 'Doctor no encontrado');
  if (req.body.cita_id) {
    appointmentId = id(req.body.cita_id);
    const appointment = db.prepare(`SELECT id FROM citas WHERE id=? AND paciente_id=? AND doctor_id=? AND consultorio_id=? AND eliminado_en IS NULL`)
      .get(appointmentId, patientId, doctorId, tenant(req));
    if (!appointment) throw new ApiError(400, 'La cita no corresponde al paciente y doctor');
  }
  const result = db.prepare(`INSERT INTO registros_clinicos
    (consultorio_id,paciente_id,cita_id,doctor_id,diagnostico,tratamiento,observaciones,estado,creado_por,validado_por,validado_en)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(tenant(req), patientId, appointmentId, doctorId, req.body.diagnostico,
    req.body.tratamiento || null, req.body.observaciones || null, req.user.rol === 'doctor' ? 'validado' : 'pendiente', req.user.id,
    req.user.rol === 'doctor' ? req.user.id : null, req.user.rol === 'doctor' ? new Date().toISOString() : null);
  log(req, 'crear', 'registro_clinico', result.lastInsertRowid, { paciente_id: patientId, cita_id: appointmentId }, patientId);
  res.status(201).json({ mensaje: 'Registro clínico creado correctamente', id: result.lastInsertRowid });
});
router.patch('/registros-clinicos/:id', allowRoles('doctor', 'operativo'), (req, res) => {
  const recordId = id(req.params.id);
  const current = db.prepare(`SELECT * FROM registros_clinicos WHERE id=? AND consultorio_id=? AND eliminado_en IS NULL`).get(recordId, tenant(req));
  if (!current) throw new ApiError(404, 'Registro clínico no encontrado');
  if (req.user.rol === 'operativo' && (current.estado !== 'pendiente' || current.creado_por !== req.user.id))
    throw new ApiError(403, 'Un registro validado ya no puede ser modificado por personal operativo');
  if (req.user.rol === 'doctor' && current.doctor_id !== req.user.id) throw new ApiError(403, 'Solo el doctor asignado puede validar este registro');
  const nextState = req.user.rol === 'doctor' && req.body.estado === 'validado' ? 'validado' : current.estado;
  db.prepare(`UPDATE registros_clinicos SET diagnostico=?,tratamiento=?,observaciones=?,estado=?,validado_por=?,validado_en=?,actualizado_en=CURRENT_TIMESTAMP
    WHERE id=? AND consultorio_id=?`).run(req.body.diagnostico ?? current.diagnostico, req.body.tratamiento ?? current.tratamiento,
    req.body.observaciones ?? current.observaciones, nextState, nextState === 'validado' ? req.user.id : current.validado_por,
    nextState === 'validado' ? new Date().toISOString() : current.validado_en, recordId, tenant(req));
  log(req, 'actualizar', 'registro_clinico', recordId, req.body, current.paciente_id);
  res.json({ mensaje: 'Registro clínico actualizado correctamente' });
});

router.get('/pagos', (req, res) => {
  const conditions = ['pg.consultorio_id=?', 'pg.eliminado_en IS NULL'];
  const values = [tenant(req)];
  if (req.user.rol === 'paciente') { conditions.push('pg.paciente_id=?'); values.push(patientForUser(req)); }
  if (req.query.paciente_id) {
    restrictPatient(req, id(req.query.paciente_id));
    conditions.push('pg.paciente_id=?'); values.push(id(req.query.paciente_id));
  }
  if (req.query.estado) { conditions.push('pg.estado=?'); values.push(req.query.estado); }
  const rows = db.prepare(`SELECT pg.*,p.codigo,p.nombres,p.apellidos,u.nombre registrado_por_nombre,
      pr.titulo presupuesto_titulo
    FROM pagos pg JOIN pacientes p ON p.id=pg.paciente_id AND p.consultorio_id=pg.consultorio_id
    JOIN usuarios u ON u.id=pg.registrado_por AND u.consultorio_id=pg.consultorio_id
    LEFT JOIN presupuestos pr ON pr.id=pg.presupuesto_id AND pr.consultorio_id=pg.consultorio_id
    WHERE ${conditions.join(' AND ')} ORDER BY pg.creado_en DESC LIMIT 500`).all(...values);
  res.json({ pagos: rows.map((row) => {
    const { evidencia_path: evidencePath, ...payment } = row;
    return { ...payment, evidencia_url: evidencePath ? `/api/pagos/${row.id}/evidencia` : null };
  }) });
});
router.post('/pagos', upload.single('evidencia'), (req, res, next) => {
  try {
    required(req.body, ['paciente_id','monto_bs','metodo']);
    const patientId = id(req.body.paciente_id);
    restrictPatient(req, patientId);
    if (!['efectivo','tarjeta','transferencia','qr'].includes(req.body.metodo)) throw new ApiError(400, 'Método de pago inválido');
    if (req.user.rol === 'paciente' && req.body.metodo !== 'qr') throw new ApiError(403, 'El paciente solo puede registrar pagos QR');
    if (req.body.metodo === 'qr' && !req.file) throw new ApiError(400, 'La evidencia es obligatoria para pagos QR');
    if (req.file && !hasValidImageSignature(req.file)) throw new ApiError(400, 'El archivo no contiene una imagen válida');
    const patient = db.prepare(`SELECT id FROM pacientes WHERE id=? AND consultorio_id=? AND eliminado_en IS NULL`).get(patientId, tenant(req));
    if (!patient) throw new ApiError(404, 'Paciente no encontrado');
    let appointmentId = null;
    if (req.body.cita_id) {
      appointmentId = id(req.body.cita_id);
      const appointment = db.prepare(`SELECT id FROM citas WHERE id=? AND paciente_id=? AND consultorio_id=? AND eliminado_en IS NULL`)
        .get(appointmentId, patientId, tenant(req));
      if (!appointment) throw new ApiError(400, 'La cita no corresponde al paciente');
    }
    let quoteId = null;
    if (req.body.presupuesto_id) {
      quoteId = id(req.body.presupuesto_id);
      const quote = db.prepare(`SELECT id FROM presupuestos WHERE id=? AND paciente_id=? AND consultorio_id=? AND eliminado_en IS NULL`)
        .get(quoteId, patientId, tenant(req));
      if (!quote) throw new ApiError(400, 'La cotización no corresponde al paciente');
    }
    const state = req.body.metodo === 'qr' ? 'por_verificar' : 'valido';
    const evidence = req.file ? req.file.filename : null;
    const result = db.prepare(`INSERT INTO pagos
      (consultorio_id,paciente_id,cita_id,presupuesto_id,monto_bs,metodo,estado,evidencia_path,referencia,registrado_por)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(tenant(req), patientId, appointmentId, quoteId, positiveNumber(req.body.monto_bs, 'monto_bs'),
      req.body.metodo, state, evidence, req.body.referencia || null, req.user.id);
    const patientUser = db.prepare(`SELECT usuario_id FROM pacientes WHERE id=? AND consultorio_id=?`).get(patientId, tenant(req));
    if (patientUser?.usuario_id) db.prepare(`INSERT INTO notificaciones (consultorio_id,usuario_id,tipo,titulo,mensaje,entidad_tipo,entidad_id)
      VALUES (?,?,'pago_actualizado','Pago registrado',?,'pago',?)`).run(tenant(req), patientUser.usuario_id,
      state === 'valido' ? 'El consultorio registró tu pago y tu saldo fue actualizado.' : 'Tu comprobante QR fue enviado para verificación.', result.lastInsertRowid);
    log(req, 'crear', 'pago', result.lastInsertRowid, { paciente_id: patientId, monto_bs: req.body.monto_bs, metodo: req.body.metodo, estado: state }, patientId);
    if (state === 'por_verificar') {
      const doctorForMail = db.prepare(`SELECT u.email, u.nombre doctor, p.nombres paciente, co.nombre consultorio, co.marca_nombre
        FROM pagos pg JOIN pacientes p ON p.id=pg.paciente_id AND p.consultorio_id=pg.consultorio_id
        JOIN usuarios u ON u.id=p.usuario_id AND u.consultorio_id=p.consultorio_id
        JOIN consultorios co ON co.id=pg.consultorio_id
        WHERE pg.id=? AND pg.consultorio_id=? AND p.usuario_id IS NOT NULL`).get(result.lastInsertRowid, tenant(req));
      const fallbackDoctors = doctorForMail ? [] : db.prepare(`SELECT u.email, u.nombre doctor
        FROM usuarios u WHERE u.consultorio_id=? AND u.rol='doctor' AND u.estado='activo' AND u.eliminado_en IS NULL LIMIT 1`)
        .all(tenant(req));
      const recipient = doctorForMail || fallbackDoctors[0];
      if (recipient?.email) {
        void sendClinicEmail({
          consultorioId: tenant(req),
          to: recipient.email,
          patientName: recipient.doctor,
          subject: `Pago QR por verificar - ${recipient.marca_nombre || recipient.consultorio}`,
          heading: 'Un paciente reportó un pago QR',
          lines: [
            `Paciente: ${recipient.paciente}`,
            `Monto: Bs ${new Intl.NumberFormat('es-BO', { maximumFractionDigits: 2 }).format(req.body.monto_bs)}`,
            'Ingresa a Cobros para validar o anular el comprobante.'
          ],
          actionUrl: `${config.clientUrl}/cobros`,
          actionLabel: 'Revisar pagos',
          tipo: 'pago_qr_reportado'
        }).catch(() => {});
      }
    }
    res.status(201).json({ mensaje: state === 'por_verificar' ? 'Pago QR enviado para verificación' : 'Pago registrado correctamente', id: result.lastInsertRowid, estado: state });
  } catch (error) {
    if (req.file) fs.unlink(req.file.path, () => {});
    next(error);
  }
});
router.get('/pagos/:id/evidencia', (req, res) => {
  const paymentId = id(req.params.id);
  const payment = db.prepare(`SELECT paciente_id,evidencia_path FROM pagos WHERE id=? AND consultorio_id=? AND eliminado_en IS NULL`)
    .get(paymentId, tenant(req));
  if (!payment?.evidencia_path) throw new ApiError(404, 'Evidencia no encontrada');
  restrictPatient(req, payment.paciente_id);
  res.sendFile(path.join(config.uploadDir, path.basename(payment.evidencia_path)));
});
router.patch('/pagos/:id/verificacion', allowRoles('doctor'), (req, res) => {
  if (!['valido','anulado'].includes(req.body.estado)) throw new ApiError(400, 'La verificación debe ser valido o anulado');
  const paymentId = id(req.params.id);
  const payment = db.prepare(`SELECT paciente_id FROM pagos WHERE id=? AND consultorio_id=? AND metodo='qr' AND estado='por_verificar' AND eliminado_en IS NULL`)
    .get(paymentId, tenant(req));
  if (!payment) throw new ApiError(404, 'Pago QR pendiente no encontrado');
  const result = db.prepare(`UPDATE pagos SET estado=?,verificado_por=?,verificado_en=CURRENT_TIMESTAMP,actualizado_en=CURRENT_TIMESTAMP
    WHERE id=? AND consultorio_id=? AND metodo='qr' AND estado='por_verificar' AND eliminado_en IS NULL`)
    .run(req.body.estado, req.user.id, paymentId, tenant(req));
  ensureFound(result, 'Pago QR pendiente no encontrado');
  const patientUser = db.prepare(`SELECT p.usuario_id FROM pagos pg JOIN pacientes p ON p.id=pg.paciente_id
    AND p.consultorio_id=pg.consultorio_id WHERE pg.id=? AND pg.consultorio_id=?`).get(paymentId, tenant(req));
  if (patientUser?.usuario_id) db.prepare(`INSERT INTO notificaciones (consultorio_id,usuario_id,tipo,titulo,mensaje,entidad_tipo,entidad_id)
    VALUES (?,?,'pago_actualizado','Pago QR actualizado',?,'pago',?)`).run(tenant(req), patientUser.usuario_id,
    req.body.estado === 'valido' ? 'Tu pago QR fue validado y tu saldo fue actualizado.' : 'Tu pago QR fue anulado.', paymentId);
  log(req, 'verificar', 'pago', paymentId, { estado: req.body.estado }, payment.paciente_id);
  const patientForMail = db.prepare(`SELECT p.nombres paciente, p.email, pg.monto_bs, co.nombre consultorio, co.marca_nombre
    FROM pagos pg JOIN pacientes p ON p.id=pg.paciente_id AND p.consultorio_id=pg.consultorio_id
    JOIN consultorios co ON co.id=pg.consultorio_id
    WHERE pg.id=? AND pg.consultorio_id=?`).get(paymentId, tenant(req));
  if (patientForMail?.email) {
    const validado = req.body.estado === 'valido';
    void sendClinicEmail({
      consultorioId: tenant(req),
      to: patientForMail.email,
      patientName: patientForMail.paciente,
      subject: `${validado ? 'Pago QR validado' : 'Pago QR anulado'} - ${patientForMail.marca_nombre || patientForMail.consultorio}`,
      heading: validado ? 'Tu pago fue validado' : 'Tu pago QR fue anulado',
      lines: [
        `Monto: Bs ${new Intl.NumberFormat('es-BO', { maximumFractionDigits: 2 }).format(patientForMail.monto_bs)}`,
        validado ? 'El consultorio confirmó tu pago y actualizó tu saldo.' : 'Si crees que es un error, contacta al consultorio.'
      ],
      actionUrl: `${config.clientUrl}/pagos`,
      actionLabel: 'Ver mis pagos',
      tipo: validado ? 'pago_validado' : 'pago_anulado'
    }).catch(() => {});
  }
  res.json({ mensaje: req.body.estado === 'valido' ? 'Pago QR validado correctamente' : 'Pago QR anulado correctamente' });
});
router.delete('/pagos/:id', allowRoles('doctor'), (req, res) => {
  const paymentId = id(req.params.id);
  const payment = db.prepare(`SELECT paciente_id FROM pagos WHERE id=? AND consultorio_id=? AND eliminado_en IS NULL`)
    .get(paymentId, tenant(req));
  if (!payment) throw new ApiError(404, 'Pago no encontrado');
  const result = db.prepare(`UPDATE pagos SET eliminado_en=CURRENT_TIMESTAMP,estado='anulado',actualizado_en=CURRENT_TIMESTAMP
    WHERE id=? AND consultorio_id=? AND eliminado_en IS NULL`).run(paymentId, tenant(req));
  ensureFound(result, 'Pago no encontrado');
  log(req, 'eliminar_logico', 'pago', paymentId, undefined, payment.paciente_id);
  res.json({ mensaje: 'Pago archivado y anulado correctamente' });
});

router.get('/saldos', (req, res) => {
  const conditions = ['p.consultorio_id=?', 'p.eliminado_en IS NULL'];
  const values = [tenant(req)];
  if (req.user.rol === 'paciente') { conditions.push('p.id=?'); values.push(patientForUser(req)); }
  if (req.query.paciente_id) {
    restrictPatient(req, id(req.query.paciente_id));
    conditions.push('p.id=?'); values.push(id(req.query.paciente_id));
  }
  const rows = db.prepare(`SELECT p.id paciente_id,p.codigo,p.nombres,p.apellidos,
     COALESCE((SELECT SUM(c.precio_bs) FROM citas c WHERE c.consultorio_id=p.consultorio_id AND c.paciente_id=p.id
       AND c.estado='atendida' AND c.eliminado_en IS NULL),0) cargos_bs,
     COALESCE((SELECT SUM(pi.precio_bs * pi.cantidad) FROM presupuesto_items pi
       JOIN presupuestos pr ON pr.id=pi.presupuesto_id AND pr.consultorio_id=p.consultorio_id
       WHERE pr.paciente_id=p.id AND pr.estado IN ('entregado','aceptado') AND pr.compartido_en IS NOT NULL
       AND pr.eliminado_en IS NULL AND pi.eliminado_en IS NULL AND pi.precio_bs IS NOT NULL),0) cotizaciones_bs,
     COALESCE((SELECT SUM(pg.monto_bs) FROM pagos pg WHERE pg.consultorio_id=p.consultorio_id AND pg.paciente_id=p.id
       AND pg.estado='valido' AND pg.eliminado_en IS NULL),0) pagos_validos_bs,
     COALESCE((SELECT SUM(c.precio_bs) FROM citas c WHERE c.consultorio_id=p.consultorio_id AND c.paciente_id=p.id
       AND c.estado='atendida' AND c.eliminado_en IS NULL),0)
     + COALESCE((SELECT SUM(pi.precio_bs * pi.cantidad) FROM presupuesto_items pi
       JOIN presupuestos pr ON pr.id=pi.presupuesto_id AND pr.consultorio_id=p.consultorio_id
       WHERE pr.paciente_id=p.id AND pr.estado IN ('entregado','aceptado') AND pr.compartido_en IS NOT NULL
       AND pr.eliminado_en IS NULL AND pi.eliminado_en IS NULL AND pi.precio_bs IS NOT NULL),0)
     - COALESCE((SELECT SUM(pg.monto_bs) FROM pagos pg WHERE pg.consultorio_id=p.consultorio_id AND pg.paciente_id=p.id
       AND pg.estado='valido' AND pg.eliminado_en IS NULL),0) saldo_bs
    FROM pacientes p WHERE ${conditions.join(' AND ')} ORDER BY p.apellidos,p.nombres`).all(...values);
  res.json({ saldos: rows, moneda: 'Bs', nota: 'Los pagos QR por verificar no reducen el saldo' });
});

router.get('/notificaciones', (req, res) => {
  const rows = db.prepare(`SELECT * FROM notificaciones WHERE consultorio_id=? AND usuario_id=? AND eliminado_en IS NULL
    ORDER BY creado_en DESC LIMIT 100`).all(tenant(req), req.user.id);
  res.json({ notificaciones: rows });
});
router.patch('/notificaciones/:id/leer', (req, res) => {
  const notificationId = id(req.params.id);
  const result = db.prepare(`UPDATE notificaciones SET leida_en=COALESCE(leida_en,CURRENT_TIMESTAMP)
    WHERE id=? AND consultorio_id=? AND usuario_id=? AND eliminado_en IS NULL`).run(notificationId, tenant(req), req.user.id);
  ensureFound(result, 'Notificación no encontrada');
  res.json({ mensaje: 'Notificación marcada como leída' });
});
router.patch('/notificaciones/leer-todas', (req, res) => {
  db.prepare(`UPDATE notificaciones SET leida_en=CURRENT_TIMESTAMP WHERE consultorio_id=? AND usuario_id=? AND leida_en IS NULL AND eliminado_en IS NULL`)
    .run(tenant(req), req.user.id);
  res.json({ mensaje: 'Notificaciones marcadas como leídas' });
});

router.get('/dashboard', (req, res) => {
  const clinicId = tenant(req);
  if (req.user.rol === 'paciente') {
    const patientId = patientForUser(req);
    const next = db.prepare(`SELECT c.*,s.nombre servicio,u.nombre doctor FROM citas c
      JOIN servicios s ON s.id=c.servicio_id AND s.consultorio_id=c.consultorio_id
      JOIN usuarios u ON u.id=c.doctor_id AND u.consultorio_id=c.consultorio_id
      WHERE c.consultorio_id=? AND c.paciente_id=? AND c.estado='confirmada' AND c.inicio>=CURRENT_TIMESTAMP AND c.eliminado_en IS NULL
      ORDER BY c.inicio LIMIT 5`).all(clinicId, patientId);
     const balance = db.prepare(`SELECT
       COALESCE((SELECT SUM(precio_bs) FROM citas WHERE consultorio_id=? AND paciente_id=? AND estado='atendida' AND eliminado_en IS NULL),0)
       + COALESCE((SELECT SUM(pi.precio_bs * pi.cantidad) FROM presupuesto_items pi JOIN presupuestos pr ON pr.id=pi.presupuesto_id
         WHERE pr.consultorio_id=? AND pr.paciente_id=? AND pr.estado IN ('entregado','aceptado') AND pr.compartido_en IS NOT NULL
         AND pr.eliminado_en IS NULL AND pi.eliminado_en IS NULL AND pi.precio_bs IS NOT NULL),0)
       - COALESCE((SELECT SUM(monto_bs) FROM pagos WHERE consultorio_id=? AND paciente_id=? AND estado='valido' AND eliminado_en IS NULL),0) saldo_bs`)
       .get(clinicId, patientId, clinicId, patientId, clinicId, patientId);
    return res.json({ proximas_citas: next, saldo_bs: balance.saldo_bs });
  }
  const doctorFilter = req.user.rol === 'doctor' ? ' AND doctor_id=@usuarioId' : '';
  const stats = db.prepare(`SELECT
    (SELECT COUNT(*) FROM pacientes WHERE consultorio_id=@clinicId AND eliminado_en IS NULL) pacientes,
    (SELECT COUNT(*) FROM citas WHERE consultorio_id=@clinicId AND date(inicio)=date('now') AND eliminado_en IS NULL${doctorFilter}) citas_hoy,
    (SELECT COUNT(*) FROM pagos WHERE consultorio_id=@clinicId AND estado='por_verificar' AND eliminado_en IS NULL) pagos_por_verificar,
    (SELECT COUNT(*) FROM citas WHERE consultorio_id=@clinicId AND estado='atendida' AND precio_bs IS NULL
      AND eliminado_en IS NULL AND date(inicio)>=date('now','start of month')${doctorFilter}) por_definir,
    (SELECT COALESCE(SUM(monto_bs),0) FROM pagos WHERE consultorio_id=@clinicId AND estado='valido' AND eliminado_en IS NULL AND date(creado_en)=date('now')) ingresos_hoy`)
    .get({ clinicId, usuarioId: req.user.id });
  res.json({ resumen: stats, moneda: 'Bs' });
});

router.get('/auditoria', allowRoles('doctor'), (req, res) => {
  const conditions = ['a.consultorio_id=?'];
  const values = [tenant(req)];
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const validDate = (value) => {
    if (typeof value !== 'string' || !datePattern.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  const actions = new Set(['crear','actualizar','actualizar_perfil','eliminar_logico','cancelar','reprogramar','cambiar_estado',
    'verificar','invitar','actualizar_qr']);
  const limit = req.query.limite === undefined ? 100 : Number(req.query.limite);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new ApiError(400, 'El límite debe ser un entero entre 1 y 500');
  if (req.query.usuario_id !== undefined) { conditions.push('a.usuario_id=?'); values.push(id(req.query.usuario_id)); }
  if (req.query.paciente_id !== undefined) { conditions.push('a.paciente_id=?'); values.push(id(req.query.paciente_id)); }
  if (req.query.accion !== undefined) {
    if (!actions.has(req.query.accion)) throw new ApiError(400, 'Acción de auditoría inválida');
    conditions.push('a.accion=?'); values.push(req.query.accion);
  }
  if (req.query.desde !== undefined) {
    if (!validDate(req.query.desde)) throw new ApiError(400, 'La fecha desde debe usar el formato YYYY-MM-DD');
    conditions.push('a.creado_en>=?'); values.push(`${req.query.desde} 00:00:00`);
  }
  if (req.query.hasta !== undefined) {
    if (!validDate(req.query.hasta)) throw new ApiError(400, 'La fecha hasta debe usar el formato YYYY-MM-DD');
    conditions.push("a.creado_en<datetime(?,'+1 day')"); values.push(`${req.query.hasta} 00:00:00`);
  }
  const where = conditions.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) total FROM auditoria a WHERE ${where}`).get(...values).total;
  const rows = db.prepare(`SELECT a.*,u.nombre usuario,p.codigo paciente_codigo,p.nombres paciente_nombres,p.apellidos paciente_apellidos
    FROM auditoria a
    LEFT JOIN usuarios u ON u.id=a.usuario_id AND u.consultorio_id=a.consultorio_id
    LEFT JOIN pacientes p ON p.id=a.paciente_id AND p.consultorio_id=a.consultorio_id
    WHERE ${where} ORDER BY a.creado_en DESC,a.id DESC LIMIT ?`).all(...values, limit);
  res.json({ auditoria: rows, total });
});

export default router;
