# Auditoría de SONRIDENT

Fecha: 7 de agosto de 2026.
Autor: revisión técnica con soporte de IA.
Objetivo: inventariar la aplicación, identificar código muerto o en desuso y
dejar constancia del estado actual para decidir mejoras o simplificaciones
posteriores (posible enfoque en solo agenda/calendario).

## 1. Estado general

- Backend: Node 22, Express 5, SQLite WAL (`better-sqlite3`).
- Frontend: React 19, Vite 7.
- Producción: `https://sonrident.copaapp.cloud` (Dokploy, 1 réplica).
- Tests del servidor: **15/15 aprobados** (`npm test`).
- Build del cliente: **aprobado** (`npm run build`).
- Auditoría npm del servidor: **0 vulnerabilidades**.

## 2. Inventario backend

| Archivo | Líneas | Contenido |
|---|---|---|
| `server/src/routes/api.js` | 876 | ~57 endpoints: pacientes, citas, servicios, horarios, pagos, registros clínicos, notas, notificaciones, saldos, auditoría |
| `server/src/routes/admin.js` | 315 | Panel superadmin (11 endpoints) |
| `server/src/routes/auth.js` | 177 | Google OAuth + acceso de desarrollo |
| `server/src/schema.sql` | 210 | 13 tablas |
| `server/src/auth.js` | 96 | Sesión JWT, cookies, permisos |
| `server/src/backup.js` | 60 | Snapshots locales WAL-safe |
| `server/src/reminders.js` | 47 | Cron de recordatorios (requiere SMTP) |
| `server/src/email.js` | ~50 | Transporte Nodemailer (requiere SMTP) |
| `server/src/rateLimit.js` | 16 | Limitadores `/api/auth`, `/api/admin`, `/api` |
| `server/src/seed.js` | 67 | Datos ficticios de desarrollo |
| `server/src/demo.js` | 117 | Consultorio demo para presentación |
| `server/test/app.test.js` | 443 | Pruebas de integración (15) |

## 3. Inventario frontend

| Archivo | Líneas | Pantallas |
|---|---|---|
| `client/src/pages/team/TeamPages.jsx` | 1330 | Agenda, Pacientes, Servicios, Cobros, Notificaciones |
| `client/src/pages/team/PatientDetail.jsx` | 70 | Expediente clínico del paciente |
| `client/src/pages/team/Settings.jsx` | 82 | Consultorio, horarios, QR, equipo |
| `client/src/pages/team/Audit.jsx` | 83 | Auditoría |
| `client/src/pages/patient/PatientPages.jsx` | 213 | Portal paciente: reserva, citas, pagos, salud |
| `client/src/pages/admin/AdminPanel.jsx` | 219 | Panel superadmin |
| `client/src/components/UI.jsx` | ~80 | Componentes base |
| `client/src/components/Icon.jsx` | 49 | Iconos SVG |
| `client/src/components/AppShell.jsx` | — | Navegación por rol |
| `client/src/styles/global.css` | 312 | Estilos |
| `client/src/App.jsx` | 92 | Rutas y permisos |

## 4. Tablas de la base de datos (13)

`consultorios`, `usuarios`, `pacientes`, `servicios`, `horarios`, `citas`,
`registros_clinicos`, `notas_paciente`, `pagos`, `notificaciones`,
`auditoria`, `email_recordatorios`, `admin_auditoria`.

## 5. Limpieza de código muerto (realizada)

Se ejecutó un barrido automatizado de imports y exportaciones sin referencia
en todo el código (server + client) con los siguientes resultados:

| Hallazgo | Tipo | Acción |
|---|---|---|
| `asyncRoute` importado en `server/src/routes/api.js` sin ningún uso | Import muerto | **Eliminado** (la importación quedó como `ApiError, positiveNumber, required`) |
| `dotenv/config` en `config.js` | Import con efecto | Correcto (carga `.env`), sin cambios |
| `global.css` en `main.jsx` | Import con efecto | Correcto (estilos), sin cambios |
| `Metric`, `Modal`, `EmptyState`, `StatusPill`, `Toast`, `Field`, `PageHeader`, `Loading`, `ErrorState` | Exports de UI | Todos usados en páginas, sin cambios |
| `asyncRoute`, `positiveNumber`, `required` en `http.js` | Exports | Usados (asyncRoute en admin.js y auth.js), sin cambios |
| `requireAdmin` en `auth.js` | Export | Usado en `routes/admin.js`, sin cambios |
| `backupsDir`, `createSnapshot`, `pruneSnapshots`, `runBackup`, `startBackups` | Exports de backup | Todos usados, sin cambios |
| `email.js` / `reminders.js` | Módulos | **NO son código muerto**: están cableados en `index.js` y funcionan en cuanto se configuren `SMTP_*`. Se conservan (función futura del roadmap). |
| Iconos `chevronLeft`/`back` y `chevronRight`/`arrow` | Duplicados de path SVG | No son código muerto: nombres distintos usados por separado en la UI. Sin cambios. |
| Columna `activo` en `servicios` y `horarios` | Mecanismo doble con `eliminado_en` | Se usan en consultas (`h.activo=1`). Pendiente de evaluar en futura simplificación; NO se tocó. |

## 6. Código en desuso o inactivo (identificado, NO eliminado)

| Ítem | Estado | Razón para conservarlo |
|---|---|---|
| Correos SMTP (confirmación, reprogramación, recordatorios) | Inactivo (SMTP no configurado) | Funcionalidad prevista del roadmap |
| `npm run seed` en producción | Prohibido por diseño | Solo desarrollo |
| `npm run demo` | Script de presentación | Removible después de la demo desde `/admin` |

## 7. Riesgos y límites actuales

1. Sin SMTP: no salen confirmaciones/recordatorios de citas.
2. Sin backup externo (Restic→S3) y restauración no probada: la copia local
   vive en el mismo volumen.
3. 2FA pendiente en Google/GitHub/Dokploy/Hostinger.
4. Rate limiting: **activo** en `/api/auth`, `/api/admin`, `/api`.
5. SQLite: cómodo para 10–30 clínicas; migrar si >60–80, backups >2–3 GB o
   restauración >1 h. Una sola réplica.
6. React Router tiene aviso de auditoría; no ejecutar `npm audit fix --force`.
7. `TeamPages.jsx` (1330 líneas) es el archivo más grande; candidato a dividir
   en una futura refactorización, no bloquea nada.

## 8. Escenarios futuros (decisión del dueño)

- **A. Solo agenda interna**: quitar pagos/saldos/QR, historia clínica, notas,
  rol paciente y notificaciones → app ~40% más simple.
- **B. Agenda + ficha mínima de paciente**: como A conservando notas y datos
  básicos.
- **C. Mantener todo, solo mejorar**: refactorizar `TeamPages.jsx`, revisar
  doble mecanismo `activo`/`eliminado_en`, añadir tests de pagos.
- **D. Mantener completo**: añadir módulos de expansión (WhatsApp,
  presupuestos, odontograma, caja, reportes, consentimiento, link público).

Recomendación: probar la app con datos reales una semana y medir qué pantallas
se usan (existe tabla `auditoria`) antes de decidir entre A/B/C/D.

## 9. Verificación posterior a la limpieza

- `cd server && npm test` → **15/15 aprobados**.
- `cd client && npm run build` → **build aprobado**.
- `npm audit` (server) → **0 vulnerabilidades**.
- Cambio realizado: un único import sin uso eliminado en `api.js`; sin cambios
  de comportamiento ni de esquema.
