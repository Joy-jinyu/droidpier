---
title: 安裝
description: 透過一道命令在 Apple Silicon Mac 上安裝並啟動 Droidpier 閘道。
sourceHash: 721a09a23a56
---

兩個步驟即可開始：

1. 在終端機中執行下面的命令。它會安裝 Droidpier 並在背景啟動它。
2. 開啟 `https://droid.devpier.dev/app/`。頁面會自行連線。第一次開啟時，當 Chrome 詢問是否允許該頁面存取你的本機網路時，點擊**允許**。

第 2 步的說明請參閱[首次執行](/zh-tw/docs/getting-started/first-run/)。

<!-- verify: phase 3 -->
`droidpier` 命令就是閘道：一個單獨的可執行檔，將 Mac 上的 Android 模擬器連接到瀏覽器頁面。執行它不需要 Node.js。

## 執行命令

<!-- verify: phase 3 -->

請先檢查[前置需求](/zh-tw/docs/getting-started/requirements/)，然後在終端機中執行：

<!-- 待第 3 阶段 Task 5 确认 -->
```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh
```

第一次執行時，該腳本將：

1. 從 `https://droid.devpier.dev/download/` 下載適用於 Apple Silicon macOS 的閘道 `droidpier-darwin-arm64.tar.xz`。其檢查碼就在旁邊的 `droidpier-darwin-arm64.tar.xz.sha256` 中。
2. 用檢查碼核對下載的檔案。如果不一致，腳本會停止，不安裝任何內容。
3. 將閘道儲存為 `~/.local/bin/droidpier`，並賦予其可執行權限。
4. 用 `droidpier start` 在背景啟動閘道。

閘道在背景執行。可以關閉終端機視窗：閘道會繼續執行，登入後也會自動啟動。執行 `droidpier stop` 停止它，執行 `droidpier status` 查看狀態。

再次執行同一道命令時：

- 如果你的版本已是最新，它會跳過下載並重新啟動閘道。
- 如果有新版本，它會更新你的版本，然後重新啟動閘道，讓新版本執行起來。
- 如果連不上下載站，它會給出提示，並啟動你已安裝的版本。
- 如果已有閘道在某個終端機視窗中執行，它會說明這一點，不啟動任何東西。先在那個視窗按 `Ctrl+C` 停止它。

如需給閘道傳選項，或只安裝不啟動，請參閱[命令列](/zh-tw/docs/reference/cli/#start-with-the-install-command)。

## 直接執行 droidpier

<!-- verify: phase 3 -->

安裝完成後，也可以使用 `droidpier` 命令。`droidpier start` 像安裝命令一樣在背景啟動閘道；只執行 `droidpier` 則在終端機視窗中執行它，直到你按 `Ctrl+C`：

```sh
droidpier start
```

如果 shell 回報 `command not found`，表示 `~/.local/bin` 不在你的 `PATH` 中。遇到這種情況時，安裝腳本會列印提示。請將其加入 `~/.zshrc`：

```sh
export PATH="$HOME/.local/bin:$PATH"
```

然後開啟新的終端機視窗並重試。

## 更新

<!-- verify: phase 3 -->

再次執行同一條命令。有新版本時，它會替換 `~/.local/bin` 中的檔案，並重新啟動閘道，讓新版本執行起來。

<!-- verify: phase 3 -->
當頁面版本比你的閘道新時，頁面會提示你閘道已過期，並顯示升級命令。

## 下一步

[首次執行](/zh-tw/docs/getting-started/first-run/)：讓閘道檢查你的 Android SDK，開啟頁面，並允許本機網路存取。
