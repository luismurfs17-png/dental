import { Router } from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { config } from '../config.js';
import { db } from '../db.js';
import { authenticate, clearSession, issueSession, withAdminFlag } from '../auth.js';
import { ApiError, asyncRoute, required } from '../http.js';

const router = Router();
const google = new OAuth2Client(config.google.clientId, config.google.clientSecret, config.google.callbackUrl);

function findOrCreateGoogleUser(profile) {
  if (!profile.email_verified) throw new ApiError(401, 'Google no verificó el correo electrónico');
  
  const isAdminEmail = config.adminEmails.includes(profile.email.toLowerCase());
  
  let user = db.prepare(`SELECT * FROM usuarios WHERE google_sub = ? AND eliminado_en IS NULL`).get(profile.sub);
  
  if (!user) {
    user = db.prepare(`SELECT * FROM usuarios
      WHERE email = ? COLLATE NOCASE AND google_sub IS NULL AND eliminado_en IS NULL
      ORDER BY CASE estado WHEN 'preautorizado' THEN 0 ELSE 1 END, id LIMIT 1`).get(profile.email);
  }
  
  if (user?.estado === 'suspendido') throw new ApiError(403, 'El usuario está suspendido');
  
  if (user) {
    const estado = user.estado === 'pendiente' ? (isAdminEmail ? 'activo' : 'pendiente') : 'activo';
    try {
      db.prepare(`UPDATE usuarios SET google_sub = ?, nombre = ?, avatar_url = ?, estado = ?,
        ultimo_acceso_en = CURRENT_TIMESTAMP, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(profile.sub, profile.name || user.nombre, profile.picture || user.avatar_url, estado, user.id);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        const existingUser = db.prepare(`SELECT id FROM usuarios WHERE google_sub = ? AND eliminado_en IS NULL`).get(profile.sub);
        if (existingUser && existingUser.id !== user.id) {
          db.prepare(`UPDATE usuarios SET google_sub = NULL WHERE id = ?`).run(existingUser.id);
          db.prepare(`UPDATE usuarios SET google_sub = ?, nombre = ?, avatar_url = ?, estado = ?,
            ultimo_acceso_en = CURRENT_TIMESTAMP, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`)
            .run(profile.sub, profile.name || user.nombre, profile.picture || user.avatar_url, estado, user.id);
        }
      } else {
        throw error;
      }
    }
  } else {
    try {
      const estado = isAdminEmail ? 'activo' : 'pendiente';
      const result = db.prepare(`INSERT INTO usuarios
        (email, nombre, avatar_url, google_sub, rol, estado, ultimo_acceso_en)
        VALUES (?, ?, ?, ?, 'doctor', ?, CURRENT_TIMESTAMP)`)
        .run(profile.email, profile.name || profile.email, profile.picture || null, profile.sub, estado);
      user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(result.lastInsertRowid);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        const existingUser = db.prepare(`SELECT * FROM usuarios WHERE google_sub = ? AND eliminado_en IS NULL`).get(profile.sub);
        if (existingUser) {
          user = existingUser;
          const estado = user.estado === 'pendiente' ? (isAdminEmail ? 'activo' : 'pendiente') : 'activo';
          db.prepare(`UPDATE usuarios SET nombre = ?, avatar_url = ?, estado = ?,
            ultimo_acceso_en = CURRENT_TIMESTAMP, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`)
            .run(profile.name || user.nombre, profile.picture || user.avatar_url, estado, user.id);
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }
  }
  
  return withAdminFlag(db.prepare(`SELECT id, consultorio_id, email, nombre, avatar_url, rol, estado
    FROM usuarios WHERE id = ?`).get(user.id));
}

router.get('/google', (_req, res, next) => {
  if (!config.google.clientId || !config.google.clientSecret) return next(new ApiError(503, 'El acceso con Google no está configurado'));
  const state = randomBytes(24).toString('hex');
  res.cookie('dentista_oauth_state', state, {
    httpOnly: true, secure: config.nodeEnv === 'production', sameSite: 'lax', maxAge: 10 * 60 * 1000, path: '/api/auth/google/callback'
  });
  res.redirect(google.generateAuthUrl({ access_type: 'offline', scope: ['openid', 'email', 'profile'], prompt: 'select_account', state }));
});

router.get('/google/callback', asyncRoute(async (req, res) => {
  if (!req.query.code) throw new ApiError(400, 'Google no devolvió un código de autorización');
  const receivedState = String(req.query.state || '');
  const expectedState = String(req.cookies.dentista_oauth_state || '');
  const validState = receivedState.length === expectedState.length && receivedState.length > 0
    && timingSafeEqual(Buffer.from(receivedState), Buffer.from(expectedState));
  res.clearCookie('dentista_oauth_state', { path: '/api/auth/google/callback' });
  if (!validState) throw new ApiError(401, 'La solicitud de acceso con Google no es válida');
  const { tokens } = await google.getToken(String(req.query.code));
  const ticket = await google.verifyIdToken({ idToken: tokens.id_token, audience: config.google.clientId });
  const user = findOrCreateGoogleUser(ticket.getPayload());
  issueSession(res, user);
  res.redirect(`${config.clientUrl}/login?success=1`);
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
