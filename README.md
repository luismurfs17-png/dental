# SONRIDENT

Portal móvil para consultorios dentales, pacientes y personal operativo. Cada
consultorio conserva sus pacientes, agenda, historial clínico y caja de forma
aislada.

Producción: https://sonrident.copaapp.cloud

Dominio neutral previsto: `https://clinicas.copaapp.cloud`. Cada consultorio
recibe una PWA instalable en `/c/<slug>` con su nombre, logo y colores.

## Funciones actuales

- Acceso con Google OAuth y cookie JWT HTTP-only.
- Superadministrador (`SUPERADMIN_EMAILS`) con panel `/admin`.
- Alta de consultorio solo con invitación previa del superadmin.
- Roles `doctor`, `operativo` y `paciente` con permisos separados.
- Agenda y reserva inmediata según horarios y disponibilidad real.
- Vistas semana / 2 semanas / mes, arrastrar y soltar citas.
- Horarios ocupados visibles para pacientes sin exponer datos ajenos.
- Una reprogramación autónoma por cita hasta cinco horas antes.
- Pacientes con código numérico único por consultorio.
- Tratamientos y precios en bolivianos (`Bs`).
- Saldos desde citas atendidas y pagos válidos.
- Pago QR con evidencia; solo el doctor valida o anula.
- Backups locales WAL-safe + exportación ZIP por consultorio.
- Rate limiting en `/api/auth`, `/api/admin` y `/api`.
- Auditoría filtrable y borrado lógico.
- PWA instalable por consultorio, con enlace y QR automáticos.

## Tecnología

- Node.js 22, Express 5, SQLite (`better-sqlite3` WAL).
- React 19 y Vite 7.
- Un contenedor Docker sirve API e interfaz en el puerto `3000`.

## Desarrollo local

```bash
cd server
npm ci
copy .env.example .env
npm run seed
npm run dev
```

En otra terminal:

```bash
cd client
npm ci
npm run dev
```

Abrir `http://localhost:5173`. Accesos ficticios tras la semilla:

- `doctora@sonrisas.test`
- `recepcion@sonrisas.test`
- `paciente@sonrisas.test`

El acceso de desarrollo no funciona con `NODE_ENV=production`.

Consultorio demo (datos de presentación de agenda):

```bash
cd server
npm run demo
```

## Verificación

```bash
cd server
npm test

cd ../client
npm run build
```

Estado verificado (agosto 2026): **24/24 tests**, smoke de producción y builds OK.

## Demo de agenda (presentación)

1. Entrar en https://sonrident.copaapp.cloud con Google (superadmin).
2. Si aún no hay consultorio propio: completar onboarding o ejecutar `npm run demo` en el contenedor (una vez).
3. Revisar Agenda (semana / 2 semanas / mes): citas de hoy, mañana y pasado.
4. Crear visita desde franja vacía o botón «Nueva visita».
5. Mostrar pacientes, servicios y reprogramación.

Detalle y límites en `PROJECT_CONTEXT.md` y `DEPLOYMENT_RUNBOOK.md`.

## Límites y riesgos actuales

| Tema | Estado |
|---|---|
| Agenda, pacientes, citas, pagos QR, cotizaciones | Operativo |
| Google OAuth en producción | Operativo |
| Correos (confirmación / recordatorio) | **Desactivado** (SMTP no configurado) |
| Backup local (cron 03:00, retención 3) | Activo si `BACKUP_ENABLED=true` |
| Backup externo (Restic→S3) | **Pendiente** — crítico antes de datos reales |
| Restauración de backup | **No probada** |
| 2FA en Google/GitHub/Dokploy/Hostinger | **Pendiente** (acción manual) |
| Rate limiting API | Activo |
| Escala SQLite | Bien para 10–30 clínicas; migrar si >60–80 |
| Réplicas | Solo 1 con SQLite |
| Módulos futuros | WhatsApp, presupuestos con abonos, odontograma, caja, reportes, consentimiento, link público |

## Documentación

- `PROJECT_CONTEXT.md` — continuidad del producto y módulos.
- `DEPLOYMENT_RUNBOOK.md` — Dokploy, variables, backups, demo en prod.
- `SUPERADMIN_CONTEXT.md` — panel superadmin.
