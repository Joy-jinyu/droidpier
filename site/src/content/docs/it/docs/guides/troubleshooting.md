---
title: Risoluzione dei problemi
description: Risolvi i problemi comuni - Chrome ha bloccato l’accesso alla rete locale, porta già in uso, nessun emulatore trovato, la pagina non si connette, versioni non corrispondenti.
sourceHash: 711f2e4dd61a
---

## Chrome ha bloccato l’accesso alla rete locale {#chrome-blocked-local-network-access}

<!-- verify: phase 3 -->
La pagina su `droid.devpier.dev` si connette al gateway sul tuo Mac. Chrome chiede l’autorizzazione la prima volta. Se l’hai negata, la pagina non riesce a connettersi e, dopo alcuni tentativi falliti, ti avvisa che Chrome ha bloccato l’accesso al tuo Mac.

Per consentirlo di nuovo:

1. Apri in Chrome **Impostazioni → Privacy e sicurezza → Impostazioni sito**.
2. Trova `droid.devpier.dev` e consenti l’accesso alla rete locale.
3. Ricarica la pagina.

Se ancora non riesci a connetterti, usa la [pagina locale di riserva](#use-the-local-fallback-page).

## Porta già in uso

Il gateway è in ascolto sulla porta `7300` per impostazione predefinita.

Se esegui di nuovo il comando mentre il gateway è ancora in esecuzione, non se ne avvia un secondo. Ti segnala che droidpier è già in esecuzione sulla porta `7300` e apre la pagina. Usa quella pagina, oppure arresta prima il gateway in esecuzione con `Ctrl+C`.

Se un altro programma usa la porta, il gateway lo segnala, suggerisce un’altra porta e termina. Trova il programma:

```sh
lsof -nP -iTCP:7300 -sTCP:LISTEN
```

Arresta quel programma, oppure avvia il gateway su un’altra porta:

```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh -s -- --port 7301
```

Dopo l’installazione, `droidpier --port 7301` fa lo stesso.

<!-- verify: phase 3 -->
Il gateway inserisce la nuova porta nell’indirizzo che apre, così la pagina si connette alla porta giusta.

## Nessun emulatore trovato

Se la pagina dice che non è stato trovato nessun emulatore in esecuzione:

- Controlla che un emulatore sia in esecuzione: `adb devices` dovrebbe elencare `emulator-5554` o simile.
- Controlla che sia stato avviato con gRPC abilitato (`-grpc <port>`). Il gateway non può leggere lo schermo di un emulatore senza gRPC.

<!-- verify: phase 2 -->
Puoi anche avviare un dispositivo dall’elenco nella pagina. Vedi [Dispositivi](/it/docs/guides/devices/).

Il gateway continua a funzionare quando non trova nessun emulatore, e stampa il motivo nel Terminale.

<!-- verify: phase 3 -->
Se il gateway segnala che mancano l’Android SDK, `emulator`, `platform-tools` o l’immagine di sistema, segui la soluzione che stampa. Vedi [Primo avvio](/it/docs/getting-started/first-run/#2-let-it-check-your-android-sdk).

## Manca «sdkmanager»

<!-- verify: phase 3 -->
Un SDK installato da Android Studio potrebbe non includere `cmdline-tools`, che fornisce `sdkmanager` e `avdmanager`. La pagina offre di installarlo: con il pulsante di installazione accanto nell’elenco degli elementi mancanti, oppure nella finestra di creazione di un dispositivo. Dopo la tua conferma, il gateway scarica da Google gli strumenti da riga di comando 22.0 nel tuo SDK. La pagina mostra per intero ogni licenza di Google e installa solo se accetti.

`sdkmanager` richiede Java. Se non ce l’hai, installa Android Studio, che include Java, oppure JDK 17 o successivo, poi riapri la pagina.

Per installare gli strumenti a mano, scarica gli strumenti da riga di comando di Google da developer.android.com ed estraili in modo che esista questo percorso:

```text
<your SDK>/cmdline-tools/latest/bin/sdkmanager
```

## La pagina non si connette

<!-- verify: phase 3 -->
La pagina cerca il gateway una volta al secondo e si connette non appena risponde. Se continua ad attendere:

- Controlla che la finestra del Terminale in cui hai eseguito il comando sia ancora aperta. Chiudere la finestra o premere `Ctrl+C` arresta il gateway. Esegui di nuovo il comando per avviarlo.
- Controlla che Chrome consenta l’accesso alla rete locale per `droid.devpier.dev`. Vedi [Chrome ha bloccato l’accesso alla rete locale](#chrome-blocked-local-network-access).
- Se hai avviato il gateway con `--port`, apri l’indirizzo che ha stampato, che termina con `#port=<port>`.
- Porta la scheda in primo piano. La pagina non controlla mentre la scheda è in background.

## Il comando di installazione non riesce

- **Checksum non valido:** il download non corrispondeva al suo checksum, quindi non è stato installato nulla. Esegui di nuovo il comando.
- **Sito di download non raggiungibile:** se Droidpier è già installato, il comando ti avvisa e avvia la copia che hai. Se non è ancora installato, controlla la connessione a internet ed esegui di nuovo il comando.

## La pagina dice che il gateway o la pagina non sono aggiornati

<!-- verify: phase 3 -->
- **Gateway non aggiornato:** esegui il comando di aggiornamento mostrato dalla pagina. È lo stesso del [comando di installazione](/it/docs/getting-started/install/).
- **Pagina non aggiornata:** forza il ricaricamento della pagina con Cmd+Shift+R.

## Browser sbagliato

<!-- verify: phase 3 -->
La pagina funziona solo in Chrome ed Edge. Negli altri browser ti chiede di cambiare browser e non tenta di connettersi. Vedi [Browser supportati](/it/docs/reference/browser-support/).

## Usa la pagina locale di riserva {#use-the-local-fallback-page}

Il gateway serve la stessa pagina all’indirizzo `http://127.0.0.1:7300/app/` (o sulla porta che hai scelto). Usala quando la pagina pubblica non si carica o l’accesso alla rete locale è stato negato.

Esegui `droidpier --local` per fare in modo che il gateway apra la pagina locale invece di quella pubblica.

## Lo schermo smette di aggiornarsi

Se l’emulatore si chiude o si riavvia, la pagina mostra che è disconnessa. Il gateway continua a funzionare. Quando l’emulatore torna disponibile, la pagina si riconnette e lo schermo ricompare.
