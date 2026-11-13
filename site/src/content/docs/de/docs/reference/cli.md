---
title: Befehlszeile
description: Optionen und Umgebungsvariablen für den Befehl des Droidpier-Gateways.
sourceHash: b62f19b96312
---

<!-- verify: phase 3 -->
```sh
droidpier start [--port <port>] [--local] [--no-open]
droidpier stop
droidpier status
droidpier logs
droidpier [--port <port>] [--local] [--no-open]
```

| Befehl | Wirkung |
|---|---|
| `droidpier start` | Führt das Gateway als macOS-LaunchAgent im Hintergrund aus. Es läuft nach dem Schließen des Terminals weiter, startet bei der Anmeldung und wird nach einem Absturz neu gestartet. Läuft es bereits, wird es neu gestartet. Angegebene Optionen werden gespeichert; ohne Optionen bleiben die gespeicherten. Öffnet die Seite einmal, außer mit `--no-open`. |
| `droidpier stop` | Stoppt das Gateway im Hintergrund. Es startet bei der Anmeldung nicht mehr. |
| `droidpier status` | Zeigt, ob das Gateway im Hintergrund läuft, mit Prozess-ID, Port, Version und Logdatei. |
| `droidpier logs` | Gibt den Pfad der Logdatei und ihre letzten 50 Zeilen aus. |
| `droidpier` | Führt das Gateway in diesem Terminal-Fenster aus, bis Sie `Ctrl+C` drücken. |

Das Stoppen des Gateways stoppt laufende Emulatoren nicht.

## Mit dem Installationsbefehl starten {#start-with-the-install-command}

Der Installationsbefehl `curl -fsSL https://droid.devpier.dev/install.sh | sh` installiert oder aktualisiert das Gateway und führt dann `droidpier start` aus. Optionen dafür schreiben Sie hinter `sh -s --`. Sie werden für das Gateway im Hintergrund gespeichert:

```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh -s -- --port 7310
```

Um nur zu installieren oder zu aktualisieren, ohne das Gateway zu starten, setzen Sie `DROIDPIER_NO_START=1`:

```sh
curl -fsSL https://droid.devpier.dev/install.sh | DROIDPIER_NO_START=1 sh
```

Um das Gateway wie früher im Terminal-Fenster auszuführen, setzen Sie `DROIDPIER_FOREGROUND=1`:

```sh
curl -fsSL https://droid.devpier.dev/install.sh | DROIDPIER_FOREGROUND=1 sh
```

## Optionen

| Option | Standard | Wirkung |
|---|---|---|
| `--port <port>` | `7300` | Der Port, auf dem das Gateway lauscht, nur auf `127.0.0.1`. |

<!-- verify: phase 3 -->
| Option | Standard | Wirkung |
|---|---|---|
| `--local` | aus | Die Seite öffnen, die das Gateway selbst bereitstellt, `http://127.0.0.1:<port>/app/`, statt der öffentlichen Seite auf `droid.devpier.dev`. |
| `--no-open` | aus | Beim Start keinen Browser öffnen. Das Gateway gibt die Adresse trotzdem aus. |

Mit oder ohne `--no-open` findet die Seite das Gateway von selbst. Siehe [Erster Start](/de/docs/getting-started/first-run/#3-open-the-page).

## Umgebungsvariablen

| Variable | Wirkung |
|---|---|
| `ANDROID_HOME` | Das Verzeichnis des Android SDK. Ohne sie verwendet das Gateway `~/Library/Android/sdk`. |
| `ANDROID_AVD_HOME` | Das Verzeichnis, das die AVDs enthält. Ohne sie verwendet das Gateway `~/.android/avd`. |
| `DEBUG=1` | Gibt pro Sekunde eine Zeile für jede Verbindung aus: empfangene, gesendete und verworfene Frames, durchschnittliche Frame-Größe und die Verzögerung vom Emulator zum Gateway. |

<!-- verify: phase 2 -->
`ANDROID_AVD_HOME` wird gelesen, wenn das Gateway Geräte auflistet.

<!-- verify: phase 3 -->
`ANDROID_HOME` wird von der Prüfung beim ersten Start gelesen.

Sind `ANDROID_HOME` und `ANDROID_AVD_HOME` gesetzt, speichert `droidpier start` sie für das Gateway im Hintergrund, denn launchd liest Ihr Shell-Profil nicht. Führen Sie `droidpier start` erneut aus, nachdem Sie sie geändert haben.

## Was es ausgibt

Beim Start gibt das Gateway die Adresse der Seite aus. Wenn kein Emulator läuft, gibt es den Grund aus und läuft weiter.

<!-- verify: phase 3 -->
Standardmäßig ist die ausgegebene Adresse die öffentliche Seite, `https://droid.devpier.dev/app/`. Wenn das Gateway nicht auf Port `7300` läuft, endet die Adresse auf `#port=<port>`. Mit `--local` ist es die lokale Seite, `http://127.0.0.1:<port>/app/`. Das Gateway öffnet die Adresse mit dem macOS-Befehl `open`, es sei denn, Sie übergeben `--no-open`.

Läuft auf dem Port bereits ein Gateway, startet kein zweites. Es meldet, dass droidpier bereits läuft, mit dem Port, und öffnet die Seite. Ist das laufende das Gateway im Hintergrund, gibt es auch `droidpier stop` aus. Belegt ein anderes Programm den Port, meldet es das, schlägt einen anderen Port vor und beendet sich.

<!-- verify: phase 3 -->
Fehlen Teile des Android SDK, listet das Gateway jedes davon mit einem Befehl zur manuellen Installation auf und bittet Sie, die Einrichtung auf der Seite abzuschließen. Im Terminal fragt es nie etwas: Installationen, neue Geräte und Lizenzen bestätigen Sie auf der Seite. Siehe [Erster Start](/de/docs/getting-started/first-run/#2-let-it-check-your-android-sdk).

## Verwendete Dateien und Ports

| Was | Wo |
|---|---|
| Lauschadresse des Gateways | `127.0.0.1:<port>` |
| Erkennung laufender Emulatoren | `~/Library/Caches/TemporaryItems/avd/running/pid_<pid>.ini` |

<!-- verify: phase 2 -->
| Was | Wo |
|---|---|
| Vergebene gRPC-Ports für Emulatoren | Der erste freie gerade Port ab `8554` |

<!-- verify: phase 3 -->
| Was | Wo |
|---|---|
| Installierte ausführbare Datei | `~/.local/bin/droidpier` |
| Prüfsumme der installierten Version | `~/.local/share/droidpier/installed.sha256` |
| Einstellungen des Gateways im Hintergrund | `~/Library/LaunchAgents/dev.devpier.droidpier.plist` |
| Log des Gateways im Hintergrund | `~/Library/Logs/Droidpier/droidpier.log` |
