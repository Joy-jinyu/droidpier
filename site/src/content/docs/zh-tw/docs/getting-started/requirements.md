---
title: 前置需求
description: 安裝 Droidpier 所需的條件——Apple Silicon Mac、Chrome 或 Edge，以及含有 arm64 系統映像的 Android 模擬器。
sourceHash: 39e85ecc70b3
---

Droidpier 在你自己的 Mac 上執行官方 Android 模擬器，並在瀏覽器分頁中顯示。沒有任何內容執行在遠端伺服器上。你需要安裝一個小型本地程式（閘道），以及在同一台 Mac 上安裝 Android 模擬器和系統映像。

## 電腦

- 搭載 Apple Silicon（M1 或更新型號）的 Mac。第 1 版僅支援 Apple Silicon Mac 和 arm64 系統映像。
- 第 1 版不支援 Intel Mac、Windows 和 Linux。

## 瀏覽器

- Google Chrome 或 Microsoft Edge。
- 不支援 Safari 和 Firefox。原因請參閱[瀏覽器支援](/zh-tw/docs/reference/browser-support/)。

## Android SDK 元件

閘道使用 Android SDK 的以下部分：

| 元件 | 用途 | 大致下載大小 |
|---|---|---|
| `emulator` | 執行 Android 虛擬裝置 | 約 400 MB |
| `platform-tools` | `adb`，用於檢查啟動狀態和停止裝置 | 約 16 MB |
| 系統映像，例如 `system-images;android-34;google_apis;arm64-v8a` | 裝置執行的 Android 系統。任何 Android 版本都可以；一個都沒裝時，頁面會提供 Android 14（API 34） | 約 1.5 GB |

<!-- verify: phase 3 -->
你不需要 Java、命令列工具（`sdkmanager`、`avdmanager`）或 Android Studio：閘道會從 Google 的 SDK 存放區下載這些元件，並自行建立裝置。如果你已透過 Android Studio 安裝了 SDK，閘道會直接使用它。尋找順序如下：

1. `ANDROID_HOME` 環境變數指定的目錄。
2. `~/Library/Android/sdk`。

<!-- verify: phase 3 -->
如有缺失，閘道會告知你缺少什麼，並在下載任何內容前徵得你的同意。請參閱[首次執行](/zh-tw/docs/getting-started/first-run/)。

## 記憶體

<!-- verify: phase 3 -->
每個執行中的模擬器使用其裝置設定中設定的 RAM 大小。閘道可建立的預設裝置使用 4096 MB。每次只顯示一個裝置。

## 實測效能 {#measured-performance}

在搭載 M4 的 Mac 上，使用 Pixel 5 API 34 虛擬裝置（1080×2340），於 Chrome 157 中使用 rgba-mmap 幀傳輸方式（原始 RGBA 幀經共享記憶體傳輸），畫面更新影格率中位數為 60 fps，點擊延遲 p50 為 20 ms，p90 為 30 ms。實際數值取決於你的 Mac、裝置和瀏覽器。

CPU 在相同設定下進行 16 次連續滑動期間測量，統計了模擬器、閘道和顯示程序（所有 Chrome 程序）的總和。Droidpier 使用了 257%（模擬器 136% + 閘道 69% + Chrome 52%）。scrcpy 在相同條件下使用了 208%（模擬器 203% + scrcpy 5%），因此 Droidpier 的 CPU 使用量為 scrcpy 的 1.24 倍。
