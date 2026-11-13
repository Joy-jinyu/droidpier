---
title: Línea de comandos
description: Opciones y variables de entorno del comando del gateway Droidpier.
sourceHash: b62f19b96312
---

<!-- verify: phase 3 -->
```sh
droidpier start [--port <port>] [--local] [--no-open]
droidpier stop
droidpier status
droidpier logs
droidpier [--port <port>] [--local] [--no-open]
```

| Comando | Efecto |
|---|---|
| `droidpier start` | Ejecuta el gateway en segundo plano, como LaunchAgent de macOS. Sigue funcionando al cerrar Terminal, se inicia al iniciar sesión y se reinicia si falla. Si ya está en ejecución, lo reinicia. Guarda las opciones que indiques; sin opciones, conserva las guardadas. Abre la página una vez, salvo que pases `--no-open`. |
| `droidpier stop` | Detiene el gateway en segundo plano. Deja de iniciarse al iniciar sesión. |
| `droidpier status` | Muestra si el gateway en segundo plano está en ejecución, con su ID de proceso, puerto, versión y archivo de registro. |
| `droidpier logs` | Imprime la ruta del archivo de registro y sus últimas 50 líneas. |
| `droidpier` | Ejecuta el gateway en esta ventana de Terminal hasta que presiones `Ctrl+C`. |

Detener el gateway no detiene los emuladores en ejecución.

## Inicia con el comando de instalación {#start-with-the-install-command}

El comando de instalación, `curl -fsSL https://droid.devpier.dev/install.sh | sh`, instala o actualiza el gateway y luego ejecuta `droidpier start`. Para pasarle opciones, ponlas después de `sh -s --`. Se guardan para el gateway en segundo plano:

```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh -s -- --port 7310
```

Para instalar o actualizar sin iniciar el gateway, define `DROIDPIER_NO_START=1`:

```sh
curl -fsSL https://droid.devpier.dev/install.sh | DROIDPIER_NO_START=1 sh
```

Para ejecutar el gateway en la ventana de Terminal, como antes, define `DROIDPIER_FOREGROUND=1`:

```sh
curl -fsSL https://droid.devpier.dev/install.sh | DROIDPIER_FOREGROUND=1 sh
```

## Opciones

| Opción | Predeterminado | Efecto |
|---|---|---|
| `--port <port>` | `7300` | El puerto en el que escucha el gateway, solo en `127.0.0.1`. |

<!-- verify: phase 3 -->
| Opción | Predeterminado | Efecto |
|---|---|---|
| `--local` | desactivado | Abre la página que sirve el propio gateway, `http://127.0.0.1:<port>/app/`, en lugar de la página pública en `droid.devpier.dev`. |
| `--no-open` | desactivado | No abre el navegador al iniciar. El gateway igualmente muestra la dirección. |

Con o sin `--no-open`, la página encuentra el gateway por sí sola. Consulta [Primera ejecución](/es/docs/getting-started/first-run/#3-open-the-page).

## Variables de entorno

| Variable | Efecto |
|---|---|
| `ANDROID_HOME` | El directorio del Android SDK. Si no está definida, el gateway usa `~/Library/Android/sdk`. |
| `ANDROID_AVD_HOME` | El directorio que contiene los AVD. Si no está definida, el gateway usa `~/.android/avd`. |
| `DEBUG=1` | Muestra una línea por segundo para cada conexión: fotogramas recibidos, enviados y descartados, tamaño medio de fotograma y el retraso del emulador al gateway. |

<!-- verify: phase 2 -->
`ANDROID_AVD_HOME` se lee cuando el gateway lista los dispositivos.

<!-- verify: phase 3 -->
`ANDROID_HOME` se lee en la comprobación de la primera ejecución.

Si `ANDROID_HOME` y `ANDROID_AVD_HOME` están definidas, `droidpier start` las guarda para el gateway en segundo plano, porque launchd no lee el perfil de tu shell. Vuelve a ejecutar `droidpier start` después de cambiarlas.

## Qué muestra

Al iniciar, el gateway muestra la dirección de la página. Si no hay ningún emulador en ejecución, muestra el motivo y sigue ejecutándose.

<!-- verify: phase 3 -->
De forma predeterminada, la dirección que muestra es la página pública, `https://droid.devpier.dev/app/`. Cuando el gateway no se ejecuta en el puerto `7300`, la dirección termina en `#port=<port>`. Con `--local`, es la página local, `http://127.0.0.1:<port>/app/`. El gateway abre la dirección con el comando `open` de macOS a menos que pases `--no-open`.

Si ya hay un gateway en ese puerto, no se inicia un segundo. Indica que droidpier ya está en ejecución, con el puerto, y abre la página. Si el que se ejecuta es el gateway en segundo plano, también muestra `droidpier stop`. Si otro programa usa el puerto, lo indica, sugiere otro puerto y termina.

<!-- verify: phase 3 -->
Cuando faltan partes del Android SDK, el gateway muestra cada una con un comando para instalarla a mano y te pide que termines la configuración en la página. Nunca pregunta nada en Terminal: las instalaciones, los dispositivos nuevos y las licencias se confirman en la página. Consulta [Primera ejecución](/es/docs/getting-started/first-run/#2-let-it-check-your-android-sdk).

## Archivos y puertos que usa

| Qué | Dónde |
|---|---|
| Dirección de escucha del gateway | `127.0.0.1:<port>` |
| Detección de emuladores en ejecución | `~/Library/Caches/TemporaryItems/avd/running/pid_<pid>.ini` |

<!-- verify: phase 2 -->
| Qué | Dónde |
|---|---|
| Puertos gRPC del emulador que asigna | El primer puerto par libre desde `8554` |

<!-- verify: phase 3 -->
| Qué | Dónde |
|---|---|
| Ejecutable instalado | `~/.local/bin/droidpier` |
| Suma de comprobación de la versión instalada | `~/.local/share/droidpier/installed.sha256` |
| Configuración del gateway en segundo plano | `~/Library/LaunchAgents/dev.devpier.droidpier.plist` |
| Registro del gateway en segundo plano | `~/Library/Logs/Droidpier/droidpier.log` |
