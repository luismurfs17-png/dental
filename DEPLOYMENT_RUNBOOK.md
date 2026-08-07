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

- Variables: `BACKUP_ENABLED` (por defecto `false`), `BACKUP_CRON`
  (`0 3 * * *`), `BACKUP_RETENTION_LOCAL` (3 snapshots, eliminando los viejos).
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
- Revisar rate limiting en OAuth/API según el tráfico real.
- Confirmar política de privacidad y acceso a historias clínicas.
- Mantener una sola réplica mientras se use SQLite.

`npm audit` del servidor está limpio. El cliente conserva un aviso alto de
React Router relacionado con RSC/Server Actions; SONRIDENT es una SPA con
`BrowserRouter` y no habilita esas capacidades. No ejecutar
`npm audit fix --force`: actualmente propone una versión con vulnerabilidades
de redirección/XSS más amplias. Revisar una versión corregida antes de publicar
datos reales.

## Estado de verificación local

- Pruebas del servidor: 12 aprobadas.
- Build de React: aprobado.
- Auditoría del servidor: 0 vulnerabilidades.
- Docker: no probado localmente porque Docker no está instalado en esta
  máquina. La primera construcción en Dokploy debe tratarse como verificación
  pendiente, no como despliegue ya validado.

## Estado del despliegue del 4 de agosto de 2026

```yaml
repository_visibility: private
deployed_commit: f568d6109cacf2a57ba0bcd52ba87372ddfeda9f
application_name: sonrident
dokploy_project: DENTISTA
dokploy_environment: production
provider: GitHub
repository: luismurfs17-png/dental
branch: main
build_path: /
build_type: Dockerfile
dockerfile_path: Dockerfile
docker_context_path: .
domain: sonrident.copaapp.cloud
container_port: 3000
volume_name: sonrident_data
volume_mount_path: /app/data
autodeploy: disabled_during_initial_setup
```

Proceso completado:

1. Se creó el repositorio privado y se subió `main` sin `.env`, SQLite,
   comprobantes, `node_modules` ni artefactos de build.
2. Dokploy obtuvo acceso al repositorio privado mediante su GitHub App.
3. Se configuró el Dockerfile raíz, contexto `.`, rama `main` y build path `/`.
4. Se configuraron `NODE_ENV=production`, `PORT=3000`, `DATA_DIR=/app/data`,
   `JWT_DAYS=7`, `CLIENT_URL` y `GOOGLE_CALLBACK_URL`. `JWT_SECRET` está guardado
   únicamente en Dokploy y no debe copiarse a este documento.
5. Se creó el volumen nombrado `sonrident_data` montado en `/app/data`.
6. El DNS `A` de `sonrident.copaapp.cloud` apunta a `76.13.253.130`.
7. Se configuró el dominio con HTTPS, paths `/` y puerto interno `3000`.
8. La imagen se construyó correctamente en Dokploy y el contenedor arrancó.

Verificaciones realizadas:

- `https://sonrident.copaapp.cloud` sirve la SPA.
- `https://sonrident.copaapp.cloud/api/health` devuelve estado saludable y
  confirma SQLite.
- HTTPS responde correctamente.
- El primer intento falló con `Github Provider not found`; se corrigió
  seleccionando otra vez la cuenta, repositorio y rama, y guardando Provider.
- Un `Bad Gateway` temporal ocurrió mientras Docker todavía exportaba la imagen;
  desapareció al finalizar el despliegue.

Pendientes para continuar:

1. Configurar Google OAuth. Crear o usar un proyecto de Google Cloud, registrar
   el origen `https://sonrident.copaapp.cloud` y la URI
   `https://sonrident.copaapp.cloud/api/auth/google/callback`. Guardar
   `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` solo en Dokploy. Actualmente el
   portal abre, pero el acceso normal con Google no está disponible.
2. Configurar Gmail SMTP únicamente después de activar 2FA y crear una
   contraseña de aplicación. Guardar `SMTP_USER` y `SMTP_PASS` solo en Dokploy.
3. Probar el flujo real completo: alta del doctor, consultorio, horario,
   tratamiento, paciente autorizado, reserva, reprogramación, notificación,
   evidencia QR, validación del pago y saldo.
4. Verificar persistencia creando datos ficticios, reiniciando o redesplegando y
   confirmando que SQLite y uploads sobreviven en `sonrident_data`.
5. Configurar backup externo diario del volumen y probar una restauración.
6. Proteger el panel de Dokploy con dominio y HTTPS; durante la configuración se
   accedió por HTTP a `76.13.253.130:3000`.
7. Confirmar 2FA en GitHub, Hostinger, Google y Dokploy, además de revisar logs,
   recursos, rate limiting y política de privacidad antes de usar datos reales.
8. Decidir si activar Autodeploy después de completar y verificar OAuth,
   persistencia y backups.

Para reanudar, comenzar por el punto 1 de pendientes. No ejecutar `npm run seed`
en producción y mantener una sola réplica mientras se use SQLite.

## Rollback

Volver al último commit conocido solo después de confirmar compatibilidad con
el esquema actual. Antes de cambios de esquema o volumen, crear backup. Un
rollback de código no revierte automáticamente datos ni columnas SQLite.
