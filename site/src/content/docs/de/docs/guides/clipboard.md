---
title: Zwischenablage
description: Kopieren und fügen Sie Text zwischen Ihrem Mac und dem Android-Emulator in beide Richtungen ein.
sourceHash: fd58b697773c
---

## Vom Mac zum Emulator

<!-- verify: phase 2 -->
Kopieren Sie Text auf Ihrem Mac. Klicken Sie auf den Emulatorbildschirm und drücken Sie dann Cmd+V:

- ASCII-Text wird Zeichen für Zeichen in den Emulator getippt.
- Text mit anderen Zeichen (Chinesisch, Emoji usw.) wird in die Zwischenablage des Emulators gelegt und eingefügt. Dadurch wird ersetzt, was in der Zwischenablage des Emulators war.

## Vom Emulator zum Mac

<!-- verify: phase 2 -->
Kopieren Sie Text in Android, zum Beispiel durch langes Drücken und Auswählen von Kopieren. Das Gateway beobachtet die Zwischenablage des Emulators und sendet den neuen Text an die Seite. Die Seite schreibt ihn dann in die Zwischenablage Ihres Macs, und Sie können ihn überall auf Ihrem Mac mit Cmd+V einfügen.

<!-- verify: phase 2 -->
Browser erlauben einer Seite nur dann, in die Zwischenablage zu schreiben, wenn die Seite den Fokus hat. Schlägt das Schreiben fehl, zum Beispiel weil ein anderes Fenster im Vordergrund war, zeigt die Seite einen Hinweis an. Klicken Sie darauf, um den Text zu kopieren.

## Nicht-ASCII-Text eingeben

Auch das Eingeben von chinesischem oder anderem Nicht-ASCII-Text mit einer macOS-Eingabemethode nutzt die Zwischenablage des Emulators. Siehe [Tastatur und Eingabe](/de/docs/guides/keyboard-and-input/#chinese-and-other-non-ascii-text).
