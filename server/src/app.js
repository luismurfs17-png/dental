import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';
import { config } from './config.js';
import { authLimiter, adminLimiter, apiLimiter } from './rateLimit.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import apiRoutes from './routes/api.js';

export const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
app.use(cors({ origin: config.clientUrl, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser());

app.get('/api/health', (_req, res) => res.json({ estado: 'saludable', base_de_datos: 'sqlite' }));
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/admin', adminLimiter, adminRoutes);
app.use('/api', apiLimiter, apiRoutes);

const publicDir = path.resolve(import.meta.dirname, '../public');
if (config.nodeEnv === 'production' && fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get('/{*ruta}', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

app.use((_req, res) => res.status(404).json({ mensaje: 'Ruta no encontrada' }));
app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_SIZE' ? 'La imagen no puede superar 5 MB' : 'No se pudo procesar la imagen';
    return res.status(400).json({ mensaje: message });
  }
  const status = Number(error.status || 500);
  if (status >= 500) console.error(error);
  const message = status >= 500 ? 'Ocurrió un error interno en el servidor' : error.message;
  res.status(status).json({ mensaje: message });
});
