---
title: Fehlerbehebung
description: Häufige Probleme beheben - Chrome hat den Zugriff auf das lokale Netzwerk blockiert, Port bereits belegt, kein Emulator gefunden, die Seite verbindet sich nicht, Versionskonflikt.
sourceHash: d8eaddc9fa12
---

## Chrome hat den Zugriff auf das lokale Netzwerk blockiert {#chrome-blocked-local-network-access}

<!-- verify: phase 3 -->
Die Seite auf `droid.devpier.dev` verbindet sich mit dem Gateway auf Ihrem eigenen Mac. Chrome fragt beim ersten Mal nach der Berechtigung. Wenn Sie sie abgelehnt haben, kann die Seite keine Verbindung herstellen und teilt Ihnen nach einigen fehlgeschlagenen Versuchen mit, dass Chrome den Zugriff auf Ihren Mac blockiert hat.

So erlauben Sie es wieder:

1. Öffnen Sie in Chrome **Einstellungen → Datenschutz und Sicherheit → Website-Einstellungen**.
2. Suchen Sie `droid.devpier.dev` und erlauben Sie den Zugriff auf das lokale Netzwerk.
3. Laden Sie die Seite neu.

Wenn Sie sich weiterhin nicht verbinden können, verwenden Sie die [lokale Ersatzseite](#use-the-local-fallback-page).

## Port bereits belegt

Das Gateway lauscht standardmäßig auf Port `7300`.

Läuft das Gateway im Hintergrund, startet ein erneuter Aufruf des Befehls es neu. Läuft ein Gateway in einem Terminal-Fenster, startet der Befehl kein zweites, sondern meldet, dass droidpier bereits auf Port `7300` läuft. Stoppen Sie dieses mit `Ctrl+C` und führen Sie den Befehl erneut aus.

Verwendet ein anderes Programm den Port, meldet das Gateway das, schlägt einen anderen Port vor und beendet sich. Finden Sie das Programm:

```sh
lsof -nP -iTCP:7300 -sTCP:LISTEN
```

Beenden Sie dieses Programm oder starten Sie das Gateway auf einem anderen Port:

```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh -s -- --port 7301
```

Nach der Installation bewirkt `droidpier --port 7301` dasselbe.

<!-- verify: phase 3 -->
Das Gateway setzt den neuen Port in die Adresse, die es öffnet, sodass sich die Seite mit dem richtigen Port verbindet.

## Kein Emulator gefunden

Wenn die Seite meldet, dass kein laufender Emulator gefunden wurde:

- Prüfen Sie, ob ein Emulator läuft: `adb devices` sollte `emulator-5554` oder Ähnliches auflisten.
- Prüfen Sie, ob er mit aktiviertem gRPC gestartet wurde (`-grpc <port>`). Ohne gRPC kann das Gateway den Bildschirm eines Emulators nicht lesen.

<!-- verify: phase 2 -->
Sie können auch ein Gerät aus der Liste in der Seite starten. Siehe [Geräte](/de/docs/guides/devices/).

Das Gateway läuft weiter, wenn kein Emulator gefunden wird, und gibt den Grund aus: im Terminal oder, wenn es im Hintergrund läuft, in seinem Log (`droidpier logs`).

<!-- verify: phase 3 -->
Wenn das Gateway meldet, dass `emulator`, `platform-tools`, ein Systemabbild oder ein Gerät fehlt, schließen Sie die Einrichtung auf der Seite ab. Siehe [Erster Start](/de/docs/getting-started/first-run/#2-let-it-check-your-android-sdk).

## Das Systemabbild eines Geräts fehlt

<!-- verify: phase 3 -->
Haben Sie ein Systemabbild entfernt, etwa in Android Studio, können die Geräte, die es nutzen, nicht starten. Die Seite nennt jedes dieser Geräte und die fehlende Android-Version und bietet an, das Abbild erneut zu installieren. Ein startfähiges Gerät genügt: Sobald irgendein Gerät sein Systemabbild hat, fragt die Seite nicht mehr.

## Eine Installation schlägt fehl

<!-- verify: phase 3 -->
Die Seite zeigt den Grund unter dem Element. Stimmt ein Download nicht mit der von Google veröffentlichten Prüfsumme überein, wird nichts entpackt; installieren Sie das Element erneut. Kommen eine Minute lang keine Daten an, bricht der Download ab; prüfen Sie Ihre Netzwerkverbindung und versuchen Sie es noch einmal. Droidpier braucht weder Java noch die Befehlszeilentools, ein fehlendes `sdkmanager` ist also kein Problem.

## Die Seite verbindet sich nicht

<!-- verify: phase 3 -->
Die Seite prüft einmal pro Sekunde, ob das Gateway da ist, und verbindet sich, sobald es antwortet. Wenn sie weiter wartet:

- Prüfen Sie mit `droidpier status`, ob das Gateway läuft. Falls nicht, führen Sie `droidpier start` aus. `droidpier logs` zeigt, warum es gestoppt ist.
- Prüfen Sie, ob Chrome den Zugriff auf das lokale Netzwerk für `droid.devpier.dev` erlaubt. Siehe [Chrome hat den Zugriff auf das lokale Netzwerk blockiert](#chrome-blocked-local-network-access).
- Wenn Sie das Gateway mit `--port` gestartet haben, öffnen Sie die ausgegebene Adresse, die auf `#port=<port>` endet.
- Holen Sie den Tab in den Vordergrund. Solange der Tab im Hintergrund ist, prüft die Seite nicht.

## Der Installationsbefehl schlägt fehl

- **Prüfsumme stimmt nicht:** Der Download passte nicht zu seiner Prüfsumme, daher wurde nichts installiert. Führen Sie den Befehl erneut aus.
- **Download-Seite nicht erreichbar:** Ist Droidpier bereits installiert, warnt der Befehl und startet die installierte Version. Ist es noch nicht installiert, prüfen Sie Ihre Internetverbindung und führen Sie den Befehl erneut aus.

## Die Seite meldet, dass das Gateway oder die Seite veraltet ist

<!-- verify: phase 3 -->
- **Gateway veraltet:** Führen Sie den Aktualisierungsbefehl aus, den die Seite anzeigt. Er ist derselbe wie der [Installationsbefehl](/de/docs/getting-started/install/).
- **Seite veraltet:** Laden Sie die Seite mit Cmd+Shift+R vollständig neu.

## Falscher Browser

<!-- verify: phase 3 -->
Die Seite funktioniert nur in Chrome und Edge. In anderen Browsern bittet sie Sie, zu wechseln, und versucht keine Verbindung. Siehe [Browser-Unterstützung](/de/docs/reference/browser-support/).

## Die lokale Ersatzseite verwenden {#use-the-local-fallback-page}

Das Gateway stellt dieselbe Seite unter `http://127.0.0.1:7300/app/` bereit (oder unter dem Port, den Sie gewählt haben). Verwenden Sie sie, wenn die öffentliche Seite nicht lädt oder der Zugriff auf das lokale Netzwerk abgelehnt wurde.

Führen Sie `droidpier --local` aus, damit das Gateway die lokale Seite statt der öffentlichen öffnet.

## Der Bildschirm wird nicht mehr aktualisiert

Wenn der Emulator beendet wird oder neu startet, zeigt die Seite an, dass die Verbindung getrennt ist. Das Gateway läuft weiter. Sobald der Emulator wieder da ist, verbindet sich die Seite erneut und der Bildschirm erscheint wieder.

## Deinstallieren {#uninstall}

Stoppen Sie das Gateway im Hintergrund und löschen Sie dann die Dateien, die es verwendet:

```sh
droidpier stop
rm ~/.local/bin/droidpier
rm -r ~/.local/share/droidpier ~/Library/Logs/Droidpier
```

Ist `droidpier` bereits gelöscht, läuft das Gateway im Hintergrund aber noch oder startet bei der Anmeldung, entfernen Sie es von Hand:

```sh
launchctl bootout gui/$(id -u)/dev.devpier.droidpier
rm ~/Library/LaunchAgents/dev.devpier.droidpier.plist
```
