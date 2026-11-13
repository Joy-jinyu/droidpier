---
title: 命令列
description: Droidpier 閘道命令的選項和環境變數。
sourceHash: b62f19b96312
---

<!-- verify: phase 3 -->
```sh
droidpier start [--port <port>] [--local] [--no-open]
droidpier stop
droidpier status
droidpier logs
droidpier [--port <port>] [--local] [--no-open]
```

| 命令 | 作用 |
|---|---|
| `droidpier start` | 以 macOS LaunchAgent 的方式在背景執行閘道。關閉終端機後繼續執行，登入時自動啟動，當機後自動重新啟動。已在執行時會重新啟動它。會儲存你給的選項；不帶選項時沿用儲存的選項。啟動後開啟一次頁面，除非加上 `--no-open`。 |
| `droidpier stop` | 停止在背景執行的閘道，登入時也不再自動啟動。 |
| `droidpier status` | 顯示背景閘道是否在執行，以及它的程序 ID、連接埠、版本和記錄檔。 |
| `droidpier logs` | 列印記錄檔路徑和最後 50 行。 |
| `droidpier` | 在目前的終端機視窗中執行閘道，直到你按 `Ctrl+C`。 |

停止閘道不會停止正在執行的模擬器。

## 用安裝命令啟動 {#start-with-the-install-command}

安裝命令 `curl -fsSL https://droid.devpier.dev/install.sh | sh` 會安裝或更新閘道，然後執行 `droidpier start`。要傳選項給它，把選項放在 `sh -s --` 之後，它們會儲存給在背景執行的閘道：

```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh -s -- --port 7310
```

如果只想安裝或更新、不啟動閘道，請設定 `DROIDPIER_NO_START=1`：

```sh
curl -fsSL https://droid.devpier.dev/install.sh | DROIDPIER_NO_START=1 sh
```

要像以前一樣在終端機視窗中執行閘道，設定 `DROIDPIER_FOREGROUND=1`：

```sh
curl -fsSL https://droid.devpier.dev/install.sh | DROIDPIER_FOREGROUND=1 sh
```

## 選項

| 選項 | 預設值 | 效果 |
|---|---|---|
| `--port <port>` | `7300` | 閘道監聽的連接埠，僅在 `127.0.0.1` 上。 |

<!-- verify: phase 3 -->
| 選項 | 預設值 | 效果 |
|---|---|---|
| `--local` | 關閉 | 開啟閘道自身提供的頁面 `http://127.0.0.1:<port>/app/`，而非 `droid.devpier.dev` 上的公共頁面。 |
| `--no-open` | 關閉 | 啟動時不開啟瀏覽器。閘道仍會列印位址。 |

無論是否使用 `--no-open`，頁面都會自行找到閘道。請參閱[首次執行](/zh-tw/docs/getting-started/first-run/#3-open-the-page)。

## 環境變數

| 變數 | 效果 |
|---|---|
| `ANDROID_HOME` | Android SDK 目錄。如未設定，閘道使用 `~/Library/Android/sdk`。 |
| `ANDROID_AVD_HOME` | 存放 AVD 的目錄。如未設定，閘道使用 `~/.android/avd`。 |
| `DEBUG=1` | 每秒為每個連線列印一行：已接收、已傳送和已捨棄的幀數，平均幀大小，以及從模擬器到閘道的延遲。 |

<!-- verify: phase 2 -->
`ANDROID_AVD_HOME` 在閘道列出裝置時讀取。

<!-- verify: phase 3 -->
`ANDROID_HOME` 在首次執行檢查時讀取。

設定了 `ANDROID_HOME` 和 `ANDROID_AVD_HOME` 時，`droidpier start` 會把它們儲存給在背景執行的閘道，因為 launchd 不讀取你的 shell 設定。修改它們後請重新執行 `droidpier start`。

## 列印內容

啟動時，閘道會列印頁面位址。如果沒有模擬器在執行，它會列印原因並繼續執行。

<!-- verify: phase 3 -->
預設情況下，列印的位址是公共頁面 `https://droid.devpier.dev/app/`。當閘道不在連接埠 `7300` 上執行時，位址以 `#port=<port>` 結尾。使用 `--local` 時，則是本機頁面 `http://127.0.0.1:<port>/app/`。閘道會使用 macOS `open` 命令開啟該位址，除非你傳入 `--no-open`。

如果該連接埠上已有閘道在執行，不會再啟動第二個。它會列印 droidpier 已在執行及連接埠，並開啟頁面。如果在執行的是背景閘道，還會列印 `droidpier stop`。如果連接埠被其他程式佔用，它會說明這一點，建議換一個連接埠，然後結束。

<!-- verify: phase 3 -->
缺少 Android SDK 元件時，閘道會逐項列出，並附上手動安裝的命令，然後提示你到頁面上完成安裝。它從不在終端機中提問：安裝、建立裝置和授權條款都在頁面上確認。請參閱[首次執行](/zh-tw/docs/getting-started/first-run/#2-let-it-check-your-android-sdk)。

## 使用的檔案和連接埠

| 內容 | 位置 |
|---|---|
| 閘道監聽位址 | `127.0.0.1:<port>` |
| 發現執行中的模擬器 | `~/Library/Caches/TemporaryItems/avd/running/pid_<pid>.ini` |

<!-- verify: phase 2 -->
| 內容 | 位置 |
|---|---|
| 分配的模擬器 gRPC 連接埠 | 從 `8554` 起第一個可用的偶數連接埠 |

<!-- verify: phase 3 -->
| 內容 | 位置 |
|---|---|
| 安裝的可執行檔 | `~/.local/bin/droidpier` |
| 已安裝版本的檢查碼 | `~/.local/share/droidpier/installed.sha256` |
| 背景閘道的設定 | `~/Library/LaunchAgents/dev.devpier.droidpier.plist` |
| 背景閘道的記錄檔 | `~/Library/Logs/Droidpier/droidpier.log` |
