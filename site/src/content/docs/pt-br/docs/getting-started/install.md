---
title: Instalação
description: Instale e inicie o gateway do Droidpier em um Mac com Apple Silicon com um único comando.
sourceHash: 721a09a23a56
---

Começar leva dois passos:

1. Execute o comando abaixo no Terminal. Ele instala o Droidpier e o inicia em segundo plano.
2. Abra `https://droid.devpier.dev/app/`. A página se conecta sozinha. Na primeira vez, quando o Chrome perguntar se a página pode acessar sua rede local, clique em **Permitir**.

O passo 2 está descrito em [Primeira execução](/pt-br/docs/getting-started/first-run/).

<!-- verify: phase 3 -->
O comando `droidpier` é o gateway: um único arquivo executável que conecta o emulador Android do seu Mac à página no navegador. Você não precisa do Node.js para executá-lo.

## Execute o comando

<!-- verify: phase 3 -->

Confira os [requisitos](/pt-br/docs/getting-started/requirements/) primeiro. Depois execute isto no Terminal:

<!-- 待第 3 阶段 Task 5 确认 -->
```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh
```

Na primeira vez, o script:

1. Baixa o gateway para macOS em Apple Silicon, `droidpier-darwin-arm64.tar.xz`, de `https://droid.devpier.dev/download/`. O checksum fica ao lado dele, em `droidpier-darwin-arm64.tar.xz.sha256`.
2. Confere o download com o checksum. Se não baterem, ele para e não instala nada.
3. Salva o gateway como `~/.local/bin/droidpier` e o torna executável.
4. Inicia o gateway em segundo plano com `droidpier start`.

O gateway roda em segundo plano. Você pode fechar a janela do Terminal: o gateway continua rodando e inicia de novo quando você faz login. Execute `droidpier stop` para pará-lo e `droidpier status` para verificá-lo.

Quando você executa o mesmo comando de novo:

- Se a sua cópia está atualizada, ele pula o download e reinicia o gateway.
- Se existe uma versão mais nova, ele atualiza a sua cópia e reinicia o gateway, para que a nova versão rode.
- Se não consegue acessar o site de download, ele avisa e inicia a cópia que você já tem.
- Se já há um gateway rodando em uma janela do Terminal, ele avisa e não inicia nada. Pare esse primeiro com `Ctrl+C`.

Para passar opções ao gateway, ou para instalar sem iniciá-lo, veja [Linha de comando](/pt-br/docs/reference/cli/#start-with-the-install-command).

## Execute o droidpier diretamente

<!-- verify: phase 3 -->

Depois da instalação, você também pode usar o comando `droidpier`. `droidpier start` inicia o gateway em segundo plano, como o comando de instalação. `droidpier` sozinho o roda na janela do Terminal até você pressionar `Ctrl+C`:

```sh
droidpier start
```

Se o seu shell informar `command not found`, `~/.local/bin` não está no seu `PATH`. Nesse caso, o script de instalação mostra uma dica. Adicione-o, por exemplo em `~/.zshrc`:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

Depois abra uma nova janela do Terminal e tente novamente.

## Atualizar

<!-- verify: phase 3 -->

Execute o mesmo comando de novo. Ele substitui o arquivo em `~/.local/bin` quando existe uma versão mais nova e reinicia o gateway para que a nova versão rode.

<!-- verify: phase 3 -->
Quando a página é mais nova que o seu gateway, a página avisa que o gateway está desatualizado e mostra o comando para atualizá-lo.

## Próximo passo

[Primeira execução](/pt-br/docs/getting-started/first-run/): deixe o gateway verificar seu Android SDK, abra a página e permita o acesso à rede local.
