---
title: Riga di comando
description: Opzioni e variabili d’ambiente del comando del gateway Droidpier.
sourceHash: eef348a17cbd
---

<!-- verify: phase 3 -->
```sh
droidpier start [--port <port>] [--local] [--no-open]
droidpier stop
droidpier status
droidpier logs
droidpier [--port <port>] [--local] [--no-open]
```

| Comando | Effetto |
|---|---|
| `droidpier start` | Esegue il gateway in background, come LaunchAgent di macOS. Continua dopo la chiusura del Terminale, si avvia all’accesso e si riavvia se va in crash. Se è già in esecuzione, lo riavvia. Salva le opzioni indicate; senza opzioni, mantiene quelle salvate. Apre la pagina una volta, a meno di `--no-open`. |
| `droidpier stop` | Arresta il gateway in background. Non si avvia più all’accesso. |
| `droidpier status` | Mostra se il gateway in background è in esecuzione, con ID di processo, porta, versione e file di log. |
| `droidpier logs` | Stampa il percorso del file di log e le sue ultime 50 righe. |
| `droidpier` | Esegue il gateway in questa finestra del Terminale finché non premi `Ctrl+C`. |

Arrestare il gateway non arresta gli emulatori in esecuzione.

## Avvio con il comando di installazione {#start-with-the-install-command}

Il comando di installazione, `curl -fsSL https://droid.devpier.dev/install.sh | sh`, installa o aggiorna il gateway, poi esegue `droidpier start`. Per passargli delle opzioni, mettile dopo `sh -s --`. Vengono salvate per il gateway in background:

```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh -s -- --port 7310
```

Per installare o aggiornare senza avviare il gateway, imposta `DROIDPIER_NO_START=1`:

```sh
curl -fsSL https://droid.devpier.dev/install.sh | DROIDPIER_NO_START=1 sh
```

Per eseguire il gateway nella finestra del Terminale, come prima, imposta `DROIDPIER_FOREGROUND=1`:

```sh
curl -fsSL https://droid.devpier.dev/install.sh | DROIDPIER_FOREGROUND=1 sh
```

## Opzioni

| Opzione | Predefinito | Effetto |
|---|---|---|
| `--port <port>` | `7300` | La porta su cui il gateway è in ascolto, solo su `127.0.0.1`. |

<!-- verify: phase 3 -->
| Opzione | Predefinito | Effetto |
|---|---|---|
| `--local` | disattivato | Apre la pagina servita dal gateway stesso, `http://127.0.0.1:<port>/app/`, invece della pagina pubblica su `droid.devpier.dev`. |
| `--no-open` | disattivato | Non apre il browser all’avvio. Il gateway stampa comunque l’indirizzo. |

Con o senza `--no-open`, la pagina trova il gateway da sola. Vedi [Primo avvio](/it/docs/getting-started/first-run/#3-open-the-page).

## Variabili d’ambiente

| Variabile | Effetto |
|---|---|
| `ANDROID_HOME` | La directory dell’Android SDK. Se non è impostata, il gateway usa `~/Library/Android/sdk`. |
| `ANDROID_AVD_HOME` | La directory che contiene gli AVD. Se non è impostata, il gateway usa `avd` dentro `ANDROID_USER_HOME`, oppure `~/.android/avd`, come l'emulatore. |
| `ANDROID_USER_HOME` | La directory utente di Android. Se non è impostata, il gateway usa `~/.android`. |
| `DEBUG=1` | Stampa una riga al secondo per ogni connessione: frame ricevuti, inviati e scartati, dimensione media dei frame e ritardo dall’emulatore al gateway. |

<!-- verify: phase 2 -->
`ANDROID_AVD_HOME` viene letta quando il gateway elenca i dispositivi.

<!-- verify: phase 3 -->
`ANDROID_HOME` viene letta dal controllo del primo avvio.

Se `ANDROID_HOME`, `ANDROID_AVD_HOME` e `ANDROID_USER_HOME` sono impostate, `droidpier start` le salva per il gateway in background, perché launchd non legge il profilo della shell. Esegui di nuovo `droidpier start` dopo averle cambiate.

## Cosa stampa

All’avvio, il gateway stampa l’indirizzo della pagina. Se nessun emulatore è in esecuzione, stampa il motivo e continua a funzionare.

<!-- verify: phase 3 -->
Per impostazione predefinita, l’indirizzo stampato è la pagina pubblica, `https://droid.devpier.dev/app/`. Quando il gateway non usa la porta `7300`, l’indirizzo termina con `#port=<port>`. Con `--local`, è la pagina locale, `http://127.0.0.1:<port>/app/`. Il gateway apre l’indirizzo con il comando `open` di macOS, a meno che tu non passi `--no-open`.

Se sulla porta è già in esecuzione un gateway, un secondo non si avvia. Segnala che droidpier è già in esecuzione, con la porta, e apre la pagina. Se quello in esecuzione è il gateway in background, stampa anche `droidpier stop`. Se un altro programma usa la porta, lo segnala, propone un’altra porta ed esce.

<!-- verify: phase 3 -->
Quando mancano parti dell’Android SDK, il gateway elenca ciascuna con un comando per installarla a mano e ti chiede di completare la configurazione nella pagina. Non fa mai domande nel Terminale: installazioni, nuovi dispositivi e licenze si confermano nella pagina. Vedi [Primo avvio](/it/docs/getting-started/first-run/#2-let-it-check-your-android-sdk).

## File e porte che usa

| Cosa | Dove |
|---|---|
| Indirizzo di ascolto del gateway | `127.0.0.1:<port>` |
| Rilevamento degli emulatori in esecuzione | `~/Library/Caches/TemporaryItems/avd/running/pid_<pid>.ini` |

<!-- verify: phase 2 -->
| Cosa | Dove |
|---|---|
| Porte gRPC che assegna agli emulatori | La prima porta pari libera a partire da `8554` |

<!-- verify: phase 3 -->
| Cosa | Dove |
|---|---|
| Eseguibile installato | `~/.local/bin/droidpier` |
| Checksum della versione installata | `~/.local/share/droidpier/installed.sha256` |
| Impostazioni del gateway in background | `~/Library/LaunchAgents/dev.devpier.droidpier.plist` |
| Log del gateway in background | `~/Library/Logs/Droidpier/droidpier.log` |

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
