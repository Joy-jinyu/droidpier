---
title: Requisitos
description: Lo que necesitas antes de instalar Droidpier - una Mac con Apple Silicon, Chrome o Edge, y el emulador de Android con una imagen de sistema arm64.
sourceHash: a1a9610ae52d
---

Droidpier ejecuta el emulador oficial de Android en tu propia Mac y lo muestra en una pestaña del navegador. Nada se ejecuta en un servidor remoto. Instalas un pequeño programa local (el gateway), y necesitas el emulador de Android y una imagen de sistema en la misma Mac.

## Computadora

- Una Mac con Apple Silicon (M1 o posterior). La versión 1 solo es compatible con Macs con Apple Silicon e imágenes de sistema arm64.
- Las Macs con Intel, Windows y Linux no son compatibles en la versión 1.

## Navegador

- Google Chrome o Microsoft Edge.
- Safari y Firefox no son compatibles. Consulta [Compatibilidad con navegadores](/es/docs/reference/browser-support/) para conocer el motivo.

## Componentes del Android SDK

El gateway usa estas partes del Android SDK:

| Componente | Para qué se usa | Tamaño aproximado de descarga |
|---|---|---|
| `emulator` | Ejecuta el dispositivo virtual Android | unos 400 MB |
| `system-images;android-34;google_apis;arm64-v8a` | La imagen de sistema de Android 14 (API 34) | unos 1.5 GB |

<!-- verify: phase 2 -->
| Componente | Para qué se usa | Tamaño aproximado de descarga |
|---|---|---|
| `platform-tools` | `adb`, para comprobar el estado de arranque y detener dispositivos | unos 15 MB |

<!-- verify: phase 3 -->
| Componente | Para qué se usa | Tamaño aproximado de descarga |
|---|---|---|
| `cmdline-tools` | `sdkmanager` y `avdmanager`, para instalar las demás partes y crear un dispositivo | - |

<!-- verify: phase 3 -->
No necesitas abrir Android Studio. Si ya tienes el SDK de Android Studio, el gateway lo usa. Busca el SDK en este orden:

1. El directorio indicado en la variable de entorno `ANDROID_HOME`.
2. `~/Library/Android/sdk`.

<!-- verify: phase 3 -->
Si falta algo, el gateway te dice qué falta y te pregunta antes de descargar cualquier cosa. Consulta [Primera ejecución](/es/docs/getting-started/first-run/).

## Memoria

<!-- verify: phase 3 -->
Cada emulador en ejecución usa la RAM definida en la configuración de su dispositivo. El dispositivo predeterminado que puede crear el gateway usa 4096 MB. Se muestra un dispositivo a la vez.

## Rendimiento medido {#measured-performance}

En una Mac con M4 con un dispositivo virtual Pixel 5 API 34 (1080×2340) en Chrome 157, usando el transporte de fotogramas rgba-mmap (fotogramas RGBA sin procesar a través de memoria compartida), la pantalla se actualizó a una mediana de 60 fotogramas por segundo, y la latencia del toque fue de 20 ms en p50 y 30 ms en p90. Tus números dependen de tu Mac, del dispositivo y del navegador.

La CPU se midió con la misma configuración durante 16 deslizamientos consecutivos, sumando el emulador, el gateway y el proceso de visualización (todos los procesos de Chrome). Droidpier usó 257% (emulador 136% + gateway 69% + Chrome 52%). scrcpy, medido de la misma forma con el mismo emulador, usó 208% (emulador 203% + scrcpy 5%), por lo que Droidpier usó 1.24 veces la CPU de scrcpy.
