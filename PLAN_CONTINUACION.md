# PLAN DE CONTINUACIÓN — SONRIDENT (CONTEXTO COMPLETO)

**Fecha:** 15 de agosto de 2026
**Repositorio:** https://github.com/luismurfs17-png/dental (rama `main`)
**Producción:** https://clinicas.copaapp.cloud (health OK: `{"estado":"saludable","base_de_datos":"sqlite"}`)
**Último commit desplegado:** `a775c91` (detección automática SMTP) — auto-deploy de Dokploy activo
**Estado del producto:** operativo. App dental multiclínica (doctores, operativos, pacientes) con citas, calendario, pagos QR, cotizaciones y correos con marca.

---

## 1. HISTORIA DEL DESPLIEGUE (cómo llegamos aquí)

1. **Dominio original** `sonrident.copaapp.cloud` → migrado a **`clinicas.copaapp.cloud`** (DNS `A` en Hostinger, TTL 14400, verificado en Google Search Console con TXT; el registro A no debe tocarse).
2. **Google OAuth roto** tras la migración (`redirect_uri_mismatch`) → corregido: orígenes y redirects con el dominio nuevo en Google Cloud.
3. **Login bloqueado** ("No se pudo cargar el usuario autenticado") → causado por la BD SQLite corrupta/desactualizada. **Se reinició desde cero**: se borraron `/app/data/dentista.sqlite` (+ wal/shm) desde la terminal del contenedor Dokploy (`/bin/sh`, no hay bash) y se redeployó. Login volvió a funcionar.
4. **Alerta Safe Browsing** ("sitio peligroso") en `clinicas.copaapp.cloud` → dominio agregado en Search Console, verificación TXT completada. **Pendiente**: revisar "Problemas de seguridad" en Search Console y `https://www.google.com/safebrowsing/report_error/` hasta que desaparezca.
5. **Dominio viejo** `sonrident.copaapp.cloud` responde 404; borrado de datos planificado, pero se conservó temporalmente su URI OAuth. **Ahora puede quitarse** (app ya publicada).
6. **Secretos expuestos** → se rotaron: `JWT_SECRET` nuevo y `GOOGLE_CLIENT_SECRET` regenerado en Google Cloud (ver sección 6; los valores reales viven SOLO en Dokploy y Google Cloud, no en este documento).
7. **App OAuth publicada**: Google Cloud → Pantalla de consentimiento → **"En producción"** (15/08/2026). Desapareció el aviso "Google no verificó esta aplicación". Con permisos no sensibles (openid/email/profile) no requiere revisión. Quedan 2 ítems informativos no bloqueantes (Protección integral de cuenta y Cuenta de facturación → se activan solo con scopes sensibles, ej. Gmail API).

### Parámetros verificados de producción
- Node 22, Dockerfile raíz, puerto interno 3000, health `/api/health`, volumen nombrado `sonrident_data` → `/app/data` (SQLite WAL), **1 réplica obligatoria** (SQLite), usuario no root.
- Terminal del contenedor usa `/bin/sh` (sin bash). `rm -rf` bloqueado por reglas → usar `node -e fs.rmSync` si se necesita limpiar.
- Variables en Dokploy (ver sección 5).
- Backup: `BACKUP_ENABLED=true`, cron 3am, retención local 3. **Pendiente**: destino externo en "Volume Backups" no configurado.
- Aprendizaje: la BD de test `server/test/data-test` es persistente → limpiarla si fallan tests de disponibilidad; FK `envios_notificacion.cita_id` es `ON DELETE SET NULL` (migración `ensureEnviosFkSoftDelete()` en `db.js`).

---

## 2. MEJORAS GMAIL YA IMPLEMENTADAS (8 pasos, desplegado)

1. **Esquema** (`schema.sql`): tablas `consultorio_email` (modo `global|propio`, smtp_*, `smtp_pass_cifrado`, activo, verificado_en, ultimo_error) y `envios_notificacion` (historial: cita_id, tipo, canal, estado, error, intentos) + índice.
2. **`crypto.js`** (nuevo): `encryptSecret`/`decryptSecret` AES-256-GCM con clave derivada de `JWT_SECRET`.
3. **`templates.js`** (nuevo): plantillas HTML con marca (logo, colores, footer con teléfono), texto plano, botones de acción — hasta **2 botones** (primario + secundario).
4. **`email.js`** (refactor): `smtpConfigured`, `getClinicEmailConfig`, `clearClinicTransporter`, `sendEmail` (reintento 1, registra en historial), `sendAppointmentEmail`, `sendReminderEmail`, `sendClinicEmail`, `sendTestEmail`, `sendWelcomeEmail` (bienvenidas), `sendPlatformEmail` (marca neutral). **Herencia**: clínica con SMTP propio usa el suyo; si no, el global. Sin SMTP configurado → `false` sin intentar.
5. **`reminders.js`**: recordatorios por clínica (cron horario), `anyEmailConfigured()`, upsert en `email_recordatorios`.
6. **`routes/api.js`** — endpoints (solo doctor): `GET/PUT /correo/configuracion`, `POST /correo/probar`, `GET /correo/envios` (últimos 100). Eventos: confirmación/reprogramación de cita, cancelación (correo al doctor con motivo y alerta <24h), pago QR reportado (doctor, con monto y botón "Revisar pagos"), pago validado/anulado (paciente, con botón "Ver mis pagos").
7. **Bienvenidas**: invitación de consultorio (`admin.js` → `sendPlatformEmail` "Fuiste invitado a crear tu consultorio"), onboarding del doctor (`sendWelcomeEmail` con portal `/c/slug` + instalar `/c/slug/instalar`), registro de paciente con correo (igual que onboarding).
8. **UI** (`Settings.jsx` + `global.css`): tarjeta "Correos de tu clínica" — modo Global/Propio (opciones corregidas de un bug de letras sueltas), campos con pistas para doctores, prueba de envío, historial expandible, estado del SMTP global.
9. **SMTP automático por dominio** (cliente y servidor): al escribir el correo, ajusta host/puerto/SSL solo: gmail.com→`smtp.gmail.com:587`, hotmail/outlook/live/msn→`smtp-mail.outlook.com:587`, yahoo→`smtp.mail.yahoo.com:465` (SSL), icloud/me→`smtp.mail.me.com:587`, zoho→`smtp.zoho.com:465`, aol→`smtp.aol.com:587`. El servidor verifica de nuevo al guardar. "Remitente mostrado" se completa solo (`Nombre <correo>`).
10. **Contraseña SMTP**: vacía al guardar = conserva la cifrada existente (solo se exige la primera vez). El cambio a `global` borra el SMTP propio.

**Calidad:** `npm test` en `server/` = 26/26 + migration-smoke + production-smoke. `npm run build` en `client/` OK.

---

## 3. SIGUIENTE EN LA COLA (acordado con el usuario)

### 3.1 Personalización del consultorio
- ✅ **Eslogan por clínica** (17/08/2026): campo `eslogan` en `consultorios` + `clinicJson` + UI en Settings ("Estudio de marca"), aparece en la portada del portal público (`Login.jsx` branded `/c/slug`), pantalla de login y pie de correos con marca.
- ✅ **WhatsApp en correos** (17/08/2026): enlace `wa.me` con el número de la clínica en el pie de plantillas (campo `whatsapp`).

### 3.2 Alcances de correo de mayor valor
- ✅ **Segundo recordatorio T-2h** (17/08/2026): columna `tipo` (`24h`|`2h`) en `email_recordatorios`; cron separado `REMINDER_CRON_2H` (default `*/15 * * * *`) además del horario de 24h; `dueReminderRows(now, tipo)` y `sendReminderEmail(id, tipo)` registran `recordatorio_2h` en el historial.
- ✅ **Resumen semanal al doctor** (17/08/2026): `server/src/weekly.js` + `sendWeeklySummaryEmail` (citas próximas 7 días, citas atendidas, pagos por verificar, pacientes con saldo y su monto, inactivos +30 días), cron `RESUMEN_SEMANAL_CRON` (default lunes 08:00), va a todos los doctores activos de la clínica. Test dedicado.
- ✅ **Prueba de correos por clínica `funciones_consultorio`** (17/08/2026): ver sección 4. Implementado completo: tabla, migración, activación/desactivación desde el panel admin, corte automático en el cron de recordatorios + verificación en `sendEmail` antes de cada envío (todos los automáticos; citas y calendario intactos), banner de estado en Ajustes → Correos.
- (Opcionales posteriores): recordatorio manual de saldo desde Cobros, correo de cotización con enlace público (`compartido_en`), seguimiento post-consulta con encuesta, botón "Confirmar asistencia" (tokens firmados + endpoints públicos), recuperación de pacientes inactivos, alerta de agenda llena.

### 3.3 Menores
- ✅ **Backup por consultorio** (17/08/2026): cron diario genera ZIP por clínica en `/app/data/backups/consultorios/consultorio-<id>/` (retención 3 por clínica, `BACKUP_POR_CONSULTORIO` default `true`); el superadmin lista y descarga desde el panel (`GET /api/admin/backups`). Lógica extraída a `server/src/exporter.js`.
- ✅ **Página pública `/privacidad`** (17/08/2026): ruta React fuera de autenticación (`client/src/pages/public/Privacy.jsx`), enlace en el pie del login (`privacy-note`), estilos `.privacy-*`.
- Google Cloud: **quitar la URI OAuth del dominio viejo** `sonrident` (ya aprobado, app publicada).
- Dokploy: **desactivar Auto Deploy** (Settings → General → toggle) para que el usuario decida cuándo desplegar (está en el panel; el usuario lo revisará).
- Search Console: revisar aviso "sitio peligroso".
- ✅ **Backup externo en Dokploy** — pasos: ver DEPLOYMENT_RUNBOOK.md sección "Backup externo (Volume Backups)" (destino S3/B2 requiere credenciales del usuario).

### 3.4 Otros temas discutidos (decisión pendiente del usuario)
- **Modo demo** ("Probar la app" sin cuenta): clínica demo + sesión invitado tipo login de desarrollo, pero activado solo para la clínica demo. Recomendado junto con la publicación de la app.
- **Límite Gmail**: ~500 correos/día por cuenta gratuita; para volumen mayor, proveedor transaccional (Resend/SendGrid) — el envío está aislado en `email.js` (fácil de adaptar).

---

## 4. DISEÑO APROBADO (YA PROGRAMADO 17/08/2026): PRUEBA DE CORREOS POR CLÍNICA

**Contexto del negocio:** el superadmin quiere **vender estas mejoras**. Un cliente pidió solo "citas y calendario". Plan: habilitarle los recordatorios por correo como **prueba de 1 mes**, ver cómo funciona y luego **sumarlo al precio total**. Requisito clave: **desactivación automática al vencer** sin intervención manual. **Decisión tomada**: el corte apaga TODOS los automáticos de la clínica (confirmaciones, recordatorios, cotizaciones, bienvenidas, resumen semanal); citas y calendario nunca se tocan.

### 4.1 Base de datos — tabla nueva `funciones_consultorio`
```
consultorio_id  INTEGER (FK consultorios; PK compuesta con funcion)
funcion         TEXT    ('correos_automaticos' por ahora; extensible)
activo          INTEGER (1/0)
vence_en        TEXT    (ISO datetime; NULL = pago activo sin vencimiento)
creado_por      INTEGER (superadmin que la activó)
creado_en       TEXT
actualizado_en  TEXT
```
Extensible: mañana se vende "cotizaciones por correo" u otra función sin cambiar el esquema.

### 4.2 Activación (superadmin)
- Panel admin, por clínica: botón **"Activar prueba de correos"** (30 días por defecto, días configurables).
- Inserta `activo=1, vence_en=ahora+30d`; registrado en auditoría (quién, cuándo).
- El panel muestra: estado (prueba / pago / sin activar) y días restantes.

### 4.3 Corte automático (defensa en profundidad)
- El cron horario de recordatorios revisa pruebas vencidas → `activo=0`.
- **Además**, el código de envío (`sendEmail`/`sendReminderEmail`/`sendClinicEmail`) verifica siempre `activo AND vence_en > ahora` ANTES de enviar → ni un correo vencido aunque falle el cron.
- **Decisión pendiente del usuario**: el corte apaga ¿solo recordatorios o TODOS los correos (confirmaciones, bienvenidas, pagos)? Propuesto: todos los automáticos; citas y calendario nunca se tocan.

### 4.4 Vista para el doctor (cliente)
- Ajustes → Correos: "Correos automáticos: prueba hasta el 15/09".
- Al vencer: los correos dejan de salir silenciosamente; aviso en la app "Tu prueba terminó. Contacta a tu administrador para activarlo."
- Opcional: correo de aviso al doctor 3 días antes de vencer.

### 4.5 Venta
- El superadmin ve en el panel si la prueba se usó (historial existe: `envios_notificacion` por clínica).
- Si funcionó → activa versión de pago (`activo=1`, `vence_en=NULL`) y suma el precio.

### Archivos que se tocarán al programar
`server/src/schema.sql` + migración en `server/src/db.js` · `server/src/email.js` y `server/src/reminders.js` (verificación de función) · `server/src/routes/admin.js` (activar/listar/auditar) · `server/src/routes/api.js` (info de prueba en `/correo/configuracion`) · `client/src/pages/admin/AdminPanel.jsx` y `client/src/pages/team/Settings.jsx`.

---

## 5. VARIABLES DE ENTORNO EN DOKPLOY (al 15/08/2026)

```
NODE_ENV=production
PORT=3000
DATA_DIR=/app/data
JWT_SECRET=<en Dokploy, no en este documento>
JWT_DAYS=7
CLIENT_URL=https://clinicas.copaapp.cloud
GOOGLE_CALLBACK_URL=https://clinicas.copaapp.cloud/api/auth/google/callback
GOOGLE_CLIENT_ID=663527399721-af4vc227lo6asi2svggo3lf2jap364vp.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<en Dokploy, no en este documento>
SUPERADMIN_EMAILS=luismurfs17@gmail.com
BACKUP_ENABLED=true
BACKUP_CRON=0 3 * * *
BACKUP_RETENTION_LOCAL=3
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=LUISMURFS17@gmail.com
SMTP_PASS=<contraseña de aplicación Gmail — en Dokploy, regenerar (ver sección 6)>
SMTP_FROM=Sonrident <luismurfs17@gmail.com>
```
Google Cloud: proyecto `dentista-app-504519`, cliente OAuth `sonrident` (nombre visual, no es fallo), ID `663527399721-af4vc227lo6asi2svggo3lf2jap364vp.apps.googleusercontent.com`, redirects con `clinicas.copaapp.cloud` + el viejo de `sonrident` (por quitar). Orígenes: `https://clinicas.copaapp.cloud`.

---

## 6. NOTAS DE SEGURIDAD (importantes)

- **Contraseña de aplicación Gmail** (se compartió en el chat) → **regenerarla** en `https://myaccount.google.com/apppasswords` y actualizar `SMTP_PASS` en Dokploy (2FA ya activa desde el 04/08; la cuenta de asistencia es `luismurfs17@gmail.com`, correo de recuperación `luismurf1@gmail.com`).
- `GOOGLE_CLIENT_SECRET` actual también se mostró en el chat → considerar regenerarlo en Google Cloud y actualizar Dokploy.
- No subir a Git: `.env`, SQLite, QR, evidencias, `screb/` (fotos personales), contraseñas, secrets.
- Reglas del proyecto: no borrar volúmenes, no comandos destructivos para corregir errores, 1 réplica por SQLite, backup antes de cambios de esquema/volumen, no seed ficticio en producción.

---

## 7. CÓMO SE DESPLIEGA (flujo actual)

1. `npm test` (en `E:\APP 2\DENTIST\server`) y `npm run build` (en `E:\APP 2\DENTIST\client`).
2. Commit + push a `main` (solo archivos del proyecto; excluir `screb/`).
3. Dokploy redeploya automáticamente por **Auto Deploy** (el usuario quiere desactivarlo en Settings → General para decidir manualmente; el botón "Deploy" de la app despliega el último commit).
4. Verificar: `/api/health`, login con Google, prueba de correo en Ajustes → "Probar envío", y persistencia tras redeploy.

---

## 8. REFERENCIAS DE ARCHIVOS CLAVE

- `server/src/routes/api.js` — endpoints `/correo/*` (≈líneas 313–370), bienvenidas (onboarding ≈166–190, pacientes ≈520–535), eventos de correo (cancelar ≈1140, pagos ≈1300–1380).
- `server/src/routes/admin.js` — invitaciones con `sendPlatformEmail` (≈272–310).
- `server/src/email.js`, `server/src/templates.js`, `server/src/crypto.js`, `server/src/reminders.js`, `server/src/schema.sql`, `server/src/db.js` (migración FK soft-delete).
- `client/src/pages/team/Settings.jsx` + `client/src/styles/global.css` (tarjeta de correos y estilos `.email-*`).
- `client/src/pages/Login.jsx` — portal público branded (texto fijo que el eslogan reemplazará).
- `DEPLOYMENT_RUNBOOK.md`, `DOMAIN_MIGRATION_CONTINUITY.md`, `PROJECT_CONTEXT.md`, `SUPERADMIN_CONTEXT.md`, `.opencode/skills/deploy-sonrident-dokploy/` — contexto y runbook de despliegue.