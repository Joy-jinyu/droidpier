---
title: Installazione
description: Installa e avvia il gateway di Droidpier su un Mac con Apple Silicon con un solo comando.
sourceHash: 9e0b6fc5fcb6
---

Per iniziare bastano due passaggi:

1. Esegui il comando qui sotto nel Terminale e lascia la finestra aperta. Installa Droidpier e lo avvia.
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
4. Avvia il gateway.

Il gateway resta in esecuzione in quella finestra del Terminale. Lasciala aperta mentre usi la pagina. Premi `Ctrl+C` per arrestarlo.

Quando esegui di nuovo lo stesso comando:

- Se la tua copia è aggiornata, salta il download e avvia il gateway.
- Se esiste una versione più recente, aggiorna la tua copia e poi la avvia.
- Se il sito di download non è raggiungibile, ti avvisa e avvia la copia che hai già.
- Se il gateway è già in esecuzione, te lo segnala e apre la pagina. Non ne avvia un secondo.

Per passare opzioni al gateway, o per installare senza avviarlo, vedi [Riga di comando](/it/docs/reference/cli/#start-with-the-install-command).

## Esegui droidpier direttamente

<!-- verify: phase 3 -->

Dopo l’installazione puoi avviare il gateway anche con il comando `droidpier`:

```sh
droidpier
```

Se la tua shell segnala `command not found`, `~/.local/bin` non è nel tuo `PATH`. In questo caso lo script di installazione mostra un suggerimento. Aggiungilo, ad esempio in `~/.zshrc`:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

Poi apri una nuova finestra del Terminale e riprova.

## Aggiornamento

<!-- verify: phase 3 -->

Esegui di nuovo lo stesso comando. Se esiste una versione più recente, sostituisce il file in `~/.local/bin`. Se il gateway è ancora in esecuzione, arrestalo prima con `Ctrl+C`, così il comando avvia la nuova versione.

<!-- verify: phase 3 -->
Quando la pagina è più recente del tuo gateway, la pagina ti avvisa che il gateway non è aggiornato e mostra il comando per aggiornarlo.

## Passaggio successivo

[Primo avvio](/it/docs/getting-started/first-run/): lascia che il gateway controlli il tuo Android SDK, apri la pagina e consenti l’accesso alla rete locale.
