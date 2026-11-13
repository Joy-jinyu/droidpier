---
title: 首次运行
description: 用一条命令启动网关，让它检查 Android SDK，在 Chrome 中允许本地网络访问，然后在浏览器中查看你的模拟器。
sourceHash: c1c836eb6e73
---

在终端中运行一条命令，打开 `https://droid.devpier.dev/app/`，并在 Chrome 询问时允许访问本地网络。

## 1. 启动网关

```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh
```

它会在需要时安装或更新网关，然后启动它。请参阅[安装](/zh-cn/docs/getting-started/install/)。安装完成后，也可以用 `droidpier start` 启动它。

网关在后台运行，可以关闭终端窗口。

网关默认监听 `127.0.0.1`，端口 `7300`。如需使用其他端口，请参阅[命令行](/zh-cn/docs/reference/cli/)。

## 2. 让网关检查 Android SDK {#2-let-it-check-your-android-sdk}

<!-- verify: phase 3 -->
启动时，网关会检查能否启动一台设备：需要 Android 模拟器（`emulator`）、`platform-tools` 里的 `adb`，以及至少一个已装好系统镜像的虚拟设备（AVD）。任何 Android 版本都可以。如果缺少某项，它会在终端中逐项列出，并提示你到页面上完成安装。它不会在终端中提问。

网关在后台运行时，这份清单写在它的日志里。运行 `droidpier logs` 查看。

<!-- verify: phase 3 -->
页面会显示同样的清单，并标出每项的下载大小。能启动设备时，页面不显示这份清单。

| 缺失项 | 你在页面上要做的 |
|---|---|
| `emulator`、`platform-tools`、系统镜像 | 用某项旁边的按钮单独安装，或一次全部安装。如果一个系统镜像都没装，页面会提供 Android 14（`system-images;android-34;google_apis;arm64-v8a`）。如果某台设备的系统镜像被删除了，页面会指出是哪台设备，并提供那个镜像。 |
| 没有设备 | 创建设备：选择设备型号和 Android 版本。如果已经装了系统镜像，页面会建议用它，而不是下载 Android 14。 |

你不需要 Java 或命令行工具（`sdkmanager`、`avdmanager`）。网关从 Google 的 SDK 仓库下载每个组件，这也是 Android Studio 使用的来源；SDK 目录还不存在时，网关会自己创建。

<!-- verify: phase 3 -->
在你于页面上确认之前，不会下载或创建任何内容。开始前，页面会显示要下载什么、装到哪里、需要多少磁盘空间。每次下载前，页面会完整显示 Google 的许可证，你同意后才会安装该项。网关会像 Android Studio 一样把你的同意记在 SDK 的 `licenses` 目录里，并在解压之前用 Google 公布的校验值检查每个下载。

如果想自己安装某项，在页面上展开它下面的手动安装部分。那里写着在 Android Studio 里去哪找这一项，以及它装到哪里。

## 3. 打开页面 {#3-open-the-page}

<!-- verify: phase 3 -->
在 Chrome 或 Edge 中打开 `https://droid.devpier.dev/app/`。网关启动时也会打印这个地址，并在默认浏览器中打开它。如果你的默认浏览器不是 Chrome 或 Edge，请自行在 Chrome 或 Edge 中打开该地址。

页面会自行连接。在没有网关响应时，它每秒检查一次，网关一启动就会连接，无需重新加载。标签页在后台时，它不会检查。

如果网关不在端口 `7300` 上运行，它打印的地址会以 `#port=<port>` 结尾：

```text
https://droid.devpier.dev/app/#port=7301
```

请打开该地址，以便页面找到正确的端口。

## 4. 允许本地网络访问 {#4-allow-local-network-access}

<!-- verify: phase 3 -->
当页面首次连接到你 Mac 上的网关时，Chrome 会显示一个权限提示，询问是否允许 `droid.devpier.dev` 访问你的本地网络。请点击**允许**。Chrome 会记住该站点的选择。

如果你拒绝了，请参阅[故障排除](/zh-cn/docs/guides/troubleshooting/#chrome-blocked-local-network-access)。

## 5. 使用模拟器

如果已有启用 gRPC 的模拟器在运行，页面会直接显示其画面。

<!-- verify: phase 2 -->
否则，在列表中选择一个设备并启动它。请参阅[设备](/zh-cn/docs/guides/devices/)。

点击屏幕以获得键盘焦点。然后：

- 点击即为轻触；拖动即为滑动。
- 使用 Mac 键盘输入。请参阅[键盘与输入](/zh-cn/docs/guides/keyboard-and-input/)。
- 使用屏幕上方的返回、主页和最近任务按钮。

## 停止

运行 `droidpier stop`。如果你是在终端窗口中用 `droidpier` 启动的网关，就在那个窗口按 `Ctrl+C`。正在运行的模拟器会继续运行。下次用同一条命令或 `droidpier start` 启动网关时，它会重新连接这些模拟器。

## 本地备用页面

网关也在 `http://127.0.0.1:7300/app/`（或你选择的端口）上提供相同的页面。当公共页面无法加载或无法连接时，可使用此页面。

如需让网关打开本地页面而非公共页面，请使用 `--local` 启动：

```sh
droidpier --local
```
