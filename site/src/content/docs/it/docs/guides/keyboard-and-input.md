---
title: Tastiera e input
description: Come mouse, trackpad, tastiera, testo non ASCII e i pulsanti del dispositivo arrivano all’emulatore.
sourceHash: 34d7c6882a09
---

## Mouse e trackpad

- **Tocco:** fai clic sullo schermo.
- **Swipe:** premi, trascina, rilascia. Il gateway invia il movimento all’emulatore come un unico tocco.
- Se trascini oltre il bordo dello schermo e rilasci fuori, l’emulatore riceve comunque il rilascio, quindi il tocco non resta premuto.

Le coordinate della pagina vengono convertite in pixel del dispositivo, tenendo conto della dimensione della pagina.

<!-- verify: phase 2 -->
Dopo aver ruotato il dispositivo, la conversione usa il nuovo orientamento, così i tocchi arrivano dove fai clic.

## Rotellina di scorrimento

<!-- verify: phase 2 -->
L’emulatore non ha un input per la rotellina, quindi la pagina trasforma il movimento della rotellina in un breve swipe:

- Ogni 100 pixel di movimento della rotellina diventano uno swipe di 300 pixel sul dispositivo, fino a 900 pixel per swipe.
- Lo swipe va nella direzione opposta alla rotellina: scorrere verso il basso sposta il dito verso l’alto, come su un telefono.
- Gli eventi della rotellina entro 50 ms vengono uniti in un unico swipe.

## Tastiera

Prima fai clic sullo schermo. A quel punto ha il focus della tastiera.

- I caratteri stampabili e i tasti funzione (frecce, Invio, Backspace, Tab, Esc e così via) vengono inviati all’emulatore mentre li premi.
- Le scorciatoie del browser che usano Cmd, come Cmd+R e Cmd+W, non vengono intercettate. Continuano ad agire sul browser.

<!-- verify: phase 2 -->
Cmd+V incolla dal tuo Mac. Vedi [Appunti](/it/docs/guides/clipboard/).

## Cinese e altro testo non ASCII {#chinese-and-other-non-ascii-text}

Scrivi con qualsiasi metodo di input di macOS. Quando il metodo di input termina la composizione di una parola, la pagina:

1. mette il testo negli appunti dell’emulatore;
2. invia un comando incolla all’emulatore.

Sull’emulatore non viene installata nessuna app di metodo di input. Il compromesso: questo sovrascrive gli appunti dell’emulatore.

L’input da tastiera dell’emulatore scarta i caratteri non ASCII, ed è per questo che questo testo passa attraverso gli appunti.

## Pulsanti del dispositivo

Pulsanti sopra lo schermo:

| Pulsante | Invia |
|---|---|
| Indietro | `GoBack` |
| Home | `GoHome` |
| App recenti | `AppSwitch` |

<!-- verify: phase 2 -->
| Pulsante | Azione |
|---|---|
| Ruota | Ruota il dispositivo di 90° in senso orario |
| Volume su / giù | `AudioVolumeUp` / `AudioVolumeDown` |
| Accensione | `Power`; premi di nuovo per riaccendere lo schermo |
| Screenshot | Scarica un PNG. Vedi [Screenshot](/it/docs/guides/screenshots/) |
