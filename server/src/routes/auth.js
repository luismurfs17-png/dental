import { Router } from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { config } from '../config.js';
import { db } from '../db.js';
import {
  authenticate,
  clearOAuthState,
  clearSession,
  issueSession,
  readOAuthState,
  setOAuthState,
  withAdminFlag
} from '../auth.js';
import { ApiError, asyncRoute, required } from '../http.js';

const router = Router();
const google = new OAuth2Client(config.google.clientId, config.google.clientSecret, config.google.callbackUrl);

function clinicLoginPath(slug) {
  return slug ? `/c/${slug}` : '/login';
}

function loginRedirect(res, params = {}, clinicSlug = '') {
  const query = new URLSearchParams(params);
  const suffix = query.toString() ? `?${query}` : '';
  return res.redirect(`${config.clientUrl}${clinicLoginPath(clinicSlug)}${suffix}`);
}

function loginClinic(value) {
  const slug = String(value || '').trim().toLowerCase();
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return '';
  return db.prepare('SELECT slug FROM consultorios WHERE slug=? AND eliminado_en IS NULL').get(slug)?.slug || '';
}

function resolveLoginEstado(user, isAdminEmail) {
  if (isAdminEmail) return 'activo';
  if (!user) return 'pendiente';
  if (user.estado === 'suspendido') throw new ApiError(403, 'El usuario está suspendido');
  if (user.estado === 'preautorizado' || user.estado === 'activo') return 'activo';
  if (user.estado === 'pendiente') return 'pendiente';
  return 'activo';
}

function bindGoogleUser(userId, { sub, email, name, picture, estado }) {
  try {
    db.prepare(`UPDATE usuarios SET google_sub = ?, email = ?, nombre = ?, avatar_url = ?, estado = ?,
      eliminado_en = NULL, ultimo_acceso_en = CURRENT_TIMESTAMP, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(sub, email, name, picture, estado, userId);
  } catch (error) {
    if (error.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw error;
    db.prepare(`UPDATE usuarios SET google_sub = NULL, actualizado_en = CURRENT_TIMESTAMP
      WHERE google_sub = ? AND id != ?`).run(sub, userId);
    db.prepare(`UPDATE usuarios SET google_sub = ?, email = ?, nombre = ?, avatar_url = ?, estado = ?,
      eliminado_en = NULL, ultimo_acceso_en = CURRENT_TIMESTAMP, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(sub, email, name, picture, estado, userId);
  }
}

export function findOrCreateGoogleUser(profile, clinicSlug = '') {
  if (!profile.email_verified) throw new ApiError(401, 'Google no verificó el correo electrónico');
  const email = String(profile.email || '').trim().toLowerCase();
  if (!email) throw new ApiError(401, 'Google no devolvió un correo válido');
  const isAdminEmail = config.adminEmails.includes(email);
  const name = profile.name || email;
  const picture = profile.picture || null;
  const targetClinic = clinicSlug ? db.prepare(`SELECT id, slug FROM consultorios
    WHERE slug=? AND eliminado_en IS NULL`).get(clinicSlug) : null;

  let user = targetClinic ? db.prepare(`SELECT * FROM usuarios
    WHERE consultorio_id=? AND (google_sub=? OR email=? COLLATE NOCASE) AND eliminado_en IS NULL
    ORDER BY CASE WHEN google_sub=? THEN 0 ELSE 1 END, id LIMIT 1`)
    .get(targetClinic.id, profile.sub, email, profile.sub) : null;
  if (targetClinic && !user) {
    throw new ApiError(403, 'Este correo no tiene acceso autorizado a la clínica seleccionada');
  }
  if (!user) user = db.prepare(`SELECT * FROM usuarios WHERE google_sub = ? ORDER BY
    CASE WHEN eliminado_en IS NULL THEN 0 ELSE 1 END, id LIMIT 1`).get(profile.sub);
  if (!user && !targetClinic) {
    user = db.prepare(`SELECT * FROM usuarios
      WHERE email = ? COLLATE NOCASE
      ORDER BY CASE
        WHEN eliminado_en IS NULL AND google_sub IS NULL AND estado = 'preautorizado' THEN 0
        WHEN eliminado_en IS NULL AND google_sub IS NULL THEN 1
        WHEN eliminado_en IS NULL THEN 2
        ELSE 3
      END, id LIMIT 1`).get(email);
  }

  if (user?.eliminado_en) throw new ApiError(403, 'La cuenta fue eliminada. Contacte al administrador.');

  if (user?.estado === 'suspendido' && !isAdminEmail) {
    throw new ApiError(403, 'El usuario está suspendido');
  }

  if (user) {
    if (!targetClinic && isAdminEmail && user.rol === 'paciente') {
      const doctor = db.prepare(`SELECT * FROM usuarios
        WHERE email = ? COLLATE NOCASE AND rol IN ('doctor','operativo') AND eliminado_en IS NULL
        ORDER BY id LIMIT 1`).get(email);
      if (doctor) {
        user = doctor;
        console.log(`Superadmin: se usará la cuenta doctor #${doctor.id} (consultorio ${doctor.consultorio_id})`);
      } else {
        db.prepare(`UPDATE usuarios SET rol = 'doctor', actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`)
          .run(user.id);
        user.rol = 'doctor';
        console.log(`Superadmin promovido de paciente a doctor (id=${user.id})`);
      }
    }
    const estado = resolveLoginEstado(user, isAdminEmail);
    bindGoogleUser(user.id, { sub: profile.sub, email, name: name || user.nombre, picture: picture || user.avatar_url, estado });
  } else {
    const estado = resolveLoginEstado(null, isAdminEmail);
    try {
      const result = db.prepare(`INSERT INTO usuarios
        (email, nombre, avatar_url, google_sub, rol, estado, ultimo_acceso_en)
        VALUES (?, ?, ?, ?, 'doctor', ?, CURRENT_TIMESTAMP)`)
        .run(email, name, picture, profile.sub, estado);
      user = { id: Number(result.lastInsertRowid) };
    } catch (error) {
      if (error.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw error;
      user = db.prepare(`SELECT * FROM usuarios
        WHERE (google_sub = ? OR email = ? COLLATE NOCASE)
        ORDER BY CASE WHEN eliminado_en IS NULL THEN 0 ELSE 1 END, id LIMIT 1`).get(profile.sub, email);
      if (!user) throw error;
      const estado = resolveLoginEstado(user, isAdminEmail);
      bindGoogleUser(user.id, { sub: profile.sub, email, name: name || user.nombre, picture: picture || user.avatar_url, estado });
    }
  }

  const fresh = db.prepare(`SELECT u.id, u.consultorio_id, u.email, u.nombre, u.avatar_url, u.rol, u.estado,
      c.slug consultorio_slug
    FROM usuarios u LEFT JOIN consultorios c ON c.id=u.consultorio_id AND c.eliminado_en IS NULL
    WHERE u.id = ? AND u.eliminado_en IS NULL AND (u.consultorio_id IS NULL OR c.id IS NOT NULL)`).get(user.id);
  if (!fresh) throw new ApiError(500, 'No se pudo cargar el usuario autenticado');
  if (!['activo', 'pendiente'].includes(fresh.estado)) {
    throw new ApiError(403, 'El usuario no tiene acceso activo');
  }
  return withAdminFlag(fresh);
}

router.get('/google', (req, res, next) => {
  try {
    if (!config.google.clientId || !config.google.clientSecret) {
      throw new ApiError(503, 'El acceso con Google no está configurado');
    }
    const clinicSlug = loginClinic(req.query.clinica);
    const state = `${randomBytes(24).toString('hex')}${clinicSlug ? `.${clinicSlug}` : ''}`;
    setOAuthState(res, state);
    res.redirect(google.generateAuthUrl({
      access_type: 'offline',
      scope: ['openid', 'email', 'profile'],
      prompt: 'select_account',
      state
    }));
  } catch (error) {
    next(error);
  }
});

router.get('/google/callback', asyncRoute(async (req, res) => {
  let clinicSlug = '';
  try {
    const receivedState = String(req.query.state || '');
    const expectedState = readOAuthState(req);
    clearOAuthState(res);
    const validState = receivedState.length > 0
      && receivedState.length === expectedState.length
      && timingSafeEqual(Buffer.from(receivedState), Buffer.from(expectedState));
    if (!validState) throw new ApiError(401, 'La solicitud de acceso con Google no es válida. Intente de nuevo.');
    clinicSlug = loginClinic(expectedState.split('.').slice(1).join('.'));
    if (!req.query.code) throw new ApiError(400, req.query.error ? 'El acceso con Google fue cancelado' : 'Google no devolvió un código de autorización');

    const { tokens } = await google.getToken(String(req.query.code));
    if (!tokens.id_token) throw new ApiError(401, 'Google no devolvió un token válido');
    const ticket = await google.verifyIdToken({ idToken: tokens.id_token, audience: config.google.clientId });
    const user = findOrCreateGoogleUser(ticket.getPayload(), clinicSlug);
    issueSession(res, user);
    console.log(`OAuth OK: id=${user.id}, admin=${Boolean(user.es_admin)}, estado=${user.estado}`);
    const suffix = clinicSlug ? `?clinica=${encodeURIComponent(clinicSlug)}` : '';
    const successPath = clinicSlug ? `/c/${clinicSlug}/auth/success` : '/auth/success';
    return res.redirect(303, `${config.clientUrl}${successPath}${suffix}`);
  } catch (error) {
    console.error('OAuth callback error:', error?.message || error);
    const message = error instanceof ApiError ? error.message : 'No se pudo completar el acceso con Google';
    return loginRedirect(res, { error: message }, clinicSlug);
  }
}));

router.post('/google', asyncRoute(async (req, res) => {
  required(req.body, ['credencial']);
  if (!config.google.clientId) throw new ApiError(503, 'El acceso con Google no está configurado');
  const ticket = await google.verifyIdToken({ idToken: req.body.credencial, audience: config.google.clientId });
  const user = findOrCreateGoogleUser(ticket.getPayload(), loginClinic(req.body.clinica));
  issueSession(res, user);
  res.json({ mensaje: 'Sesión iniciada correctamente', usuario: user });
}));

router.post('/desarrollo', (req, res, next) => {
  try {
    if (config.nodeEnv !== 'development') throw new ApiError(404, 'Ruta no encontrada');
    const email = req.body.email || 'doctora@sonrisas.test';
    const user = db.prepare(`SELECT u.id, u.consultorio_id, u.email, u.nombre, u.avatar_url, u.rol, u.estado,
        c.slug consultorio_slug
      FROM usuarios u LEFT JOIN consultorios c ON c.id=u.consultorio_id AND c.eliminado_en IS NULL
      WHERE u.email = ? COLLATE NOCASE AND u.eliminado_en IS NULL LIMIT 1`).get(email);
    if (!user || user.estado !== 'activo') throw new ApiError(404, 'Usuario de desarrollo no encontrado; ejecute la semilla');
    issueSession(res, user);
    res.json({ mensaje: 'Sesión de desarrollo iniciada', usuario: withAdminFlag(user) });
  } catch (error) { next(error); }
});

router.get('/yo', authenticate, (req, res) => res.json({ usuario: req.user }));
router.post('/salir', (_req, res) => {
  clearSession(res);
  res.json({ mensaje: 'Sesión cerrada correctamente' });
});

export default router;
