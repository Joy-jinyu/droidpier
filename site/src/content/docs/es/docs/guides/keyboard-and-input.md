---
title: Teclado y entrada
description: Cómo llegan al emulador el mouse, el trackpad, el teclado, el texto no ASCII y los botones del dispositivo.
sourceHash: 34d7c6882a09
---

## Mouse y trackpad

- **Tocar:** haz clic en la pantalla.
- **Deslizar:** presiona, arrastra y suelta. El gateway envía el movimiento al emulador como un solo toque.
- Si arrastras más allá del borde de la pantalla y sueltas fuera de ella, el emulador recibe igualmente la liberación, así que el toque no queda presionado.

Las coordenadas de la página se convierten a píxeles del dispositivo, teniendo en cuenta el tamaño de la página.

<!-- verify: phase 2 -->
Después de rotar el dispositivo, la conversión usa la nueva orientación, así que los toques caen donde haces clic.

## Rueda de desplazamiento

<!-- verify: phase 2 -->
El emulador no tiene entrada de rueda de desplazamiento, así que la página convierte el movimiento de la rueda en un deslizamiento corto:

- Cada 100 píxeles de movimiento de la rueda se convierten en un deslizamiento de 300 píxeles en el dispositivo, hasta 900 píxeles por deslizamiento.
- El deslizamiento va en sentido contrario a la rueda: desplazarse hacia abajo mueve el dedo hacia arriba, como en un teléfono.
- Los eventos de rueda que ocurren dentro de 50 ms se combinan en un solo deslizamiento.

## Teclado

Primero haz clic en la pantalla. Así recibe el foco del teclado.

- Los caracteres imprimibles y las teclas de función (flechas, Enter, Retroceso, Tab, Escape, etc.) se envían al emulador a medida que las presionas.
- Los atajos del navegador que usan Cmd, como Cmd+R y Cmd+W, no se capturan. Siguen actuando sobre el navegador.

<!-- verify: phase 2 -->
Cmd+V pega desde tu Mac. Consulta [Portapapeles](/es/docs/guides/clipboard/).

## Chino y otro texto no ASCII {#chinese-and-other-non-ascii-text}

Escribe con cualquier método de entrada de macOS. Cuando el método de entrada termina de componer una palabra, la página:

1. coloca el texto en el portapapeles del emulador;
2. envía una acción de pegar al emulador.

No se instala ninguna app de método de entrada en el emulador. La contrapartida: esto sobrescribe el portapapeles del emulador.

La entrada de teclas del emulador descarta los caracteres no ASCII, por eso este texto pasa por el portapapeles.

## Botones del dispositivo

Botones sobre la pantalla:

| Botón | Envía |
|---|---|
| Atrás | `GoBack` |
| Inicio | `GoHome` |
| Recientes | `AppSwitch` |

<!-- verify: phase 2 -->
| Botón | Acción |
|---|---|
| Rotar | Rota el dispositivo 90° en sentido horario |
| Subir / bajar volumen | `AudioVolumeUp` / `AudioVolumeDown` |
| Encendido | `Power`; presiónalo de nuevo para volver a encender la pantalla |
| Captura de pantalla | Descarga un PNG. Consulta [Capturas de pantalla](/es/docs/guides/screenshots/) |
