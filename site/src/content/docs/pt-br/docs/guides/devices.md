---
title: Dispositivos
description: Liste seus dispositivos virtuais Android, inicie e pare-os pela página e assuma o controle de um emulador que já está em execução.
sourceHash: 160631b5e5d9
---

Aqui, um dispositivo é um Android Virtual Device (AVD) no seu Mac. A página mostra um dispositivo por vez.

## A lista de dispositivos

<!-- verify: phase 2 -->
A lista à esquerda mostra cada AVD informado por `emulator -list-avds`. Para cada um, ela mostra:

- o nome;
- a resolução da tela;
- a versão do Android;
- o estado: parado, inicializando (com os segundos decorridos), em execução, ou em execução mas sem possibilidade de assumir o controle;
- um botão de iniciar ou parar.

<!-- verify: phase 2 -->
Resolução, RAM e versão do Android vêm do `config.ini` de cada AVD em `~/.android/avd/<name>.avd/`. Se você definir `ANDROID_AVD_HOME`, o gateway lê esse diretório em vez disso. Se um campo estiver ausente no `config.ini`, ele fica em branco.

## Iniciar um dispositivo

<!-- verify: phase 2 -->
Clique em iniciar ao lado de um dispositivo. O gateway executa:

```sh
emulator -avd <name> -no-window -grpc <port> -no-boot-anim -gpu host
```

- `-no-window` significa que nenhuma janela separada do emulador é aberta. A tela aparece apenas na página.
- A porta gRPC é a primeira porta par livre a partir de `8554`.
- O dispositivo é considerado inicializado quando `adb -s emulator-<serial> shell getprop sys.boot_completed` retorna `1`. Até lá, a página mostra o progresso.
- Se o dispositivo não tiver inicializado após 180 segundos, a inicialização falha e o gateway encerra o processo do emulador.

<!-- verify: phase 2 -->
Clicar em iniciar de novo enquanto um dispositivo está inicializando não inicia uma segunda cópia. Se você fechar a página durante a inicialização e abri-la novamente, o progresso continua.

## Parar um dispositivo

<!-- verify: phase 2 -->
Clique em parar. O gateway executa `adb -s emulator-<serial> emu kill`.

## Emuladores que já estão em execução

O gateway encontra emuladores em execução pelos arquivos que o emulador grava em `~/Library/Caches/TemporaryItems/avd/running/`. Se um emulador estiver rodando com gRPC ativado, por exemplo um que você iniciou com `-grpc <port>`, o gateway se conecta a ele em vez de iniciar outra cópia.

<!-- verify: phase 2 -->
Um emulador que roda sem gRPC é marcado como "em execução mas sem possibilidade de assumir o controle". O gateway precisa do gRPC para ler a tela e enviar entradas. Pare esse emulador e inicie-o pela página.

## Quando o gateway para

Parar o gateway não para os emuladores. Quando você inicia o gateway novamente, ele se conecta a eles de novo.

## Criar um dispositivo

<!-- verify: phase 3 -->
Crie dispositivos na página. Use o botão de novo dispositivo, escolha um modelo de dispositivo e uma versão do Android e dê um nome ao dispositivo; a página sugere um. Antes de qualquer coisa, a página mostra o modelo, a versão do Android e a memória do dispositivo. Se a imagem de sistema dessa versão ainda não estiver instalada, o gateway a baixa depois que você confirma e concorda com a licença do Google.

Criar um dispositivo não exige o Android Studio nem as ferramentas de linha de comando: o gateway grava os arquivos do dispositivo ele mesmo, no formato que o Android Studio usa. Veja [Primeira execução](/pt-br/docs/getting-started/first-run/#2-let-it-check-your-android-sdk).

Você também pode criar dispositivos no Device Manager do Android Studio; a lista os detecta.

## Excluir um dispositivo

Clique no ícone de lixeira ao lado de um dispositivo e confirme. Isso exclui o dispositivo e todos os seus dados (apps instalados, arquivos, snapshots); não é possível desfazer. A imagem do sistema continua instalada. Um dispositivo em execução ou inicializando não pode ser excluído: pare-o primeiro.
