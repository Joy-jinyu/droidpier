---
title: Teclado e entrada
description: Como mouse, trackpad, teclado, texto não ASCII e os botões do dispositivo chegam ao emulador.
sourceHash: 34d7c6882a09
---

## Mouse e trackpad

- **Tocar:** clique na tela.
- **Deslizar:** pressione, arraste e solte. O gateway envia o movimento ao emulador como um único toque.
- Se você arrastar além da borda da tela e soltar fora dela, o emulador ainda recebe a liberação, então o toque não fica pressionado.

As coordenadas da página são convertidas em pixels do dispositivo, levando em conta o tamanho da página.

<!-- verify: phase 2 -->
Depois que você gira o dispositivo, a conversão usa a nova orientação, então os toques caem onde você clica.

## Roda de rolagem

<!-- verify: phase 2 -->
O emulador não tem entrada de roda de rolagem, então a página transforma o movimento da roda em um deslize curto:

- Cada 100 pixels de movimento da roda viram um deslize de 300 pixels no dispositivo, até 900 pixels por deslize.
- O deslize vai no sentido oposto ao da roda: rolar para baixo move o dedo para cima, como em um celular.
- Eventos de roda dentro de 50 ms são combinados em um único deslize.

## Teclado

Clique na tela primeiro. Assim ela recebe o foco do teclado.

- Caracteres imprimíveis e teclas de função (setas, Enter, Backspace, Tab, Escape etc.) são enviados ao emulador conforme você os pressiona.
- Atalhos do navegador que usam Cmd, como Cmd+R e Cmd+W, não são capturados. Eles continuam agindo no navegador.

<!-- verify: phase 2 -->
Cmd+V cola a partir do seu Mac. Veja [Área de transferência](/pt-br/docs/guides/clipboard/).

## Chinês e outros textos não ASCII {#chinese-and-other-non-ascii-text}

Digite com qualquer método de entrada do macOS. Quando o método de entrada termina de compor uma palavra, a página:

1. coloca o texto na área de transferência do emulador;
2. envia um comando de colar ao emulador.

Nenhum app de método de entrada é instalado no emulador. A contrapartida: isso sobrescreve a área de transferência do emulador.

A entrada de teclas do emulador descarta caracteres não ASCII, por isso esse texto passa pela área de transferência.

## Botões do dispositivo

Botões acima da tela:

| Botão | Envia |
|---|---|
| Voltar | `GoBack` |
| Início | `GoHome` |
| Recentes | `AppSwitch` |

<!-- verify: phase 2 -->
| Botão | Ação |
|---|---|
| Girar | Gira o dispositivo 90° no sentido horário |
| Aumentar / diminuir volume | `AudioVolumeUp` / `AudioVolumeDown` |
| Liga/desliga | `Power`; pressione de novo para ligar a tela outra vez |
| Captura de tela | Baixa um PNG. Veja [Capturas de tela](/pt-br/docs/guides/screenshots/) |
