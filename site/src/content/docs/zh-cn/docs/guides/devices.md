---
title: 设备
description: 列出 Android 虚拟设备，从页面启动和停止它们，并接管已在运行的模拟器。
sourceHash: 6eaf456bc1f3
---

这里的设备是指 Mac 上的 Android 虚拟设备（AVD）。页面每次显示一个设备。

## 设备列表

<!-- verify: phase 2 -->
左侧列表显示 `emulator -list-avds` 报告的所有 AVD。每个条目显示：

- 名称；
- 屏幕分辨率；
- Android 版本；
- 状态：未运行、正在启动（显示已用秒数）、运行中，或运行中但无法接管；
- 启动或停止按钮。

<!-- verify: phase 2 -->
分辨率、RAM 和 Android 版本来自 `~/.android/avd/<name>.avd/` 中各 AVD 的 `config.ini`。如果你设置了 `ANDROID_AVD_HOME`，网关会读取该目录。如果 `config.ini` 中某字段缺失，则显示为空白。

## 启动设备

<!-- verify: phase 2 -->
点击设备旁边的启动按钮。网关会运行：

```sh
emulator -avd <name> -no-window -grpc <port> -no-boot-anim -gpu host
```

- `-no-window` 表示不会打开单独的模拟器窗口。画面仅在页面中显示。
- gRPC 端口为从 `8554` 起第一个可用的偶数端口。
- 当 `adb -s emulator-<serial> shell getprop sys.boot_completed` 返回 `1` 时，设备视为已启动。在此之前，页面会显示进度。
- 如果设备在 180 秒内未启动，启动失败，网关会终止模拟器进程。

<!-- verify: phase 2 -->
设备正在启动时再次点击启动不会启动第二个副本。如果你在启动过程中关闭页面再重新打开，进度会继续。

## 停止设备

<!-- verify: phase 2 -->
点击停止按钮。网关运行 `adb -s emulator-<serial> emu kill`。

## 已在运行的模拟器

网关通过模拟器写入 `~/Library/Caches/TemporaryItems/avd/running/` 中的文件来发现正在运行的模拟器。如果模拟器启用了 gRPC（例如通过 `-grpc <port>` 启动），网关会直接连接，而不是再启动一个副本。

<!-- verify: phase 2 -->
未启用 gRPC 运行的模拟器会被标记为"运行中但无法接管"。网关需要 gRPC 来读取画面和发送输入。请停止该模拟器，然后从页面重新启动它。

## 网关停止时

停止网关不会停止模拟器。再次启动网关时，它会重新连接到这些模拟器。

## 创建设备

<!-- verify: phase 3 -->
在页面上创建设备。用新建设备的按钮，选择设备型号和 Android 版本，再给设备起个名字（页面会建议一个）。开始之前，页面会显示设备的型号、Android 版本和内存。如果该版本的系统镜像还没安装，网关会在你确认并同意 Google 许可证后下载它。

创建设备需要命令行工具（`avdmanager`）。如果缺少，对话框会先提供安装。请参阅[首次运行](/zh-cn/docs/getting-started/first-run/#2-let-it-check-your-android-sdk)。

你也可以使用 `avdmanager` 或 Android Studio 创建设备；列表会自动识别它们。

## 删除设备

点设备旁边的垃圾桶图标并确认。这会删除设备和它的全部数据（已装的 App、文件、快照），不能恢复。系统镜像不会删除。正在运行或正在启动的设备不能删除：请先停止它。
