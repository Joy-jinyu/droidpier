---
title: 命令行
description: Droidpier 网关命令的选项和环境变量。
sourceHash: eef348a17cbd
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
| `droidpier start` | 以 macOS LaunchAgent 的方式在后台运行网关。关闭终端后继续运行，登录时自动启动，崩溃后自动重启。已在运行时会重启它。会保存你给的选项；不带选项时沿用保存的选项。启动后打开一次页面，除非加 `--no-open`。 |
| `droidpier stop` | 停止后台运行的网关，登录时也不再自动启动。 |
| `droidpier status` | 显示后台网关是否在运行，以及它的进程 ID、端口、版本和日志文件。 |
| `droidpier logs` | 打印日志文件路径和最后 50 行。 |
| `droidpier` | 在当前终端窗口中运行网关，直到你按 `Ctrl+C`。 |

停止网关不会停止正在运行的模拟器。

## 用安装命令启动 {#start-with-the-install-command}

安装命令 `curl -fsSL https://droid.devpier.dev/install.sh | sh` 会安装或更新网关，然后运行 `droidpier start`。要传选项给它，把选项放在 `sh -s --` 之后，它们会保存给后台运行的网关：

```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh -s -- --port 7310
```

如果只想安装或更新、不启动网关，请设置 `DROIDPIER_NO_START=1`：

```sh
curl -fsSL https://droid.devpier.dev/install.sh | DROIDPIER_NO_START=1 sh
```

要像以前一样在终端窗口中运行网关，设置 `DROIDPIER_FOREGROUND=1`：

```sh
curl -fsSL https://droid.devpier.dev/install.sh | DROIDPIER_FOREGROUND=1 sh
```

## 选项

| 选项 | 默认值 | 效果 |
|---|---|---|
| `--port <port>` | `7300` | 网关监听的端口，仅在 `127.0.0.1` 上。 |

<!-- verify: phase 3 -->
| 选项 | 默认值 | 效果 |
|---|---|---|
| `--local` | 关闭 | 打开网关自身提供的页面 `http://127.0.0.1:<port>/app/`，而非 `droid.devpier.dev` 上的公共页面。 |
| `--no-open` | 关闭 | 启动时不打开浏览器。网关仍会打印地址。 |

无论是否使用 `--no-open`，页面都会自行找到网关。请参阅[首次运行](/zh-cn/docs/getting-started/first-run/#3-open-the-page)。

## 环境变量

| 变量 | 效果 |
|---|---|
| `ANDROID_HOME` | Android SDK 目录。如未设置，网关使用 `~/Library/Android/sdk`。 |
| `ANDROID_AVD_HOME` | 存放 AVD 的目录。如未设置，网关和模拟器一样使用 `ANDROID_USER_HOME` 里的 `avd`，或 `~/.android/avd`。 |
| `ANDROID_USER_HOME` | Android 用户目录。如未设置，网关使用 `~/.android`。 |
| `DEBUG=1` | 每秒为每个连接打印一行：已接收、已发送和已丢弃的帧数，平均帧大小，以及从模拟器到网关的延迟。 |

<!-- verify: phase 2 -->
`ANDROID_AVD_HOME` 在网关列出设备时读取。

<!-- verify: phase 3 -->
`ANDROID_HOME` 在首次运行检查时读取。

设置了 `ANDROID_HOME`、`ANDROID_AVD_HOME` 和 `ANDROID_USER_HOME` 时，`droidpier start` 会把它们保存给后台运行的网关，因为 launchd 不读取你的 shell 配置。修改它们后请重新运行 `droidpier start`。

## 打印内容

启动时，网关会打印页面地址。如果没有模拟器在运行，它会打印原因并继续运行。

<!-- verify: phase 3 -->
默认情况下，打印的地址是公共页面 `https://droid.devpier.dev/app/`。当网关不在端口 `7300` 上运行时，地址以 `#port=<port>` 结尾。使用 `--local` 时，则是本地页面 `http://127.0.0.1:<port>/app/`。网关会使用 macOS `open` 命令打开该地址，除非你传入 `--no-open`。

如果该端口上已有网关在运行，不会再启动第二个。它会打印 droidpier 已在运行及端口，并打开页面。如果在运行的是后台网关，还会打印 `droidpier stop`。如果端口被其他程序占用，它会说明这一点，建议换一个端口，然后退出。

<!-- verify: phase 3 -->
缺少 Android SDK 组件时，网关会逐项列出，并附上手动安装的命令，然后提示你到页面上完成安装。它从不在终端中提问：安装、新建设备和许可证都在页面上确认。请参阅[首次运行](/zh-cn/docs/getting-started/first-run/#2-let-it-check-your-android-sdk)。

## 使用的文件和端口

| 内容 | 位置 |
|---|---|
| 网关监听地址 | `127.0.0.1:<port>` |
| 发现运行中的模拟器 | `~/Library/Caches/TemporaryItems/avd/running/pid_<pid>.ini` |

<!-- verify: phase 2 -->
| 内容 | 位置 |
|---|---|
| 分配的模拟器 gRPC 端口 | 从 `8554` 起第一个可用的偶数端口 |

<!-- verify: phase 3 -->
| 内容 | 位置 |
|---|---|
| 安装的可执行文件 | `~/.local/bin/droidpier` |
| 已安装版本的校验和 | `~/.local/share/droidpier/installed.sha256` |
| 后台网关的设置 | `~/Library/LaunchAgents/dev.devpier.droidpier.plist` |
| 后台网关的日志 | `~/Library/Logs/Droidpier/droidpier.log` |

## 卸载 {#uninstall}

先停止后台运行的网关，再删除它用到的文件：

```sh
droidpier stop
rm ~/.local/bin/droidpier
rm -r ~/.local/share/droidpier ~/Library/Logs/Droidpier
```

如果 `droidpier` 已经删掉了，但后台网关还在运行或登录时还会启动，就手动移除它：

```sh
launchctl bootout gui/$(id -u)/dev.devpier.droidpier
rm ~/Library/LaunchAgents/dev.devpier.droidpier.plist
```
