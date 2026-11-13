---
title: Segurança
description: Como o gateway impede que outras páginas web e outros computadores controlem seu emulador - apenas loopback e uma lista de origens permitidas.
sourceHash: 08642471687c
---

A página é servida a partir de `droid.devpier.dev`, mas o emulador e o gateway rodam no seu Mac. Qualquer página web que você abrir poderia tentar se conectar a um programa no seu Mac, então o gateway verifica cada conexão.

## Apenas loopback

O gateway escuta apenas em `127.0.0.1`. Ele não aceita conexões da sua rede local nem da internet. Outros computadores não conseguem alcançá-lo.

## Lista de origens permitidas

<!-- verify: phase 3 -->
Os navegadores enviam um cabeçalho `Origin` quando uma página abre um WebSocket, e uma página web não consegue falsificá-lo. O gateway aceita conexões apenas da página pública em `droid.devpier.dev` e da sua própria página local, ou seja, apenas destas origens:

- `https://droid.devpier.dev`
- `http://127.0.0.1:<port>`
- `http://localhost:<port>`

<!-- verify: phase 3 -->
Uma conexão com qualquer outra origem, ou sem origem, é fechada com o código `4003`. Uma página de outro site não consegue controlar seu emulador, mesmo que adivinhe a porta.

## Como a página encontra o gateway

<!-- verify: phase 3 -->
- Enquanto nenhum gateway responder, a página em `droid.devpier.dev/app/` procura por ele uma vez por segundo e se conecta assim que o `droidpier` é executado. Ela não procura enquanto a aba está em segundo plano.
- Ela usa a porta `7300`, ou a porta depois de `#port=` no endereço. O gateway adiciona `#port=<port>` ao endereço que abre apenas quando não está rodando na porta `7300`.
- A página não armazena a porta no navegador.

## O site não se conecta ao seu Mac

<!-- verify: phase 3 -->
A permissão de rede local do Chrome e a verificação de Origin do gateway funcionam por site, não por caminho. Por isso, as páginas de documentação compartilham a permissão com a página do emulador em `/app/`. Para limitar o que isso significa:

- Apenas a página do emulador em `/app/` se conecta ao gateway. A página inicial e esta documentação nunca fazem isso, então lê-las não dispara a solicitação de permissão.
- O site não carrega scripts, estilos, fontes ou mídia de terceiros. Tudo é servido a partir de `droid.devpier.dev`.

## Instalação de software

<!-- verify: phase 3 -->
O gateway nunca instala pacotes do Android SDK nem cria dispositivos sem perguntar. Você confirma cada instalação ou novo dispositivo na página, depois que ela mostra o que será baixado e onde. A página mostra as licenças do Google por completo, e um item só é instalado se você concordar. As ferramentas de linha de comando na versão 23 ou mais recente podem aceitar as licenças sem perguntar; a página avisa antes de você confirmar. O gateway não pergunta nada no Terminal.

## Códigos de fechamento de conexão

<!-- verify: phase 3 -->
| Código | Significado |
|---|---|
| `4000` | A primeira mensagem não foi `hello`. |
| `4002` | A página e o gateway usam versões de protocolo diferentes. |
| `4003` | Origem não permitida. |

## Relatar um problema

Abra uma issue em [github.com/twosugar/droidpier](https://github.com/twosugar/droidpier/issues).
