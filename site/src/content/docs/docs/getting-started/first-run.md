---
title: First run
description: Start the gateway with one command, let it check the Android SDK, allow local network access in Chrome, and see your emulator in the browser.
---

Run one command in Terminal, open `https://droid.devpier.dev/app/`, and allow local network access when Chrome asks.

## 1. Start the gateway

```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh
```

This installs the gateway if needed, or updates it, and starts it. See [Install](/docs/getting-started/install/). After the install, `droidpier start` starts it too.

The gateway runs in the background. You can close the Terminal window.

The gateway listens on `127.0.0.1`, port `7300` by default. To use another port, see [Command line](/docs/reference/cli/).

## 2. Let it check your Android SDK

<!-- verify: phase 3 -->
On start, the gateway checks whether a device can start: it needs the Android emulator (`emulator`), `adb` from `platform-tools`, and at least one virtual device (AVD) whose system image is installed. Any Android version works. If something is missing, it lists each item in Terminal and tells you to finish the setup on the page. It does not ask anything in Terminal.

When the gateway runs in the background, this list goes to its log. Run `droidpier logs` to see it.

<!-- verify: phase 3 -->
The page shows the same list, with the download size of each item. When a device can start, it shows nothing.

| Missing | What you do on the page |
|---|---|
| `emulator`, `platform-tools`, system image | Install one item with the button next to it, or install them all at once. If no system image is installed, the page offers Android 14 (`system-images;android-34;google_apis;arm64-v8a`). If a device's system image was removed, the page names the device and offers that image. |
| No device | Create a device: pick a device model and an Android version. If a system image is already installed, the page suggests it instead of downloading Android 14. |

You do not need Java or the command line tools (`sdkmanager`, `avdmanager`). The gateway downloads each part from Google's SDK repository, the same source Android Studio uses, and creates the SDK folder if it does not exist yet.

<!-- verify: phase 3 -->
Nothing is downloaded or created until you confirm on the page. Before it starts, the page shows what it will download, where it goes and how much disk space it needs. Before each download, the page shows Google's license in full, and the item is installed only if you agree. The gateway records your agreement in the SDK's `licenses` folder, as Android Studio does, and checks each download against the checksum Google publishes before it unpacks anything.

To install an item yourself instead, expand the manual install section under it on the page. It says where to find the item in Android Studio and where it goes.

## 3. Open the page

<!-- verify: phase 3 -->
Open `https://droid.devpier.dev/app/` in Chrome or Edge. When the gateway starts, it also prints this address and opens it in your default browser. If your default browser is not Chrome or Edge, open the address in Chrome or Edge yourself.

The page connects by itself. While no gateway answers, it checks once a second and connects as soon as the gateway starts, without a reload. It does not check while the tab is in the background.

If the gateway does not run on port `7300`, the address it prints ends in `#port=<port>`:

```text
https://droid.devpier.dev/app/#port=7301
```

Open that address so the page finds the right port.

## 4. Allow local network access

<!-- verify: phase 3 -->
The first time the page connects to the gateway on your Mac, Chrome shows a permission prompt asking whether `droid.devpier.dev` may access your local network. Click **Allow**. Chrome remembers the choice for the site.

If you denied it, see [Troubleshooting](/docs/guides/troubleshooting/#chrome-blocked-local-network-access).

## 5. Use the emulator

If an emulator with gRPC is already running, the page shows its screen.

<!-- verify: phase 2 -->
Otherwise pick a device in the list and start it. See [Devices](/docs/guides/devices/).

Click the screen to give it keyboard focus. Then:

- Click to tap; drag to swipe.
- Type on your Mac keyboard. See [Keyboard and input](/docs/guides/keyboard-and-input/).
- Use the Back, Home and Recents buttons above the screen.

## Stop

Run `droidpier stop`. If you started the gateway with `droidpier` in a Terminal window, press `Ctrl+C` there instead. Running emulators keep running. The next time you start the gateway, with the same command or with `droidpier start`, it connects to them again.

## The local fallback page

The gateway also serves the same page itself at `http://127.0.0.1:7300/app/` (or the port you chose). Use it if the public page does not load or cannot connect.

To have the gateway open the local page instead of the public one, start it with `--local`:

```sh
droidpier --local
```
