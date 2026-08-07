import rateLimit from 'express-rate-limit';

const spanishHandler = (_req, res) => {
  res.status(429).json({ mensaje: 'Demasiadas solicitudes. Intente de nuevo en un momento.' });
};

export const authLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: spanishHandler
});

export const adminLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: spanishHandler
});

export const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: spanishHandler
});
