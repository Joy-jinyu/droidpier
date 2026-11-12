# Droidpier

Drive the official Android emulator from a web page.

Droidpier replaces the Android Studio emulator window with a page in Chrome or Edge. The emulator itself is unchanged: it runs headless on your Mac, and a small local gateway streams its screen to the page and sends your input back.

**Docs:** https://droid.devpier.dev/docs/getting-started/install/ · [中文文档](https://droid.devpier.dev/zh-cn/docs/getting-started/install/)

## Features

- Sharp, low-latency screen at your display's pixel density, with mouse, wheel scrolling and keyboard input
- Paste text from your Mac (including Chinese) and copy text out of the emulator
- Back, Home, Recents, volume, power, rotate (the whole device turns), screenshots, restart; the Android Studio emulator's
  shortcuts for these keys work once you click the screen (⌘⌫ Back, ⇧⌘H Home, ⌘O Recents, ⌘P power, ⌘= / ⌘- volume,
  ⌘← / ⌘→ rotate left / right, ⌘S screenshot)
- Device list: start and stop AVDs, rename and delete them, create a device by picking a model and Android version
- H5 debugging: inspect a WebView page in an embedded DevTools, see its network requests, point it at a local dev server
- First-run guide in the page: checks the Android SDK pieces and installs what is missing, after you confirm and accept each licence yourself

## Quick start

Requirements: an Apple Silicon Mac, Chrome or Edge.

```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh
```

The command installs the gateway the first time, updates it when there is a new version, and then starts it in the background with `droidpier start`. You can close the terminal: the gateway keeps running and starts again when you log in. `droidpier stop` stops it, `droidpier status` shows whether it runs.

Then open https://droid.devpier.dev/app/ (the gateway opens it for you). The first time, Chrome asks whether the site may access your local network: click **Allow**. An open page connects by itself as soon as the gateway is running.

No Android SDK yet? The page lists what is missing and installs it.

## How it works

```
Chrome / Edge                    your Mac
┌──────────────────────┐  ws://127.0.0.1:7300  ┌──────────────┐  gRPC + adb  ┌──────────────────┐
│ droid.devpier.dev/app│ ◄───────────────────► │  droidpier   │ ◄──────────► │ Android emulator │
│ (static page)        │                       │  (gateway)   │              │ (official, -grpc)│
└──────────────────────┘                       └──────────────┘              └──────────────────┘
```

- The page is static and served from Cloudflare Pages. Nothing about your device leaves your Mac.
- The gateway listens on `127.0.0.1` only and accepts connections only from `https://droid.devpier.dev` and its own local page. Browsers cannot fake that origin. See [Security](https://droid.devpier.dev/docs/reference/security/).
- Frames come from the emulator's gRPC `streamScreenshot` over shared memory; input goes back over gRPC, paste over adb.

## Command line

```sh
droidpier start [--port <port>] [--local] [--no-open]   # run in the background (a per-user LaunchAgent)
droidpier stop                                          # stop it; it no longer starts at login
droidpier status                                        # running? pid, port, version, log file
droidpier logs                                          # log file path and its last lines
droidpier [--port <port>] [--local] [--no-open]         # run in this terminal until Ctrl+C
droidpier --version | --help
```

`droidpier start` writes `~/Library/LaunchAgents/dev.devpier.droidpier.plist` with the options you gave (a later `droidpier start` without options keeps them), starts the gateway, waits until it answers and opens the page once. launchd restarts the gateway if it crashes, not after `droidpier stop`. The log is `~/Library/Logs/Droidpier/droidpier.log`. If `ANDROID_HOME` or `ANDROID_AVD_HOME` is set when you run `droidpier start`, it is passed to the service, since launchd does not read your shell profile.

| Option | Effect |
| --- | --- |
| `--port <port>` | Listen on another port (default `7300`). The page address then ends in `#port=<port>`. |
| `--local` | Open the page the gateway serves itself, `http://127.0.0.1:<port>/app/`. |
| `--no-open` | Do not open the browser; just print the address. |
| `--version` | Print the version (the build time of the release binary) and exit. |
| `-h`, `--help` | Print the options and exit. |

An unknown option or a stray argument makes `droidpier` exit with a message instead of being ignored.

### Uninstall

```sh
droidpier stop
rm ~/.local/bin/droidpier
rm -r ~/.local/share/droidpier ~/Library/Logs/Droidpier
```

If `droidpier` is already deleted but the background gateway still runs or starts at login, remove it by hand:

```sh
launchctl bootout gui/$(id -u)/dev.devpier.droidpier
rm ~/Library/LaunchAgents/dev.devpier.droidpier.plist
```

More in the [command line reference](https://droid.devpier.dev/docs/reference/cli/) and [troubleshooting](https://droid.devpier.dev/docs/guides/troubleshooting/).

## Development

Needs Node 22.6+ (runs TypeScript directly), [Bun](https://bun.sh), and the nsh toolchain for the page.

```sh
pnpm install            # or: bun install
npm test                # unit tests (node --test)
npm start               # run the gateway from source on port 7300
```

Build the page and the single-file gateway:

```sh
NSH=/path/to/nsh bun run build:ui    # page → .nsh/out/Droidpier
NSH=/path/to/nsh bun run build:bin   # gateway → dist/droidpier-darwin-arm64(.tar.xz)
```

`build:ui` compiles wasm with llvm from `/opt/homebrew/opt/llvm/bin`; set `LLVM_BIN` if yours is elsewhere. Integration tests against a running emulator: `EMU_IT=1 node --test gateway/test/emulator.it.test.ts`.

Deploying the public page is described in [docs/deploy.md](docs/deploy.md).

### Layout

| Path | What |
| --- | --- |
| `gateway/` | Node gateway: emulator discovery, gRPC/adb, WebSocket server, installer, DevTools proxy |
| `host/` | Browser-side host module: connection, canvas renderer, pointer/keyboard, clipboard |
| `ui/` | The page UI (nsh) |
| `shared/` | Protocol and pure logic shared by gateway, host and UI |
| `scripts/` | Binary build, Pages build, install script |
| `docs/superpowers/` | Design spec, plans and execution notes |

## Status

macOS on Apple Silicon only for now. Chrome and Edge only (they support the local network access the page needs).
