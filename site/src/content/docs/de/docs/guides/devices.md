---
title: Geräte
description: Listen Sie Ihre virtuellen Android-Geräte auf, starten und stoppen Sie sie über die Seite und übernehmen Sie einen Emulator, der bereits läuft.
sourceHash: 6eaf456bc1f3
---

Ein Gerät ist hier ein Android Virtual Device (AVD) auf Ihrem Mac. Die Seite zeigt jeweils ein Gerät.

## Die Geräteliste

<!-- verify: phase 2 -->
Die Liste links zeigt jedes AVD, das `emulator -list-avds` meldet. Für jedes zeigt sie:

- den Namen;
- die Bildschirmauflösung;
- die Android-Version;
- den Zustand: nicht gestartet, startet (mit verstrichenen Sekunden), läuft oder läuft, kann aber nicht übernommen werden;
- eine Start- oder Stopp-Schaltfläche.

<!-- verify: phase 2 -->
Auflösung, RAM und Android-Version stammen aus der `config.ini` jedes AVD in `~/.android/avd/<name>.avd/`. Wenn Sie `ANDROID_AVD_HOME` setzen, liest das Gateway stattdessen dieses Verzeichnis. Fehlt ein Feld in `config.ini`, bleibt es leer.

## Ein Gerät starten

<!-- verify: phase 2 -->
Klicken Sie neben einem Gerät auf Start. Das Gateway führt aus:

```sh
emulator -avd <name> -no-window -grpc <port> -no-boot-anim -gpu host
```

- `-no-window` bedeutet, dass sich kein separates Emulatorfenster öffnet. Der Bildschirm erscheint nur in der Seite.
- Der gRPC-Port ist der erste freie gerade Port ab `8554` aufwärts.
- Das Gerät gilt als hochgefahren, wenn `adb -s emulator-<serial> shell getprop sys.boot_completed` den Wert `1` zurückgibt. Bis dahin zeigt die Seite den Fortschritt.
- Ist das Gerät nach 180 Sekunden nicht hochgefahren, schlägt der Start fehl und das Gateway beendet den Emulatorprozess.

<!-- verify: phase 2 -->
Ein erneuter Klick auf Start, während ein Gerät hochfährt, startet keine zweite Instanz. Wenn Sie die Seite während des Hochfahrens schließen und wieder öffnen, läuft der Fortschritt weiter.

## Ein Gerät stoppen

<!-- verify: phase 2 -->
Klicken Sie auf Stopp. Das Gateway führt `adb -s emulator-<serial> emu kill` aus.

## Emulatoren, die bereits laufen

Das Gateway findet laufende Emulatoren über die Dateien, die der Emulator in `~/Library/Caches/TemporaryItems/avd/running/` schreibt. Wenn ein Emulator mit aktiviertem gRPC läuft, zum Beispiel einer, den Sie mit `-grpc <port>` gestartet haben, verbindet sich das Gateway mit ihm, statt eine weitere Instanz zu starten.

<!-- verify: phase 2 -->
Ein Emulator, der ohne gRPC läuft, wird als „läuft, kann aber nicht übernommen werden“ markiert. Das Gateway braucht gRPC, um den Bildschirm zu lesen und Eingaben zu senden. Stoppen Sie diesen Emulator und starten Sie ihn über die Seite.

## Wenn das Gateway stoppt

Das Stoppen des Gateways stoppt keine Emulatoren. Wenn Sie das Gateway erneut starten, verbindet es sich wieder mit ihnen.

## Ein Gerät erstellen

<!-- verify: phase 3 -->
Geräte erstellen Sie auf der Seite. Verwenden Sie die Schaltfläche für ein neues Gerät, wählen Sie ein Gerätemodell und eine Android-Version und geben Sie dem Gerät einen Namen; die Seite schlägt einen vor. Bevor etwas passiert, zeigt die Seite das Modell, die Android-Version und den Arbeitsspeicher des Geräts. Ist das Systemabbild für diese Version noch nicht installiert, lädt das Gateway es herunter, nachdem Sie bestätigt und der Lizenz von Google zugestimmt haben.

Zum Erstellen eines Geräts braucht es die Befehlszeilentools (`avdmanager`). Fehlen sie, bietet der Dialog an, sie zuerst zu installieren. Siehe [Erster Start](/de/docs/getting-started/first-run/#2-let-it-check-your-android-sdk).

Sie können Geräte auch mit `avdmanager` oder Android Studio erstellen; die Liste erkennt sie.

## Ein Gerät löschen

Klicke auf das Papierkorb-Symbol neben einem Gerät und bestätige. Damit werden das Gerät und alle seine Daten (installierte Apps, Dateien, Snapshots) gelöscht; das lässt sich nicht rückgängig machen. Das System-Image bleibt installiert. Ein Gerät, das läuft oder gerade startet, kann nicht gelöscht werden: Stoppe es zuerst.
