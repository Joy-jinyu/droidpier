---
title: Browser-Unterstützung
description: Droidpier unterstützt Chrome und Edge. Safari blockiert die Verbindung zum lokalen Gateway, und Firefox wird nicht unterstützt.
sourceHash: f0d75b070eb1
---

| Browser | Unterstützt |
|---|---|
| Google Chrome | Ja |
| Microsoft Edge | Ja |
| Safari | Nein |
| Firefox | Nein |

Die Messungen auf der Seite [Voraussetzungen](/de/docs/getting-started/requirements/#measured-performance) wurden in Chrome 157 durchgeführt.

## Warum Safari nicht funktioniert

Die Seite wird über `https` ausgeliefert und verbindet sich mit dem Gateway auf Ihrem Mac über `ws://127.0.0.1` (oder `ws://localhost`), was nicht verschlüsselt ist. Safari behandelt dies als gemischte Inhalte (eine unsichere Verbindung von einer sicheren Seite) und blockiert sie. Die Seite kann das Gateway in Safari nicht erreichen.

## Firefox

Firefox wird nicht unterstützt.

## Wie die Seite den Browser prüft

<!-- verify: phase 3 -->
Die Seite liest `navigator.userAgentData.brands`. Sie fährt nur fort, wenn die Liste `Google Chrome` oder `Microsoft Edge` enthält. Andernfalls bittet sie Sie, die Seite in Chrome oder Edge zu öffnen, und versucht keine Verbindung.

<!-- verify: phase 3 -->
Safari und Firefox stellen `navigator.userAgentData` nicht bereit, daher werden sie abgewiesen. Andere Chromium-basierte Browser, die nicht die Marke Chrome oder Edge melden, werden ebenfalls abgewiesen.

## Zugriff auf das lokale Netzwerk in Chrome

<!-- verify: phase 3 -->
- Seit Chrome 147 muss eine öffentliche `https`-Seite, die sich mit `localhost` verbindet, zuerst die Erlaubnis des Nutzers einholen. Chrome fragt einmal und merkt sich die Antwort für die Website.
- Seit Chrome 154 kann die Seite angeben, dass sie sich mit der Loopback-Adresse verbindet (`targetAddressSpace: "loopback"` beim Öffnen des WebSockets). Die Seite tut das und weicht in Versionen, die diese Option nicht unterstützen, auf einen einfachen WebSocket aus.
- Seit Chrome 156 kann diese Prüfung nicht mehr per Unternehmensrichtlinie abgeschaltet werden.

Wenn Sie die Berechtigung abgelehnt haben, siehe [Fehlerbehebung](/de/docs/guides/troubleshooting/#chrome-blocked-local-network-access).
