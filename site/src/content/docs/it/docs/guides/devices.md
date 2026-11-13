---
title: Dispositivi
description: Elenca i tuoi dispositivi virtuali Android, avviali e arrestali dalla pagina, e prendi il controllo di un emulatore già in esecuzione.
sourceHash: 6eaf456bc1f3
---

Qui un dispositivo è un Android Virtual Device (AVD) sul tuo Mac. La pagina mostra un dispositivo alla volta.

## L’elenco dei dispositivi

<!-- verify: phase 2 -->
L’elenco a sinistra mostra ogni AVD riportato da `emulator -list-avds`. Per ciascuno mostra:

- il nome;
- la risoluzione dello schermo;
- la versione di Android;
- lo stato: non in esecuzione, in avvio (con i secondi trascorsi), in esecuzione, oppure in esecuzione ma impossibile da controllare;
- un pulsante di avvio o di arresto.

<!-- verify: phase 2 -->
Risoluzione, RAM e versione di Android provengono dal `config.ini` di ogni AVD in `~/.android/avd/<name>.avd/`. Se imposti `ANDROID_AVD_HOME`, il gateway legge invece quella directory. Se un campo manca in `config.ini`, viene lasciato vuoto.

## Avviare un dispositivo

<!-- verify: phase 2 -->
Fai clic su avvia accanto a un dispositivo. Il gateway esegue:

```sh
emulator -avd <name> -no-window -grpc <port> -no-boot-anim -gpu host
```

- `-no-window` significa che non si apre una finestra separata dell’emulatore. Lo schermo appare solo nella pagina.
- La porta gRPC è la prima porta pari libera a partire da `8554`.
- Il dispositivo è considerato avviato quando `adb -s emulator-<serial> shell getprop sys.boot_completed` restituisce `1`. Fino ad allora la pagina mostra l’avanzamento.
- Se il dispositivo non ha completato l’avvio dopo 180 secondi, l’avvio fallisce e il gateway termina il processo dell’emulatore.

<!-- verify: phase 2 -->
Fare di nuovo clic su avvia mentre un dispositivo si sta avviando non avvia una seconda istanza. Se chiudi la pagina durante l’avvio e la riapri, l’avanzamento continua.

## Arrestare un dispositivo

<!-- verify: phase 2 -->
Fai clic su arresta. Il gateway esegue `adb -s emulator-<serial> emu kill`.

## Emulatori già in esecuzione

Il gateway trova gli emulatori in esecuzione tramite i file che l’emulatore scrive in `~/Library/Caches/TemporaryItems/avd/running/`. Se un emulatore è in esecuzione con gRPC abilitato, ad esempio uno che hai avviato con `-grpc <port>`, il gateway si connette a esso invece di avviarne un’altra istanza.

<!-- verify: phase 2 -->
Un emulatore in esecuzione senza gRPC viene contrassegnato come «in esecuzione ma impossibile da controllare». Il gateway ha bisogno di gRPC per leggere lo schermo e inviare l’input. Arresta quell’emulatore e avvialo dalla pagina.

## Quando il gateway si arresta

Arrestare il gateway non arresta gli emulatori. Quando avvii di nuovo il gateway, si riconnette a essi.

## Creare un dispositivo

<!-- verify: phase 3 -->
Crea i dispositivi nella pagina. Usa il pulsante per un nuovo dispositivo, scegli un modello di dispositivo e una versione di Android, e dai un nome al dispositivo; la pagina ne suggerisce uno. Prima di procedere, la pagina mostra il modello, la versione di Android e la memoria del dispositivo. Se l’immagine di sistema di quella versione non è ancora installata, il gateway la scarica dopo che hai confermato e accettato la licenza di Google.

Per creare un dispositivo servono gli strumenti da riga di comando (`avdmanager`). Se mancano, la finestra offre di installarli prima. Vedi [Primo avvio](/it/docs/getting-started/first-run/#2-let-it-check-your-android-sdk).

Puoi anche creare dispositivi con `avdmanager` o Android Studio; l’elenco li rileva.

## Eliminare un dispositivo

Fai clic sull'icona del cestino accanto a un dispositivo e conferma. Vengono eliminati il dispositivo e tutti i suoi dati (app installate, file, snapshot); non si può annullare. L'immagine di sistema resta installata. Un dispositivo in esecuzione o in avvio non può essere eliminato: fermalo prima.
