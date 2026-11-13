---
title: Primera ejecución
description: Inicia el gateway con un solo comando, deja que revise el Android SDK, permite el acceso a la red local en Chrome y ve tu emulador en el navegador.
sourceHash: c1c836eb6e73
---

Ejecuta un comando en Terminal, abre `https://droid.devpier.dev/app/` y permite el acceso a la red local cuando Chrome lo pida.

## 1. Inicia el gateway

```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh
```

Instala o actualiza el gateway si hace falta y lo inicia. Consulta [Instalación](/es/docs/getting-started/install/). Después de instalarlo, `droidpier start` también lo inicia.

El gateway se ejecuta en segundo plano. Puedes cerrar la ventana de Terminal.

El gateway escucha en `127.0.0.1`, en el puerto `7300` de forma predeterminada. Para usar otro puerto, consulta [Línea de comandos](/es/docs/reference/cli/).

## 2. Deja que revise tu Android SDK {#2-let-it-check-your-android-sdk}

<!-- verify: phase 3 -->
Al iniciarse, el gateway comprueba si un dispositivo puede arrancar: necesita el emulador de Android (`emulator`), `adb` de `platform-tools` y al menos un dispositivo virtual (AVD) cuya imagen del sistema esté instalada. Sirve cualquier versión de Android. Si falta algo, muestra cada elemento en Terminal y te indica que termines la configuración en la página. No pregunta nada en Terminal.

Cuando el gateway se ejecuta en segundo plano, esta lista va a su registro. Ejecuta `droidpier logs` para verla.

<!-- verify: phase 3 -->
La página muestra la misma lista, con el tamaño de descarga de cada elemento. Cuando un dispositivo puede arrancar, no muestra nada.

| Falta | Qué haces en la página |
|---|---|
| `emulator`, `platform-tools`, imagen del sistema | Instala un elemento con el botón que tiene al lado, o instálalos todos a la vez. Si no hay ninguna imagen del sistema instalada, la página ofrece Android 14 (`system-images;android-34;google_apis;arm64-v8a`). Si se eliminó la imagen del sistema de un dispositivo, la página indica qué dispositivo es y ofrece esa imagen. |
| No hay dispositivos | Crea un dispositivo: elige un modelo de dispositivo y una versión de Android. Si ya hay una imagen del sistema instalada, la página la sugiere en lugar de descargar Android 14. |

No necesitas Java ni las herramientas de línea de comandos (`sdkmanager`, `avdmanager`). El gateway descarga cada parte del repositorio del SDK de Google, la misma fuente que usa Android Studio, y crea la carpeta del SDK si aún no existe.

<!-- verify: phase 3 -->
No se descarga ni se crea nada hasta que confirmas en la página. Antes de empezar, la página muestra qué va a descargar, dónde lo instala y cuánto espacio en disco necesita. Antes de cada descarga, la página muestra la licencia de Google completa, y el elemento solo se instala si aceptas. Como Android Studio, el gateway guarda tu aceptación en la carpeta `licenses` del SDK y comprueba cada descarga con la suma de verificación que publica Google antes de descomprimir nada.

Si prefieres instalar un elemento tú mismo, despliega la sección de instalación manual debajo de él en la página. Indica dónde encontrarlo en Android Studio y dónde se instala.

## 3. Abre la página {#3-open-the-page}

<!-- verify: phase 3 -->
Abre `https://droid.devpier.dev/app/` en Chrome o Edge. Cuando el gateway se inicia, también muestra esta dirección y la abre en tu navegador predeterminado. Si tu navegador predeterminado no es Chrome ni Edge, abre tú mismo la dirección en Chrome o Edge.

La página se conecta sola. Mientras ningún gateway responda, comprueba una vez por segundo y se conecta en cuanto el gateway se inicia, sin recargar. No comprueba mientras la pestaña está en segundo plano.

Si el gateway no se ejecuta en el puerto `7300`, la dirección que muestra termina en `#port=<port>`:

```text
https://droid.devpier.dev/app/#port=7301
```

Abre esa dirección para que la página encuentre el puerto correcto.

## 4. Permite el acceso a la red local {#4-allow-local-network-access}

<!-- verify: phase 3 -->
La primera vez que la página se conecta al gateway en tu Mac, Chrome muestra un aviso de permiso que pregunta si `droid.devpier.dev` puede acceder a tu red local. Haz clic en **Permitir**. Chrome recuerda la elección para el sitio.

Si lo rechazaste, consulta [Solución de problemas](/es/docs/guides/troubleshooting/#chrome-blocked-local-network-access).

## 5. Usa el emulador

Si ya hay un emulador en ejecución con gRPC, la página muestra su pantalla.

<!-- verify: phase 2 -->
De lo contrario, elige un dispositivo de la lista e inícialo. Consulta [Dispositivos](/es/docs/guides/devices/).

Haz clic en la pantalla para darle el foco del teclado. Luego:

- Haz clic para tocar; arrastra para deslizar.
- Escribe con el teclado de tu Mac. Consulta [Teclado y entrada](/es/docs/guides/keyboard-and-input/).
- Usa los botones Atrás, Inicio y Recientes que están sobre la pantalla.

## Detener

Ejecuta `droidpier stop`. Si iniciaste el gateway con `droidpier` en una ventana de Terminal, presiona `Ctrl+C` allí. Los emuladores en ejecución siguen funcionando. La próxima vez que inicies el gateway, con el mismo comando o con `droidpier start`, se vuelve a conectar a ellos.

## La página local de respaldo

El gateway también sirve la misma página en `http://127.0.0.1:7300/app/` (o en el puerto que elegiste). Úsala si la página pública no carga o no puede conectarse.

Para que el gateway abra la página local en lugar de la pública, inícialo con `--local`:

```sh
droidpier --local
```
