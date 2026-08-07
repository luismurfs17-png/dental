# Respaldo de contexto: Superadministrador de SONRIDENT

Fecha actualización: agosto 2026.

## Rol

- Correos en `SUPERADMIN_EMAILS` (coma-separados). No es un rol en la base.
- `es_admin: true` en sesión; acceso validado por correo en cada request (`requireAdmin`).
- Panel: `/admin` → `client/src/pages/admin/AdminPanel.jsx`.
- API: `/api/admin/*` → `server/src/routes/admin.js` (con rate limit).

## Capacidades del panel

- Resumen global, listado de consultorios (actividad, ingresos, última actividad).
- Detalle de consultorio (citas próximas, pagos, evidencias).
- Invitar correos (`preautorizado` → al Google login pasa a `activo`).
- Cambiar estado / eliminar usuarios y consultorios (borrado lógico).
- Exportar ZIP (`GET .../exportar`) y reiniciar a cero (`POST .../reiniciar` con snapshot previo).
- Auditoría admin con filtros.
- No puede suspenderse ni eliminarse a sí mismo.

## Flujo de invitación

1. Superadmin invita correo → `preautorizado`.
2. Invitado inicia con Google → `activo`.
3. Crea su consultorio en onboarding.

Sin invitación: queda `pendiente` y el onboarding lo rechaza.

## Demo de agenda

```bash
# En el contenedor o local (con DATA_DIR apuntando a la DB deseada)
node src/demo.js
```

Crea `Clínica Demo SONRIDENT` y vincula los superadmins como doctor. Quitar
después desde el panel (eliminar/reiniciar consultorio).

## Producción

- URL: `https://sonrident.copaapp.cloud/admin`
- OAuth Google operativo. Configurar `SUPERADMIN_EMAILS` solo en Dokploy.
- Pendiente antes de datos reales: backup externo, 2FA, SMTP, política de privacidad.

## Verificación

- `npm test` en server: 15/15.
- `npm run build` en client: OK.
