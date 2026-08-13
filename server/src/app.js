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
import publicRoutes from './routes/public.js';
import { db } from './db.js';

export const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
app.use(cors({ origin: config.clientUrl, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser());

app.get('/api/health', (_req, res) => res.json({ estado: 'saludable', base_de_datos: 'sqlite' }));
app.use('/api/publico', apiLimiter, publicRoutes);
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/admin', adminLimiter, adminRoutes);
app.use('/api', apiLimiter, apiRoutes);

const packagedPublicDir = path.resolve(import.meta.dirname, '../public');
const localBuildDir = path.resolve(import.meta.dirname, '../../client/dist');
const publicDir = fs.existsSync(path.join(packagedPublicDir, 'index.html')) ? packagedPublicDir : localBuildDir;
if (config.nodeEnv === 'production' && fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  const indexPath = path.join(publicDir, 'index.html');
  const indexTemplate = fs.readFileSync(indexPath, 'utf8');
  app.get('/{*ruta}', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    const match = req.path.match(/^\/c\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/|$)/);
    if (!match) return res.sendFile(indexPath);
    const clinic = db.prepare(`SELECT slug, nombre, marca_nombre, color_primario FROM consultorios
      WHERE slug=? AND eliminado_en IS NULL`).get(match[1]);
    if (!clinic) return res.sendFile(indexPath);
    const name = escapeHtml(clinic.marca_nombre || clinic.nombre);
    const primary = /^#[0-9a-f]{6}$/i.test(clinic.color_primario || '') ? clinic.color_primario : '#24577a';
    const manifest = `/api/publico/clinicas/${clinic.slug}/manifest.webmanifest`;
    const icon = `/api/publico/clinicas/${clinic.slug}/icon/180.png`;
    const html = indexTemplate
      .replace('content="#24577a"', () => `content="${primary}"`)
      .replace('<link id="app-manifest" />', () => `<link id="app-manifest" rel="manifest" href="${manifest}" />`)
      .replace('rel="icon" href="/icons/clinicas.svg"', () => `rel="icon" href="${icon}"`)
      .replace('rel="apple-touch-icon" href="/icons/clinicas-180.png"', () => `rel="apple-touch-icon" href="${icon}"`)
      .replace('content="Portal Clínico"', () => `content="${name}"`)
      .replace('<title>Portal Clínico</title>', () => `<title>${name}</title>`);
    return res.type('html').send(html);
  });
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
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
