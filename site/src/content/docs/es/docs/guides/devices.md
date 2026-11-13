---
title: Dispositivos
description: Lista tus dispositivos virtuales Android, inícialos y detenlos desde la página, y toma el control de un emulador que ya está en ejecución.
sourceHash: 6eaf456bc1f3
---

Aquí, un dispositivo es un Android Virtual Device (AVD) en tu Mac. La página muestra un dispositivo a la vez.

## La lista de dispositivos

<!-- verify: phase 2 -->
La lista de la izquierda muestra cada AVD que informa `emulator -list-avds`. Para cada uno muestra:

- el nombre;
- la resolución de pantalla;
- la versión de Android;
- el estado: detenido, arrancando (con los segundos transcurridos), en ejecución, o en ejecución pero sin posibilidad de tomar el control;
- un botón para iniciar o detener.

<!-- verify: phase 2 -->
La resolución, la RAM y la versión de Android provienen del `config.ini` de cada AVD en `~/.android/avd/<name>.avd/`. Si defines `ANDROID_AVD_HOME`, el gateway lee ese directorio en su lugar. Si falta un campo en `config.ini`, se deja en blanco.

## Iniciar un dispositivo

<!-- verify: phase 2 -->
Haz clic en iniciar junto a un dispositivo. El gateway ejecuta:

```sh
emulator -avd <name> -no-window -grpc <port> -no-boot-anim -gpu host
```

- `-no-window` significa que no se abre una ventana separada del emulador. La pantalla aparece solo en la página.
- El puerto gRPC es el primer puerto par libre desde `8554` hacia arriba.
- El dispositivo se considera arrancado cuando `adb -s emulator-<serial> shell getprop sys.boot_completed` devuelve `1`. Hasta entonces, la página muestra el progreso.
- Si el dispositivo no ha arrancado después de 180 segundos, el inicio falla y el gateway termina el proceso del emulador.

<!-- verify: phase 2 -->
Hacer clic de nuevo en iniciar mientras un dispositivo está arrancando no inicia una segunda copia. Si cierras la página durante el arranque y la vuelves a abrir, el progreso continúa.

## Detener un dispositivo

<!-- verify: phase 2 -->
Haz clic en detener. El gateway ejecuta `adb -s emulator-<serial> emu kill`.

## Emuladores que ya están en ejecución

El gateway encuentra los emuladores en ejecución a través de los archivos que el emulador escribe en `~/Library/Caches/TemporaryItems/avd/running/`. Si un emulador se está ejecutando con gRPC habilitado, por ejemplo uno que iniciaste con `-grpc <port>`, el gateway se conecta a él en lugar de iniciar otra copia.

<!-- verify: phase 2 -->
Un emulador que se ejecuta sin gRPC se marca como "en ejecución pero sin posibilidad de tomar el control". El gateway necesita gRPC para leer la pantalla y enviar entradas. Detén ese emulador e inícialo desde la página.

## Cuando el gateway se detiene

Detener el gateway no detiene los emuladores. Cuando vuelves a iniciar el gateway, se conecta a ellos de nuevo.

## Crear un dispositivo

<!-- verify: phase 3 -->
Crea los dispositivos en la página. Usa el botón para un dispositivo nuevo, elige un modelo de dispositivo y una versión de Android, y ponle un nombre al dispositivo; la página sugiere uno. Antes de hacer nada, la página muestra el modelo, la versión de Android y la memoria que tendrá el dispositivo. Si la imagen del sistema de esa versión aún no está instalada, el gateway la descarga después de que confirmes y aceptes la licencia de Google.

Crear un dispositivo requiere las herramientas de línea de comandos (`avdmanager`). Si faltan, el diálogo ofrece instalarlas primero. Consulta [Primera ejecución](/es/docs/getting-started/first-run/#2-let-it-check-your-android-sdk).

También puedes crear dispositivos con `avdmanager` o Android Studio; la lista los detecta.

## Eliminar un dispositivo

Haz clic en el icono de papelera junto a un dispositivo y confirma. Se eliminan el dispositivo y todos sus datos (apps instaladas, archivos, instantáneas); no se puede deshacer. La imagen del sistema sigue instalada. No se puede eliminar un dispositivo que está en ejecución o arrancando: detenlo primero.
