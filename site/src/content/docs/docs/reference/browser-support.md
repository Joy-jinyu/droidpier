---
title: Browser support
description: Droidpier supports Chrome and Edge. Safari blocks the connection to the local gateway, and Firefox is not supported.
---

| Browser | Supported |
|---|---|
| Google Chrome | Yes |
| Microsoft Edge | Yes |
| Safari | No |
| Firefox | No |

Measurements on the [requirements](/docs/getting-started/requirements/#measured-performance) page were taken in Chrome 157.

## Why Safari does not work

The page is served over `https`, and it connects to the gateway on your Mac with `ws://127.0.0.1` (or `ws://localhost`), which is not encrypted. Safari treats this as mixed content (an insecure connection from a secure page) and blocks it. The page cannot reach the gateway in Safari.

## Firefox

Firefox is not supported.

## How the page checks the browser

<!-- verify: phase 3 -->
The page reads `navigator.userAgentData.brands`. It continues only if the list contains `Google Chrome` or `Microsoft Edge`. Otherwise it asks you to open the page in Chrome or Edge and does not try to connect.

<!-- verify: phase 3 -->
Safari and Firefox do not provide `navigator.userAgentData`, so they are rejected. Other Chromium-based browsers that do not report the Chrome or Edge brand are rejected as well.

## Chrome local network access

<!-- verify: phase 3 -->
- Since Chrome 147, a public `https` page that connects to `localhost` must first get the user's permission. Chrome asks once and remembers the answer for the site.
- Since Chrome 154, the page can say it is connecting to the loopback address (`targetAddressSpace: "loopback"` when opening the WebSocket). The page does this, and falls back to a plain WebSocket on versions that do not support the option.
- Since Chrome 156, enterprise policy can no longer turn this check off.

If you denied the permission, see [Troubleshooting](/docs/guides/troubleshooting/#chrome-blocked-local-network-access).
