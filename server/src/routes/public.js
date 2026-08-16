import path from 'node:path';
import { Router } from 'express';
import { clinicIconPath, ensureClinicIcon } from '../branding.js';
import { config } from '../config.js';
import { db } from '../db.js';
import { ApiError } from '../http.js';

const router = Router();
const validSlug = (value) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(value || ''));

function clinicBySlug(value) {
  const slug = String(value || '').toLowerCase();
  if (!validSlug(slug)) throw new ApiError(404, 'Clínica no encontrada');
  const clinic = db.prepare(`SELECT slug, nombre, marca_nombre, color_primario, color_acento, color_fondo,
      fondo_opacidad, fondo_estilo, tipografia, eslogan, bienvenida, whatsapp, facebook, instagram,
      telefono, direccion, logo_path, fondo_path
    FROM consultorios WHERE slug=? AND eliminado_en IS NULL`).get(slug);
  if (!clinic) throw new ApiError(404, 'Clínica no encontrada');
  return clinic;
}

function assetUrl(clinic, type) {
  const file = type === 'logo' ? clinic.logo_path : clinic.fondo_path;
  return file ? `/api/publico/clinicas/${clinic.slug}/${type}?v=${encodeURIComponent(file)}` : null;
}

function publicClinic(clinic) {
  return {
    slug: clinic.slug,
    nombre: clinic.nombre,
    marca_nombre: clinic.marca_nombre,
    color_primario: clinic.color_primario,
    color_acento: clinic.color_acento,
    color_fondo: clinic.color_fondo,
    fondo_opacidad: clinic.fondo_opacidad,
    fondo_estilo: clinic.fondo_estilo || 'imagen',
    tipografia: clinic.tipografia || 'fraunces',
    eslogan: clinic.eslogan || null,
    bienvenida: clinic.bienvenida || null,
    whatsapp: clinic.whatsapp || null,
    facebook: clinic.facebook || null,
    instagram: clinic.instagram || null,
    telefono: clinic.telefono || null,
    direccion: clinic.direccion || null,
    logo_url: assetUrl(clinic, 'logo'),
    fondo_url: assetUrl(clinic, 'fondo'),
    manifest_url: `/api/publico/clinicas/${clinic.slug}/manifest.webmanifest`,
    app_path: `/c/${clinic.slug}`
  };
}

router.get('/clinicas/:slug', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.json({ consultorio: publicClinic(clinicBySlug(req.params.slug)) });
});

router.get('/clinicas/:slug/manifest.webmanifest', (req, res) => {
  const clinic = clinicBySlug(req.params.slug);
  const name = clinic.marca_nombre || clinic.nombre;
  const icons = [
    { src: `/api/publico/clinicas/${clinic.slug}/icon/192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: `/api/publico/clinicas/${clinic.slug}/icon/512.png`, sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
  ];
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.json({
    id: `/c/${clinic.slug}/`,
    name,
    short_name: name.slice(0, 30),
    description: `Portal clínico de ${name}`,
    lang: 'es',
    start_url: `/c/${clinic.slug}/?origen=app`,
    scope: `/c/${clinic.slug}/`,
    display: 'standalone',
    orientation: 'any',
    background_color: clinic.color_fondo || '#f3fafc',
    theme_color: clinic.color_primario || '#24577a',
    icons
  });
});

router.get('/clinicas/:slug/icon/:size.png', async (req, res, next) => {
  if (!['180', '192', '512'].includes(req.params.size)) return next(new ApiError(404, 'Icono no encontrado'));
  const clinic = clinicBySlug(req.params.slug);
  const file = clinicIconPath(clinic.slug, req.params.size);
  try {
    await ensureClinicIcon(clinic, Number(req.params.size));
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.sendFile(file, (error) => {
      if (error) { res.removeHeader('Cache-Control'); next(new ApiError(404, 'Icono no encontrado')); }
    });
  } catch (error) { next(error); }
});

router.get('/clinicas/:slug/:tipo', (req, res, next) => {
  if (!['logo', 'fondo'].includes(req.params.tipo)) throw new ApiError(404, 'Imagen no encontrada');
  const clinic = clinicBySlug(req.params.slug);
  const file = req.params.tipo === 'logo' ? clinic.logo_path : clinic.fondo_path;
  if (!file) throw new ApiError(404, 'Imagen no encontrada');
  const requestedVersion = String(req.query.v || '');
  if (requestedVersion && requestedVersion !== file) throw new ApiError(404, 'Imagen no encontrada');
  res.setHeader('Cache-Control', requestedVersion ? 'public, max-age=31536000, immutable' : 'public, max-age=300');
  res.sendFile(path.join(config.uploadDir, path.basename(file)), (error) => {
    if (error) { res.removeHeader('Cache-Control'); next(new ApiError(404, 'Imagen no encontrada')); }
  });
});

export default router;
