# Continuidad: migracion a clinicas.copaapp.cloud

Actualizado: 13 de agosto de 2026.

## Objetivo

Usar `https://clinicas.copaapp.cloud` como dominio neutral de la plataforma y
mantener una URL automatica para cada consultorio:

```text
https://clinicas.copaapp.cloud/c/<slug>
```

## Estado completado

- DNS `A` creado: `clinicas.copaapp.cloud` apunta a `76.13.253.130`.
- DNS validado por Dokploy.
- Dominio agregado en Dokploy con path `/`, puerto `3000`, HTTPS y Let's Encrypt.
- Health de produccion responde correctamente:

  ```text
  https://clinicas.copaapp.cloud/api/health
  ```

  Respuesta esperada:

  ```json
  {"estado":"saludable","base_de_datos":"sqlite"}
  ```

- Google Cloud tiene configurado el origen JavaScript:

  ```text
  https://clinicas.copaapp.cloud
  ```

- Google Cloud tiene estas URI de redireccion autorizadas:

  ```text
  https://clinicas.copaapp.cloud/api/auth/google/callback
  https://sonrident.copaapp.cloud/api/auth/google/callback
  ```

- Commit desplegado: `a5a26a7`.
- Docker build en Dokploy finalizo correctamente.
- La aplicacion ya responde CORS para `https://clinicas.copaapp.cloud`.

## Problema actual

El acceso con Google muestra:

```text
Error 400: redirect_uri_mismatch
```

Esto significa que la URI enviada por la aplicacion no coincide exactamente con
una URI autorizada en Google Cloud. No es un problema del DNS, SQLite ni del
certificado HTTPS.

## Siguiente paso exacto

1. Abrir Dokploy.
2. Entrar a `DENTISTA` -> `production` -> servicio `sonrident`.
3. Abrir la pestana `Environment`.
4. Confirmar que la variable tenga exactamente este valor, sin espacios ni `/`
   adicional al final:

   ```env
   GOOGLE_CALLBACK_URL=https://clinicas.copaapp.cloud/api/auth/google/callback
   ```

5. Confirmar tambien:

   ```env
   CLIENT_URL=https://clinicas.copaapp.cloud
   ```

6. Guardar las variables.
7. Ejecutar un redeploy completo en Dokploy.
8. Esperar a que el deployment figure como `Done` y el contenedor como
   `Running`.
9. Esperar unos minutos por la propagacion de Google OAuth.
10. Borrar las cookies de `clinicas.copaapp.cloud` o abrir una ventana privada.
11. Probar:

    ```text
    https://clinicas.copaapp.cloud/login
    ```

## Si el error continua

Abrir `Detalles del error` en la pantalla de Google y copiar el valor exacto de
`redirect_uri`. Compararlo caracter por caracter con:

```text
https://clinicas.copaapp.cloud/api/auth/google/callback
```

Tambien revisar los logs del contenedor en Dokploy durante un intento de acceso.
No compartir ni guardar en capturas el valor de `GOOGLE_CLIENT_SECRET`,
`JWT_SECRET` o cualquier otro secreto.

## Verificaciones despues de resolver OAuth

1. Entrar con la cuenta superadmin.
2. Confirmar que la redireccion final permanece en `clinicas.copaapp.cloud`.
3. Abrir la URL de un consultorio: `/c/<slug>`.
4. Verificar nombre, logo, colores, QR y enlace de instalacion PWA.
5. Probar aislamiento entre consultorios.
6. Probar una reserva, evidencia QR y validacion de pago.
7. Redesplegar y confirmar persistencia del volumen `/app/data`.

## Precauciones

- No borrar el historial de deployments para corregir OAuth.
- No borrar ni recrear el volumen `sonrident_data`.
- Mantener una sola replica mientras se use SQLite.
- Conservar temporalmente el dominio `sonrident.copaapp.cloud` hasta completar
  las pruebas del dominio nuevo.
