---
title: Command line
description: Options and environment variables for the Droidpier gateway command.
---

<!-- verify: phase 3 -->
```sh
droidpier start [--port <port>] [--local] [--no-open]
droidpier stop
droidpier status
droidpier logs
droidpier [--port <port>] [--local] [--no-open]
```

| Command | Effect |
|---|---|
| `droidpier start` | Run the gateway in the background, as a macOS LaunchAgent. It keeps running after you close Terminal, starts again when you log in, and restarts if it crashes. If it is already running, it restarts. It saves the options you give; without options, it keeps the saved ones. It opens the page once unless you pass `--no-open`. |
| `droidpier stop` | Stop the background gateway. It no longer starts when you log in. |
| `droidpier status` | Show whether the background gateway runs, with its process ID, port, version and log file. |
| `droidpier logs` | Print the log file path and its last 50 lines. |
| `droidpier` | Run the gateway in this Terminal window until you press `Ctrl+C`. |

Stopping the gateway does not stop running emulators.

## Start with the install command

The install command, `curl -fsSL https://droid.devpier.dev/install.sh | sh`, installs or updates the gateway, then runs `droidpier start`. To pass options to it, put them after `sh -s --`. They are saved for the background gateway:

```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh -s -- --port 7310
```

To install or update without starting the gateway, set `DROIDPIER_NO_START=1`:

```sh
curl -fsSL https://droid.devpier.dev/install.sh | DROIDPIER_NO_START=1 sh
```

To run the gateway in the Terminal window instead, as before, set `DROIDPIER_FOREGROUND=1`:

```sh
curl -fsSL https://droid.devpier.dev/install.sh | DROIDPIER_FOREGROUND=1 sh
```

## Options

| Option | Default | Effect |
|---|---|---|
| `--port <port>` | `7300` | The port the gateway listens on, on `127.0.0.1` only. |

<!-- verify: phase 3 -->
| Option | Default | Effect |
|---|---|---|
| `--local` | off | Open the page the gateway serves itself, `http://127.0.0.1:<port>/app/`, instead of the public page on `droid.devpier.dev`. |
| `--no-open` | off | Do not open the browser on start. The gateway still prints the address. |

With or without `--no-open`, the page finds the gateway by itself. See [First run](/docs/getting-started/first-run/#3-open-the-page).

## Environment variables

| Variable | Effect |
|---|---|
| `ANDROID_HOME` | The Android SDK directory. Without it, the gateway uses `~/Library/Android/sdk`. |
| `ANDROID_AVD_HOME` | The directory that holds AVDs. Without it, the gateway uses `~/.android/avd`. |
| `DEBUG=1` | Print one line per second for each connection: frames received, sent and dropped, average frame size, and the delay from the emulator to the gateway. |

<!-- verify: phase 2 -->
`ANDROID_AVD_HOME` is read when the gateway lists devices.

<!-- verify: phase 3 -->
`ANDROID_HOME` is read by the first-run check.

`droidpier start` saves `ANDROID_HOME` and `ANDROID_AVD_HOME` for the background gateway when they are set, because launchd does not read your shell profile. Run `droidpier start` again after you change them.

## What it prints

On start, the gateway prints the address of the page. If no emulator is running, it prints the reason and keeps running.

<!-- verify: phase 3 -->
By default the printed address is the public page, `https://droid.devpier.dev/app/`. When the gateway does not run on port `7300`, the address ends in `#port=<port>`. With `--local`, it is the local page, `http://127.0.0.1:<port>/app/`. The gateway opens the address with the macOS `open` command unless you pass `--no-open`.

If a gateway is already running on the port, a second one does not start. It prints that droidpier is already running, with the port, and opens the page. If the running one is the background gateway, it also prints `droidpier stop`. If another program uses the port, it says so, suggests another port, and exits.

<!-- verify: phase 3 -->
When Android SDK parts are missing, the gateway lists each one with a command to install it by hand, and tells you to finish the setup on the page. It never asks anything in Terminal: installs, new devices and licenses are confirmed on the page. See [First run](/docs/getting-started/first-run/#2-let-it-check-your-android-sdk).

## Files and ports it uses

| What | Where |
|---|---|
| Gateway listen address | `127.0.0.1:<port>` |
| Running emulator discovery | `~/Library/Caches/TemporaryItems/avd/running/pid_<pid>.ini` |

<!-- verify: phase 2 -->
| What | Where |
|---|---|
| Emulator gRPC ports it assigns | The first free even port from `8554` |

<!-- verify: phase 3 -->
| What | Where |
|---|---|
| Installed executable | `~/.local/bin/droidpier` |
| Checksum of the installed version | `~/.local/share/droidpier/installed.sha256` |
| Background gateway settings | `~/Library/LaunchAgents/dev.devpier.droidpier.plist` |
| Background gateway log | `~/Library/Logs/Droidpier/droidpier.log` |
