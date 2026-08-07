import rateLimit from 'express-rate-limit';

const spanishHandler = (_req, res) => {
  res.status(429).json({ mensaje: 'Demasiadas solicitudes. Intente de nuevo en un momento.' });
};

const base = {
  standardHeaders: true,
  legacyHeaders: false,
  handler: spanishHandler,
  validate: { xForwardedForHeader: false }
};

export const authLimiter = rateLimit({ ...base, windowMs: 60_000, max: 60 });
export const adminLimiter = rateLimit({ ...base, windowMs: 60_000, max: 120 });
export const apiLimiter = rateLimit({ ...base, windowMs: 60_000, max: 300 });
