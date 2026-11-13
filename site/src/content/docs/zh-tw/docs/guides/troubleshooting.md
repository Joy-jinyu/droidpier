---
title: 疑難排解
description: 解決常見問題——Chrome 封鎖本機網路存取、連接埠被佔用、未找到模擬器、頁面無法連線、版本不符。
sourceHash: b8a54e8a6f0d
---

## Chrome 封鎖了本機網路存取 {#chrome-blocked-local-network-access}

<!-- verify: phase 3 -->
`droid.devpier.dev` 上的頁面會連接到你自己 Mac 上的閘道。Chrome 在首次連接時會要求權限。如果你拒絕了，頁面無法連接，在幾次失敗嘗試後，它會告知你 Chrome 封鎖了對你 Mac 的存取。

重新允許的方法：

1. 開啟 Chrome **設定 → 隱私權和安全性 → 網站設定**。
2. 找到 `droid.devpier.dev`，允許本機網路存取。
3. 重新載入頁面。

如果仍然無法連接，請使用[本機備用頁面](#use-the-local-fallback-page)。

## 連接埠已被佔用

閘道預設監聽連接埠 `7300`。

如果閘道在背景執行，再次執行這條命令會重新啟動它。如果有閘道在某個終端機視窗中執行，這條命令不會再啟動第二個，而是說明 droidpier 已在連接埠 `7300` 上執行。先按 `Ctrl+C` 停止那個，再執行這條命令。

如果連接埠被別的程式佔用，閘道會說明這一點，建議換一個連接埠，然後結束。查找該程式：

```sh
lsof -nP -iTCP:7300 -sTCP:LISTEN
```

停止該程式，或在其他連接埠啟動閘道：

```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh -s -- --port 7301
```

安裝完成後，`droidpier --port 7301` 效果相同。

<!-- verify: phase 3 -->
閘道會將新連接埠寫入它開啟的位址，頁面會連接到正確的連接埠。

## 未找到模擬器

如果頁面提示未找到正在執行的模擬器：

- 確認模擬器是否在執行：`adb devices` 應該列出 `emulator-5554` 或類似內容。
- 確認它是否在啟用 gRPC 的情況下啟動（`-grpc <port>`）。閘道無法讀取未啟用 gRPC 的模擬器的畫面。

<!-- verify: phase 2 -->
你也可以從頁面的清單中啟動裝置。請參閱[裝置](/zh-tw/docs/guides/devices/)。

找不到模擬器時，閘道會繼續執行，並列印原因：列印在終端機裡，背景執行時寫在記錄檔裡（`droidpier logs`）。

<!-- verify: phase 3 -->
如果閘道回報 Android SDK、`emulator`、`platform-tools` 或系統映像缺失，請按照它列印的修復方法操作。請參閱[首次執行](/zh-tw/docs/getting-started/first-run/#2-let-it-check-your-android-sdk)。

## "sdkmanager" 缺失

<!-- verify: phase 3 -->
Android Studio 安裝的 SDK 可能不包含 `cmdline-tools`（提供 `sdkmanager` 和 `avdmanager`）。頁面會提供安裝：在缺少項目清單裡它旁邊的安裝按鈕，或在建立裝置的對話框裡。你確認後，閘道會從 Google 下載 22.0 版命令列工具，裝到你的 SDK 中。頁面會完整顯示每份 Google 授權條款，你同意後才會安裝。

`sdkmanager` 需要 Java。如果你沒有 Java，請安裝內含 Java 的 Android Studio，或安裝 JDK 17 以上版本，然後重新開啟頁面。

如果想手動安裝，請從 developer.android.com 下載 Google 命令列工具並解壓縮，確保以下路徑存在：

```text
<your SDK>/cmdline-tools/latest/bin/sdkmanager
```

## 頁面無法連線

<!-- verify: phase 3 -->
頁面每秒檢查一次閘道，閘道一回應就會連線。如果頁面一直在等待：

- 執行 `droidpier status` 確認閘道在執行。沒有執行就執行 `droidpier start`；`droidpier logs` 可以看到它停止的原因。
- 檢查 Chrome 是否允許 `droid.devpier.dev` 存取本機網路。請參閱 [Chrome 封鎖了本機網路存取](#chrome-blocked-local-network-access)。
- 如果你使用 `--port` 啟動了閘道，請開啟它列印的位址，該位址以 `#port=<port>` 結尾。
- 將該分頁切換到前景。分頁在背景時，頁面不會檢查。

## 安裝命令失敗

- **檢查失敗：** 下載的檔案與檢查碼不一致，因此沒有安裝任何內容。請再次執行命令。
- **連不上下載站：** 如果已經安裝過 Droidpier，命令會給出提示，並啟動你已安裝的版本。如果還沒安裝，請檢查網路連線，然後再次執行命令。

## 頁面提示閘道或頁面已過期

<!-- verify: phase 3 -->
- **閘道已過期：** 執行頁面顯示的升級命令。與[安裝命令](/zh-tw/docs/getting-started/install/)相同。
- **頁面已過期：** 用 Cmd+Shift+R 強制重新整理頁面。

## 瀏覽器不正確

<!-- verify: phase 3 -->
該頁面僅在 Chrome 和 Edge 中有效。在其他瀏覽器中，它會要求你切換，並不會嘗試連接。請參閱[瀏覽器支援](/zh-tw/docs/reference/browser-support/)。

## 使用本機備用頁面 {#use-the-local-fallback-page}

閘道在 `http://127.0.0.1:7300/app/`（或你選擇的連接埠）上提供相同的頁面。當公共頁面無法載入或本機網路存取被拒絕時，可使用此頁面。

執行 `droidpier --local`，讓閘道開啟本機頁面而非公共頁面。

## 畫面停止更新

如果模擬器結束或重新啟動，頁面會顯示已中斷連線。閘道繼續執行。當模擬器恢復後，頁面會重新連接，畫面也會恢復。

## 解除安裝 {#uninstall}

先停止在背景執行的閘道，再刪除它用到的檔案：

```sh
droidpier stop
rm ~/.local/bin/droidpier
rm -r ~/.local/share/droidpier ~/Library/Logs/Droidpier
```

如果 `droidpier` 已經刪掉了，但背景閘道還在執行或登入時還會啟動，就手動移除它：

```sh
launchctl bootout gui/$(id -u)/dev.devpier.droidpier
rm ~/Library/LaunchAgents/dev.devpier.droidpier.plist
```
