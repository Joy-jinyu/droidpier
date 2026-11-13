---
title: 故障排除
description: 解决常见问题——Chrome 阻止本地网络访问、端口被占用、未找到模拟器、页面无法连接、版本不匹配。
sourceHash: 711f2e4dd61a
---

## Chrome 阻止了本地网络访问 {#chrome-blocked-local-network-access}

<!-- verify: phase 3 -->
`droid.devpier.dev` 上的页面会连接到你自己 Mac 上的网关。Chrome 在首次连接时会请求权限。如果你拒绝了，页面无法连接，在几次失败尝试后，它会告知你 Chrome 阻止了对你 Mac 的访问。

重新允许的方法：

1. 打开 Chrome **设置 → 隐私和安全 → 网站设置**。
2. 找到 `droid.devpier.dev`，允许本地网络访问。
3. 重新加载页面。

如果仍然无法连接，请使用[本地备用页面](#use-the-local-fallback-page)。

## 端口已被占用

网关默认监听端口 `7300`。

如果网关仍在运行时你再次运行命令，它不会启动第二个，而是提示 droidpier 已经在端口 `7300` 上运行，并打开页面。直接使用该页面即可；或者先按 `Ctrl+C` 停止正在运行的网关。

如果端口被别的程序占用，网关会说明这一点，建议换一个端口，然后退出。查找该程序：

```sh
lsof -nP -iTCP:7300 -sTCP:LISTEN
```

停止该程序，或在其他端口启动网关：

```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh -s -- --port 7301
```

安装完成后，`droidpier --port 7301` 效果相同。

<!-- verify: phase 3 -->
网关会将新端口写入它打开的地址，页面会连接到正确的端口。

## 未找到模拟器

如果页面提示未找到正在运行的模拟器：

- 检查模拟器是否在运行：`adb devices` 应该列出 `emulator-5554` 或类似内容。
- 检查它是否在启用 gRPC 的情况下启动（`-grpc <port>`）。网关无法读取未启用 gRPC 的模拟器的画面。

<!-- verify: phase 2 -->
你也可以从页面的列表中启动设备。请参阅[设备](/zh-cn/docs/guides/devices/)。

未找到模拟器时，网关会继续运行并在终端中打印原因。

<!-- verify: phase 3 -->
如果网关报告 Android SDK、`emulator`、`platform-tools` 或系统镜像缺失，请按照它打印的修复方法操作。请参阅[首次运行](/zh-cn/docs/getting-started/first-run/#2-let-it-check-your-android-sdk)。

## "sdkmanager" 缺失

<!-- verify: phase 3 -->
Android Studio 安装的 SDK 可能不包含 `cmdline-tools`（提供 `sdkmanager` 和 `avdmanager`）。页面会提供安装：在缺失项清单里它旁边的安装按钮，或在创建设备的对话框里。你确认后，网关会从 Google 下载 22.0 版命令行工具，装到你的 SDK 中。页面会完整显示每份 Google 许可证，你同意后才会安装。

`sdkmanager` 需要 Java。如果你没有 Java，请安装自带 Java 的 Android Studio，或安装 JDK 17 及以上版本，然后重新打开页面。

如果想手动安装，请从 developer.android.com 下载 Google 命令行工具并解压，确保以下路径存在：

```text
<your SDK>/cmdline-tools/latest/bin/sdkmanager
```

## 页面无法连接

<!-- verify: phase 3 -->
页面每秒检查一次网关，网关一响应就会连接。如果页面一直在等待：

- 检查你运行命令的那个终端窗口是否还开着。关闭该窗口或按 `Ctrl+C` 会停止网关。再次运行命令即可启动它。
- 检查 Chrome 是否允许 `droid.devpier.dev` 访问本地网络。请参阅 [Chrome 阻止了本地网络访问](#chrome-blocked-local-network-access)。
- 如果你使用 `--port` 启动了网关，请打开它打印的地址，该地址以 `#port=<port>` 结尾。
- 将该标签页切换到前台。标签页在后台时，页面不会检查。

## 安装命令失败

- **校验失败：** 下载的文件与校验和不一致，因此没有安装任何内容。请再次运行命令。
- **连不上下载站：** 如果已经安装过 Droidpier，命令会给出提示，并启动你已安装的版本。如果还没安装，请检查网络连接，然后再次运行命令。

## 页面提示网关或页面已过期

<!-- verify: phase 3 -->
- **网关已过期：** 运行页面显示的升级命令。与[安装命令](/zh-cn/docs/getting-started/install/)相同。
- **页面已过期：** 用 Cmd+Shift+R 强制刷新页面。

## 浏览器不正确

<!-- verify: phase 3 -->
该页面仅在 Chrome 和 Edge 中有效。在其他浏览器中，它会要求你切换，并不会尝试连接。请参阅[浏览器支持](/zh-cn/docs/reference/browser-support/)。

## 使用本地备用页面 {#use-the-local-fallback-page}

网关在 `http://127.0.0.1:7300/app/`（或你选择的端口）上提供相同的页面。当公共页面无法加载或本地网络访问被拒绝时，可使用此页面。

运行 `droidpier --local`，让网关打开本地页面而非公共页面。

## 画面停止更新

如果模拟器退出或重启，页面会显示已断开连接。网关继续运行。当模拟器恢复后，页面会重新连接，画面也会恢复。
