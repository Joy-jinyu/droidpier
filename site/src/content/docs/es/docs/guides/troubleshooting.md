---
title: Solución de problemas
description: Resuelve problemas comunes - Chrome bloqueó el acceso a la red local, puerto en uso, no se encontró ningún emulador, la página no se conecta, versiones que no coinciden.
sourceHash: 0b338512d1e9
---

## Chrome bloqueó el acceso a la red local {#chrome-blocked-local-network-access}

<!-- verify: phase 3 -->
La página en `droid.devpier.dev` se conecta al gateway en tu propia Mac. Chrome pide permiso la primera vez. Si lo rechazaste, la página no puede conectarse y, tras algunos intentos fallidos, te indica que Chrome bloqueó el acceso a tu Mac.

Para permitirlo de nuevo:

1. Abre en Chrome **Configuración → Privacidad y seguridad → Configuración de sitios**.
2. Busca `droid.devpier.dev` y permite el acceso a la red local.
3. Vuelve a cargar la página.

Si aún no puedes conectarte, usa la [página local de respaldo](#use-the-local-fallback-page).

## El puerto ya está en uso

El gateway escucha en el puerto `7300` de forma predeterminada.

Si el gateway se ejecuta en segundo plano, volver a ejecutar el comando lo reinicia. Si hay un gateway en una ventana de Terminal, el comando no inicia un segundo: indica que droidpier ya está en ejecución en el puerto `7300`. Detén ese con `Ctrl+C` y vuelve a ejecutar el comando.

Si otro programa usa el puerto, el gateway lo indica, sugiere otro puerto y termina. Encuentra el programa:

```sh
lsof -nP -iTCP:7300 -sTCP:LISTEN
```

Detén ese programa o inicia el gateway en otro puerto:

```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh -s -- --port 7301
```

Después de instalarlo, `droidpier --port 7301` hace lo mismo.

<!-- verify: phase 3 -->
El gateway incluye el nuevo puerto en la dirección que abre, así que la página se conecta al puerto correcto.

## No se encontró ningún emulador

Si la página indica que no se encontró ningún emulador en ejecución:

- Comprueba que haya un emulador en ejecución: `adb devices` debería listar `emulator-5554` o algo similar.
- Comprueba que se haya iniciado con gRPC habilitado (`-grpc <port>`). El gateway no puede leer la pantalla de un emulador sin gRPC.

<!-- verify: phase 2 -->
También puedes iniciar un dispositivo desde la lista de la página. Consulta [Dispositivos](/es/docs/guides/devices/).

El gateway sigue ejecutándose cuando no encuentra ningún emulador e indica el motivo: en Terminal, o en su registro cuando se ejecuta en segundo plano (`droidpier logs`).

<!-- verify: phase 3 -->
Si el gateway informa que falta el Android SDK, `emulator`, `platform-tools` o la imagen de sistema, sigue la solución que muestra. Consulta [Primera ejecución](/es/docs/getting-started/first-run/#2-let-it-check-your-android-sdk).

## Falta "sdkmanager"

<!-- verify: phase 3 -->
Un SDK instalado por Android Studio puede no incluir `cmdline-tools`, que proporciona `sdkmanager` y `avdmanager`. La página ofrece instalarlo: usa el botón de instalar que tiene al lado en la lista de elementos que faltan, o el del diálogo para crear un dispositivo. Después de que confirmes, el gateway descarga las herramientas de línea de comandos 22.0 de Google en tu SDK. La página muestra cada licencia de Google completa, y solo instala si aceptas.

`sdkmanager` necesita Java. Si no lo tienes, instala Android Studio, que incluye Java, o JDK 17 o posterior, y vuelve a abrir la página.

Para instalar las herramientas a mano, descarga las herramientas de línea de comandos de Google desde developer.android.com y descomprímelas de modo que exista esta ruta:

```text
<your SDK>/cmdline-tools/latest/bin/sdkmanager
```

## La página no se conecta

<!-- verify: phase 3 -->
La página busca el gateway una vez por segundo y se conecta en cuanto responde. Si sigue esperando:

- Ejecuta `droidpier status` para comprobar que el gateway está en ejecución. Si no lo está, ejecuta `droidpier start`. `droidpier logs` muestra por qué se detuvo.
- Comprueba que Chrome permite el acceso a la red local para `droid.devpier.dev`. Consulta [Chrome bloqueó el acceso a la red local](#chrome-blocked-local-network-access).
- Si iniciaste el gateway con `--port`, abre la dirección que mostró, que termina en `#port=<port>`.
- Trae la pestaña al frente. La página no comprueba mientras la pestaña está en segundo plano.

## El comando de instalación falla

- **Falla la suma de comprobación:** la descarga no coincidía con su suma de comprobación, así que no se instaló nada. Vuelve a ejecutar el comando.
- **No se puede conectar con el sitio de descarga:** si Droidpier ya está instalado, el comando te avisa e inicia la copia que tienes. Si todavía no está instalado, revisa tu conexión a internet y vuelve a ejecutar el comando.

## La página indica que el gateway o la página están desactualizados

<!-- verify: phase 3 -->
- **Gateway desactualizado:** ejecuta el comando de actualización que muestra la página. Es el mismo que el [comando de instalación](/es/docs/getting-started/install/).
- **Página desactualizada:** fuerza la recarga de la página con Cmd+Shift+R.

## Navegador incorrecto

<!-- verify: phase 3 -->
La página funciona solo en Chrome y Edge. En otros navegadores te pide que cambies de navegador y no intenta conectarse. Consulta [Compatibilidad con navegadores](/es/docs/reference/browser-support/).

## Usa la página local de respaldo {#use-the-local-fallback-page}

El gateway sirve la misma página en `http://127.0.0.1:7300/app/` (o en el puerto que elegiste). Úsala cuando la página pública no carga o se rechazó el acceso a la red local.

Ejecuta `droidpier --local` para que el gateway abra la página local en lugar de la pública.

## La pantalla deja de actualizarse

Si el emulador se cierra o se reinicia, la página muestra que está desconectada. El gateway sigue ejecutándose. Cuando el emulador vuelve, la página se reconecta y la pantalla regresa.
