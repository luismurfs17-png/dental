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
- Correo: Gmail SMTP mediante Nodemailer (opcional).
- Rate limiting: `express-rate-limit` en `/api/auth`, `/api/admin` y `/api`.
- Producción: un contenedor Docker servido por Express en el puerto `3000`.
- Persistencia: `/app/data/dentista.sqlite` y `/app/data/uploads`.
- Usar una sola réplica mientras la base sea SQLite.

## Roles y permisos

### Superadministrador

- Se define por correo en `SUPERADMIN_EMAILS` (separados por coma); no se guarda como rol en la base.
- Conserva su cuenta y consultorio propios; `es_admin` solo añade el panel extra.
- Panel `Administrar` (`/admin` y `/api/admin/*`): métricas, consultorios, usuarios, invitaciones, exportar ZIP, reiniciar.
- Invita correos; el invitado queda `preautorizado` y al iniciar con Google se activa.
- No puede suspenderse ni eliminarse a sí mismo. Acciones en `admin_auditoria`.

### Doctor

- Agenda y citas; pacientes y datos clínicos; autoriza correos; tratamientos, precios, horarios, QR; valida pagos QR; cotizaciones; Auditoría; archiva registros.

### Operativo

- Agenda del consultorio; agenda visitas y elige doctor; crea/edita datos básicos de pacientes; registra pagos y notas y cotizaciones; no autoriza correos ni ve Auditoría.

### Paciente

- Solo su ficha, citas, historia, saldo y pagos; reserva en horarios libres; bloques ajenos como `Ocupado`; una reprogramación con ≥5 h de anticipación; reporta pagos QR.

## Reglas importantes

- Solo correos invitados por el superadmin pueden crear consultorio; auto-registro queda `pendiente`.
- Código de paciente: obligatorio, solo numérico, máx. 32 dígitos, único por consultorio (texto para ceros iniciales).
- Citas confirmadas de inmediato; API valida horario y conflictos.
- Cotizaciones: el precio de cada servicio es **opcional** (se define en consulta); los ítems salen del catálogo de tratamientos o como nombre libre, se añaden/quitan sin límite, y el total solo suma los ítems con precio. Estados: `borrador → entregado → aceptado` (o `archivado`).
- Pagos QR quedan `por_verificar`; solo el doctor marca `valido` o `anulado`.
- Saldo = citas atendidas − pagos válidos. Borrados lógicos y auditados.
- Tratamientos sin costo: el doctor define el precio de cada servicio (opcional, se reserva como "a definir"); el paciente los ve y reserva su primera consulta **sin pagar por adelantado**; el pago se reporta aparte por QR. `precio_bs` es NULL en `servicios` y `citas` cuando no hay costo.
- Modo de cobro del consultorio (`consultorios.modo_cobro`): `app` exige precio fijo en todos los tratamientos; `definir` los deja todos “a definir”; `mixto` (por defecto) permite ambos. El doctor lo elige en *Tu consultorio*.

## Correos

Con SMTP: confirmación al crear cita, aviso al reprogramar, recordatorio programado. Sin SMTP la app sigue y omite correos.

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

`SMTP_PASS` = contraseña de aplicación de Google (nunca la clave normal).

## Diseño

- Marca: `SONRIDENT`. Paleta: `#24577a`, `#45bfc4`, `#6672bd`.
- Responsive; en móvil menú `Más`. Respetar `prefers-reduced-motion`.

## Archivos clave

- `server/src/routes/api.js` — reglas principales.
- `server/src/routes/admin.js` — panel superadmin.
- `server/src/routes/auth.js` — Google OAuth y acceso desarrollo.
- `server/src/rateLimit.js` — limitadores de tasa.
- `server/src/backup.js` — snapshots locales.
- `server/src/demo.js` — consultorio demo de presentación (`npm run demo`).
- `server/src/schema.sql`, `db.js`, `email.js`, `reminders.js`, `seed.js`.
- `server/test/app.test.js` + `server/test/preload.mjs`.
- `client/src/App.jsx`, `pages/admin/AdminPanel.jsx`, `pages/team/*` (incl. `Quotes.jsx`), `pages/patient/*`.
- `DEPLOYMENT_RUNBOOK.md`, `SUPERADMIN_CONTEXT.md`.

## Desarrollo local

```bash
cd server && npm ci && copy .env.example .env && npm run seed && npm run dev
cd client && npm ci && npm run dev
```

- Frontend: `http://localhost:5173` · Backend: `http://localhost:3000` · Salud: `/api/health`.
- Dev logins: `doctora@sonrisas.test`, `recepcion@sonrisas.test`, `paciente@sonrisas.test`.

## Verificación

```bash
cd server && npm test
cd ../client && npm run build
```

Estado (agosto 2026): **18/18 tests** OK; build cliente OK; 0 vulnerabilidades npm en server.

## Estado del despliegue

- Repo: `https://github.com/luismurfs17-png/dental` (privado).
- Prod: `https://sonrident.copaapp.cloud`.
- Google OAuth **operativo** (login verificado). Superadmin por `SUPERADMIN_EMAILS`.
- Volumen `sonrident_data` → `/app/data`. Una réplica. Backups locales con cron si `BACKUP_ENABLED=true`.
- SMTP **no** configurado. Backup externo y restauración **pendientes**.

## Demo agenda (presentación)

1. Login Google como superadmin → `/admin` o portal doctor.
2. Cargar datos demo una vez en el contenedor: `node src/demo.js` (o `npm run demo` si el PATH tiene npm).
3. El script crea `Clínica Demo SONRIDENT` con pacientes 10001–10004, 3 servicios, horario lun–vie 08–17, citas de ayer/hoy/mañana/pasado y vincula los correos de `SUPERADMIN_EMAILS` como doctor.
4. Mostrar Agenda (semana/2 semanas/mes), nueva visita, reprogramación.
5. Quitar demo después: `/admin` → eliminar o reiniciar consultorio.

## Límites y riesgos actuales / futuros

**Listo para demo de agenda**

- OAuth, multi-tenant, agenda, pacientes, servicios, pagos QR, **cotizaciones sin precio obligatorio**, panel admin, rate limit, backups locales, tests verdes.
- **Enlace público de cotizaciones**: cada cotización tiene token único; el doctor lo comparte por WhatsApp o copiándolo, el paciente lo ve sin sesión (`/cotizacion/:token`), solo visible desde estado `entregado`/`aceptado` (borrador/archivado devuelven 404), se registra `compartido_en` y `visto_en` (primer vista audita; segundas no re-auditan), y el detalle muestra el recorrido de estados (timeline) con autor y fecha.

**Pendiente antes de datos reales de clientes**

1. Backup externo diario (Restic→S3 u equivalente) + **probar restauración**.
2. 2FA en Google, GitHub, Hostinger y Dokploy.
3. Cerrar acceso HTTP público al panel Dokploy.
4. Política de privacidad / consentimiento de historias clínicas.
5. Probar persistencia tras redesplegar (volumen).
6. SMTP (opcional para la demo; necesario para recordatorios reales).

**Límites técnicos**

- SQLite: 10–30 clínicas cómodo; migrar si >60–80, backups >2–3 GB o restore >1 h.
- Una sola réplica.
- Sin correos hasta configurar SMTP.
- No ejecutar `npm run seed` en producción de forma rutinaria; `demo.js` solo para presentación y es removible.
- React Router tiene aviso de auditoría; no usar `npm audit fix --force`.

**Módulos siguientes (expansión)**

WhatsApp (botón ya integrado en compartir) → presupuestos con abonos (convertir cotización a pagos) → odontograma → control de caja → reportes → consentimiento informado → link público de agendamiento.

## Criterio para continuar

Antes de tocar reglas sensibles: revisar multi-tenant y añadir prueba de integración. Tras cambios: `npm test` en server y `npm run build` en client.
