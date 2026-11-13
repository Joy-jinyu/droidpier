---
title: 安装
description: 通过一条命令在 Apple Silicon Mac 上安装并启动 Droidpier 网关。
sourceHash: 721a09a23a56
---

两步即可开始：

1. 在终端中运行下面的命令。它会安装 Droidpier 并在后台启动它。
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
4. 用 `droidpier start` 在后台启动网关。

网关在后台运行。可以关闭终端窗口：网关会继续运行，登录后也会自动启动。运行 `droidpier stop` 停止它，运行 `droidpier status` 查看状态。

再次运行同一条命令时：

- 如果你的版本已是最新，它会跳过下载并重启网关。
- 如果有新版本，它会更新你的版本，然后重启网关，让新版本运行起来。
- 如果连不上下载站，它会给出提示，并启动你已安装的版本。
- 如果已有网关在某个终端窗口中运行，它会说明这一点，不启动任何东西。先在那个窗口按 `Ctrl+C` 停止它。

如需给网关传选项，或只安装不启动，请参阅[命令行](/zh-cn/docs/reference/cli/#start-with-the-install-command)。

## 直接运行 droidpier

<!-- verify: phase 3 -->

安装完成后，也可以使用 `droidpier` 命令。`droidpier start` 像安装命令一样在后台启动网关；只运行 `droidpier` 则在终端窗口中运行它，直到你按 `Ctrl+C`：

```sh
droidpier start
```

如果 shell 报告 `command not found`，说明 `~/.local/bin` 不在你的 `PATH` 中。遇到这种情况时，安装脚本会打印提示。请将其添加到 `~/.zshrc` 中：

```sh
export PATH="$HOME/.local/bin:$PATH"
```

然后打开新的终端窗口并重试。

## 更新

<!-- verify: phase 3 -->

再次运行同一条命令。有新版本时，它会替换 `~/.local/bin` 中的文件，并重启网关，让新版本运行起来。

<!-- verify: phase 3 -->
当页面版本比你的网关新时，页面会提示你网关已过期，并显示升级命令。

## 下一步

[首次运行](/zh-cn/docs/getting-started/first-run/)：让网关检查你的 Android SDK，打开页面，并允许本地网络访问。
