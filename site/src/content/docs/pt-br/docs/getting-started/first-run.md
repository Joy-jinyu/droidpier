---
title: Primeira execução
description: Inicie o gateway com um único comando, deixe-o verificar o Android SDK, permita o acesso à rede local no Chrome e veja seu emulador no navegador.
sourceHash: 7b613962f696
---

Execute um comando no Terminal, abra `https://droid.devpier.dev/app/` e permita o acesso à rede local quando o Chrome pedir.

## 1. Inicie o gateway

```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh
```

Ele instala ou atualiza o gateway quando necessário e depois o inicia. Veja [Instalação](/pt-br/docs/getting-started/install/). Depois da instalação, `droidpier start` também o inicia.

O gateway roda em segundo plano. Você pode fechar a janela do Terminal.

O gateway escuta em `127.0.0.1`, na porta `7300` por padrão. Para usar outra porta, veja [Linha de comando](/pt-br/docs/reference/cli/).

## 2. Deixe-o verificar seu Android SDK {#2-let-it-check-your-android-sdk}

<!-- verify: phase 3 -->
Ao iniciar, o gateway verifica o Android SDK, `cmdline-tools`, `emulator`, `platform-tools`, a imagem de sistema `system-images;android-34;google_apis;arm64-v8a` e pelo menos um dispositivo virtual (AVD). Se faltar algo, ele lista cada item no Terminal com um comando para instalá-lo manualmente e pede que você termine a configuração na página. Ele não faz perguntas no Terminal.

Quando o gateway roda em segundo plano, essa lista vai para o log dele. Execute `droidpier logs` para vê-la.

<!-- verify: phase 3 -->
A página mostra a mesma lista, com o tamanho do download de cada item:

| Faltando | O que você faz na página |
|---|---|
| Android SDK, `cmdline-tools`, `emulator`, `platform-tools`, imagem de sistema | Instale um item com o botão ao lado dele, ou instale todos de uma vez. |
| Nenhum AVD | Crie um dispositivo: escolha um modelo de dispositivo e uma versão do Android. |
| Java, quando um item precisa dele | Instale o Android Studio, que inclui Java, ou o JDK 17 ou mais recente, e depois reabra a página. O gateway não instala Java. |

<!-- verify: phase 3 -->
Nada é baixado ou criado até você confirmar na página. Antes de começar, a página mostra o que vai baixar, onde vai instalar e quanto espaço em disco é necessário. Durante a instalação, a página mostra cada licença do Google por completo, e um item só é instalado se você concordar. As ferramentas de linha de comando na versão 23 ou mais recente podem aceitar as licenças sem perguntar; a página avisa antes de você confirmar.

Por exemplo, para instalar a imagem de sistema manualmente:

```sh
sdkmanager "system-images;android-34;google_apis;arm64-v8a"
```

## 3. Abra a página {#3-open-the-page}

<!-- verify: phase 3 -->
Abra `https://droid.devpier.dev/app/` no Chrome ou no Edge. Quando o gateway é iniciado, ele também mostra esse endereço e o abre no seu navegador padrão. Se o seu navegador padrão não for o Chrome nem o Edge, abra você mesmo o endereço no Chrome ou no Edge.

A página se conecta sozinha. Enquanto nenhum gateway responder, ela verifica uma vez por segundo e se conecta assim que o gateway inicia, sem recarregar. Ela não verifica enquanto a aba está em segundo plano.

Se o gateway não estiver rodando na porta `7300`, o endereço que ele mostra termina em `#port=<port>`:

```text
https://droid.devpier.dev/app/#port=7301
```

Abra esse endereço para que a página encontre a porta certa.

## 4. Permita o acesso à rede local {#4-allow-local-network-access}

<!-- verify: phase 3 -->
Na primeira vez que a página se conecta ao gateway no seu Mac, o Chrome mostra uma solicitação de permissão perguntando se `droid.devpier.dev` pode acessar sua rede local. Clique em **Permitir**. O Chrome lembra a escolha para o site.

Se você negou, veja [Solução de problemas](/pt-br/docs/guides/troubleshooting/#chrome-blocked-local-network-access).

## 5. Use o emulador

Se um emulador com gRPC já estiver em execução, a página mostra a tela dele.

<!-- verify: phase 2 -->
Caso contrário, escolha um dispositivo na lista e inicie-o. Veja [Dispositivos](/pt-br/docs/guides/devices/).

Clique na tela para dar a ela o foco do teclado. Depois:

- Clique para tocar; arraste para deslizar.
- Digite no teclado do seu Mac. Veja [Teclado e entrada](/pt-br/docs/guides/keyboard-and-input/).
- Use os botões Voltar, Início e Recentes acima da tela.

## Parar

Execute `droidpier stop`. Se você iniciou o gateway com `droidpier` em uma janela do Terminal, pressione `Ctrl+C` nela. Os emuladores em execução continuam rodando. Na próxima vez que iniciar o gateway, com o mesmo comando ou com `droidpier start`, ele se conecta a eles de novo.

## A página local alternativa

O gateway também serve a mesma página em `http://127.0.0.1:7300/app/` (ou na porta que você escolheu). Use-a se a página pública não carregar ou não conseguir se conectar.

Para que o gateway abra a página local em vez da pública, inicie-o com `--local`:

```sh
droidpier --local
```
