---
name: deploy-sonrident-dokploy
description: SONRIDENT, Dokploy, Docker, Node 22 y SQLite deployment. Usar cuando se necesite desplegar, diagnosticar, respaldar o configurar esta aplicación dental en GitHub, Dokploy o el VPS de producción.
---

# Deploy SONRIDENT Dokploy

## Fuente obligatoria

Leer `DEPLOYMENT_RUNBOOK.md`, `README.md`, `Dockerfile`, los dos
`package.json` y `server/.env.example` antes de cambiar o desplegar. El runbook
específico prevalece sobre ejemplos de otros proyectos.

## Parámetros fijos verificados

- Runtime: Node.js 22.
- Build: Dockerfile raíz, contexto `.`.
- Puerto interno: `3000`.
- Health: `/api/health`.
- Persistencia: volumen nombrado en `/app/data`.
- Base: `/app/data/dentista.sqlite` con WAL.
- Archivos: `/app/data/uploads`.
- Réplicas: exactamente una mientras se use SQLite.
- Proceso: usuario no root y cierre por `SIGTERM`.

## Flujo

1. Revisar Git, lockfiles, Dockerfile y ausencia de secretos/datos.
2. Ejecutar pruebas del servidor y build del cliente.
3. Construir Docker y comprobar health y una función real.
4. Confirmar repositorio, rama, dominio, volumen y variables con el usuario.
5. Tratar push y Deploy como operaciones de producción; no ejecutarlas sin
   solicitud clara.
6. Verificar commit, HTTPS, OAuth, reserva, pago QR y persistencia.

## Límites críticos

- No ejecutar el seed ficticio en producción.
- No copiar configuración, dominio, volumen o secretos de COPAMODA.
- No guardar `.env`, SQLite, QR ni evidencias en Git.
- No borrar volúmenes ni usar comandos destructivos para corregir errores.
- No afirmar éxito sin comprobar el endpoint, Google OAuth, una reserva y los
  datos después de un redespliegue.
- Crear backup antes de cambiar esquema o volumen.

## Entrega

Informar commit, dominio, variables no secretas, volumen, health, pruebas,
persistencia y cualquier punto no verificado. Si faltan repositorio, dominio o
acceso al panel, detener el despliegue y pedir únicamente esos datos.
