---
title: Risoluzione dei problemi
description: Risolvi i problemi comuni - Chrome ha bloccato l’accesso alla rete locale, porta già in uso, nessun emulatore trovato, la pagina non si connette, versioni non corrispondenti.
sourceHash: d8eaddc9fa12
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

Se il gateway è in background, eseguire di nuovo il comando lo riavvia. Se un gateway è in esecuzione in una finestra del Terminale, il comando non ne avvia un secondo: segnala che droidpier è già in esecuzione sulla porta `7300`. Arresta quello con `Ctrl+C`, poi esegui di nuovo il comando.

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

Il gateway resta in esecuzione quando non trova emulatori e ne indica il motivo: nel Terminale, o nel suo log quando è in background (`droidpier logs`).

<!-- verify: phase 3 -->
Se il gateway segnala che mancano `emulator`, `platform-tools`, un’immagine di sistema o un dispositivo, completa la configurazione nella pagina. Vedi [Primo avvio](/it/docs/getting-started/first-run/#2-let-it-check-your-android-sdk).

## Manca l’immagine di sistema di un dispositivo

<!-- verify: phase 3 -->
Se hai rimosso un’immagine di sistema, ad esempio in Android Studio, i dispositivi che la usano non possono partire. La pagina indica ciascuno di questi dispositivi e la versione di Android che gli manca, e propone di reinstallare quell’immagine. Basta un dispositivo in grado di partire: la pagina smette di chiedere appena un dispositivo qualsiasi ha la sua immagine di sistema.

## Un’installazione non riesce

<!-- verify: phase 3 -->
La pagina mostra il motivo sotto l’elemento. Se un download non corrisponde al checksum pubblicato da Google, non viene estratto nulla; installa di nuovo l’elemento. Se per un minuto non arrivano dati, il download si interrompe; controlla la connessione di rete e riprova. Droidpier non ha bisogno di Java né degli strumenti da riga di comando, quindi la mancanza di `sdkmanager` non è un problema.

## La pagina non si connette

<!-- verify: phase 3 -->
La pagina cerca il gateway una volta al secondo e si connette non appena risponde. Se continua ad attendere:

- Esegui `droidpier status` per verificare che il gateway sia in esecuzione. Se non lo è, esegui `droidpier start`. `droidpier logs` mostra perché si è fermato.
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

## Disinstallare {#uninstall}

Arresta il gateway in background, poi elimina i file che usa:

```sh
droidpier stop
rm ~/.local/bin/droidpier
rm -r ~/.local/share/droidpier ~/Library/Logs/Droidpier
```

Se hai già eliminato `droidpier` ma il gateway in background è ancora in esecuzione o si avvia all’accesso, rimuovilo a mano:

```sh
launchctl bootout gui/$(id -u)/dev.devpier.droidpier
rm ~/Library/LaunchAgents/dev.devpier.droidpier.plist
```
