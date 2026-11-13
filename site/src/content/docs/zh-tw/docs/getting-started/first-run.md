---
title: 首次執行
description: 用一道命令啟動閘道，讓它檢查 Android SDK，在 Chrome 中允許本機網路存取，然後在瀏覽器中查看你的模擬器。
sourceHash: 67f231cc69cd
---

在終端機中執行一道命令並保持該視窗開啟，開啟 `https://droid.devpier.dev/app/`，並在 Chrome 詢問時允許本機網路存取。

## 1. 啟動閘道

```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh
```

它會在需要時安裝或更新閘道，然後啟動它。請參閱[安裝](/zh-tw/docs/getting-started/install/)。安裝完成後，也可以用 `droidpier` 啟動它。

閘道會在該終端機視窗中持續執行。使用頁面期間請保持該視窗開啟。

閘道預設監聽 `127.0.0.1`，連接埠 `7300`。如需使用其他連接埠，請參閱[命令列](/zh-tw/docs/reference/cli/)。

## 2. 讓閘道檢查 Android SDK {#2-let-it-check-your-android-sdk}

<!-- verify: phase 3 -->
啟動時，閘道會檢查 Android SDK、`cmdline-tools`、`emulator`、`platform-tools`、系統映像 `system-images;android-34;google_apis;arm64-v8a`，以及至少一個虛擬裝置（AVD）。如果缺少某項，它會在終端機中逐項列出，並附上手動安裝的命令，然後提示你到頁面上完成安裝。它不會在終端機中提問。

<!-- verify: phase 3 -->
頁面會顯示同樣的清單，並標出每項的下載大小：

| 缺少的項目 | 你在頁面上要做的 |
|---|---|
| Android SDK、`cmdline-tools`、`emulator`、`platform-tools`、系統映像 | 用某項旁邊的按鈕單獨安裝，或一次全部安裝。 |
| 沒有 AVD | 建立裝置：選擇裝置型號和 Android 版本。 |
| Java（某項需要時） | 安裝內含 Java 的 Android Studio，或安裝 JDK 17 以上版本，然後重新開啟頁面。閘道不會安裝 Java。 |

<!-- verify: phase 3 -->
在你於頁面上確認之前，不會下載或建立任何內容。開始前，頁面會顯示要下載什麼、裝到哪裡、需要多少磁碟空間。安裝過程中，頁面會完整顯示每份 Google 授權條款，你同意後才會安裝該項。23 以上版本的命令列工具可能不詢問就接受授權條款；頁面會在你確認前告訴你。

例如，手動安裝系統映像：

```sh
sdkmanager "system-images;android-34;google_apis;arm64-v8a"
```

## 3. 開啟頁面 {#3-open-the-page}

<!-- verify: phase 3 -->
在 Chrome 或 Edge 中開啟 `https://droid.devpier.dev/app/`。閘道啟動時也會列印這個位址，並在預設瀏覽器中開啟它。如果你的預設瀏覽器不是 Chrome 或 Edge，請自行在 Chrome 或 Edge 中開啟該位址。

頁面會自行連線。在沒有閘道回應時，它每秒檢查一次，閘道一啟動就會連線，無需重新載入。分頁在背景時，它不會檢查。

如果閘道不在連接埠 `7300` 上執行，它列印的位址會以 `#port=<port>` 結尾：

```text
https://droid.devpier.dev/app/#port=7301
```

請開啟該位址，讓頁面找到正確的連接埠。

## 4. 允許本機網路存取 {#4-allow-local-network-access}

<!-- verify: phase 3 -->
當頁面首次連接到你 Mac 上的閘道時，Chrome 會顯示一個權限提示，詢問是否允許 `droid.devpier.dev` 存取你的本機網路。請點擊**允許**。Chrome 會記住該網站的選擇。

如果你拒絕了，請參閱[疑難排解](/zh-tw/docs/guides/troubleshooting/#chrome-blocked-local-network-access)。

## 5. 使用模擬器

如果已有啟用 gRPC 的模擬器在執行，頁面會直接顯示其畫面。

<!-- verify: phase 2 -->
否則，在清單中選擇一個裝置並啟動它。請參閱[裝置](/zh-tw/docs/guides/devices/)。

點擊畫面以取得鍵盤焦點。然後：

- 點擊即為輕觸；拖曳即為滑動。
- 使用 Mac 鍵盤輸入。請參閱[鍵盤與輸入](/zh-tw/docs/guides/keyboard-and-input/)。
- 使用畫面上方的返回、首頁和最近使用按鈕。

## 停止

在執行閘道的終端機中按 `Ctrl+C`，或關閉該視窗。正在執行的模擬器會繼續執行。下次用同一道命令或 `droidpier` 啟動閘道時，它會重新連接到這些模擬器。

## 本機備用頁面

閘道也在 `http://127.0.0.1:7300/app/`（或你選擇的連接埠）上提供相同的頁面。當公共頁面無法載入或無法連接時，可使用此頁面。

如需讓閘道開啟本機頁面而非公共頁面，請使用 `--local` 啟動：

```sh
droidpier --local
```
