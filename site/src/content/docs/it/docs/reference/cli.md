---
title: Riga di comando
description: Opzioni e variabili d’ambiente del comando del gateway Droidpier.
sourceHash: 6811a7927009
---

<!-- verify: phase 3 -->
```sh
droidpier [--port <port>] [--local] [--no-open]
```

Il gateway resta in esecuzione in primo piano finché non premi `Ctrl+C`. Arrestarlo non arresta gli emulatori in esecuzione.

## Avvio con il comando di installazione {#start-with-the-install-command}

Il comando di installazione, `curl -fsSL https://droid.devpier.dev/install.sh | sh`, installa o aggiorna il gateway e poi lo avvia. Per passare opzioni al gateway, scrivile dopo `sh -s --`:

```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh -s -- --port 7310
```

Per installare o aggiornare senza avviare il gateway, imposta `DROIDPIER_NO_START=1`:

```sh
curl -fsSL https://droid.devpier.dev/install.sh | DROIDPIER_NO_START=1 sh
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
| `ANDROID_AVD_HOME` | La directory che contiene gli AVD. Se non è impostata, il gateway usa `~/.android/avd`. |
| `DEBUG=1` | Stampa una riga al secondo per ogni connessione: frame ricevuti, inviati e scartati, dimensione media dei frame e ritardo dall’emulatore al gateway. |

<!-- verify: phase 2 -->
`ANDROID_AVD_HOME` viene letta quando il gateway elenca i dispositivi.

<!-- verify: phase 3 -->
`ANDROID_HOME` viene letta dal controllo del primo avvio.

## Cosa stampa

All’avvio, il gateway stampa l’indirizzo della pagina. Se nessun emulatore è in esecuzione, stampa il motivo e continua a funzionare.

<!-- verify: phase 3 -->
Per impostazione predefinita, l’indirizzo stampato è la pagina pubblica, `https://droid.devpier.dev/app/`. Quando il gateway non usa la porta `7300`, l’indirizzo termina con `#port=<port>`. Con `--local`, è la pagina locale, `http://127.0.0.1:<port>/app/`. Il gateway apre l’indirizzo con il comando `open` di macOS, a meno che tu non passi `--no-open`.

Se sulla porta è già in esecuzione un gateway, non se ne avvia un secondo. Stampa che droidpier è già in esecuzione, con la porta, e apre la pagina. Se un altro programma usa la porta, lo segnala, suggerisce un’altra porta e termina.

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
