# Contexto de continuidad de SONRIDENT

Documento breve para continuar el proyecto en otra sesión o con otro agente.

## Producto

SONRIDENT es un portal en español para consultorios dentales. Es multi-consultorio: cada clínica conserva aislados sus usuarios, pacientes, citas, historia clínica, pagos, archivos y auditoría.

No tiene landing page. La aplicación abre directamente en el acceso o en el portal correspondiente al rol.

## Tecnología

- Node.js 22.
- Backend: Express 5 y SQLite WAL con `better-sqlite3`.
- Frontend: React 19 y Vite 7.
- Autenticación: Google OAuth 2.0 y cookie JWT HTTP-only.
- Correo: Gmail SMTP mediante Nodemailer.
- Producción: un contenedor Docker servido por Express en el puerto `3000`.
- Persistencia: `/app/data/dentista.sqlite` y `/app/data/uploads`.
- Usar una sola réplica mientras la base sea SQLite.

## Roles y permisos

### Superadministrador

- Se define por correo en la variable `SUPERADMIN_EMAILS` (separados por coma); no se guarda como rol en la base de datos.
- Conserva su cuenta y consultorio propios si ya los tiene; la bandera `es_admin` solo añade el panel extra.
- Ve el panel `Administrar` (`/admin` y `GET/POST /api/admin/*`): métricas, consultorios, usuarios e invitaciones.
- Invita correos (`POST /api/admin/invitaciones`); el invitado queda `preautorizado` y al iniciar con Google se activa y puede crear su consultorio.
- Cambia estado (`activo`/`suspendido`/`pendiente`/`preautorizado`) o elimina usuarios; suspendidos y eliminados pierden el acceso.
- Puede eliminar un consultorio completo (borrado lógico del consultorio y de sus usuarios).
- Sus acciones quedan en la tabla `admin_auditoria`.
- No puede suspenderse ni eliminarse a sí mismo.

### Doctor

- Control de su agenda y citas.
- Crea y edita pacientes, códigos y datos clínicos.
- Autoriza correos de pacientes.
- Configura tratamientos, precios, horarios, QR y consultorio.
- Valida o anula pagos QR.
- Consulta Auditoría.
- Archiva pacientes, citas y otros registros permitidos.

### Operativo

- Consulta la agenda completa del consultorio.
- Agenda visitas manualmente y selecciona doctor.
- Crea y edita datos básicos de pacientes.
- Asigna o modifica el código numérico del sistema anterior.
- Registra pagos y notas operativas.
- Los registros clínicos que crea quedan pendientes de validación.
- No autoriza correos, modifica datos clínicos protegidos, cambia precios ni consulta Auditoría.

### Paciente

- Solo consulta su propia ficha, citas, historia, saldo y pagos.
- Reserva citas en horarios disponibles.
- Ve horarios ocupados únicamente como `Ocupado`, sin datos de otros pacientes, servicios, motivos o contactos.
- Puede reprogramar una cita una sola vez y únicamente con al menos 5 horas de anticipación.
- Dentro de las últimas 5 horas debe llamar al consultorio.
- Puede reportar pagos QR con evidencia.

## Reglas importantes

- Solo los correos invitados por el superadministrador pueden crear un consultorio; quien se auto-registra queda `pendiente` y sin acceso hasta recibir invitación.
- El código del paciente es obligatorio, solo numérico, máximo 32 dígitos y único por consultorio.
- Se almacena como texto para conservar ceros iniciales.
- La búsqueda prioriza código exacto, luego prefijo y después coincidencias parciales.
- Las citas se confirman inmediatamente.
- La API valida horario del doctor y conflictos antes de crear o reprogramar.
- Doctor y operativo pueden crear visitas desde el botón `Nueva visita` o haciendo clic en una franja vacía del calendario.
- El calendario del equipo muestra inicio y finalización de cada cita.
- El paciente no recibe información privada de bloques ocupados.
- Pagos QR quedan `por_verificar`; solo el doctor puede marcarlos `valido` o `anulado`.
- El saldo considera citas atendidas menos pagos válidos.
- Los borrados relevantes son lógicos y quedan auditados.
- Auditoría es exclusiva del doctor y filtra por usuario, paciente, fecha y acción.

## Correos

Con SMTP configurado se envían:

- Confirmación al crear una cita.
- Aviso al reprogramar una cita, tanto por paciente como por personal.
- Recordatorio programado antes de la cita.

Una reprogramación elimina el marcador del recordatorio anterior para permitir el aviso del nuevo horario. Si SMTP no está configurado, la aplicación continúa funcionando y omite los correos.

Variables principales:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM="SONRIDENT <correo@gmail.com>"
REMINDER_CRON=0 * * * *
REMINDER_HOURS=24
```

`SMTP_PASS` debe ser una contraseña de aplicación de Google, nunca la contraseña normal.

## Diseño

- Marca visible: `SONRIDENT`.
- Paleta principal: azul `#24577a`, turquesa `#45bfc4` y lavanda `#6672bd`.
- Interfaz responsive para escritorio, tablet y móvil.
- En móvil hay navegación principal y menú `Más` con todas las rutas y cierre de sesión.
- Se adaptaron efectos moderados inspirados en Magic UI bajo licencia MIT.
- Respetar `prefers-reduced-motion` y evitar animaciones que dificulten tareas clínicas.

## Archivos clave

- `server/src/routes/api.js`: rutas, permisos y reglas principales.
- `server/src/routes/admin.js`: panel del superadministrador (invitaciones, consultorios, usuarios).
- `server/src/routes/auth.js`: Google OAuth y acceso de desarrollo.
- `server/src/schema.sql`: esquema SQLite.
- `server/src/db.js`: apertura, migraciones incrementales y auditoría.
- `server/src/email.js`: transporte SMTP y correos de citas.
- `server/src/reminders.js`: cron de recordatorios.
- `server/src/seed.js`: datos ficticios.
- `server/test/app.test.js`: pruebas de integración.
- `client/src/App.jsx`: rutas y permisos frontend.
- `client/src/pages/admin/AdminPanel.jsx`: centro de control del superadministrador.
- `client/src/components/AppShell.jsx`: navegación por rol.
- `client/src/pages/team/TeamPages.jsx`: agenda, pacientes, servicios, caja y avisos.
- `client/src/pages/team/Audit.jsx`: pantalla de Auditoría.
- `client/src/pages/team/PatientDetail.jsx`: expediente del paciente.
- `client/src/pages/patient/PatientPages.jsx`: portal, reservas, citas, pagos y salud.
- `client/src/styles/global.css`: diseño y responsive.
- `Dockerfile`: build de React y runtime Node 22.
- `DEPLOYMENT_RUNBOOK.md`: configuración detallada de Dokploy.

## Desarrollo local

Backend:

```bash
cd server
npm ci
copy .env.example .env
npm run seed
npm run dev
```

Frontend:

```bash
cd client
npm ci
npm run dev
```

URLs:

- Frontend: `http://localhost:5173`.
- Backend: `http://localhost:3000`.
- Salud: `http://localhost:3000/api/health`.

Accesos ficticios de desarrollo:

- `doctora@sonrisas.test`.
- `recepcion@sonrisas.test`.
- `paciente@sonrisas.test`.

El acceso de desarrollo está deshabilitado en producción.

## Verificación actual

```bash
cd server
npm test

cd ../client
npm run build
```

Estado verificado:

- 12 pruebas del servidor aprobadas.
- Build del frontend aprobado.
- Auditoría npm del servidor: 0 vulnerabilidades.
- Frontend y API locales responden `200`.
- Docker no está instalado en esta máquina; la imagen no se ha probado localmente.
- El cliente conserva un aviso de React Router relacionado con RSC. SONRIDENT es una SPA y no usa RSC. No ejecutar `npm audit fix --force`.

## Estado del despliegue

- Repositorio privado: `https://github.com/luismurfs17-png/dental`.
- Producción: `https://sonrident.copaapp.cloud`.
- Commit desplegado: `f568d6109cacf2a57ba0bcd52ba87372ddfeda9f`.
- Dokploy usa Dockerfile raíz, contexto `.`, puerto interno `3000` y una réplica.
- El volumen `sonrident_data` está montado en `/app/data`.
- La SPA, HTTPS y `GET /api/health` están verificados.
- Google OAuth y Gmail SMTP siguen pendientes; el acceso normal todavía no funciona.
- También faltan la prueba de persistencia tras redespliegue, backup externo,
  restauración y validación funcional completa.
- El proceso detallado y los pasos exactos para continuar están en
  `DEPLOYMENT_RUNBOOK.md`, sección "Estado del despliegue del 4 de agosto de 2026".

## Criterio para continuar

Antes de modificar una regla sensible, revisar permisos multi-tenant y añadir una prueba de integración. Después de cambios ejecutar siempre `npm test` en `server` y `npm run build` en `client`.

## Módulos 1 y 2 completados (agosto 2026)

### Módulo 1: Backup y exportación

- **Backup local**: `server/src/backup.js` genera snapshots WAL-safe con `db.backup()` + copia de `uploads/` en `data/backups/`.
- Variables: `BACKUP_ENABLED`, `BACKUP_CRON`, `BACKUP_RETENTION_LOCAL`.
- Integrado en `server/src/index.js` junto a reminders.
- **Exportación ZIP**: `GET /api/admin/consultorios/:id/exportar` genera ZIP con JSON, HTML y evidencias.

### Módulo 2: Panel superadmin enriquecido

- **Listado enriquecido**: `GET /api/admin/consultorios` ahora incluye `estado_actividad`, `ingresos_total`, `ultima_actividad`.
- **Detalle**: `GET /api/admin/consultorios/:id` con próximas citas, últimos pagos, evidencias.
- **Auditoría**: `GET /api/admin/auditoria` con filtros por fecha y acción.
- **Reinicio**: `POST /api/admin/consultorios/:id/reiniciar` vacía pacientes/citas/pagos conservando usuarios y configuración. Snapshot previo de seguridad.
- **Panel UI**: `client/src/pages/admin/AdminPanel.jsx` con badges de actividad, botones de detalle, exportar, reiniciar.

### Archivos nuevos

- `server/src/backup.js`: módulo de backups.
- `server/src/routes/admin.js`: rutas del panel superadmin enriquecido.
- `client/src/pages/admin/AdminPanel.jsx`: UI del panel.
- `SUPERADMIN_CONTEXT.md`: contexto detallado del rol superadmin.

### Próximos pasos

1. **Producción**: Configurar `SUPERADMIN_EMAILS`, Google OAuth y backup externo en Dokploy.
2. **Tests**: Los tests automatizados tienen un problema con NODE_ENV en ESM que requiere solución (loader personalizado o reestructuración de imports).
3. **Módulos siguientes**: WhatsApp, presupuestos con abonos, odontograma, control de caja, reportes, consentimiento informado, link público de agendamiento.
4. **Infraestructura**: Rate limiting, 2FA, política de privacidad.
