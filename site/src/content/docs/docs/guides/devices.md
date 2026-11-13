---
title: Devices
description: List your Android virtual devices, start and stop them from the page, and take over an emulator that is already running.
---

A device here is an Android Virtual Device (AVD) on your Mac. The page shows one device at a time.

## The device list

<!-- verify: phase 2 -->
The list on the left shows every AVD that `emulator -list-avds` reports. For each one it shows:

- the name;
- the screen resolution;
- the Android version;
- the state: not running, booting (with seconds elapsed), running, or running but cannot be taken over;
- a start or stop button.

<!-- verify: phase 2 -->
Resolution, RAM and Android version come from each AVD's `config.ini` in `~/.android/avd/<name>.avd/`. If you set `ANDROID_AVD_HOME`, the gateway reads that directory instead. If a field is missing from `config.ini`, it is left blank.

## Start a device

<!-- verify: phase 2 -->
Click start next to a device. The gateway runs:

```sh
emulator -avd <name> -no-window -grpc <port> -no-boot-anim -gpu host
```

- `-no-window` means no separate emulator window opens. The screen appears only in the page.
- The gRPC port is the first free even port from `8554` upward.
- The device counts as booted when `adb -s emulator-<serial> shell getprop sys.boot_completed` returns `1`. The page shows progress until then.
- If the device has not booted after 180 seconds, the start fails and the gateway ends the emulator process.

<!-- verify: phase 2 -->
Clicking start again while a device is booting does not start a second copy. If you close the page during boot and open it again, the progress continues.

## Stop a device

<!-- verify: phase 2 -->
Click stop. The gateway runs `adb -s emulator-<serial> emu kill`.

## Emulators that are already running

The gateway finds running emulators through the files the emulator writes in `~/Library/Caches/TemporaryItems/avd/running/`. If an emulator is running with gRPC enabled, for example one you started with `-grpc <port>`, the gateway connects to it instead of starting another copy.

<!-- verify: phase 2 -->
An emulator that runs without gRPC is marked "running but cannot be taken over". The gateway needs gRPC to read the screen and send input. Stop that emulator and start it from the page.

## When the gateway stops

Stopping the gateway does not stop emulators. When you start the gateway again, it connects to them again.

## Create a device

<!-- verify: phase 3 -->
Create devices on the page. Use the button for a new device, then pick a device model and an Android version, and give the device a name; the page suggests one. Before anything happens, the page shows the model, the Android version and the memory the device gets. If the system image for that version is not installed yet, the gateway downloads it after you confirm and agree to Google's license.

Creating a device needs the command line tools (`avdmanager`). If they are missing, the dialog offers to install them first. See [First run](/docs/getting-started/first-run/#2-let-it-check-your-android-sdk).

You can also create devices with `avdmanager` or Android Studio; the list picks them up.
