---
title: Compatibilidad con navegadores
description: Droidpier es compatible con Chrome y Edge. Safari bloquea la conexión con el gateway local, y Firefox no es compatible.
sourceHash: f0d75b070eb1
---

| Navegador | Compatible |
|---|---|
| Google Chrome | Sí |
| Microsoft Edge | Sí |
| Safari | No |
| Firefox | No |

Las mediciones de la página de [requisitos](/es/docs/getting-started/requirements/#measured-performance) se tomaron en Chrome 157.

## Por qué Safari no funciona

La página se sirve por `https` y se conecta al gateway en tu Mac con `ws://127.0.0.1` (o `ws://localhost`), que no está cifrado. Safari lo trata como contenido mixto (una conexión insegura desde una página segura) y lo bloquea. La página no puede llegar al gateway en Safari.

## Firefox

Firefox no es compatible.

## Cómo comprueba la página el navegador

<!-- verify: phase 3 -->
La página lee `navigator.userAgentData.brands`. Continúa solo si la lista contiene `Google Chrome` o `Microsoft Edge`. De lo contrario, te pide abrir la página en Chrome o Edge y no intenta conectarse.

<!-- verify: phase 3 -->
Safari y Firefox no proporcionan `navigator.userAgentData`, así que se rechazan. Otros navegadores basados en Chromium que no informan la marca Chrome o Edge también se rechazan.

## Acceso a la red local en Chrome

<!-- verify: phase 3 -->
- Desde Chrome 147, una página pública `https` que se conecta a `localhost` primero debe obtener el permiso del usuario. Chrome lo pregunta una vez y recuerda la respuesta para el sitio.
- Desde Chrome 154, la página puede indicar que se está conectando a la dirección de loopback (`targetAddressSpace: "loopback"` al abrir el WebSocket). La página lo hace, y recurre a un WebSocket simple en las versiones que no admiten la opción.
- Desde Chrome 156, las políticas empresariales ya no pueden desactivar esta comprobación.

Si rechazaste el permiso, consulta [Solución de problemas](/es/docs/guides/troubleshooting/#chrome-blocked-local-network-access).
