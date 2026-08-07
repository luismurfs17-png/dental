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

function loginRedirect(res, params = {}) {
  const query = new URLSearchParams(params);
  const suffix = query.toString() ? `?${query}` : '';
  return res.redirect(`${config.clientUrl}/login${suffix}`);
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

function findOrCreateGoogleUser(profile) {
  if (!profile.email_verified) throw new ApiError(401, 'Google no verificó el correo electrónico');
  const email = String(profile.email || '').trim().toLowerCase();
  if (!email) throw new ApiError(401, 'Google no devolvió un correo válido');
  const isAdminEmail = config.adminEmails.includes(email);
  const name = profile.name || email;
  const picture = profile.picture || null;

  let user = db.prepare(`SELECT * FROM usuarios WHERE google_sub = ? ORDER BY
    CASE WHEN eliminado_en IS NULL THEN 0 ELSE 1 END, id LIMIT 1`).get(profile.sub);
  if (!user) {
    user = db.prepare(`SELECT * FROM usuarios
      WHERE email = ? COLLATE NOCASE
      ORDER BY CASE
        WHEN eliminado_en IS NULL AND google_sub IS NULL AND estado = 'preautorizado' THEN 0
        WHEN eliminado_en IS NULL AND google_sub IS NULL THEN 1
        WHEN eliminado_en IS NULL THEN 2
        ELSE 3
      END, id LIMIT 1`).get(email);
  }

  if (user?.estado === 'suspendido' && !isAdminEmail) {
    throw new ApiError(403, 'El usuario está suspendido');
  }

  if (user) {
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

  const fresh = db.prepare(`SELECT id, consultorio_id, email, nombre, avatar_url, rol, estado
    FROM usuarios WHERE id = ? AND eliminado_en IS NULL`).get(user.id);
  if (!fresh) throw new ApiError(500, 'No se pudo cargar el usuario autenticado');
  if (!['activo', 'pendiente'].includes(fresh.estado)) {
    throw new ApiError(403, 'El usuario no tiene acceso activo');
  }
  return withAdminFlag(fresh);
}

router.get('/google', (_req, res, next) => {
  try {
    if (!config.google.clientId || !config.google.clientSecret) {
      throw new ApiError(503, 'El acceso con Google no está configurado');
    }
    const state = randomBytes(24).toString('hex');
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
  try {
    if (!req.query.code) throw new ApiError(400, 'Google no devolvió un código de autorización');
    const receivedState = String(req.query.state || '');
    const expectedState = readOAuthState(req);
    clearOAuthState(res);
    const validState = receivedState.length > 0
      && receivedState.length === expectedState.length
      && timingSafeEqual(Buffer.from(receivedState), Buffer.from(expectedState));
    if (!validState) throw new ApiError(401, 'La solicitud de acceso con Google no es válida. Intente de nuevo.');

    const { tokens } = await google.getToken(String(req.query.code));
    if (!tokens.id_token) throw new ApiError(401, 'Google no devolvió un token válido');
    const ticket = await google.verifyIdToken({ idToken: tokens.id_token, audience: config.google.clientId });
    const user = findOrCreateGoogleUser(ticket.getPayload());
    issueSession(res, user);
    console.log(`OAuth OK: ${user.email} (id=${user.id}, admin=${Boolean(user.es_admin)}, estado=${user.estado})`);
    return res.redirect(303, `${config.clientUrl}/auth/success`);
  } catch (error) {
    console.error('OAuth callback error:', error?.message || error);
    const message = error instanceof ApiError ? error.message : 'No se pudo completar el acceso con Google';
    return loginRedirect(res, { error: message });
  }
}));

router.post('/google', asyncRoute(async (req, res) => {
  required(req.body, ['credencial']);
  if (!config.google.clientId) throw new ApiError(503, 'El acceso con Google no está configurado');
  const ticket = await google.verifyIdToken({ idToken: req.body.credencial, audience: config.google.clientId });
  const user = findOrCreateGoogleUser(ticket.getPayload());
  issueSession(res, user);
  res.json({ mensaje: 'Sesión iniciada correctamente', usuario: user });
}));

router.post('/desarrollo', (req, res, next) => {
  try {
    if (config.nodeEnv !== 'development') throw new ApiError(404, 'Ruta no encontrada');
    const email = req.body.email || 'doctora@sonrisas.test';
    const user = db.prepare(`SELECT id, consultorio_id, email, nombre, avatar_url, rol, estado
      FROM usuarios WHERE email = ? COLLATE NOCASE AND eliminado_en IS NULL LIMIT 1`).get(email);
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
