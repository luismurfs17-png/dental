import jwt from 'jsonwebtoken';
import { db } from './db.js';
import { config } from './config.js';
import { ApiError } from './http.js';

const cookieName = 'dentista_token';
const stateCookieName = 'dentista_oauth_state';

function baseCookieOptions(maxAge) {
  return {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge
  };
}

export function isAdmin(user) {
  return config.adminEmails.includes(String(user.email || '').trim().toLowerCase());
}

export function withAdminFlag(user) {
  if (user && isAdmin(user)) return { ...user, es_admin: true };
  return user;
}

export function issueSession(res, user) {
  if (!user?.id) throw new ApiError(500, 'No se pudo crear la sesión del usuario');
  const token = jwt.sign(
    { sub: String(user.id), consultorioId: user.consultorio_id ?? null, rol: user.rol },
    config.jwtSecret,
    { expiresIn: `${config.jwtDays}d` }
  );
  res.clearCookie(cookieName, { httpOnly: true, secure: config.nodeEnv === 'production', sameSite: 'lax', path: '/' });
  res.cookie(cookieName, token, baseCookieOptions(config.jwtDays * 86400000));
}

export function clearSession(res) {
  res.clearCookie(cookieName, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    path: '/'
  });
}

export function setOAuthState(res, state) {
  res.cookie(stateCookieName, state, baseCookieOptions(10 * 60 * 1000));
}

export function clearOAuthState(res) {
  res.clearCookie(stateCookieName, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    path: '/'
  });
}

export function readOAuthState(req) {
  return String(req.cookies?.[stateCookieName] || '');
}

export function authenticate(req, _res, next) {
  try {
    const token = req.cookies?.[cookieName];
    if (!token) throw new ApiError(401, 'Debe iniciar sesión');
    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      throw new ApiError(401, 'La sesión no es válida o expiró');
    }
    const user = db.prepare(`SELECT u.id, u.consultorio_id, u.email, u.nombre, u.avatar_url, u.rol, u.estado,
        c.slug consultorio_slug
      FROM usuarios u LEFT JOIN consultorios c ON c.id=u.consultorio_id AND c.eliminado_en IS NULL
      WHERE u.id = ? AND u.eliminado_en IS NULL AND (u.consultorio_id IS NULL OR c.id IS NOT NULL)`).get(Number(payload.sub));
    if (!user) throw new ApiError(401, 'La sesión no es válida');
    if (!['activo', 'pendiente'].includes(user.estado)) {
      throw new ApiError(401, 'La cuenta no está activa. Contacte al administrador.');
    }
    req.user = withAdminFlag(user);
    next();
  } catch (error) {
    next(error instanceof ApiError ? error : new ApiError(401, 'La sesión no es válida o expiró'));
  }
}

export function requireTenant(req, _res, next) {
  if (!req.user.consultorio_id || req.user.estado !== 'activo') {
    return next(new ApiError(403, 'Debe completar la configuración del consultorio'));
  }
  next();
}

export const requireAdmin = (req, _res, next) => {
  if (!isAdmin(req.user)) return next(new ApiError(403, 'Solo el administrador puede realizar esta acción'));
  next();
};

export const allowRoles = (...roles) => (req, _res, next) => {
  if (!roles.includes(req.user.rol)) return next(new ApiError(403, 'No tiene permisos para realizar esta acción'));
  next();
};
