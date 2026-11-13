---
title: Sicurezza
description: Come il gateway impedisce ad altre pagine web e ad altri computer di controllare il tuo emulatore - solo loopback e un elenco di origini consentite.
sourceHash: 08642471687c
---

La pagina viene servita da `droid.devpier.dev`, ma l’emulatore e il gateway girano sul tuo Mac. Qualsiasi pagina web che apri potrebbe tentare di connettersi a un programma sul tuo Mac, quindi il gateway controlla ogni connessione.

## Solo loopback

Il gateway è in ascolto solo su `127.0.0.1`. Non accetta connessioni dalla tua rete locale né da Internet. Altri computer non possono raggiungerlo.

## Elenco di origini consentite

<!-- verify: phase 3 -->
I browser inviano un’intestazione `Origin` quando una pagina apre un WebSocket, e una pagina web non può falsificarla. Il gateway accetta connessioni solo dalla pagina pubblica su `droid.devpier.dev` e dalla propria pagina locale, cioè solo da queste origini:

- `https://droid.devpier.dev`
- `http://127.0.0.1:<port>`
- `http://localhost:<port>`

<!-- verify: phase 3 -->
Una connessione con qualsiasi altra origine, o senza origine, viene chiusa con il codice `4003`. Una pagina su un altro sito non può controllare il tuo emulatore, anche se indovina la porta.

## Come la pagina trova il gateway

<!-- verify: phase 3 -->
- Finché nessun gateway risponde, la pagina su `droid.devpier.dev/app/` lo cerca una volta al secondo e si connette non appena `droidpier` è in esecuzione. Non controlla mentre la scheda è in background.
- Usa la porta `7300`, oppure la porta dopo `#port=` nell’indirizzo. Il gateway aggiunge `#port=<port>` all’indirizzo che apre solo quando non usa la porta `7300`.
- La pagina non salva la porta nel browser.

## Il sito web non si connette al tuo Mac

<!-- verify: phase 3 -->
L’autorizzazione di Chrome per la rete locale e il controllo dell’origine del gateway funzionano entrambi per sito, non per percorso. Quindi le pagine della documentazione condividono l’autorizzazione con la pagina dell’emulatore in `/app/`. Per limitare le conseguenze:

- Solo la pagina dell’emulatore in `/app/` si connette al gateway. La home page e questa documentazione non lo fanno mai, quindi leggerle non fa comparire la richiesta di autorizzazione.
- Il sito non carica script, stili, font o contenuti multimediali di terze parti. Tutto viene servito da `droid.devpier.dev`.

## Installazione di software

<!-- verify: phase 3 -->
Il gateway non installa mai pacchetti dell’Android SDK né crea dispositivi senza chiedere. Confermi ogni installazione o nuovo dispositivo nella pagina, dopo che ti ha mostrato cosa verrà scaricato e dove. La pagina mostra per intero le licenze di Google, e un elemento viene installato solo se accetti. Gli strumenti da riga di comando dalla versione 23 in poi possono accettare le licenze senza chiedere; la pagina te lo segnala prima che tu confermi. Il gateway non fa domande nel Terminale.

## Codici di chiusura della connessione

<!-- verify: phase 3 -->
| Codice | Significato |
|---|---|
| `4000` | Il primo messaggio non era `hello`. |
| `4002` | La pagina e il gateway usano versioni del protocollo diverse. |
| `4003` | Origine non consentita. |

## Segnalare un problema

Apri una issue su [github.com/twosugar/droidpier](https://github.com/twosugar/droidpier/issues).
