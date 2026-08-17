# Despliegue de SONRIDENT en Dokploy

Este archivo es la fuente específica del proyecto para el agente de despliegue.
Los datos no definidos (repositorio, dominio y proveedor del VPS) deben
confirmarse antes de publicar.

## Identidad

```yaml
project_name: sonrident
repository: luismurfs17-png/dental
production_branch: main
production_url: https://sonrident.copaapp.cloud
planned_neutral_url: https://clinicas.copaapp.cloud
health_path: /api/health
deployment_platform: Dokploy
```

## Runtime y build

```yaml
language: JavaScript
runtime: Node.js 22
package_manager: npm
lockfiles:
  - client/package-lock.json
  - server/package-lock.json
build_type: Dockerfile
dockerfile_path: Dockerfile
docker_context_path: .
container_port: 3000
start_command: node src/index.js
healthcheck: /api/health
run_as_non_root: true
replicas: 1
```

El Dockerfile construye React y copia `client/dist` a `server/public`. Express
sirve la SPA y la API en el mismo origen. `better-sqlite3` se compila dentro de
Linux y el contenedor maneja `SIGTERM` antes de cerrar SQLite.

## Variables de Dokploy

| Variable | Secreto | Valor o fuente |
|---|---:|---|
| `NODE_ENV` | No | `production` |
| `PORT` | No | `3000` |
| `DATA_DIR` | No | `/app/data` |
| `CLIENT_URL` | No | URL HTTPS pública exacta |
| `JWT_SECRET` | Sí | Aleatoria, mínimo 32 caracteres |
| `JWT_DAYS` | No | `7` |
| `GOOGLE_CLIENT_ID` | No | Google Cloud OAuth Web Client |
| `GOOGLE_CLIENT_SECRET` | Sí | Google Cloud OAuth |
| `GOOGLE_CALLBACK_URL` | No | `https://DOMINIO/api/auth/google/callback` |
| `GOOGLE_GMAIL_CALLBACK_URL` | No | `https://DOMINIO/api/auth/google/gmail/callback` |
| `SUPERADMIN_EMAILS` | No | Correos del administrador, separados por coma |
| `SMTP_HOST` | No | `smtp.gmail.com` al activar Gmail |
| `SMTP_PORT` | No | `587` |
| `SMTP_SECURE` | No | `false` para STARTTLS |
| `SMTP_USER` | Sí | Cuenta Gmail emisora |
| `SMTP_PASS` | Sí | Contraseña de aplicación, no clave normal |
| `SMTP_FROM` | No | Nombre y correo del remitente |
| `REMINDER_CRON` | No | `0 * * * *` |
| `REMINDER_HOURS` | No | `24` |

No configurar SMTP todavía si los recordatorios se dejan para fase 2: el
servidor los desactiva de forma segura cuando faltan esas variables.
Al configurarlo, SONRIDENT envía confirmaciones al crear citas,
avisos al reprogramarlas y recordatorios programados. Una reprogramación elimina
el marcador del recordatorio anterior para que el nuevo horario pueda avisarse.

## Google OAuth

Crear un cliente OAuth de tipo aplicación web. Registrar exactamente:

- Origen autorizado: `https://DOMINIO`.
- URI de redirección: `https://DOMINIO/api/auth/google/callback`.

Al migrar al portal neutral usar `https://clinicas.copaapp.cloud` como origen y
`https://clinicas.copaapp.cloud/api/auth/google/callback` como URI. El cambio de
`CLIENT_URL`, callback, DNS y dominio Dokploy debe hacerse en una misma ventana:
las cookies y las instalaciones PWA no se transfieren entre dominios. El dominio
anterior puede mostrar un aviso o redirección, pero los usuarios deberán iniciar
sesión e instalar nuevamente desde el dominio neutral.

### Enlace de correo con Google (doctor)

En `Tu consultorio → Correos de tu clínica` el doctor puede conectar el Gmail
del consultorio con un clic (OAuth, sin contraseñas). Requiere:

- Registrar la URI de redirección `https://DOMINIO/api/auth/google/gmail/callback`
  en el mismo cliente OAuth de Google Cloud.
- Incluir el scope `https://mail.google.com/` en la pantalla de consentimiento.
  Es un alcance restringido: en modo *Testing* funciona solo con usuarios de
  prueba; para producción con usuarios reales se requiere la verificación de la
  aplicación en Google.
- Variable `GOOGLE_GMAIL_CALLBACK_URL` en Dokploy.

El servidor guarda únicamente el refresh token cifrado (clave derivada de
`JWT_SECRET`) en `consultorio_email` y envía mediante SMTP OAuth2 de
Nodemailer. El formulario SMTP manual ya no se muestra en la interfaz; el
backend conserva el soporte para configuraciones previas.

## PWA multi-clínica

- Portal neutral: `/login`.
- Portal e instalación por clínica: `/c/:slug` y `/c/:slug/instalar`.
- Cada clínica obtiene manifiesto e iconos PNG propios; el `id` PWA usa su slug.
- Los enlaces y QR usan `window.location.origin`, por lo que adoptan el nuevo
  dominio automáticamente después de cambiar DNS y Dokploy.
- No se guarda información clínica sin conexión. El service worker solo conserva
  recursos visuales y muestra una pantalla segura cuando no hay red.
- Las instalaciones comparten sesión por estar en el mismo dominio. El login
  marcado valida la membresía y no permite entrar silenciosamente a otra clínica.
- El primer arranque que detecta el esquema anterior crea automáticamente un
  snapshot `pre-pwa-multiclinica-*` antes de añadir slug e identidad visual.

El doctor que no existe todavía entra con Google y completa el alta de su
consultorio. Los pacientes y operativos deben estar preautorizados por correo
desde el consultorio antes de su primer acceso.

## Dominio en Dokploy

```yaml
path: /
internal_path: /
container_port: 3000
https: true
certificate_provider: Lets Encrypt
published_host_port: none
```

Traefik debe apuntar al puerto interno `3000`. No publicar otro puerto del
contenedor.

## Persistencia

```yaml
database_type: SQLite WAL
volume_type: Volume Mount
volume_name: sonrident_data
mount_path: /app/data
database_file: /app/data/dentista.sqlite
uploads_path: /app/data/uploads
replicas: 1
```

El volumen debe existir antes de introducir datos reales. Contiene la base,
sus archivos WAL/SHM, el QR del consultorio y comprobantes de pago. El volumen
no es un backup. Programar una copia externa diaria y probar restauración antes
de producción. No copiar solo el archivo `.sqlite` mientras la app escribe;
usar el mecanismo de backup de SQLite o detener el contenedor de forma limpia.

## Copias de seguridad locales

La app genera snapshots WAL-safe dentro de `data/backups/<etiqueta>-<fecha>/`:
`dentista.sqlite` (con `db.backup()`) más una copia de `uploads/`. Cada reinicio
a cero de un consultorio también guarda un snapshot previo.

Además, con `BACKUP_POR_CONSULTORIO` activo (por defecto `true`), el cron diario
genera un ZIP por consultorio (`index.json` con todas las tablas + `index.html` +
archivos adjuntos) en `data/backups/consultorios/consultorio-<id>/`. El
superadmin puede listar y descargar esos ZIPs en el panel (`/api/admin/backups`
y `/api/admin/backups/consultorio-<id>/<archivo>`). Se conservan los
`BACKUP_RETENTION_LOCAL` últimos por clínica.

- Variables: `BACKUP_ENABLED` (por defecto `false`), `BACKUP_CRON`
  (`0 3 * * *`), `BACKUP_RETENTION_LOCAL` (3 snapshots, eliminando los viejos),
  `BACKUP_POR_CONSULTORIO` (`true` por defecto; `false` para desactivarlo).
- Mantener la retención local pequeña: la copia duradera es el backup externo
  (Restic→S3) que programa Dokploy sobre el volumen. Probar la restauración
  reemplazando `/app/data/dentista.sqlite` y `uploads/` y reiniciando el
  contenedor mientras la app está detenida.
- Regla de escalabilidad: migrar de SQLite solo si se superan ~60–80 clínicas,
  los backups superan los 2–3 GB o la restauración excede 1 h.

## Reinicio a cero de un consultorio (superadmin)

El endpoint `POST /api/admin/consultorios/:id/reiniciar` (bajo confirmación)
vacíar pacientes, citas, registros, notas, pagos y auditoría del consultorio;
conserva usuarios, servicios, horarios y configuración. El evento queda en
`admin_auditoria` con la cuenta de registros eliminados.

## Primer despliegue

1. Crear un repositorio GitHub privado exclusivo para este proyecto.
2. Subir el código sin `.env`, `data/` ni bases SQLite.
3. En Dokploy elegir GitHub, rama `main`, tipo `Dockerfile`, contexto `.`.
4. Configurar puerto interno `3000`, variables y volumen `/app/data`.
5. Configurar dominio HTTPS y después registrar la URL final en Google OAuth.
6. Desplegar una sola réplica.
7. No ejecutar `npm run seed` en producción.

## Verificación posterior

1. Confirmar el commit usado por Dokploy.
2. Verificar `GET /api/health` por HTTPS.
3. Abrir el portal y acceder con el doctor mediante Google.
4. Crear un consultorio, horario, tratamiento y paciente ficticio.
5. Entrar como paciente autorizado y reservar una cita.
6. Comprobar la notificación del doctor.
7. Subir una evidencia QR y validarla solo con el doctor.
8. Confirmar que el saldo cambia únicamente después de validar el pago.
9. Redesplegar y comprobar que pacientes, SQLite y evidencias persisten.
10. Revisar logs, CPU, memoria, disco y certificado.

## Seguridad pendiente antes de datos reales

- Activar 2FA en Google, GitHub, VPS y Dokploy.
- Mantener Dokploy detrás de HTTPS y cerrar su acceso HTTP público.
- Configurar backup externo y restauración probada.
- Rate limiting en OAuth/API: **activo** (`express-rate-limit`).
- Confirmar política de privacidad y acceso a historias clínicas.
- Mantener una sola réplica mientras se use SQLite.

`npm audit` del servidor está limpio. El cliente conserva un aviso alto de
React Router relacionado con RSC/Server Actions; SONRIDENT es una SPA con
`BrowserRouter` y no habilita esas capacidades. No ejecutar
`npm audit fix --force`.

## Estado de verificación local (agosto 2026)

- Pruebas del servidor: **15/15** aprobadas (`npm test` con preload aislado).
- Build de React: aprobado.
- Auditoría del servidor: 0 vulnerabilidades.
- Rate limiting: activo en `/api/auth`, `/api/admin`, `/api`.
- Script demo: `npm run demo` / `node src/demo.js`.

## Demo de agenda en producción

1. Redesplegar el commit actual en Dokploy.
2. Confirmar `https://sonrident.copaapp.cloud/api/health`.
3. Login con Google (superadmin en `SUPERADMIN_EMAILS`).
4. Cargar datos de presentación **una sola vez** en el contenedor:
   ```bash
   node src/demo.js
   ```
   Crea `Clínica Demo SONRIDENT` (email `demo@sonrident.local`) con pacientes
   10001–10004, servicios, horario lun–vie y citas de ayer/hoy/mañana/pasado.
   Vincula los correos de `SUPERADMIN_EMAILS` como doctor del demo.
5. Abrir Agenda y mostrar semana / 2 semanas / mes, nueva visita, reprogramación.
6. Después de la demo: en `/admin` eliminar o reiniciar ese consultorio.

No usar `npm run seed` de forma rutinaria en producción. `demo.js` es solo
para presentación y es removible.

## Estado del despliegue (actualizado agosto 2026)

```yaml
repository_visibility: private
application_name: sonrident
dokploy_project: DENTISTA
dokploy_environment: production
provider: GitHub
repository: luismurfs17-png/dental
branch: main
build_type: Dockerfile
domain: sonrident.copaapp.cloud
next_domain: clinicas.copaapp.cloud
container_port: 3000
volume_name: sonrident_data
volume_mount_path: /app/data
oauth_google: operativo
smtp: no_configurado
backup_local: disponible (BACKUP_ENABLED)
backup_externo: pendiente
rate_limiting: activo
```

Completado:

1. Repo privado, Dockerfile, volumen, HTTPS, health OK.
2. Google OAuth operativo (login verificado con superadmin).
3. Módulos 1–2: backups locales, exportación ZIP, panel admin enriquecido.
4. Rate limiting API. Tests 15/15. Script `demo.js` para presentación de agenda.

Pendientes (antes de datos reales de clientes):

1. Gmail SMTP (2FA + contraseña de aplicación) si se quieren recordatorios.
2. Flujo e2e completo (paciente reserva, QR, saldo) cuando haya tiempo.
3. Persistencia tras redespliegue (crear dato → redeploy → verificar).
4. Backup externo diario del volumen + **probar restauración**.
5. Proteger panel Dokploy (HTTPS, sin HTTP público).
6. 2FA en GitHub, Hostinger, Google y Dokploy.
7. Política de privacidad / consentimiento de historias clínicas.
8. Autodeploy opcional cuando OAuth + backups estén estables.

Una sola réplica mientras se use SQLite.

## Rollback

Volver al último commit conocido solo después de confirmar compatibilidad con
el esquema actual. Antes de cambios de esquema o volumen, crear backup. Un
rollback de código no revierte automáticamente datos ni columnas SQLite.
