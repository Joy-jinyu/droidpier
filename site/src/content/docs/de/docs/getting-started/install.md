---
title: Installation
description: Installieren und starten Sie das Gateway von Droidpier mit einem Befehl auf einem Mac mit Apple Silicon.
sourceHash: 9e0b6fc5fcb6
---

Der Einstieg besteht aus zwei Schritten:

1. Führen Sie den Befehl unten im Terminal aus und lassen Sie das Fenster geöffnet. Er installiert Droidpier und startet es.
2. Öffnen Sie `https://droid.devpier.dev/app/`. Die Seite verbindet sich von selbst. Wenn Chrome beim ersten Mal fragt, ob die Seite auf Ihr lokales Netzwerk zugreifen darf, klicken Sie auf **Zulassen**.

Schritt 2 ist unter [Erster Start](/de/docs/getting-started/first-run/) beschrieben.

<!-- verify: phase 3 -->
Der Befehl `droidpier` ist das Gateway: eine einzelne ausführbare Datei, die den Android-Emulator auf Ihrem Mac mit der Browserseite verbindet. Zum Ausführen brauchen Sie kein Node.js.

## Befehl ausführen

<!-- verify: phase 3 -->

Prüfen Sie zuerst die [Voraussetzungen](/de/docs/getting-started/requirements/). Führen Sie dann dies im Terminal aus:

<!-- 待第 3 阶段 Task 5 确认 -->
```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh
```

Beim ersten Mal macht das Skript Folgendes:

1. Es lädt das Gateway für macOS auf Apple Silicon, `droidpier-darwin-arm64.tar.xz`, von `https://droid.devpier.dev/download/` herunter. Die Prüfsumme liegt daneben, in `droidpier-darwin-arm64.tar.xz.sha256`.
2. Es prüft den Download anhand der Prüfsumme. Stimmen sie nicht überein, bricht es ab und installiert nichts.
3. Es speichert das Gateway als `~/.local/bin/droidpier` und macht es ausführbar.
4. Es startet das Gateway.

Das Gateway läuft in diesem Terminal-Fenster weiter. Lassen Sie das Fenster geöffnet, solange Sie die Seite verwenden. Drücken Sie `Ctrl+C`, um es zu stoppen.

Wenn Sie denselben Befehl erneut ausführen:

- Ist Ihre Version aktuell, überspringt er den Download und startet das Gateway.
- Gibt es eine neuere Version, aktualisiert er Ihre Version und startet sie dann.
- Ist die Download-Seite nicht erreichbar, warnt er Sie und startet die bereits installierte Version.
- Läuft das Gateway bereits, meldet er das und öffnet die Seite. Ein zweites Gateway startet er nicht.

Wie Sie dem Gateway Optionen übergeben oder nur installieren, ohne zu starten, steht unter [Befehlszeile](/de/docs/reference/cli/#start-with-the-install-command).

## droidpier direkt ausführen

<!-- verify: phase 3 -->

Nach der Installation können Sie das Gateway auch mit dem Befehl `droidpier` starten:

```sh
droidpier
```

Wenn Ihre Shell `command not found` meldet, ist `~/.local/bin` nicht in Ihrem `PATH`. Das Installationsskript weist in diesem Fall darauf hin. Fügen Sie es hinzu, zum Beispiel in `~/.zshrc`:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

Öffnen Sie dann ein neues Terminal-Fenster und versuchen Sie es erneut.

## Aktualisieren

<!-- verify: phase 3 -->

Führen Sie denselben Befehl erneut aus. Gibt es eine neuere Version, ersetzt er die Datei in `~/.local/bin`. Läuft das Gateway noch, stoppen Sie es zuerst mit `Ctrl+C`, damit der Befehl die neue Version startet.

<!-- verify: phase 3 -->
Wenn die Seite neuer ist als Ihr Gateway, teilt Ihnen die Seite mit, dass das Gateway veraltet ist, und zeigt den Befehl zum Aktualisieren an.

## Nächster Schritt

[Erster Start](/de/docs/getting-started/first-run/): Lassen Sie das Gateway Ihr Android SDK prüfen, öffnen Sie die Seite und erlauben Sie den Zugriff auf das lokale Netzwerk.
