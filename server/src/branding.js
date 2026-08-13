import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { config } from './config.js';

const validColor = (value) => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : '#24577a';
const iconName = (slug, size) => `brand-${slug}-${size}.png`;
const iconJobs = new Map();

function fallbackSvg(color) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${color}"/><path d="M157 112c-65 27-78 101-50 164 36 84 31 189 87 189 38 0 28-126 62-126s24 126 62 126c56 0 51-105 87-189 28-63 15-137-50-164-40-17-63 17-99 17s-59-34-99-17Z" fill="none" stroke="#fff" stroke-width="28" stroke-linejoin="round"/></svg>`);
}

export async function createClinicIcons(clinic) {
  const color = validColor(clinic.color_primario);
  const sourcePath = clinic.logo_path ? path.join(config.uploadDir, path.basename(clinic.logo_path)) : null;
  for (const size of [180, 192, 512]) {
    if (sourcePath && fs.existsSync(sourcePath)) {
      const padding = Math.round(size * .14);
      const inner = size - padding * 2;
      const logo = await sharp(sourcePath).resize(inner, inner, { fit: 'contain', background: '#ffffff00' }).png().toBuffer();
      const rounded = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="${color}"/><rect x="${padding - 2}" y="${padding - 2}" width="${inner + 4}" height="${inner + 4}" rx="${Math.round(size * .17)}" fill="#fff"/></svg>`);
      await sharp(rounded).composite([{ input: logo, left: padding, top: padding }]).png()
        .toFile(path.join(config.uploadDir, iconName(clinic.slug, size)));
    } else {
      await sharp(fallbackSvg(color)).resize(size, size).png().toFile(path.join(config.uploadDir, iconName(clinic.slug, size)));
    }
  }
}

export async function validateClinicImage(filePath) {
  const metadata = await sharp(filePath, { failOn: 'error', limitInputPixels: 40_000_000 }).metadata();
  if (!metadata.width || !metadata.height || !['jpeg', 'png', 'webp'].includes(metadata.format)) {
    throw new Error('Formato de imagen inválido');
  }
  await sharp(filePath, { failOn: 'error', limitInputPixels: 40_000_000 }).rotate().resize(1, 1).toBuffer();
}

export async function ensureClinicIcon(clinic, size) {
  if (fs.existsSync(clinicIconPath(clinic.slug, size))) return;
  if (!iconJobs.has(clinic.slug)) {
    iconJobs.set(clinic.slug, createClinicIcons(clinic).finally(() => iconJobs.delete(clinic.slug)));
  }
  await iconJobs.get(clinic.slug);
}

export function clinicIconPath(slug, size) {
  return path.join(config.uploadDir, iconName(slug, size));
}

export function removeClinicIcons(slug) {
  for (const size of [180, 192, 512]) fs.rm(clinicIconPath(slug, size), { force: true }, () => {});
}

export function clinicIconNames(slug) {
  return [180, 192, 512].map((size) => iconName(slug, size));
}
