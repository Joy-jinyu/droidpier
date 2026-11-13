---
title: Seguridad
description: Cómo el gateway impide que otras páginas web y otras computadoras controlen tu emulador - solo loopback y una lista de orígenes permitidos.
sourceHash: 08642471687c
---

La página se sirve desde `droid.devpier.dev`, pero el emulador y el gateway se ejecutan en tu Mac. Cualquier página web que abras podría intentar conectarse a un programa en tu Mac, así que el gateway comprueba cada conexión.

## Solo loopback

El gateway escucha solo en `127.0.0.1`. No acepta conexiones de tu red local ni de internet. Otras computadoras no pueden llegar a él.

## Lista de orígenes permitidos

<!-- verify: phase 3 -->
Los navegadores envían un encabezado `Origin` cuando una página abre un WebSocket, y una página web no puede falsificarlo. El gateway acepta conexiones solo de la página pública en `droid.devpier.dev` y de su propia página local, es decir, solo de estos orígenes:

- `https://droid.devpier.dev`
- `http://127.0.0.1:<port>`
- `http://localhost:<port>`

<!-- verify: phase 3 -->
Una conexión con cualquier otro origen, o sin origen, se cierra con el código `4003`. Una página de otro sitio no puede controlar tu emulador, aunque adivine el puerto.

## Cómo la página encuentra el gateway

<!-- verify: phase 3 -->
- Mientras ningún gateway responda, la página en `droid.devpier.dev/app/` lo busca una vez por segundo y se conecta en cuanto se ejecuta `droidpier`. No lo busca mientras la pestaña está en segundo plano.
- Usa el puerto `7300`, o el puerto que va después de `#port=` en la dirección. El gateway agrega `#port=<port>` a la dirección que abre solo cuando no se ejecuta en el puerto `7300`.
- La página no guarda el puerto en el navegador.

## El sitio web no se conecta a tu Mac

<!-- verify: phase 3 -->
El permiso de red local de Chrome y la comprobación de Origin del gateway funcionan por sitio, no por ruta. Por eso, las páginas de documentación comparten el permiso con la página del emulador en `/app/`. Para limitar lo que eso implica:

- Solo la página del emulador en `/app/` se conecta al gateway. La página de inicio y esta documentación nunca lo hacen, así que leerlas no activa el aviso de permiso.
- El sitio no carga scripts, estilos, fuentes ni contenido multimedia de terceros. Todo se sirve desde `droid.devpier.dev`.

## Instalación de software

<!-- verify: phase 3 -->
El gateway nunca instala paquetes del Android SDK ni crea dispositivos sin preguntar. Confirmas cada instalación o dispositivo nuevo en la página, después de que te muestra qué se va a descargar y dónde. La página muestra las licencias de Google completas, y un elemento solo se instala si aceptas. Las herramientas de línea de comandos 23 o posteriores pueden aceptar las licencias sin preguntar; la página te lo indica antes de que confirmes. El gateway no pregunta nada en Terminal.

## Códigos de cierre de conexión

<!-- verify: phase 3 -->
| Código | Significado |
|---|---|
| `4000` | El primer mensaje no fue `hello`. |
| `4002` | La página y el gateway usan versiones de protocolo diferentes. |
| `4003` | Origen no permitido. |

## Reportar un problema

Abre un issue en [github.com/twosugar/droidpier](https://github.com/twosugar/droidpier/issues).
