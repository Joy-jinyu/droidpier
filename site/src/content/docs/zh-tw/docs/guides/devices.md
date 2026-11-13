---
title: 裝置
description: 列出 Android 虛擬裝置，從頁面啟動和停止它們，並接管已在執行的模擬器。
sourceHash: 6eaf456bc1f3
---

這裡的裝置是指 Mac 上的 Android 虛擬裝置（AVD）。頁面每次顯示一個裝置。

## 裝置清單

<!-- verify: phase 2 -->
左側清單顯示 `emulator -list-avds` 回報的所有 AVD。每個項目顯示：

- 名稱；
- 螢幕解析度；
- Android 版本；
- 狀態：未執行、正在啟動（顯示已用秒數）、執行中，或執行中但無法接管；
- 啟動或停止按鈕。

<!-- verify: phase 2 -->
解析度、RAM 和 Android 版本來自 `~/.android/avd/<name>.avd/` 中各 AVD 的 `config.ini`。如果你設定了 `ANDROID_AVD_HOME`，閘道會讀取該目錄。如果 `config.ini` 中某欄位缺失，則顯示為空白。

## 啟動裝置

<!-- verify: phase 2 -->
點擊裝置旁邊的啟動按鈕。閘道會執行：

```sh
emulator -avd <name> -no-window -grpc <port> -no-boot-anim -gpu host
```

- `-no-window` 表示不會開啟獨立的模擬器視窗。畫面僅在頁面中顯示。
- gRPC 連接埠為從 `8554` 起第一個可用的偶數連接埠。
- 當 `adb -s emulator-<serial> shell getprop sys.boot_completed` 回傳 `1` 時，裝置視為已啟動。在此之前，頁面會顯示進度。
- 如果裝置在 180 秒內未啟動，啟動失敗，閘道會終止模擬器程序。

<!-- verify: phase 2 -->
裝置正在啟動時再次點擊啟動不會啟動第二個副本。如果你在啟動過程中關閉頁面再重新開啟，進度會繼續。

## 停止裝置

<!-- verify: phase 2 -->
點擊停止按鈕。閘道執行 `adb -s emulator-<serial> emu kill`。

## 已在執行的模擬器

閘道透過模擬器寫入 `~/Library/Caches/TemporaryItems/avd/running/` 中的檔案來發現正在執行的模擬器。如果模擬器啟用了 gRPC（例如透過 `-grpc <port>` 啟動），閘道會直接連接，而不是再啟動一個副本。

<!-- verify: phase 2 -->
未啟用 gRPC 執行的模擬器會被標記為「執行中但無法接管」。閘道需要 gRPC 來讀取畫面和傳送輸入。請停止該模擬器，然後從頁面重新啟動它。

## 閘道停止時

停止閘道不會停止模擬器。再次啟動閘道時，它會重新連接到這些模擬器。

## 建立裝置

<!-- verify: phase 3 -->
在頁面上建立裝置。用新增裝置的按鈕，選擇裝置型號和 Android 版本，再替裝置取個名稱（頁面會建議一個）。開始之前，頁面會顯示裝置的型號、Android 版本和記憶體。如果該版本的系統映像還沒安裝，閘道會在你確認並同意 Google 授權條款後下載它。

建立裝置需要命令列工具（`avdmanager`）。如果缺少，對話框會先提供安裝。請參閱[首次執行](/zh-tw/docs/getting-started/first-run/#2-let-it-check-your-android-sdk)。

你也可以使用 `avdmanager` 或 Android Studio 建立裝置；清單會自動識別它們。

## 刪除裝置

點裝置旁邊的垃圾桶圖示並確認。這會刪除裝置和它的全部資料（已安裝的 App、檔案、快照），無法復原。系統映像不會刪除。正在執行或正在啟動的裝置不能刪除：請先停止它。
