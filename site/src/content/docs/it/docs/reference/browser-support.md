---
title: Browser supportati
description: Droidpier supporta Chrome ed Edge. Safari blocca la connessione al gateway locale, e Firefox non è supportato.
sourceHash: f0d75b070eb1
---

| Browser | Supportato |
|---|---|
| Google Chrome | Sì |
| Microsoft Edge | Sì |
| Safari | No |
| Firefox | No |

Le misurazioni nella pagina [Requisiti](/it/docs/getting-started/requirements/#measured-performance) sono state effettuate in Chrome 157.

## Perché Safari non funziona

La pagina viene servita via `https`, e si connette al gateway sul tuo Mac con `ws://127.0.0.1` (o `ws://localhost`), che non è cifrato. Safari considera questo contenuto misto (una connessione non sicura da una pagina sicura) e lo blocca. In Safari la pagina non riesce a raggiungere il gateway.

## Firefox

Firefox non è supportato.

## Come la pagina controlla il browser

<!-- verify: phase 3 -->
La pagina legge `navigator.userAgentData.brands`. Prosegue solo se l’elenco contiene `Google Chrome` o `Microsoft Edge`. Altrimenti ti chiede di aprire la pagina in Chrome o Edge e non tenta di connettersi.

<!-- verify: phase 3 -->
Safari e Firefox non forniscono `navigator.userAgentData`, quindi vengono rifiutati. Anche gli altri browser basati su Chromium che non riportano il marchio Chrome o Edge vengono rifiutati.

## Accesso alla rete locale in Chrome

<!-- verify: phase 3 -->
- Da Chrome 147, una pagina `https` pubblica che si connette a `localhost` deve prima ottenere l’autorizzazione dell’utente. Chrome lo chiede una volta e ricorda la risposta per il sito.
- Da Chrome 154, la pagina può dichiarare che si sta connettendo all’indirizzo di loopback (`targetAddressSpace: "loopback"` all’apertura del WebSocket). La pagina lo fa, e nelle versioni che non supportano l’opzione ripiega su un normale WebSocket.
- Da Chrome 156, i criteri aziendali non possono più disattivare questo controllo.

Se hai negato l’autorizzazione, vedi [Risoluzione dei problemi](/it/docs/guides/troubleshooting/#chrome-blocked-local-network-access).
