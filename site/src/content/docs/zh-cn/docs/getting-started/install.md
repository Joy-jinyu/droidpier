---
title: 安装
description: 通过一条命令在 Apple Silicon Mac 上安装并启动 Droidpier 网关。
sourceHash: 9e0b6fc5fcb6
---

两步即可开始：

1. 在终端中运行下面的命令，并保持该窗口打开。它会安装 Droidpier 并启动它。
2. 打开 `https://droid.devpier.dev/app/`。页面会自行连接。首次打开时，当 Chrome 询问是否允许该页面访问你的本地网络时，点击**允许**。

第 2 步的说明请参阅[首次运行](/zh-cn/docs/getting-started/first-run/)。

<!-- verify: phase 3 -->
`droidpier` 命令就是网关：一个单独的可执行文件，将 Mac 上的 Android 模拟器连接到浏览器页面。运行它不需要 Node.js。

## 运行命令

<!-- verify: phase 3 -->

请先检查[前置要求](/zh-cn/docs/getting-started/requirements/)，然后在终端中运行：

<!-- 待第 3 阶段 Task 5 确认 -->
```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh
```

第一次运行时，该脚本将：

1. 从 `https://droid.devpier.dev/download/` 下载适用于 Apple Silicon macOS 的网关 `droidpier-darwin-arm64.tar.xz`。其校验和就在旁边的 `droidpier-darwin-arm64.tar.xz.sha256` 中。
2. 用校验和核对下载的文件。如果不一致，脚本会停止，不安装任何内容。
3. 将网关保存为 `~/.local/bin/droidpier`，并赋予其可执行权限。
4. 启动网关。

网关会在该终端窗口中持续运行。使用页面期间请保持该窗口打开。按 `Ctrl+C` 停止。

再次运行同一条命令时：

- 如果你的版本已是最新，它会跳过下载，直接启动网关。
- 如果有新版本，它会先更新，再启动。
- 如果连不上下载站，它会给出提示，并启动你已安装的版本。
- 如果网关已经在运行，它会提示这一点并打开页面，不会再启动第二个。

如需给网关传选项，或只安装不启动，请参阅[命令行](/zh-cn/docs/reference/cli/#start-with-the-install-command)。

## 直接运行 droidpier

<!-- verify: phase 3 -->

安装完成后，也可以用 `droidpier` 命令启动网关：

```sh
droidpier
```

如果 shell 报告 `command not found`，说明 `~/.local/bin` 不在你的 `PATH` 中。遇到这种情况时，安装脚本会打印提示。请将其添加到 `~/.zshrc` 中：

```sh
export PATH="$HOME/.local/bin:$PATH"
```

然后打开新的终端窗口并重试。

## 更新

<!-- verify: phase 3 -->

再次运行同一条命令即可。有新版本时，它会替换 `~/.local/bin` 中的文件。如果网关仍在运行，请先按 `Ctrl+C` 停止它，这样命令才会启动新版本。

<!-- verify: phase 3 -->
当页面版本比你的网关新时，页面会提示你网关已过期，并显示升级命令。

## 下一步

[首次运行](/zh-cn/docs/getting-started/first-run/)：让网关检查你的 Android SDK，打开页面，并允许本地网络访问。
