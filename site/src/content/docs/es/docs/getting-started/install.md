---
title: Instalación
description: Instala e inicia el gateway de Droidpier en una Mac con Apple Silicon con un solo comando.
sourceHash: 9e0b6fc5fcb6
---

Empezar lleva dos pasos:

1. Ejecuta el comando de abajo en Terminal y deja la ventana abierta. Instala Droidpier y lo inicia.
2. Abre `https://droid.devpier.dev/app/`. La página se conecta sola. La primera vez, cuando Chrome pregunte si la página puede acceder a tu red local, haz clic en **Permitir**.

El paso 2 se describe en [Primera ejecución](/es/docs/getting-started/first-run/).

<!-- verify: phase 3 -->
El comando `droidpier` es el gateway: un único archivo ejecutable que conecta el emulador de Android de tu Mac con la página del navegador. No necesitas Node.js para ejecutarlo.

## Ejecuta el comando

<!-- verify: phase 3 -->

Primero revisa los [requisitos](/es/docs/getting-started/requirements/). Luego ejecuta esto en Terminal:

<!-- 待第 3 阶段 Task 5 确认 -->
```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh
```

La primera vez, el script:

1. Descarga el gateway para macOS en Apple Silicon, `droidpier-darwin-arm64.tar.xz`, desde `https://droid.devpier.dev/download/`. Su suma de comprobación está junto a él, en `droidpier-darwin-arm64.tar.xz.sha256`.
2. Comprueba la descarga con la suma de comprobación. Si no coinciden, se detiene y no instala nada.
3. Guarda el gateway como `~/.local/bin/droidpier` y lo hace ejecutable.
4. Inicia el gateway.

El gateway sigue ejecutándose en esa ventana de Terminal. Déjala abierta mientras usas la página. Presiona `Ctrl+C` para detenerlo.

Cuando vuelves a ejecutar el mismo comando:

- Si tu copia está al día, omite la descarga e inicia el gateway.
- Si hay una versión más reciente, actualiza tu copia y luego la inicia.
- Si no puede conectar con el sitio de descarga, te avisa e inicia la copia que ya tienes.
- Si el gateway ya se está ejecutando, te lo indica y abre la página. No inicia un segundo gateway.

Para pasar opciones al gateway, o para instalar sin iniciarlo, consulta [Línea de comandos](/es/docs/reference/cli/#start-with-the-install-command).

## Ejecuta droidpier directamente

<!-- verify: phase 3 -->

Después de instalarlo, también puedes iniciar el gateway con el comando `droidpier`:

```sh
droidpier
```

Si tu shell muestra `command not found`, `~/.local/bin` no está en tu `PATH`. En ese caso, el script de instalación muestra un aviso. Agrégalo, por ejemplo en `~/.zshrc`:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

Luego abre una nueva ventana de Terminal e inténtalo de nuevo.

## Actualizar

<!-- verify: phase 3 -->

Vuelve a ejecutar el mismo comando. Si hay una versión más reciente, reemplaza el archivo en `~/.local/bin`. Si el gateway sigue en ejecución, detenlo primero con `Ctrl+C` para que el comando inicie la nueva versión.

<!-- verify: phase 3 -->
Cuando la página es más reciente que tu gateway, la página te avisa que el gateway está desactualizado y muestra el comando para actualizarlo.

## Siguiente paso

[Primera ejecución](/es/docs/getting-started/first-run/): deja que el gateway revise tu Android SDK, abre la página y permite el acceso a la red local.
