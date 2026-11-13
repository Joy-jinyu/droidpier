---
title: Befehlszeile
description: Optionen und Umgebungsvariablen für den Befehl des Droidpier-Gateways.
sourceHash: 6811a7927009
---

<!-- verify: phase 3 -->
```sh
droidpier [--port <port>] [--local] [--no-open]
```

Das Gateway läuft im Vordergrund, bis Sie `Ctrl+C` drücken. Das Stoppen beendet keine laufenden Emulatoren.

## Mit dem Installationsbefehl starten {#start-with-the-install-command}

Der Installationsbefehl `curl -fsSL https://droid.devpier.dev/install.sh | sh` installiert oder aktualisiert das Gateway und startet es dann. Um dem Gateway Optionen zu übergeben, schreiben Sie sie hinter `sh -s --`:

```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh -s -- --port 7310
```

Um nur zu installieren oder zu aktualisieren, ohne das Gateway zu starten, setzen Sie `DROIDPIER_NO_START=1`:

```sh
curl -fsSL https://droid.devpier.dev/install.sh | DROIDPIER_NO_START=1 sh
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

## Was es ausgibt

Beim Start gibt das Gateway die Adresse der Seite aus. Wenn kein Emulator läuft, gibt es den Grund aus und läuft weiter.

<!-- verify: phase 3 -->
Standardmäßig ist die ausgegebene Adresse die öffentliche Seite, `https://droid.devpier.dev/app/`. Wenn das Gateway nicht auf Port `7300` läuft, endet die Adresse auf `#port=<port>`. Mit `--local` ist es die lokale Seite, `http://127.0.0.1:<port>/app/`. Das Gateway öffnet die Adresse mit dem macOS-Befehl `open`, es sei denn, Sie übergeben `--no-open`.

Läuft auf dem Port bereits ein Gateway, startet kein zweites. Es gibt aus, dass droidpier bereits läuft, mit dem Port, und öffnet die Seite. Verwendet ein anderes Programm den Port, meldet es das, schlägt einen anderen Port vor und beendet sich.

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
