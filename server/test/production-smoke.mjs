import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clinicas-production-'));
process.env.NODE_ENV = 'production';
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'prueba-produccion-clinicas-32-caracteres-minimo';
process.env.CLIENT_URL = 'https://clinicas.copaapp.cloud';
process.env.BACKUP_ENABLED = 'false';
process.env.MAINTENANCE_ENABLED = 'false';

const { app } = await import('../src/app.js');
const { db } = await import('../src/db.js');
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});
const base = `http://127.0.0.1:${server.address().port}`;

try {
  db.prepare(`INSERT INTO consultorios
    (nombre,slug,marca_nombre,color_primario,color_acento,color_fondo)
    VALUES (?,?,?,?,?,?)`).run('Clínica Smoke', 'clinica-smoke', 'Marca Smoke', '#173f5f', '#d05a43', '#f7f4ed');

  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).estado, 'saludable');

  const neutral = await fetch(`${base}/login`);
  const neutralHtml = await neutral.text();
  assert.equal(neutral.status, 200);
  assert.match(neutralHtml, /<title>Portal Clínico<\/title>/);
  assert.doesNotMatch(neutralHtml, /rel="manifest"/);

  const branded = await fetch(`${base}/c/clinica-smoke`);
  const brandedHtml = await branded.text();
  assert.equal(branded.status, 200);
  assert.match(brandedHtml, /<title>Marca Smoke<\/title>/);
  assert.match(brandedHtml, /clinica-smoke\/manifest\.webmanifest/);
  assert.match(brandedHtml, /clinica-smoke\/icon\/180\.png/);
  assert.match(brandedHtml, /apple-mobile-web-app-title" content="Marca Smoke"/);
  const brandedInternal = await fetch(`${base}/c/clinica-smoke/agenda`);
  const brandedInternalHtml = await brandedInternal.text();
  assert.equal(brandedInternal.status, 200);
  assert.match(brandedInternalHtml, /clinica-smoke\/manifest\.webmanifest/);

  const manifest = await fetch(`${base}/api/publico/clinicas/clinica-smoke/manifest.webmanifest`);
  assert.match(manifest.headers.get('content-type'), /application\/manifest\+json/);
  const manifestJson = await manifest.json();
  assert.equal(manifestJson.id, '/c/clinica-smoke/');
  assert.equal(manifestJson.scope, '/c/clinica-smoke/');
  assert.equal(manifestJson.start_url, '/c/clinica-smoke/?origen=app');
  assert.equal(manifestJson.name, 'Marca Smoke');
  assert.ok(manifestJson.icons.some((icon) => icon.sizes === '512x512' && icon.purpose.includes('maskable')));

  const icon = await fetch(`${base}/api/publico/clinicas/clinica-smoke/icon/192.png`);
  assert.equal(icon.status, 200);
  assert.match(icon.headers.get('content-type'), /image\/png/);
  assert.ok((await icon.arrayBuffer()).byteLength > 500);

  const worker = await fetch(`${base}/sw.js`);
  assert.equal(worker.status, 200);
  assert.match(await worker.text(), /clinicas-shell-v1/);
  console.log('Producción smoke: health, portal neutral, marca, manifiesto, icono y service worker OK');
} finally {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
