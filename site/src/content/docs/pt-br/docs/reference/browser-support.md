---
title: Suporte a navegadores
description: O Droidpier oferece suporte ao Chrome e ao Edge. O Safari bloqueia a conexão com o gateway local, e o Firefox não é suportado.
sourceHash: f0d75b070eb1
---

| Navegador | Suportado |
|---|---|
| Google Chrome | Sim |
| Microsoft Edge | Sim |
| Safari | Não |
| Firefox | Não |

As medições na página de [requisitos](/pt-br/docs/getting-started/requirements/#measured-performance) foram feitas no Chrome 157.

## Por que o Safari não funciona

A página é servida via `https` e se conecta ao gateway no seu Mac com `ws://127.0.0.1` (ou `ws://localhost`), que não é criptografado. O Safari trata isso como conteúdo misto (uma conexão insegura a partir de uma página segura) e o bloqueia. A página não consegue alcançar o gateway no Safari.

## Firefox

O Firefox não é suportado.

## Como a página verifica o navegador

<!-- verify: phase 3 -->
A página lê `navigator.userAgentData.brands`. Ela só continua se a lista contiver `Google Chrome` ou `Microsoft Edge`. Caso contrário, pede que você abra a página no Chrome ou no Edge e não tenta se conectar.

<!-- verify: phase 3 -->
O Safari e o Firefox não fornecem `navigator.userAgentData`, então são rejeitados. Outros navegadores baseados em Chromium que não informam a marca Chrome ou Edge também são rejeitados.

## Acesso à rede local no Chrome

<!-- verify: phase 3 -->
- Desde o Chrome 147, uma página pública `https` que se conecta a `localhost` precisa primeiro obter a permissão do usuário. O Chrome pergunta uma vez e lembra a resposta para o site.
- Desde o Chrome 154, a página pode informar que está se conectando ao endereço de loopback (`targetAddressSpace: "loopback"` ao abrir o WebSocket). A página faz isso e recorre a um WebSocket simples nas versões que não oferecem suporte à opção.
- Desde o Chrome 156, políticas corporativas não podem mais desativar essa verificação.

Se você negou a permissão, veja [Solução de problemas](/pt-br/docs/guides/troubleshooting/#chrome-blocked-local-network-access).
