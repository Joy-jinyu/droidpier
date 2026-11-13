---
title: Sicherheit
description: Wie das Gateway verhindert, dass andere Webseiten und andere Computer Ihren Emulator steuern - nur Loopback und eine Origin-Zulassungsliste.
sourceHash: 08642471687c
---

Die Seite wird von `droid.devpier.dev` ausgeliefert, aber Emulator und Gateway laufen auf Ihrem Mac. Jede Webseite, die Sie öffnen, könnte versuchen, sich mit einem Programm auf Ihrem Mac zu verbinden, deshalb prüft das Gateway jede Verbindung.

## Nur Loopback

Das Gateway lauscht nur auf `127.0.0.1`. Es nimmt keine Verbindungen aus Ihrem lokalen Netzwerk oder dem Internet an. Andere Computer können es nicht erreichen.

## Origin-Zulassungsliste

<!-- verify: phase 3 -->
Browser senden einen `Origin`-Header, wenn eine Seite einen WebSocket öffnet, und eine Webseite kann ihn nicht fälschen. Das Gateway nimmt Verbindungen nur von der öffentlichen Seite auf `droid.devpier.dev` und von seiner eigenen lokalen Seite an, also nur von diesen Origins:

- `https://droid.devpier.dev`
- `http://127.0.0.1:<port>`
- `http://localhost:<port>`

<!-- verify: phase 3 -->
Eine Verbindung mit einem anderen Origin oder ohne Origin wird mit Code `4003` geschlossen. Eine Seite auf einer anderen Website kann Ihren Emulator nicht steuern, selbst wenn sie den Port errät.

## Wie die Seite das Gateway findet

<!-- verify: phase 3 -->
- Solange kein Gateway antwortet, prüft die Seite unter `droid.devpier.dev/app/` einmal pro Sekunde, ob es da ist, und verbindet sich, sobald `droidpier` läuft. Solange der Tab im Hintergrund ist, prüft sie nicht.
- Sie verwendet Port `7300` oder den Port nach `#port=` in der Adresse. Das Gateway hängt `#port=<port>` nur dann an die Adresse an, die es öffnet, wenn es nicht auf Port `7300` läuft.
- Die Seite speichert den Port nicht im Browser.

## Die Website verbindet sich nicht mit Ihrem Mac

<!-- verify: phase 3 -->
Die Berechtigung für das lokale Netzwerk in Chrome und die Origin-Prüfung des Gateways gelten beide pro Website, nicht pro Pfad. Die Dokumentationsseiten teilen sich die Berechtigung also mit der Emulatorseite unter `/app/`. Um die Folgen davon zu begrenzen:

- Nur die Emulatorseite unter `/app/` verbindet sich mit dem Gateway. Die Startseite und diese Dokumentation tun das nie, daher löst ihr Lesen keine Berechtigungsabfrage aus.
- Die Website lädt keine Skripte, Stylesheets, Schriftarten oder Medien von Drittanbietern. Alles wird von `droid.devpier.dev` ausgeliefert.

## Software installieren

<!-- verify: phase 3 -->
Das Gateway installiert niemals Pakete des Android SDK oder erstellt Geräte, ohne zu fragen. Jede Installation und jedes neue Gerät bestätigen Sie auf der Seite, nachdem sie angezeigt hat, was wohin heruntergeladen wird. Die Seite zeigt die Lizenzen von Google vollständig an, und ein Element wird nur installiert, wenn Sie zustimmen. Befehlszeilentools ab Version 23 akzeptieren die Lizenzen möglicherweise ohne Nachfrage; darauf weist die Seite hin, bevor Sie bestätigen. Im Terminal fragt das Gateway nichts.

## Codes beim Schließen der Verbindung

<!-- verify: phase 3 -->
| Code | Bedeutung |
|---|---|
| `4000` | Die erste Nachricht war nicht `hello`. |
| `4002` | Seite und Gateway verwenden unterschiedliche Protokollversionen. |
| `4003` | Origin nicht erlaubt. |

## Ein Problem melden

Eröffnen Sie ein Issue unter [github.com/twosugar/droidpier](https://github.com/twosugar/droidpier/issues).
