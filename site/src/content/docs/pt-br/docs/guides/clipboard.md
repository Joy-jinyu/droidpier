---
title: Área de transferência
description: Copie e cole texto entre o seu Mac e o emulador Android nas duas direções.
sourceHash: fd58b697773c
---

## Do Mac para o emulador

<!-- verify: phase 2 -->
Copie um texto no seu Mac. Clique na tela do emulador e pressione Cmd+V:

- Texto ASCII é digitado no emulador caractere por caractere.
- Texto com outros caracteres (chinês, emoji etc.) é colocado na área de transferência do emulador e colado. Isso substitui o que estava na área de transferência do emulador.

## Do emulador para o Mac

<!-- verify: phase 2 -->
Copie um texto dentro do Android, por exemplo tocando e segurando e escolhendo copiar. O gateway observa a área de transferência do emulador e envia o novo texto para a página. A página então o grava na área de transferência do seu Mac, e você pode colá-lo com Cmd+V em qualquer lugar do seu Mac.

<!-- verify: phase 2 -->
Os navegadores só permitem que uma página grave na área de transferência enquanto ela está em foco. Se a gravação falhar, por exemplo porque outra janela estava na frente, a página mostra um aviso. Clique nele para copiar o texto.

## Digitar texto não ASCII

Digitar chinês ou outro texto não ASCII com um método de entrada do macOS também usa a área de transferência do emulador. Veja [Teclado e entrada](/pt-br/docs/guides/keyboard-and-input/#chinese-and-other-non-ascii-text).
