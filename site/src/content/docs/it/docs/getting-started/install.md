---
title: Installazione
description: Installa e avvia il gateway di Droidpier su un Mac con Apple Silicon con un solo comando.
sourceHash: 721a09a23a56
---

Per iniziare bastano due passaggi:

1. Esegui il comando qui sotto nel Terminale. Installa Droidpier e lo avvia in background.
2. Apri `https://droid.devpier.dev/app/`. La pagina si connette da sola. La prima volta, quando Chrome chiede se la pagina può accedere alla tua rete locale, fai clic su **Consenti**.

Il passaggio 2 è descritto in [Primo avvio](/it/docs/getting-started/first-run/).

<!-- verify: phase 3 -->
Il comando `droidpier` è il gateway: un unico file eseguibile che collega l’emulatore Android sul tuo Mac alla pagina nel browser. Non ti serve Node.js per eseguirlo.

## Esegui il comando

<!-- verify: phase 3 -->

Prima controlla i [requisiti](/it/docs/getting-started/requirements/). Poi esegui questo comando nel Terminale:

<!-- 待第 3 阶段 Task 5 确认 -->
```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh
```

La prima volta, lo script:

1. Scarica il gateway per macOS su Apple Silicon, `droidpier-darwin-arm64.tar.xz`, da `https://droid.devpier.dev/download/`. Il checksum si trova accanto, in `droidpier-darwin-arm64.tar.xz.sha256`.
2. Controlla il download con il checksum. Se non corrispondono, si ferma e non installa nulla.
3. Salva il gateway come `~/.local/bin/droidpier` e lo rende eseguibile.
4. Avvia il gateway in background con `droidpier start`.

Il gateway resta in esecuzione in background. Puoi chiudere la finestra del Terminale: il gateway continua a funzionare e si riavvia quando accedi. Esegui `droidpier stop` per arrestarlo e `droidpier status` per controllarlo.

Quando esegui di nuovo lo stesso comando:

- Se la tua copia è aggiornata, salta il download e riavvia il gateway.
- Se esiste una versione più recente, aggiorna la tua copia e riavvia il gateway, così gira la nuova versione.
- Se il sito di download non è raggiungibile, ti avvisa e avvia la copia che hai già.
- Se un gateway è già in esecuzione in una finestra del Terminale, lo segnala e non avvia nulla. Arresta prima quello con `Ctrl+C`.

Per passare opzioni al gateway, o per installare senza avviarlo, vedi [Riga di comando](/it/docs/reference/cli/#start-with-the-install-command).

## Esegui droidpier direttamente

<!-- verify: phase 3 -->

Dopo l’installazione puoi usare anche il comando `droidpier`. `droidpier start` avvia il gateway in background, come il comando di installazione. `droidpier` da solo lo esegue nella finestra del Terminale finché non premi `Ctrl+C`:

```sh
droidpier start
```

Se la tua shell segnala `command not found`, `~/.local/bin` non è nel tuo `PATH`. In questo caso lo script di installazione mostra un suggerimento. Aggiungilo, ad esempio in `~/.zshrc`:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

Poi apri una nuova finestra del Terminale e riprova.

## Aggiornamento

<!-- verify: phase 3 -->

Esegui di nuovo lo stesso comando. Sostituisce il file in `~/.local/bin` quando esiste una versione più recente e riavvia il gateway, così gira la nuova versione.

<!-- verify: phase 3 -->
Quando la pagina è più recente del tuo gateway, la pagina ti avvisa che il gateway non è aggiornato e mostra il comando per aggiornarlo.

## Passaggio successivo

[Primo avvio](/it/docs/getting-started/first-run/): lascia che il gateway controlli il tuo Android SDK, apri la pagina e consenti l’accesso alla rete locale.
