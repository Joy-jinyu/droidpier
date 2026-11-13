---
title: 命令列
description: Droidpier 閘道命令的選項和環境變數。
sourceHash: 6811a7927009
---

<!-- verify: phase 3 -->
```sh
droidpier [--port <port>] [--local] [--no-open]
```

閘道在前台執行，直到你按 `Ctrl+C`。停止它不會停止正在執行的模擬器。

## 用安裝命令啟動 {#start-with-the-install-command}

安裝命令 `curl -fsSL https://droid.devpier.dev/install.sh | sh` 會安裝或更新閘道，然後啟動它。如需給閘道傳選項，把選項寫在 `sh -s --` 後面：

```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh -s -- --port 7310
```

如果只想安裝或更新、不啟動閘道，請設定 `DROIDPIER_NO_START=1`：

```sh
curl -fsSL https://droid.devpier.dev/install.sh | DROIDPIER_NO_START=1 sh
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

## 列印內容

啟動時，閘道會列印頁面位址。如果沒有模擬器在執行，它會列印原因並繼續執行。

<!-- verify: phase 3 -->
預設情況下，列印的位址是公共頁面 `https://droid.devpier.dev/app/`。當閘道不在連接埠 `7300` 上執行時，位址以 `#port=<port>` 結尾。使用 `--local` 時，則是本機頁面 `http://127.0.0.1:<port>/app/`。閘道會使用 macOS `open` 命令開啟該位址，除非你傳入 `--no-open`。

如果該連接埠上已有閘道在執行，就不會再啟動第二個。它會列印 droidpier 已經在執行及連接埠號，並開啟頁面。如果連接埠被別的程式佔用，它會說明這一點，建議換一個連接埠，然後結束。

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
