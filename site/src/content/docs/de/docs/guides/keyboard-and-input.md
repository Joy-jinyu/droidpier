---
title: Tastatur und Eingabe
description: Wie Maus, Trackpad, Tastatur, Nicht-ASCII-Text und die Gerätetasten den Emulator erreichen.
sourceHash: 34d7c6882a09
---

## Maus und Trackpad

- **Tippen:** Klicken Sie auf den Bildschirm.
- **Wischen:** Drücken, ziehen, loslassen. Das Gateway sendet die Bewegung als eine einzige Berührung an den Emulator.
- Wenn Sie über den Rand des Bildschirms hinausziehen und außerhalb loslassen, erhält der Emulator trotzdem das Loslassen, sodass die Berührung nicht gedrückt bleibt.

Seitenkoordinaten werden unter Berücksichtigung der Seitengröße in Gerätepixel umgerechnet.

<!-- verify: phase 2 -->
Nachdem Sie das Gerät gedreht haben, verwendet die Umrechnung die neue Ausrichtung, sodass Taps dort landen, wo Sie klicken.

## Mausrad

<!-- verify: phase 2 -->
Der Emulator hat keine Mausrad-Eingabe, daher wandelt die Seite Mausradbewegungen in eine kurze Wischgeste um:

- Je 100 Pixel Mausradbewegung werden zu einer Wischgeste von 300 Pixeln auf dem Gerät, höchstens 900 Pixel pro Wischgeste.
- Die Wischgeste verläuft entgegengesetzt zum Mausrad: Scrollen nach unten bewegt den Finger nach oben, wie auf einem Smartphone.
- Mausrad-Ereignisse innerhalb von 50 ms werden zu einer Wischgeste zusammengefasst.

## Tastatur

Klicken Sie zuerst auf den Bildschirm. Er hat dann den Tastaturfokus.

- Druckbare Zeichen und Funktionstasten (Pfeiltasten, Enter, Backspace, Tab, Escape usw.) werden beim Drücken an den Emulator gesendet.
- Browser-Tastenkürzel mit Cmd, etwa Cmd+R und Cmd+W, werden nicht abgefangen. Sie wirken weiterhin auf den Browser.

<!-- verify: phase 2 -->
Cmd+V fügt vom Mac aus ein. Siehe [Zwischenablage](/de/docs/guides/clipboard/).

## Chinesischer und anderer Nicht-ASCII-Text {#chinese-and-other-non-ascii-text}

Schreiben Sie mit einer beliebigen macOS-Eingabemethode. Wenn die Eingabemethode ein Wort fertig zusammengesetzt hat, macht die Seite Folgendes:

1. Sie legt den Text in die Zwischenablage des Emulators;
2. sie sendet ein Einfügen an den Emulator.

Auf dem Emulator wird keine Eingabemethoden-App installiert. Der Nachteil: Dabei wird die Zwischenablage des Emulators überschrieben.

Die Tasteneingabe des Emulators verwirft Nicht-ASCII-Zeichen, deshalb läuft dieser Text über die Zwischenablage.

## Gerätetasten

Tasten über dem Bildschirm:

| Taste | Sendet |
|---|---|
| Zurück | `GoBack` |
| Startbildschirm | `GoHome` |
| Letzte Apps | `AppSwitch` |

<!-- verify: phase 2 -->
| Taste | Aktion |
|---|---|
| Drehen | Dreht das Gerät um 90° im Uhrzeigersinn |
| Lauter / Leiser | `AudioVolumeUp` / `AudioVolumeDown` |
| Ein/Aus | `Power`; erneut drücken, um den Bildschirm wieder einzuschalten |
| Screenshot | Lädt ein PNG herunter. Siehe [Screenshots](/de/docs/guides/screenshots/) |
