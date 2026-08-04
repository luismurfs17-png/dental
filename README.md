# SONRIDENT

Portal móvil para consultorios dentales, pacientes y personal operativo. Cada
consultorio conserva sus pacientes, agenda, historial clínico y caja de forma
aislada.

## Funciones actuales

- Acceso con Google y autorización previa de pacientes por correo.
- Alta autónoma de un consultorio por su doctor propietario.
- Roles `doctor`, `operativo` y `paciente` con permisos separados.
- Agenda y reserva inmediata según horarios y disponibilidad real.
- Horarios ocupados visibles para pacientes sin exponer información de otras citas.
- Una reprogramación autónoma por cita hasta cinco horas antes; después se coordina por teléfono.
- Pacientes con código numérico heredado, único por consultorio y disponible en búsquedas.
- Tratamientos y precios en bolivianos (`Bs`).
- Saldos calculados desde citas atendidas y pagos válidos.
- Pago QR con evidencia; solo el doctor puede validarlo o anularlo.
- Confirmaciones, reprogramaciones y recordatorios opcionales por Gmail SMTP, además de notificaciones internas.
- Auditoría visual filtrable por usuario, fecha, paciente y acción.
- Borrado lógico y trazabilidad vinculada al paciente.

## Tecnología

- Node.js 22.
- Express 5 y SQLite con `better-sqlite3`.
- React 19 y Vite 7.
- Un contenedor Docker sirve API e interfaz por el puerto `3000`.

## Desarrollo local

Requisitos: Node.js 22 y npm.

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

Abrir `http://localhost:5173`. El acceso de desarrollo acepta estos datos
ficticios después de ejecutar la semilla:

- `doctora@sonrisas.test`
- `recepcion@sonrisas.test`
- `paciente@sonrisas.test`

El acceso de desarrollo no aparece ni funciona con `NODE_ENV=production`.

## Verificación

```bash
cd server
npm test

cd ../client
npm run build

cd ..
docker build -t sonrident:test .
```

La configuración de producción y Dokploy está documentada en
`DEPLOYMENT_RUNBOOK.md`. Los secretos nunca deben guardarse en Git.

El resumen funcional y técnico para continuar el trabajo está en
`PROJECT_CONTEXT.md`.
