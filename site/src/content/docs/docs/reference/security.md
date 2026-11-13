---
title: Security
description: How the gateway keeps other web pages and other computers from controlling your emulator - loopback only and an Origin allow-list.
---

The page is served from `droid.devpier.dev`, but the emulator and the gateway run on your Mac. Any web page you open could try to connect to a program on your Mac, so the gateway checks every connection.

## Loopback only

The gateway listens only on `127.0.0.1`. It does not accept connections from your local network or the internet. Other computers cannot reach it.

## Origin allow-list

<!-- verify: phase 3 -->
Browsers send an `Origin` header when a page opens a WebSocket, and a web page cannot forge it. The gateway accepts connections only from the public page on `droid.devpier.dev` and its own local page, that is, only from these origins:

- `https://droid.devpier.dev`
- `http://127.0.0.1:<port>`
- `http://localhost:<port>`

<!-- verify: phase 3 -->
A connection with any other origin, or with no origin, is closed with code `4003`. A page on another site cannot control your emulator, even if it guesses the port.

## How the page finds the gateway

<!-- verify: phase 3 -->
- While no gateway answers, the page at `droid.devpier.dev/app/` checks for it once a second and connects as soon as `droidpier` runs. It does not check while the tab is in the background.
- It uses port `7300`, or the port after `#port=` in the address. The gateway adds `#port=<port>` to the address it opens only when it does not run on port `7300`.
- The page does not store the port in the browser.

## The website does not connect to your Mac

<!-- verify: phase 3 -->
Chrome's local network permission and the gateway's Origin check both work per site, not per path. So the documentation pages share the permission with the emulator page at `/app/`. To limit what that means:

- Only the emulator page at `/app/` connects to the gateway. The home page and these docs never do, so reading them does not trigger the permission prompt.
- The site loads no third-party scripts, styles, fonts or media. Everything is served from `droid.devpier.dev`.

## Installing software

<!-- verify: phase 3 -->
The gateway never installs Android SDK packages or creates devices without asking. You confirm each install or new device on the page, after it shows what will be downloaded and where. The page shows Google's licenses in full, and an item is installed only if you agree. Command line tools version 23 or later may accept the licenses without asking; the page tells you before you confirm. The gateway asks nothing in Terminal.

## Connection close codes

<!-- verify: phase 3 -->
| Code | Meaning |
|---|---|
| `4000` | The first message was not `hello`. |
| `4002` | The page and the gateway use different protocol versions. |
| `4003` | Origin not allowed. |

## Reporting a problem

Open an issue at [github.com/twosugar/droidpier](https://github.com/twosugar/droidpier/issues).
