---
title: Voraussetzungen
description: Was Sie vor der Installation von Droidpier brauchen - einen Mac mit Apple Silicon, Chrome oder Edge und den Android-Emulator mit einem arm64-Systemabbild.
sourceHash: 39e85ecc70b3
---

Droidpier führt den offiziellen Android-Emulator auf Ihrem eigenen Mac aus und zeigt ihn in einem Browser-Tab. Nichts läuft auf einem entfernten Server. Sie installieren ein kleines lokales Programm (das Gateway) und brauchen den Android-Emulator und ein Systemabbild auf demselben Mac.

## Computer

- Ein Mac mit Apple Silicon (M1 oder neuer). Version 1 unterstützt nur Macs mit Apple Silicon und arm64-Systemabbilder.
- Intel-Macs, Windows und Linux werden in Version 1 nicht unterstützt.

## Browser

- Google Chrome oder Microsoft Edge.
- Safari und Firefox werden nicht unterstützt. Den Grund finden Sie unter [Browser-Unterstützung](/de/docs/reference/browser-support/).

## Komponenten des Android SDK

Das Gateway verwendet diese Teile des Android SDK:

| Komponente | Verwendet für | Ungefähre Downloadgröße |
|---|---|---|
| `emulator` | Führt das virtuelle Android-Gerät aus | etwa 400 MB |
| `platform-tools` | `adb`, um den Boot-Status zu prüfen und Geräte zu stoppen | etwa 16 MB |
| Ein Systemabbild, etwa `system-images;android-34;google_apis;arm64-v8a` | Das Android-System, das auf dem Gerät läuft. Jede Android-Version geht; ist keins installiert, bietet die Seite Android 14 (API 34) an | etwa 1.5 GB |

<!-- verify: phase 3 -->
Sie brauchen weder Java noch die Befehlszeilentools (`sdkmanager`, `avdmanager`) noch Android Studio: Das Gateway lädt diese Teile aus Googles SDK-Repository und erstellt Geräte selbst. Haben Sie das SDK bereits über Android Studio, verwendet das Gateway es. Es sucht das SDK in dieser Reihenfolge:

1. Das Verzeichnis in der Umgebungsvariable `ANDROID_HOME`.
2. `~/Library/Android/sdk`.

<!-- verify: phase 3 -->
Wenn etwas fehlt, sagt Ihnen das Gateway, was fehlt, und fragt nach, bevor es etwas herunterlädt. Siehe [Erster Start](/de/docs/getting-started/first-run/).

## Arbeitsspeicher

<!-- verify: phase 3 -->
Jeder laufende Emulator verwendet den RAM, der in seiner Gerätekonfiguration festgelegt ist. Das Standardgerät, das das Gateway erstellen kann, verwendet 4096 MB. Es wird jeweils ein Gerät angezeigt.

## Gemessene Leistung {#measured-performance}

Auf einem M4-Mac mit einem virtuellen Gerät Pixel 5 API 34 (1080×2340) in Chrome 157, mit dem Frame-Transport rgba-mmap (rohe RGBA-Frames über Shared Memory), wurde der Bildschirm mit einem Median von 60 Bildern pro Sekunde aktualisiert, und die Tap-Latenz betrug 20 ms bei p50 und 30 ms bei p90. Ihre Werte hängen von Ihrem Mac, dem Gerät und dem Browser ab.

Die CPU-Last wurde mit demselben Aufbau während 16 unmittelbar aufeinanderfolgender Wischgesten gemessen, als Summe aus Emulator, Gateway und Anzeigeprozess (alle Chrome-Prozesse). Droidpier nutzte 257 % (Emulator 136 % + Gateway 69 % + Chrome 52 %). scrcpy, auf dieselbe Weise mit demselben Emulator gemessen, nutzte 208 % (Emulator 203 % + scrcpy 5 %). Droidpier nutzte also das 1.24-Fache der CPU-Last von scrcpy.
