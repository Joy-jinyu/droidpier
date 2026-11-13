---
title: Requirements
description: What you need before installing Droidpier - an Apple Silicon Mac, Chrome or Edge, and the Android emulator with an arm64 system image.
---

Droidpier runs the official Android emulator on your own Mac and shows it in a browser tab. Nothing runs on a remote server. You install a small local program (the gateway), and you need the Android emulator and a system image on the same Mac.

## Computer

- A Mac with Apple Silicon (M1 or later). Version 1 supports only Apple Silicon Macs and arm64 system images.
- Intel Macs, Windows and Linux are not supported in version 1.

## Browser

- Google Chrome or Microsoft Edge.
- Safari and Firefox are not supported. See [Browser support](/docs/reference/browser-support/) for the reason.

## Android SDK components

The gateway uses these parts of the Android SDK:

| Component | Used for | Approximate download size |
|---|---|---|
| `emulator` | Runs the Android virtual device | about 400 MB |
| `platform-tools` | `adb`, to check boot state and stop devices | about 16 MB |
| A system image, such as `system-images;android-34;google_apis;arm64-v8a` | The Android system the device runs. Any Android version works; if none is installed, the page offers Android 14 (API 34) | about 1.5 GB |

<!-- verify: phase 3 -->
You do not need Java, the command line tools (`sdkmanager`, `avdmanager`) or Android Studio: the gateway downloads these parts from Google's SDK repository and creates devices itself. If you already have the SDK from Android Studio, the gateway uses it. It looks for the SDK in this order:

1. The directory in the `ANDROID_HOME` environment variable.
2. `~/Library/Android/sdk`.

<!-- verify: phase 3 -->
If something is missing, the gateway tells you what and asks before it downloads anything. See [First run](/docs/getting-started/first-run/).

## Memory

<!-- verify: phase 3 -->
Each running emulator uses the RAM set in its device configuration. The default device that the gateway can create uses 4096 MB. One device is shown at a time.

## Measured performance

On an M4 Mac with a Pixel 5 API 34 virtual device (1080×2340) in Chrome 157, using the rgba-mmap frame transport (raw RGBA frames over shared memory), the screen updated at a median of 60 frames per second, and tap latency was 20 ms at p50 and 30 ms at p90. Your numbers depend on your Mac, the device and the browser.

CPU was measured on the same setup during 16 back-to-back swipes, summing the emulator, the gateway and the display process (all Chrome processes). Droidpier used 257% (emulator 136% + gateway 69% + Chrome 52%). scrcpy, measured the same way with the same emulator, used 208% (emulator 203% + scrcpy 5%), so Droidpier used 1.24 times as much CPU.
