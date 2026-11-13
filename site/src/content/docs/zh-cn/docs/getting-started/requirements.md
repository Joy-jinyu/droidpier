---
title: 前置要求
description: 安装 Droidpier 所需的条件——Apple Silicon Mac、Chrome 或 Edge，以及带有 arm64 系统镜像的 Android 模拟器。
sourceHash: 39e85ecc70b3
---

Droidpier 在你自己的 Mac 上运行官方 Android 模拟器，并在浏览器标签页中显示。没有任何内容运行在远程服务器上。你需要安装一个小型本地程序（网关），以及在同一台 Mac 上安装 Android 模拟器和系统镜像。

## 计算机

- 搭载 Apple Silicon（M1 或更新型号）的 Mac。第 1 版仅支持 Apple Silicon Mac 和 arm64 系统镜像。
- 第 1 版不支持 Intel Mac、Windows 和 Linux。

## 浏览器

- Google Chrome 或 Microsoft Edge。
- 不支持 Safari 和 Firefox。原因请参阅[浏览器支持](/zh-cn/docs/reference/browser-support/)。

## Android SDK 组件

网关使用 Android SDK 的以下部分：

| 组件 | 用途 | 大致下载大小 |
|---|---|---|
| `emulator` | 运行 Android 虚拟设备 | 约 400 MB |
| `platform-tools` | `adb`，用于检查启动状态和停止设备 | 约 16 MB |
| 系统镜像，例如 `system-images;android-34;google_apis;arm64-v8a` | 设备运行的 Android 系统。任何 Android 版本都可以；一个都没装时，页面会提供 Android 14（API 34） | 约 1.5 GB |

<!-- verify: phase 3 -->
你不需要 Java、命令行工具（`sdkmanager`、`avdmanager`）或 Android Studio：网关会从 Google 的 SDK 仓库下载这些组件，并自己创建设备。如果你已通过 Android Studio 安装了 SDK，网关会直接使用它。查找顺序如下：

1. `ANDROID_HOME` 环境变量指定的目录。
2. `~/Library/Android/sdk`。

<!-- verify: phase 3 -->
如有缺失，网关会告知你缺少什么，并在下载任何内容前征得你的同意。请参阅[首次运行](/zh-cn/docs/getting-started/first-run/)。

## 内存

<!-- verify: phase 3 -->
每个运行中的模拟器使用其设备配置中设定的 RAM 大小。网关可创建的默认设备使用 4096 MB。每次只显示一个设备。

## 实测性能 {#measured-performance}

在搭载 M4 的 Mac 上，使用 Pixel 5 API 34 虚拟设备（1080×2340），于 Chrome 157 中使用 rgba-mmap 帧传输方式（原始 RGBA 帧经共享内存传输），屏幕更新帧率中位数为 60 fps，点击延迟 p50 为 20 ms，p90 为 30 ms。实际数值取决于你的 Mac、设备和浏览器。

CPU 在相同配置下进行 16 次连续滑动期间测量，统计了模拟器、网关和显示进程（所有 Chrome 进程）的总和。Droidpier 使用了 257%（模拟器 136% + 网关 69% + Chrome 52%）。scrcpy 在相同条件下使用了 208%（模拟器 203% + scrcpy 5%），因此 Droidpier 的 CPU 占用为 scrcpy 的 1.24 倍。
