---
title: Linha de comando
description: Opções e variáveis de ambiente do comando do gateway Droidpier.
sourceHash: 6811a7927009
---

<!-- verify: phase 3 -->
```sh
droidpier [--port <port>] [--local] [--no-open]
```

O gateway roda em primeiro plano até você pressionar `Ctrl+C`. Pará-lo não para os emuladores em execução.

## Inicie com o comando de instalação {#start-with-the-install-command}

O comando de instalação, `curl -fsSL https://droid.devpier.dev/install.sh | sh`, instala ou atualiza o gateway e depois o inicia. Para passar opções ao gateway, coloque-as depois de `sh -s --`:

```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh -s -- --port 7310
```

Para instalar ou atualizar sem iniciar o gateway, defina `DROIDPIER_NO_START=1`:

```sh
curl -fsSL https://droid.devpier.dev/install.sh | DROIDPIER_NO_START=1 sh
```

## Opções

| Opção | Padrão | Efeito |
|---|---|---|
| `--port <port>` | `7300` | A porta em que o gateway escuta, apenas em `127.0.0.1`. |

<!-- verify: phase 3 -->
| Opção | Padrão | Efeito |
|---|---|---|
| `--local` | desativado | Abre a página que o próprio gateway serve, `http://127.0.0.1:<port>/app/`, em vez da página pública em `droid.devpier.dev`. |
| `--no-open` | desativado | Não abre o navegador ao iniciar. O gateway ainda mostra o endereço. |

Com ou sem `--no-open`, a página encontra o gateway sozinha. Veja [Primeira execução](/pt-br/docs/getting-started/first-run/#3-open-the-page).

## Variáveis de ambiente

| Variável | Efeito |
|---|---|
| `ANDROID_HOME` | O diretório do Android SDK. Sem ela, o gateway usa `~/Library/Android/sdk`. |
| `ANDROID_AVD_HOME` | O diretório que contém os AVDs. Sem ela, o gateway usa `~/.android/avd`. |
| `DEBUG=1` | Mostra uma linha por segundo para cada conexão: quadros recebidos, enviados e descartados, tamanho médio do quadro e o atraso do emulador até o gateway. |

<!-- verify: phase 2 -->
`ANDROID_AVD_HOME` é lida quando o gateway lista os dispositivos.

<!-- verify: phase 3 -->
`ANDROID_HOME` é lida pela verificação da primeira execução.

## O que ele mostra

Ao iniciar, o gateway mostra o endereço da página. Se nenhum emulador estiver em execução, ele mostra o motivo e continua rodando.

<!-- verify: phase 3 -->
Por padrão, o endereço mostrado é a página pública, `https://droid.devpier.dev/app/`. Quando o gateway não está rodando na porta `7300`, o endereço termina em `#port=<port>`. Com `--local`, é a página local, `http://127.0.0.1:<port>/app/`. O gateway abre o endereço com o comando `open` do macOS, a menos que você passe `--no-open`.

Se já houver um gateway rodando na porta, um segundo não inicia. Ele mostra que o droidpier já está rodando, com a porta, e abre a página. Se outro programa usa a porta, ele avisa, sugere outra porta e sai.

<!-- verify: phase 3 -->
Quando faltam partes do Android SDK, o gateway lista cada uma com um comando para instalá-la manualmente e pede que você termine a configuração na página. Ele nunca pergunta nada no Terminal: instalações, novos dispositivos e licenças são confirmados na página. Veja [Primeira execução](/pt-br/docs/getting-started/first-run/#2-let-it-check-your-android-sdk).

## Arquivos e portas que ele usa

| O quê | Onde |
|---|---|
| Endereço de escuta do gateway | `127.0.0.1:<port>` |
| Descoberta de emuladores em execução | `~/Library/Caches/TemporaryItems/avd/running/pid_<pid>.ini` |

<!-- verify: phase 2 -->
| O quê | Onde |
|---|---|
| Portas gRPC do emulador que ele atribui | A primeira porta par livre a partir de `8554` |

<!-- verify: phase 3 -->
| O quê | Onde |
|---|---|
| Executável instalado | `~/.local/bin/droidpier` |
| Checksum da versão instalada | `~/.local/share/droidpier/installed.sha256` |
