# Respaldo de contexto: Superadministrador de SONRIDENT

Fecha: 4 de agosto de 2026.
Resumen del trabajo implementado para administrar consultorios y correos nuevos como superadministrador.

## Problema original

Cualquier correo que iniciaba sesión con Google podía crear su propio consultorio
mediante el onboarding, sin aprobación ni control. No existía forma de administrar
esas cuentas desde la aplicación.

## Solución implementada

### Rol superadministrador

- Se define por correo en la variable de entorno `SUPERADMIN_EMAILS`
  (varios correos separados por coma). No se guarda como rol en la base de datos.
- El usuario admin conserva su cuenta y consultorio propios; la API añade la
  bandera `es_admin: true` a su sesión (`server/src/auth.js`).
- El acceso a rutas admin se valida por correo en cada petición (`requireAdmin`),
  no depende del JWT.

### Panel de administración

- URL: `/admin` (frontend) → `client/src/pages/admin/AdminPanel.jsx`.
- API: `/api/admin/*` → `server/src/routes/admin.js`.
- Endpoints:
  - `GET /api/admin/resumen`: métricas globales.
  - `GET /api/admin/consultorios`: todos los consultorios con conteos.
  - `GET /api/admin/usuarios`: todos los usuarios (filtros por estado y búsqueda).
  - `POST /api/admin/invitaciones`: invita un correo (queda `preautorizado`).
  - `PATCH /api/admin/usuarios/:id/estado`: activa, suspende o regresa a pendiente.
  - `DELETE /api/admin/usuarios/:id`: elimina usuario (borrado lógico, pierde acceso).
  - `DELETE /api/admin/consultorios/:id`: elimina consultorio y todos sus usuarios.
- Todas las acciones quedan registradas en la tabla `admin_auditoria`.
- El admin no puede suspenderse ni eliminarse a sí mismo.

### Flujo de invitación

1. El superadmin invita un correo desde el panel → usuario `preautorizado`, sin consultorio.
2. El invitado inicia sesión con Google → se vincula y pasa a `activo`.
3. Crea su consultorio en el onboarding y opera normalmente.

### Cierre del auto-registro

- Quien inicia sesión con Google sin invitación se crea como `pendiente`
  (`server/src/routes/auth.js`) y el login ya no lo auto-activa.
- El onboarding rechaza a los `pendiente` con el mensaje
  "Su correo no tiene una invitación para crear un consultorio"
  (`server/src/routes/api.js`).
- Suspender o eliminar un usuario bloquea su acceso de inmediato.

## Archivos modificados

- `server/src/config.js`: getter `adminEmails` desde `SUPERADMIN_EMAILS`.
- `server/src/auth.js`: `isAdmin`, `withAdminFlag`, `requireAdmin`.
- `server/src/routes/auth.js`: login Google sin auto-activar `pendiente`, bandera admin.
- `server/src/routes/admin.js`: nuevo, rutas del panel.
- `server/src/routes/api.js`: gate de onboarding por invitación.
- `server/src/app.js`: montaje de `/api/admin`.
- `server/src/schema.sql`: tabla `admin_auditoria`.
- `server/test/app.test.js`: 2 pruebas nuevas (15/15 pasando).
- `client/src/pages/admin/AdminPanel.jsx`: nuevo, centro de control.
- `client/src/App.jsx`, `Login.jsx`, `AppShell.jsx`, `UI.jsx`, `global.css`:
  ruta `/admin`, redirección y navegación del admin.
- `server/.env.example`, `DEPLOYMENT_RUNBOOK.md`, `PROJECT_CONTEXT.md`: documentación.

## Pendiente de configurar (importante)

1. Definir el correo del superadmin: agregar en Dokploy la variable
   `SUPERADMIN_EMAILS=<correo de Google del dueño>` y redesplegar.
   El correo aún no fue proporcionado por el dueño.
2. Google OAuth sigue pendiente en producción (ver `DEPLOYMENT_RUNBOOK.md`);
   hasta activarlo, el login normal no funciona.
3. Para probar localmente: crear `server/.env` con
   `SUPERADMIN_EMAILS=doctora@sonrisas.test` y usar el acceso de desarrollo.

## Verificación

- `npm test` en `server`: 15/15 pruebas pasando.
- `npm run build` en `client`: build exitoso.

## Acceso del superadmin

- Producción: `https://sonrident.copaapp.cloud/admin`
  (redirige automáticamente al iniciar sesión con el correo admin sin consultorio;
  si el admin tiene consultorio, aparece el menú "Administrar" en la barra lateral).
