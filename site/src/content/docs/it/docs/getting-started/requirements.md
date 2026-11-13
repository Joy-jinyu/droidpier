---
title: Requisiti
description: Cosa ti serve prima di installare Droidpier - un Mac con Apple Silicon, Chrome o Edge, e l’emulatore Android con un’immagine di sistema arm64.
sourceHash: a1a9610ae52d
---

Droidpier esegue l’emulatore Android ufficiale sul tuo Mac e lo mostra in una scheda del browser. Nulla gira su un server remoto. Installi un piccolo programma locale (il gateway), e ti servono l’emulatore Android e un’immagine di sistema sullo stesso Mac.

## Computer

- Un Mac con Apple Silicon (M1 o successivo). La versione 1 supporta solo i Mac con Apple Silicon e le immagini di sistema arm64.
- I Mac Intel, Windows e Linux non sono supportati nella versione 1.

## Browser

- Google Chrome o Microsoft Edge.
- Safari e Firefox non sono supportati. Il motivo è spiegato in [Browser supportati](/it/docs/reference/browser-support/).

## Componenti dell’Android SDK

Il gateway usa queste parti dell’Android SDK:

| Componente | Serve per | Dimensione approssimativa del download |
|---|---|---|
| `emulator` | Esegue il dispositivo virtuale Android | circa 400 MB |
| `system-images;android-34;google_apis;arm64-v8a` | L’immagine di sistema di Android 14 (API 34) | circa 1.5 GB |

<!-- verify: phase 2 -->
| Componente | Serve per | Dimensione approssimativa del download |
|---|---|---|
| `platform-tools` | `adb`, per controllare lo stato di avvio e arrestare i dispositivi | circa 15 MB |

<!-- verify: phase 3 -->
| Componente | Serve per | Dimensione approssimativa del download |
|---|---|---|
| `cmdline-tools` | `sdkmanager` e `avdmanager`, per installare le altre parti e creare un dispositivo | - |

<!-- verify: phase 3 -->
Non devi aprire Android Studio. Se hai già l’SDK installato da Android Studio, il gateway lo usa. Cerca l’SDK in quest’ordine:

1. La directory indicata nella variabile d’ambiente `ANDROID_HOME`.
2. `~/Library/Android/sdk`.

<!-- verify: phase 3 -->
Se manca qualcosa, il gateway ti dice cosa e chiede conferma prima di scaricare qualsiasi cosa. Vedi [Primo avvio](/it/docs/getting-started/first-run/).

## Memoria

<!-- verify: phase 3 -->
Ogni emulatore in esecuzione usa la RAM impostata nella configurazione del suo dispositivo. Il dispositivo predefinito che il gateway può creare usa 4096 MB. Viene mostrato un dispositivo alla volta.

## Prestazioni misurate {#measured-performance}

Su un Mac M4 con un dispositivo virtuale Pixel 5 API 34 (1080×2340) in Chrome 157, usando il trasporto dei frame rgba-mmap (frame RGBA grezzi tramite memoria condivisa), lo schermo si è aggiornato con una mediana di 60 frame al secondo, e la latenza del tocco è stata di 20 ms al p50 e di 30 ms al p90. I tuoi valori dipendono dal tuo Mac, dal dispositivo e dal browser.

La CPU è stata misurata sulla stessa configurazione durante 16 swipe consecutivi, sommando l’emulatore, il gateway e il processo di visualizzazione (tutti i processi di Chrome). Droidpier ha usato il 257% (emulatore 136% + gateway 69% + Chrome 52%). scrcpy, misurato nello stesso modo con lo stesso emulatore, ha usato il 208% (emulatore 203% + scrcpy 5%). Quindi Droidpier ha usato 1.24 volte la CPU usata da scrcpy.
