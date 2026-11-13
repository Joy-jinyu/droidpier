---
title: Erster Start
description: Starten Sie das Gateway mit einem Befehl, lassen Sie es das Android SDK prüfen, erlauben Sie den Zugriff auf das lokale Netzwerk in Chrome und sehen Sie Ihren Emulator.
sourceHash: c1c836eb6e73
---

Führen Sie einen Befehl im Terminal aus, öffnen Sie `https://droid.devpier.dev/app/` und erlauben Sie den Zugriff auf das lokale Netzwerk, wenn Chrome fragt.

## 1. Gateway starten

```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh
```

Er installiert oder aktualisiert das Gateway bei Bedarf und startet es. Siehe [Installation](/de/docs/getting-started/install/). Nach der Installation startet es auch `droidpier start`.

Das Gateway läuft im Hintergrund. Sie können das Terminal-Fenster schließen.

Das Gateway lauscht auf `127.0.0.1`, standardmäßig auf Port `7300`. Wie Sie einen anderen Port verwenden, steht unter [Befehlszeile](/de/docs/reference/cli/).

## 2. Android SDK prüfen lassen {#2-let-it-check-your-android-sdk}

<!-- verify: phase 3 -->
Beim Start prüft das Gateway, ob ein Gerät starten kann: Dazu braucht es den Android-Emulator (`emulator`), `adb` aus `platform-tools` und mindestens ein virtuelles Gerät (AVD), dessen Systemabbild installiert ist. Jede Android-Version geht. Fehlt etwas, listet es jedes Element im Terminal auf und fordert Sie auf, die Einrichtung auf der Seite abzuschließen. Im Terminal fragt es nichts.

Läuft das Gateway im Hintergrund, steht diese Liste in seinem Log. Mit `droidpier logs` sehen Sie sie.

<!-- verify: phase 3 -->
Die Seite zeigt dieselbe Liste, mit der Downloadgröße jedes Elements. Kann ein Gerät starten, zeigt sie nichts.

| Fehlt | Was Sie auf der Seite tun |
|---|---|
| `emulator`, `platform-tools`, Systemabbild | Installieren Sie ein Element mit der Schaltfläche daneben oder alle auf einmal. Ist kein Systemabbild installiert, bietet die Seite Android 14 an (`system-images;android-34;google_apis;arm64-v8a`). Wurde das Systemabbild eines Geräts entfernt, nennt die Seite das Gerät und bietet dieses Abbild an. |
| Kein Gerät | Erstellen Sie ein Gerät: Wählen Sie ein Gerätemodell und eine Android-Version. Ist bereits ein Systemabbild installiert, schlägt die Seite es vor, statt Android 14 herunterzuladen. |

Sie brauchen weder Java noch die Befehlszeilentools (`sdkmanager`, `avdmanager`). Das Gateway lädt jeden Teil aus Googles SDK-Repository, derselben Quelle, die Android Studio nutzt, und legt den SDK-Ordner an, falls er noch nicht existiert.

<!-- verify: phase 3 -->
Es wird nichts heruntergeladen oder erstellt, bevor Sie auf der Seite bestätigen. Vorher zeigt die Seite, was heruntergeladen wird, wohin es kommt und wie viel Speicherplatz es braucht. Vor jedem Download zeigt die Seite die Lizenz von Google vollständig an, und das Element wird nur installiert, wenn Sie zustimmen. Das Gateway hält Ihre Zustimmung wie Android Studio im Ordner `licenses` des SDK fest und prüft jeden Download vor dem Entpacken gegen die Prüfsumme, die Google veröffentlicht.

Wenn Sie ein Element lieber selbst installieren, klappen Sie auf der Seite den Abschnitt zur manuellen Installation darunter auf. Dort steht, wo Sie das Element in Android Studio finden und wohin es kommt.

## 3. Seite öffnen {#3-open-the-page}

<!-- verify: phase 3 -->
Öffnen Sie `https://droid.devpier.dev/app/` in Chrome oder Edge. Beim Start gibt das Gateway diese Adresse auch aus und öffnet sie in Ihrem Standardbrowser. Wenn Ihr Standardbrowser nicht Chrome oder Edge ist, öffnen Sie die Adresse selbst in Chrome oder Edge.

Die Seite verbindet sich von selbst. Solange kein Gateway antwortet, prüft sie einmal pro Sekunde und verbindet sich, sobald das Gateway startet, ohne Neuladen. Solange der Tab im Hintergrund ist, prüft sie nicht.

Wenn das Gateway nicht auf Port `7300` läuft, endet die ausgegebene Adresse auf `#port=<port>`:

```text
https://droid.devpier.dev/app/#port=7301
```

Öffnen Sie diese Adresse, damit die Seite den richtigen Port findet.

## 4. Zugriff auf das lokale Netzwerk erlauben {#4-allow-local-network-access}

<!-- verify: phase 3 -->
Wenn sich die Seite zum ersten Mal mit dem Gateway auf Ihrem Mac verbindet, zeigt Chrome eine Berechtigungsabfrage, ob `droid.devpier.dev` auf Ihr lokales Netzwerk zugreifen darf. Klicken Sie auf **Zulassen**. Chrome merkt sich die Entscheidung für die Website.

Wenn Sie es abgelehnt haben, siehe [Fehlerbehebung](/de/docs/guides/troubleshooting/#chrome-blocked-local-network-access).

## 5. Emulator verwenden

Wenn bereits ein Emulator mit gRPC läuft, zeigt die Seite seinen Bildschirm.

<!-- verify: phase 2 -->
Andernfalls wählen Sie ein Gerät in der Liste aus und starten es. Siehe [Geräte](/de/docs/guides/devices/).

Klicken Sie auf den Bildschirm, damit er den Tastaturfokus erhält. Dann:

- Klicken zum Tippen; Ziehen zum Wischen.
- Schreiben Sie mit der Tastatur Ihres Macs. Siehe [Tastatur und Eingabe](/de/docs/guides/keyboard-and-input/).
- Verwenden Sie die Tasten Zurück, Startbildschirm und Letzte Apps über dem Bildschirm.

## Stoppen

Führen Sie `droidpier stop` aus. Haben Sie das Gateway mit `droidpier` in einem Terminal-Fenster gestartet, drücken Sie dort stattdessen `Ctrl+C`. Laufende Emulatoren laufen weiter. Wenn Sie das Gateway das nächste Mal starten, mit demselben Befehl oder mit `droidpier start`, verbindet es sich wieder mit ihnen.

## Die lokale Ersatzseite

Das Gateway stellt dieselbe Seite auch selbst unter `http://127.0.0.1:7300/app/` bereit (oder unter dem Port, den Sie gewählt haben). Verwenden Sie sie, wenn die öffentliche Seite nicht lädt oder keine Verbindung herstellen kann.

Damit das Gateway die lokale Seite statt der öffentlichen öffnet, starten Sie es mit `--local`:

```sh
droidpier --local
```
