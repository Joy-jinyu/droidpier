---
title: 命令行
description: Droidpier 网关命令的选项和环境变量。
sourceHash: 6811a7927009
---

<!-- verify: phase 3 -->
```sh
droidpier [--port <port>] [--local] [--no-open]
```

网关在前台运行，直到你按 `Ctrl+C`。停止它不会停止正在运行的模拟器。

## 用安装命令启动 {#start-with-the-install-command}

安装命令 `curl -fsSL https://droid.devpier.dev/install.sh | sh` 会安装或更新网关，然后启动它。如需给网关传选项，把选项写在 `sh -s --` 后面：

```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh -s -- --port 7310
```

如果只想安装或更新、不启动网关，请设置 `DROIDPIER_NO_START=1`：

```sh
curl -fsSL https://droid.devpier.dev/install.sh | DROIDPIER_NO_START=1 sh
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
| `ANDROID_AVD_HOME` | 存放 AVD 的目录。如未设置，网关使用 `~/.android/avd`。 |
| `DEBUG=1` | 每秒为每个连接打印一行：已接收、已发送和已丢弃的帧数，平均帧大小，以及从模拟器到网关的延迟。 |

<!-- verify: phase 2 -->
`ANDROID_AVD_HOME` 在网关列出设备时读取。

<!-- verify: phase 3 -->
`ANDROID_HOME` 在首次运行检查时读取。

## 打印内容

启动时，网关会打印页面地址。如果没有模拟器在运行，它会打印原因并继续运行。

<!-- verify: phase 3 -->
默认情况下，打印的地址是公共页面 `https://droid.devpier.dev/app/`。当网关不在端口 `7300` 上运行时，地址以 `#port=<port>` 结尾。使用 `--local` 时，则是本地页面 `http://127.0.0.1:<port>/app/`。网关会使用 macOS `open` 命令打开该地址，除非你传入 `--no-open`。

如果该端口上已有网关在运行，就不会再启动第二个。它会打印 droidpier 已经在运行及端口号，并打开页面。如果端口被别的程序占用，它会说明这一点，建议换一个端口，然后退出。

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
