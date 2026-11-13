---
title: Primo avvio
description: Avvia il gateway con un solo comando, lascia che controlli l’Android SDK, consenti l’accesso alla rete locale in Chrome e vedi il tuo emulatore nel browser.
sourceHash: c1c836eb6e73
---

Esegui un comando nel Terminale, apri `https://droid.devpier.dev/app/` e consenti l’accesso alla rete locale quando Chrome lo chiede.

## 1. Avvia il gateway

```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh
```

Installa o aggiorna il gateway se serve, poi lo avvia. Vedi [Installazione](/it/docs/getting-started/install/). Dopo l’installazione, anche `droidpier start` lo avvia.

Il gateway resta in esecuzione in background. Puoi chiudere la finestra del Terminale.

Il gateway è in ascolto su `127.0.0.1`, sulla porta `7300` per impostazione predefinita. Per usare un’altra porta, vedi [Riga di comando](/it/docs/reference/cli/).

## 2. Lascia che controlli il tuo Android SDK {#2-let-it-check-your-android-sdk}

<!-- verify: phase 3 -->
All’avvio, il gateway verifica che un dispositivo possa partire: servono l’emulatore Android (`emulator`), `adb` di `platform-tools` e almeno un dispositivo virtuale (AVD) con la sua immagine di sistema installata. Va bene qualsiasi versione di Android. Se manca qualcosa, elenca ogni elemento nel Terminale e ti invita a completare la configurazione nella pagina. Nel Terminale non chiede nulla.

Quando il gateway è in background, questo elenco finisce nel suo log. Esegui `droidpier logs` per vederlo.

<!-- verify: phase 3 -->
La pagina mostra lo stesso elenco, con la dimensione del download di ogni elemento. Quando un dispositivo può partire, non mostra nulla.

| Mancante | Cosa fai nella pagina |
|---|---|
| `emulator`, `platform-tools`, immagine di sistema | Installa un elemento con il pulsante accanto, oppure installali tutti insieme. Se non è installata nessuna immagine di sistema, la pagina propone Android 14 (`system-images;android-34;google_apis;arm64-v8a`). Se l’immagine di sistema di un dispositivo è stata rimossa, la pagina indica il dispositivo e propone quell’immagine. |
| Nessun dispositivo | Crea un dispositivo: scegli un modello di dispositivo e una versione di Android. Se un’immagine di sistema è già installata, la pagina la suggerisce invece di scaricare Android 14. |

Non ti servono Java né gli strumenti da riga di comando (`sdkmanager`, `avdmanager`). Il gateway scarica ogni componente dal repository SDK di Google, la stessa fonte usata da Android Studio, e crea la cartella dell’SDK se non esiste ancora.

<!-- verify: phase 3 -->
Non viene scaricato né creato nulla finché non confermi nella pagina. Prima di iniziare, la pagina mostra cosa scaricherà, dove lo installerà e quanto spazio su disco serve. Prima di ogni download, la pagina mostra per intero la licenza di Google, e l’elemento viene installato solo se accetti. Come Android Studio, il gateway registra il tuo consenso nella cartella `licenses` dell’SDK e controlla ogni download con il checksum pubblicato da Google prima di estrarre qualsiasi cosa.

Se preferisci installare un elemento da solo, espandi la sezione di installazione manuale sotto di esso nella pagina. Indica dove trovarlo in Android Studio e dove viene installato.

## 3. Apri la pagina {#3-open-the-page}

<!-- verify: phase 3 -->
Apri `https://droid.devpier.dev/app/` in Chrome o Edge. Quando il gateway si avvia, stampa anche questo indirizzo e lo apre nel tuo browser predefinito. Se il tuo browser predefinito non è Chrome o Edge, apri tu stesso l’indirizzo in Chrome o Edge.

La pagina si connette da sola. Finché nessun gateway risponde, controlla una volta al secondo e si connette non appena il gateway si avvia, senza ricaricare. Non controlla mentre la scheda è in background.

Se il gateway non usa la porta `7300`, l’indirizzo che stampa termina con `#port=<port>`:

```text
https://droid.devpier.dev/app/#port=7301
```

Apri quell’indirizzo, così la pagina trova la porta giusta.

## 4. Consenti l’accesso alla rete locale {#4-allow-local-network-access}

<!-- verify: phase 3 -->
La prima volta che la pagina si connette al gateway sul tuo Mac, Chrome mostra una richiesta di autorizzazione che chiede se `droid.devpier.dev` può accedere alla tua rete locale. Fai clic su **Consenti**. Chrome ricorda la scelta per il sito.

Se l’hai negato, vedi [Risoluzione dei problemi](/it/docs/guides/troubleshooting/#chrome-blocked-local-network-access).

## 5. Usa l’emulatore

Se è già in esecuzione un emulatore con gRPC, la pagina mostra il suo schermo.

<!-- verify: phase 2 -->
Altrimenti scegli un dispositivo nell’elenco e avvialo. Vedi [Dispositivi](/it/docs/guides/devices/).

Fai clic sullo schermo per dargli il focus della tastiera. Poi:

- Fai clic per toccare; trascina per fare uno swipe.
- Scrivi con la tastiera del tuo Mac. Vedi [Tastiera e input](/it/docs/guides/keyboard-and-input/).
- Usa i pulsanti Indietro, Home e App recenti sopra lo schermo.

## Arresto

Esegui `droidpier stop`. Se hai avviato il gateway con `droidpier` in una finestra del Terminale, premi invece `Ctrl+C` lì. Gli emulatori in esecuzione continuano a funzionare. La prossima volta che avvii il gateway, con lo stesso comando o con `droidpier start`, si ricollega a loro.

## La pagina locale di riserva

Il gateway serve anche la stessa pagina all’indirizzo `http://127.0.0.1:7300/app/` (o sulla porta che hai scelto). Usala se la pagina pubblica non si carica o non riesce a connettersi.

Per fare in modo che il gateway apra la pagina locale invece di quella pubblica, avvialo con `--local`:

```sh
droidpier --local
```
