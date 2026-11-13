---
title: Solução de problemas
description: Corrija problemas comuns - o Chrome bloqueou o acesso à rede local, porta já em uso, nenhum emulador encontrado, a página não se conecta, versões incompatíveis.
sourceHash: d8eaddc9fa12
---

## O Chrome bloqueou o acesso à rede local {#chrome-blocked-local-network-access}

<!-- verify: phase 3 -->
A página em `droid.devpier.dev` se conecta ao gateway no seu próprio Mac. O Chrome pede permissão na primeira vez. Se você negou, a página não consegue se conectar e, após algumas tentativas sem sucesso, informa que o Chrome bloqueou o acesso ao seu Mac.

Para permitir novamente:

1. Abra no Chrome **Configurações → Privacidade e segurança → Configurações do site**.
2. Encontre `droid.devpier.dev` e permita o acesso à rede local.
3. Recarregue a página.

Se ainda não conseguir se conectar, use a [página local alternativa](#use-the-local-fallback-page).

## Porta já em uso

O gateway escuta na porta `7300` por padrão.

Se o gateway roda em segundo plano, executar o comando de novo o reinicia. Se há um gateway rodando em uma janela do Terminal, o comando não inicia um segundo: ele informa que o droidpier já está rodando na porta `7300`. Pare esse com `Ctrl+C` e execute o comando de novo.

Se outro programa usa a porta, o gateway avisa, sugere outra porta e sai. Encontre o programa:

```sh
lsof -nP -iTCP:7300 -sTCP:LISTEN
```

Pare esse programa ou inicie o gateway em outra porta:

```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh -s -- --port 7301
```

Depois da instalação, `droidpier --port 7301` faz o mesmo.

<!-- verify: phase 3 -->
O gateway coloca a nova porta no endereço que abre, então a página se conecta à porta certa.

## Nenhum emulador encontrado

Se a página disser que nenhum emulador em execução foi encontrado:

- Verifique se há um emulador em execução: `adb devices` deve listar `emulator-5554` ou algo parecido.
- Verifique se ele foi iniciado com gRPC ativado (`-grpc <port>`). O gateway não consegue ler a tela de um emulador sem gRPC.

<!-- verify: phase 2 -->
Você também pode iniciar um dispositivo pela lista na página. Veja [Dispositivos](/pt-br/docs/guides/devices/).

O gateway continua rodando quando não encontra emulador e mostra o motivo: no Terminal, ou no log dele quando roda em segundo plano (`droidpier logs`).

<!-- verify: phase 3 -->
Se o gateway informar que `emulator`, `platform-tools`, uma imagem de sistema ou um dispositivo está faltando, conclua a configuração na página. Veja [Primeira execução](/pt-br/docs/getting-started/first-run/#2-let-it-check-your-android-sdk).

## A imagem de sistema de um dispositivo está faltando

<!-- verify: phase 3 -->
Se você removeu uma imagem de sistema, por exemplo no Android Studio, os dispositivos que a usam não conseguem iniciar. A página aponta cada um desses dispositivos e a versão do Android que falta, e oferece instalar essa imagem de novo. Basta um dispositivo que consiga iniciar: a página para de pedir assim que algum dispositivo tem sua imagem de sistema.

## Uma instalação falha

<!-- verify: phase 3 -->
A página mostra o motivo abaixo do item. Se um download não bater com a soma de verificação publicada pelo Google, nada é descompactado; instale o item de novo. Se nenhum dado chegar por um minuto, o download para; verifique sua conexão de rede e tente de novo. O Droidpier não precisa de Java nem das ferramentas de linha de comando, então a falta do `sdkmanager` não é um problema.

## A página não se conecta

<!-- verify: phase 3 -->
A página procura o gateway uma vez por segundo e se conecta assim que ele responde. Se ela continuar esperando:

- Execute `droidpier status` para conferir se o gateway está rodando. Se não estiver, execute `droidpier start`. `droidpier logs` mostra por que ele parou.
- Verifique se o Chrome permite o acesso à rede local para `droid.devpier.dev`. Veja [O Chrome bloqueou o acesso à rede local](#chrome-blocked-local-network-access).
- Se você iniciou o gateway com `--port`, abra o endereço que ele mostrou, que termina em `#port=<port>`.
- Traga a aba para a frente. A página não verifica enquanto a aba está em segundo plano.

## O comando de instalação falha

- **Falha no checksum:** o download não bateu com o checksum, então nada foi instalado. Execute o comando de novo.
- **Não foi possível acessar o site de download:** se o Droidpier já está instalado, o comando avisa e inicia a cópia que você tem. Se ainda não está instalado, verifique sua conexão com a internet e execute o comando de novo.

## A página diz que o gateway ou a página está desatualizado

<!-- verify: phase 3 -->
- **Gateway desatualizado:** execute o comando de atualização que a página mostra. É o mesmo [comando de instalação](/pt-br/docs/getting-started/install/).
- **Página desatualizada:** force o recarregamento da página com Cmd+Shift+R.

## Navegador errado

<!-- verify: phase 3 -->
A página funciona apenas no Chrome e no Edge. Em outros navegadores, ela pede que você troque de navegador e não tenta se conectar. Veja [Suporte a navegadores](/pt-br/docs/reference/browser-support/).

## Use a página local alternativa {#use-the-local-fallback-page}

O gateway serve a mesma página em `http://127.0.0.1:7300/app/` (ou na porta que você escolheu). Use-a quando a página pública não carregar ou o acesso à rede local tiver sido negado.

Execute `droidpier --local` para que o gateway abra a página local em vez da pública.

## A tela para de atualizar

Se o emulador fechar ou reiniciar, a página mostra que está desconectada. O gateway continua rodando. Quando o emulador volta, a página se reconecta e a tela retorna.

## Desinstalar {#uninstall}

Pare o gateway em segundo plano e depois apague os arquivos que ele usa:

```sh
droidpier stop
rm ~/.local/bin/droidpier
rm -r ~/.local/share/droidpier ~/Library/Logs/Droidpier
```

Se `droidpier` já foi apagado, mas o gateway em segundo plano ainda roda ou inicia no login, remova-o manualmente:

```sh
launchctl bootout gui/$(id -u)/dev.devpier.droidpier
rm ~/Library/LaunchAgents/dev.devpier.droidpier.plist
```
