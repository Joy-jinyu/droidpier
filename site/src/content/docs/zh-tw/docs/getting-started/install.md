---
title: 安裝
description: 透過一道命令在 Apple Silicon Mac 上安裝並啟動 Droidpier 閘道。
sourceHash: 9e0b6fc5fcb6
---

兩個步驟即可開始：

1. 在終端機中執行下方的命令，並保持該視窗開啟。它會安裝 Droidpier 並啟動它。
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
4. 啟動閘道。

閘道會在該終端機視窗中持續執行。使用頁面期間請保持該視窗開啟。按 `Ctrl+C` 停止。

再次執行同一道命令時：

- 如果你的版本已是最新，它會略過下載，直接啟動閘道。
- 如果有新版本，它會先更新，再啟動。
- 如果連不上下載站，它會給出提示，並啟動你已安裝的版本。
- 如果閘道已經在執行，它會提示這一點並開啟頁面，不會再啟動第二個。

如需給閘道傳選項，或只安裝不啟動，請參閱[命令列](/zh-tw/docs/reference/cli/#start-with-the-install-command)。

## 直接執行 droidpier

<!-- verify: phase 3 -->

安裝完成後，也可以用 `droidpier` 命令啟動閘道：

```sh
droidpier
```

如果 shell 回報 `command not found`，表示 `~/.local/bin` 不在你的 `PATH` 中。遇到這種情況時，安裝腳本會列印提示。請將其加入 `~/.zshrc`：

```sh
export PATH="$HOME/.local/bin:$PATH"
```

然後開啟新的終端機視窗並重試。

## 更新

<!-- verify: phase 3 -->

再次執行同一道命令即可。有新版本時，它會替換 `~/.local/bin` 中的檔案。如果閘道仍在執行，請先按 `Ctrl+C` 停止它，這樣命令才會啟動新版本。

<!-- verify: phase 3 -->
當頁面版本比你的閘道新時，頁面會提示你閘道已過期，並顯示升級命令。

## 下一步

[首次執行](/zh-tw/docs/getting-started/first-run/)：讓閘道檢查你的 Android SDK，開啟頁面，並允許本機網路存取。
