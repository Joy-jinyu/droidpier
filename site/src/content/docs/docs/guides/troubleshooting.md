---
title: Troubleshooting
description: Fix common problems - Chrome blocked local network access, port already in use, no emulator found, the page does not connect, version mismatch.
---

## Chrome blocked local network access

<!-- verify: phase 3 -->
The page at `droid.devpier.dev` connects to the gateway on your own Mac. Chrome asks for permission the first time. If you denied it, the page cannot connect, and after a few failed attempts it tells you that Chrome blocked access to your Mac.

To allow it again:

1. Open Chrome **Settings → Privacy and security → Site settings**.
2. Find `droid.devpier.dev` and allow local network access.
3. Reload the page.

If you still cannot connect, use the [local fallback page](#use-the-local-fallback-page).

## Port already in use

The gateway listens on port `7300` by default.

If you run the command again while the gateway is still running, it does not start a second one. It says droidpier is already running on port `7300` and opens the page. Use that page, or stop the running gateway with `Ctrl+C` first.

If another program uses the port, the gateway says so, suggests another port, and exits. Find the program:

```sh
lsof -nP -iTCP:7300 -sTCP:LISTEN
```

Stop that program, or start the gateway on another port:

```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh -s -- --port 7301
```

After the install, `droidpier --port 7301` does the same.

<!-- verify: phase 3 -->
The gateway puts the new port in the address it opens, so the page connects to the right port.

## No emulator found

If the page says no running emulator was found:

- Check that an emulator is running: `adb devices` should list `emulator-5554` or similar.
- Check that it was started with gRPC enabled (`-grpc <port>`). The gateway cannot read the screen of an emulator without gRPC.

<!-- verify: phase 2 -->
You can also start a device from the list in the page. See [Devices](/docs/guides/devices/).

The gateway keeps running when no emulator is found, and prints the reason in Terminal.

<!-- verify: phase 3 -->
If the gateway reports that the Android SDK, `emulator`, `platform-tools` or the system image is missing, follow the fix it prints. See [First run](/docs/getting-started/first-run/#2-let-it-check-your-android-sdk).

## "sdkmanager" is missing

<!-- verify: phase 3 -->
An SDK installed by Android Studio may not include `cmdline-tools`, which provides `sdkmanager` and `avdmanager`. The page offers to install it: use the install button next to it in the list of missing items, or in the dialog for creating a device. After you confirm, the gateway downloads command line tools 22.0 from Google into your SDK. The page shows each Google license in full, and installs only if you agree.

`sdkmanager` needs Java. If you have none, install Android Studio, which includes Java, or JDK 17 or later, then reopen the page.

To install the tools by hand instead, download Google's command line tools from developer.android.com and unpack them so that this path exists:

```text
<your SDK>/cmdline-tools/latest/bin/sdkmanager
```

## The page does not connect

<!-- verify: phase 3 -->
The page checks for the gateway once a second and connects as soon as it answers. If it keeps waiting:

- Check that the Terminal window where you ran the command is still open. Closing the window or pressing `Ctrl+C` stops the gateway. Run the command again to start it.
- Check that Chrome allows local network access for `droid.devpier.dev`. See [Chrome blocked local network access](#chrome-blocked-local-network-access).
- If you started the gateway with `--port`, open the address it printed, which ends in `#port=<port>`.
- Bring the tab to the front. The page does not check while the tab is in the background.

## The install command fails

- **Checksum failed:** the download did not match its checksum, so nothing was installed. Run the command again.
- **Cannot reach the download site:** if Droidpier is already installed, the command warns you and starts the copy you have. If it is not installed yet, check your internet connection and run the command again.

## The page says the gateway or the page is out of date

<!-- verify: phase 3 -->
- **Gateway out of date:** run the upgrade command the page shows. It is the same as the [install command](/docs/getting-started/install/).
- **Page out of date:** force-reload the page with Cmd+Shift+R.

## Wrong browser

<!-- verify: phase 3 -->
The page works only in Chrome and Edge. In other browsers it asks you to switch and does not try to connect. See [Browser support](/docs/reference/browser-support/).

## Use the local fallback page

The gateway serves the same page at `http://127.0.0.1:7300/app/` (or the port you chose). Use it when the public page does not load or local network access was denied.

Run `droidpier --local` to have the gateway open the local page instead of the public one.

## The screen stops updating

If the emulator exits or restarts, the page shows that it is disconnected. The gateway keeps running. When the emulator comes back, the page reconnects and the screen returns.
