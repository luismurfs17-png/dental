# Despliegue de SONRIDENT en Dokploy

Este archivo es la fuente específica del proyecto para el agente de despliegue.
Los datos no definidos (repositorio, dominio y proveedor del VPS) deben
confirmarse antes de publicar.

## Identidad

```yaml
project_name: sonrident
repository: luismurfs17-png/dental
production_branch: main
production_url: PENDIENTE_DOMINIO
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

## Rollback

Volver al último commit conocido solo después de confirmar compatibilidad con
el esquema actual. Antes de cambios de esquema o volumen, crear backup. Un
rollback de código no revierte automáticamente datos ni columnas SQLite.
