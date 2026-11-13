---
title: Requisitos
description: O que você precisa antes de instalar o Droidpier - um Mac com Apple Silicon, Chrome ou Edge, e o emulador Android com uma imagem de sistema arm64.
sourceHash: a1a9610ae52d
---

O Droidpier executa o emulador oficial do Android no seu próprio Mac e o exibe em uma aba do navegador. Nada roda em um servidor remoto. Você instala um pequeno programa local (o gateway) e precisa do emulador Android e de uma imagem de sistema no mesmo Mac.

## Computador

- Um Mac com Apple Silicon (M1 ou posterior). A versão 1 oferece suporte apenas a Macs com Apple Silicon e imagens de sistema arm64.
- Macs Intel, Windows e Linux não são suportados na versão 1.

## Navegador

- Google Chrome ou Microsoft Edge.
- Safari e Firefox não são suportados. Veja o motivo em [Suporte a navegadores](/pt-br/docs/reference/browser-support/).

## Componentes do Android SDK

O gateway usa estas partes do Android SDK:

| Componente | Usado para | Tamanho aproximado do download |
|---|---|---|
| `emulator` | Executa o dispositivo virtual Android | cerca de 400 MB |
| `system-images;android-34;google_apis;arm64-v8a` | A imagem de sistema do Android 14 (API 34) | cerca de 1.5 GB |

<!-- verify: phase 2 -->
| Componente | Usado para | Tamanho aproximado do download |
|---|---|---|
| `platform-tools` | `adb`, para verificar o estado de inicialização e parar dispositivos | cerca de 15 MB |

<!-- verify: phase 3 -->
| Componente | Usado para | Tamanho aproximado do download |
|---|---|---|
| `cmdline-tools` | `sdkmanager` e `avdmanager`, para instalar as outras partes e criar um dispositivo | - |

<!-- verify: phase 3 -->
Você não precisa abrir o Android Studio. Se você já tem o SDK do Android Studio, o gateway o utiliza. Ele procura o SDK nesta ordem:

1. O diretório definido na variável de ambiente `ANDROID_HOME`.
2. `~/Library/Android/sdk`.

<!-- verify: phase 3 -->
Se algo estiver faltando, o gateway informa o que falta e pergunta antes de baixar qualquer coisa. Veja [Primeira execução](/pt-br/docs/getting-started/first-run/).

## Memória

<!-- verify: phase 3 -->
Cada emulador em execução usa a RAM definida na configuração do dispositivo. O dispositivo padrão que o gateway pode criar usa 4096 MB. Um dispositivo é exibido por vez.

## Desempenho medido {#measured-performance}

Em um Mac M4 com um dispositivo virtual Pixel 5 API 34 (1080×2340) no Chrome 157, usando o transporte de quadros rgba-mmap (quadros RGBA brutos via memória compartilhada), a tela foi atualizada a uma mediana de 60 quadros por segundo, e a latência do toque foi de 20 ms no p50 e 30 ms no p90. Seus números dependem do seu Mac, do dispositivo e do navegador.

A CPU foi medida na mesma configuração durante 16 deslizes consecutivos, somando o emulador, o gateway e o processo de exibição (todos os processos do Chrome). O Droidpier usou 257% (emulador 136% + gateway 69% + Chrome 52%). O scrcpy, medido da mesma forma com o mesmo emulador, usou 208% (emulador 203% + scrcpy 5%), então o Droidpier usou 1.24 vez a CPU do scrcpy.
