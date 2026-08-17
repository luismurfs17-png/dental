---
name: diagnostico-correos-citas
description: Use when the user reports that appointment confirmation or reminder (re-confirmation) emails were not received, when investigating send history (envios_notificacion / email_recordatorios), or when editing reminders.js, email.js or the reminder cron. Includes the known timezone and better-sqlite3 pitfalls of the reminder system.
---

# SKILL — Diagnóstico y Corrección de Correos de Citas

## OBJETIVO

Resolver por qué no llegan los correos de **confirmación** o **recordatorio (re-confirmación)** de citas, y aplicar correcciones sin romper el flujo existente.

## CÓMO FUNCIONA EL FLUJO

- **Confirmación**: se envía al crear la cita (`POST /citas` → `sendAppointmentEmail(id, 'confirmacion')`). También en reprogramaciones (`'reprogramacion'`).
- **Recordatorio**: un cron (`startReminders` en `server/src/reminders.js`) revisa cada hora las citas que ya entraron en su ventana y llama `sendReminderEmail`.
- **Registro**: cada intento queda en `envios_notificacion` (tipo `confirmacion`/`recordatorio`, estado `enviado`/`error` + mensaje). Los recordatorios además registran `email_recordatorios`.
- **Dónde los ve el usuario**: Ajustes → Correos de tu clínica → Historial de envíos (✓ enviado / ✗ error).

## DIAGNÓSTICO EN ORDEN

1. **Historial de envíos** (UI o `GET /api/correo/envios`):
   - `✓ enviado` → el correo salió del servidor; revisar Spam (remitente genérico cae en spam).
   - `✗ error` → el mensaje de error indica el fallo (credenciales SMTP, OAuth de Gmail, etc.).
   - **Sin fila** → nunca se intentó enviar. Causas:
     a. El paciente **no tiene correo** registrado o tiene `recordatorios_activos=0` (aplica a ambos correos).
     b. **Sin SMTP configurado** (ni global `SMTP_*` ni `consultorio_email` propio) → `sendEmail` retorna `false` sin registrar nada.
     c. El **cron de recordatorios está desactivado** (`anyEmailConfigured()` falso) o **muere cada tick** (ver trampa 1).

2. **Configuración de correo**: global (`server/.env`: `SMTP_HOST/USER/PASS`, `REMINDER_CRON`) o por consultorio (`consultorio_email` con `modo='propio'`, OAuth Gmail o SMTP).

3. **Reproducir**: `node --input-type=module -e "import { dueReminderRows } from './src/reminders.js'; console.log(dueReminderRows())"` desde `server/` (debe correr sin lanzar excepción).

## TRAMPAS CONOCIDAS (CORRECCIÓN APLICADA)

### 1. Cron que muere en silencio por parámetro extra en better-sqlite3

**Síntoma**: ninguna confirmación se envía vía cron, sin error visible; `envios_notificacion` vacío para recordatorios.

**Causa**: `db.prepare(sql).all('+24 hours')` con un SQL **sin placeholders `?`** → better-sqlite3 lanza `RangeError: Too many parameter values were provided` en cada tick → el cron nunca envía nada.

**Regla**: nunca pasar más argumentos que placeholders. Los parámetros deben estar enlazados con `?` en el SQL.

### 2. Zona horaria: las citas se guardan en UTC

`citas.inicio` se almacena con `start.toISOString()` (**UTC**). La lógica que use horas locales sin convertir dará desfases de 4 h (Bolivia = UTC−4, sin DST). Referencia: `GET /citas` usa `date(c.inicio,'-4 hours')`.

Ventanas correctas del modo inteligente (todo en UTC):

| Cita local | Umbral UTC | Significado local |
|---|---|---|
| Antes de las 12:00 (hora UTC < `'16'`) | `date(c.inicio) || ' 00:00:00'` | día previo a las **20:00** |
| Desde las 12:00 (hora UTC ≥ `'16'`) | `date(c.inicio) || ' 12:00:00'` | mismo día a las **08:00** |

- `strftime('%H', c.inicio) >= '16'` ⇔ hora local ≥ 12:00.
- Horas fijas (`recordatorio_horas`): comparar `datetime(c.inicio) <= datetime(?, '+' || recordatorio_horas || ' hours')` — ambos lados UTC, correcto.
- El cron `0 * * * *` (por defecto) corre en punto de cada hora UTC = en punto de cada hora local; la ventana de las 20:00 local coincide con el tick de las 00:00 UTC.

### 3. Recordatorios desactivados sin SMTP

`startReminders` no arranca si `anyEmailConfigured()` es falso (sin SMTP global y sin ningún `consultorio_email` activo). No es un bug: la app no puede enviar sin proveedor.

## VERIFICACIÓN DESPUÉS DE UN CAMBIO

1. `npm test` en `server/` (debe pasar el test `recordatorios: horario inteligente respeta la hora local de La Paz y las horas fijas`, que valida las 4 ventanas con reloj controlado + horas fijas).
2. Smoke local: `dueReminderRows()` sin excepción.
3. En producción: redeploy en Dokploy y comprobar Historial de envíos con un tick del cron.

## REGLA DE SEGURIDAD

- No cambiar el formato de almacenamiento de `citas.inicio` (es UTC en toda la app).
- No enviar correos "de prueba" a pacientes reales.
- No tocar `templates.js`/`email.js` si el problema es solo de ventana o cron.