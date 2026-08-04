import jwt from 'jsonwebtoken';
import { db } from './db.js';
import { config } from './config.js';
import { ApiError } from './http.js';

const cookieName = 'dentista_token';

export function issueSession(res, user) {
  const token = jwt.sign({ sub: String(user.id), consultorioId: user.consultorio_id, rol: user.rol }, config.jwtSecret, {
    expiresIn: `${config.jwtDays}d`
  });
  res.cookie(cookieName, token, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: config.jwtDays * 86400000,
    path: '/'
  });
}

export function clearSession(res) {
  res.clearCookie(cookieName, { httpOnly: true, secure: config.nodeEnv === 'production', sameSite: 'lax', path: '/' });
}

export function authenticate(req, _res, next) {
  try {
    const token = req.cookies[cookieName];
    if (!token) throw new ApiError(401, 'Debe iniciar sesión');
    const payload = jwt.verify(token, config.jwtSecret);
    const user = db.prepare(`SELECT id, consultorio_id, email, nombre, avatar_url, rol, estado
      FROM usuarios WHERE id = ? AND eliminado_en IS NULL`).get(Number(payload.sub));
    if (!user || !['activo', 'pendiente'].includes(user.estado)) throw new ApiError(401, 'La sesión no es válida');
    req.user = user;
    next();
  } catch (error) {
    next(error instanceof ApiError ? error : new ApiError(401, 'La sesión no es válida o expiró'));
  }
}

export function requireTenant(req, _res, next) {
  if (!req.user.consultorio_id || req.user.estado !== 'activo') return next(new ApiError(403, 'Debe completar la configuración del consultorio'));
  next();
}

export const allowRoles = (...roles) => (req, _res, next) => {
  if (!roles.includes(req.user.rol)) return next(new ApiError(403, 'No tiene permisos para realizar esta acción'));
  next();
};
