---
title: Install
description: Install and start the Droidpier gateway on an Apple Silicon Mac with one command.
---

Getting started takes two steps:

1. Run the command below in Terminal. It installs Droidpier and starts it in the background.
2. Open `https://droid.devpier.dev/app/`. The page connects by itself. The first time, when Chrome asks whether the page may access your local network, click **Allow**.

Step 2 is described in [First run](/docs/getting-started/first-run/).

<!-- verify: phase 3 -->
The `droidpier` command is the gateway: a single executable file that connects the Android emulator on your Mac to the browser page. You do not need Node.js to run it.

## Run the command

<!-- verify: phase 3 -->

Check the [requirements](/docs/getting-started/requirements/) first. Then run this in Terminal:

<!-- 待第 3 阶段 Task 5 确认 -->
```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh
```

The first time, the script:

1. Downloads the gateway for macOS on Apple Silicon, `droidpier-darwin-arm64.tar.xz`, from `https://droid.devpier.dev/download/`. Its checksum is next to it, in `droidpier-darwin-arm64.tar.xz.sha256`.
2. Checks the download against the checksum. If they do not match, it stops and installs nothing.
3. Saves the gateway as `~/.local/bin/droidpier` and makes it executable.
4. Starts the gateway in the background with `droidpier start`.

The gateway runs in the background. You can close the Terminal window: the gateway keeps running, and it starts again when you log in. Run `droidpier stop` to stop it, and `droidpier status` to check it.

When you run the same command again:

- If your copy is up to date, it skips the download and restarts the gateway.
- If a newer version exists, it updates your copy, then restarts the gateway, so the new version runs.
- If the download site cannot be reached, it warns you and starts the copy you already have.
- If a gateway is already running in a Terminal window, it says so and starts nothing. Stop that one with `Ctrl+C` first.

To pass options to the gateway, or to install without starting it, see [Command line](/docs/reference/cli/#start-with-the-install-command).

## Run droidpier directly

<!-- verify: phase 3 -->

After the install, you can also use the `droidpier` command. `droidpier start` starts the gateway in the background, as the install command does. `droidpier` alone runs it in the Terminal window until you press `Ctrl+C`:

```sh
droidpier start
```

If your shell reports `command not found`, `~/.local/bin` is not on your `PATH`. The install script prints a hint when this is the case. Add it, for example in `~/.zshrc`:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

Then open a new Terminal window and try again.

## Update

<!-- verify: phase 3 -->

Run the same command again. It replaces the file in `~/.local/bin` when a newer version exists, and restarts the gateway so the new version runs.

<!-- verify: phase 3 -->
When the page is newer than your gateway, the page tells you the gateway is out of date and shows the command to upgrade it.

## Next step

[First run](/docs/getting-started/first-run/): let the gateway check your Android SDK, open the page, and allow local network access.
