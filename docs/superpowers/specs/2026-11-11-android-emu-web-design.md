# android-emu-web 设计

日期：2026-11-11 状态：草稿，待确认

## 1. 为什么做

Android Studio 自带的模拟器窗口（Running Devices）难用、卡，偶尔看起来像卡死。底层的模拟器内核本身并不慢：本机是 Apple Silicon Mac，AVD 都是 arm64 镜像，走 Hypervisor.framework 硬件虚拟化，开机约 12 秒。慢和难用主要出在外面这层显示和交互上。

所以要做的是：**内核继续用 Google 官方模拟器，在它外面换一个轻快的网页界面。**

## 2. 目标

1. 打开一个公网 https 地址的网页就能用自己电脑上的模拟器（用户决定，2026-11-11）。模拟器和网关都在每个人自己的电脑上运行，网页只负责界面，不需要服务器做计算。网页上能：
   - 看到实时画面；
   - 用鼠标点击、拖动（滑动）、滚轮滚动；
   - 用 Mac 键盘直接打字；
   - Mac 和模拟器之间剪贴板互通。
2. 页面上能列出本机 AVD，选一个启动或关闭，不需要打开 Android Studio，也不需要记命令。
3. 常用按钮：返回、主页、最近任务、旋转、音量加减、电源、截图（存成 PNG 下载）。
4. 网关和页面在浏览器 DevTools / 终端里都能直接调试。nsh 网页版的 TSX 跑在浏览器自己的 JS 引擎上，可以下断点；网关日志要清晰。
5. 界面用 nsh 写（用户决定，2026-11-11）。以后要出 Mac 原生版时，TSX 界面可以照搬，只把画面和输入那一层换成 Rust 原生组件。
6. 其他开发者拿到后，一条命令就能装好网关并跑起来。没有模拟器或系统镜像时，程序会说明缺什么，经用户同意后再下载安装。
7. 只支持 Chrome 和 Edge（用户决定，2026-11-11）。用 Safari 或 Firefox 打开时，提示换浏览器。
8. **成功标准**：
   - 和 scrcpy 比，点击、滑动、打字的反应不能更慢；
   - 画面不再出现“卡住不刷新”或者“点了没反应”的情况。

## 3. 不做 / 反目标

- **不做**：
  - 从零写模拟器内核；
  - 这次不做 nsh 的 macOS 原生目标，只做 web 目标；
  - 在服务器上运行模拟器，或者多人共用一台模拟器；网页只做静态托管；
  - 支持 Safari 和 Firefox；
  - 第一版只支持 Apple Silicon Mac，用 arm64 镜像。用户已确认（2026-11-11），以后 Intel Mac、Windows 等平台都要支持。所以网关里和平台相关的部分要集中放，别写散：SDK 路径、可执行文件名、镜像 ABI、打包目标。第一版不实现其他平台；
  - 跟具体业务相关的功能（审查 App 内 H5、把 H5 地址换成本机开发服务器除外，见 6.8，用户 2026-11-11 决定加入）；
  - 同时操作多台设备（一次只连一台）。
- **反目标（就算功能能用，出现下面情况也算失败）**：
  - 比 scrcpy 明显卡，或者延迟明显更高；
  - 页面空闲时 CPU 占用很高，导致 Mac 变卡。本机内存有限，交换区占用较高。
  - 依赖 Android Studio 开着才能用。

## 4. 约束与已核实事实

已在本机核实：

- **环境**：
  - Apple Silicon Mac，内存有限；
  - Node v22.22.0，pnpm 8.8.0，bun 1.4.2。
- **SDK 和模拟器**：
  - SDK 在 `~/Library/Android/sdk`，模拟器版本 32.1.14.0。
  - 本机有若干个 AVD，都是 arm64-v8a。
- **gRPC 启用和发现文件**：
  - 模拟器用 `-grpc <port>` 打开 gRPC。
  - 运行中的模拟器会在 `~/Library/Caches/TemporaryItems/avd/running/pid_<pid>.ini` 写一个发现文件，里面有 `grpc.port`（本次是 8554）、`port.serial`（5554）等字段。
  - 加上 `-grpc-use-token` 时，发现文件里还会有 `grpc.token`，请求头要带 `authorization: Bearer <token>`。
- **接口定义**：在 `~/Library/Android/sdk/emulator/lib/emulator_controller.proto`，本设计会用到这些：
  - `streamScreenshot(ImageFormat) returns (stream Image)`：
    - `ImageFormat` 可以指定 `format`（PNG / RGBA8888 / RGB888）、`width`、`height`（让模拟器缩放）、`display`；
    - 可以用 `transport{channel: MMAP, handle: <文件>}` 走共享内存；
    - 每个 `Image` 帧带 `seq` 和 `timestampUs`。
  - `sendTouch(TouchEvent)`：多点触控，每个 `Touch` 有 `x`、`y`、`identifier`、`pressure`；`pressure=0` 表示抬起。
  - `sendMouse(MouseEvent)`：带 `x`、`y`、`buttons`。
  - `sendKey(KeyboardEvent)`：
    - `codeType` 支持 Usb / Evdev / XKB / Win / Mac；
    - `eventType` 是 keydown / keyup / keypress；
    - 可以传 `keyCode`，也可以传 `key`（W3C 键名）或 `text`。
  - 剪贴板：`setClipboard`、`getClipboard`、`streamClipboard`。
  - 其他：`getStatus`、`getDisplayConfigurations`、`streamLogcat`。
- **没有滚轮接口**：这个版本的 proto 里没有 wheel 相关的 rpc。滚轮要换成别的办法实现（见第 6 节）。
- **本机内存紧**：`Pixel_5_API_34` 的内存已经从 10GB 调到 4GB。网关和页面自己也要省内存、省 CPU。

## 5. 架构（已定）

```
浏览器页面（nsh web 目标）
  ├─ nsh TSX 应用：设备列表、按钮、状态；留一个 testID="screen" 的占位 View
  │      ⇅ host.call(name, args) / host.on(event)
  └─ 页面宿主模块 host.js（nsh.json web.host，运行在页面里的普通 JS/TS）
         · 在占位区域放 <canvas>，用 WebGL 画画面
         · 直接在 canvas 上收鼠标和键盘事件（不经过 nsh 引擎，延迟最低）
         · 持有到网关的 WebSocket
   ⇅ WebSocket（localhost）
本地网关（Node + TypeScript）
   ⇅ gRPC（localhost:<grpc 端口>）        ⇅ 子进程
Android 官方模拟器（-no-window）         emulator / adb 命令
```

nsh 相关的事实（已在 nsh 源码中核实）：

- `web.host` 指向一个导出 `createHost(player)` 的 JS 模块。它运行在应用所在的页面里，可以用任何浏览器 API。
  - 应用通过 `host.call` 调用它，调用前要在 `capabilities.host` 里授权函数名前缀，比如 `emu.*`。
  - 它通过 `player.hostEvent(event, payload)` 推送事件，payload 必须是 JSON（`website/docs/web.md:300-360`）。
  - 它自己连 WebSocket 时，目标地址要列进 `web.connect`。
- nsh 网页端不支持注册原生组件（`website/docs/native-components.md:180`）。nsh 自带的 `Canvas` 不能显示原始像素，所以画面只能由宿主模块自己画。
- View 的 `testID` 在网页上会变成 DOM 属性 `data-testid`（`crates/nsh-platform-web/web/nsh.js:2277`），宿主模块靠它找到占位元素。
- **第 0 阶段已验证**（2026-11-11，`spike/NOTES.md`；开发模式和打包产物结果一致）：
  - 宿主模块把 `<canvas>` `appendChild` 进 `[data-testid="screen"]` 后，nsh 重新渲染了 20 次（兄弟节点出现和消失、占位 View 样式变化），canvas 一次都没被移走。所以直接嵌入，不用退路方案。
  - `nsh run --target web` 开发模式下 `web.host` 生效，`host.call` 能到达宿主模块。
  - 点击画布后键盘事件能到达 canvas，nsh 不拦截；Cmd+R 等浏览器快捷键也照常可用。
  - 打包产物的 CSP `connect-src` 会根据 `web.connect` 自动生成 `ws(s)://127.0.0.1:*` 和 `ws(s)://localhost:*`，连本机网关不会被拦。
  - **还没验证**：公网 https 页面上 Chrome 的本地网络权限流程，这一步需要先对外上传。
  - **注意**：`nsh run` 在整台机器上同一时间只能有一个开发会话，会顶掉本机其他项目的 nsh 开发服务器。

分工：

- **nsh TSX 应用**：设备列表、启动和关闭、导航按钮（返回 / 主页 / 最近任务 / 旋转 / 音量 / 电源 / 截图）、连接状态和帧率显示。按钮通过 `host.call("emu.key", …)` 等函数交给宿主模块执行。
- **宿主模块**：
  - WebSocket 连接；
  - 画面显示；
  - 画面上的鼠标、键盘、滚轮、剪贴板；
  - 把状态和指标通过 `hostEvent` 推给 TSX 应用。
- **网关**：
  - 列出 AVD；启动和关闭模拟器；
  - 通过发现文件找到 gRPC 端口和 token；
  - 订阅画面帧推给页面；
  - 把页面发来的输入转成 gRPC 调用；
  - 同步剪贴板；
  - 托管页面的静态文件。
- **启动方式**：
  - 开发时：网关一条命令（`pnpm dev`），界面用 `nsh run --target web`。
  - 日常用：`nsh package --target web` 打出静态站点，由网关托管。只用一条命令启动网关，然后打开浏览器。
- 网关只监听 `127.0.0.1`，不对局域网开放。
- 模拟器用 `-no-window -grpc <port>` 启动。`-gpu` 用 `host` 还是 `auto` 由实测决定。
- 代码和文档放在独立仓库 `android-emu-web`，不放进其他前端仓库或 nsh。

## 6. 关键设计点

### 6.1 画面传输（最大风险，先做实测）

可选的路线有几种，由第 0 阶段的实测来定（见第 8 节）：

- **A. 原始像素**：
  - 网关请求 RGBA8888 帧，并让模拟器按页面画布的实际像素尺寸缩放；
  - 走 MMAP 共享内存，或者直接放在 gRPC 消息里；
  - 网关通过 WebSocket 二进制帧原样转发；
  - 页面用 WebGL `texImage2D` 上传成纹理后绘制。
- **B. JPEG**：网关把帧压成 JPEG 后发送，页面用 `createImageBitmap` 解码再绘制。
- **C. PNG**：直接用模拟器的 PNG 格式。预计模拟器那边 CPU 开销大，只作为对照组。

**选择规则**：

- 在 1080×2340 的设备、页面显示约 540×1170 的条件下，选同时满足下面两条的方案：
  - 输入到画面变化的延迟最低；
  - 帧率不低于 50。
- 同时，网关加模拟器的 CPU 占用不能超过 scrcpy 的 1.5 倍（我定的数值）。
- 如果三种方案都达不到标准：先停下来，带着实测数据找用户讨论，不自行继续做第 1 阶段。可以考虑的兜底方案是网关编码成 H.264，页面用 WebCodecs 解码。（我的决定）

**第 0 阶段实测结论（2026-11-11，详细数据见 `spike/NOTES.md`）**：

- “按画布实际像素尺寸取帧”指的是 CSS 尺寸 × `devicePixelRatio`。Retina 屏上就是原始分辨率 1080×2340。取 540×1170 在 Retina 上会糊，用户已经指出过。
- 测量口径（`spike/measure.ts`，审查后统一）：
  - 两边用同一组 gRPC 触摸序列，连续 16 次上下滑动，中间不停顿。
  - 帧率取显示端每秒帧数的中位数。
  - CPU 只算滑动那段时间，用累计 CPU 时间的增量计算，并且算上显示端（Chrome 全部进程，或 scrcpy）。
  - 每测一组之间冷却 20 秒。
  - 点击延迟测 30 次。
- 原始分辨率下的结果：

  | 方案 | 每秒帧数中位数 | 点击延迟 p50 / p90 | 模拟器 + 网关 + 显示端 CPU |
  |---|---|---|---|
  | **A. rgba-mmap（共享内存）** | **60** | 20 / 30ms | 136 + 69 + 52 = **257%**（scrcpy 的 1.24 倍） |
  | A. rgba（gRPC 消息里带帧） | 55 | 21 / 43ms | 177 + 108 + 52 = 337%（1.62 倍） |
  | B. jpeg | 47 | 19 / 33ms | 158 + 143 + 42 = 343% |
  | scrcpy（H.264） | 60 | 未测 | 203 + 5 = 208% |

- **选定：A. rgba-mmap，按 CSS × DPR 取帧。** 三条标准全部达到：每秒 60 帧；CPU 不超过 scrcpy 的 1.5 倍；延迟 20–30ms。
  - 延迟没有和 scrcpy 对比过：测 scrcpy 的延迟要录屏，这次没做。
  - 已知风险：共享内存可能出现画面撕裂（proto 注释里写着“the mmap can result in tearing”）。第 0 阶段没法检测，因为帧里没有序号。第 1 阶段要用眼睛检查；如果确实有撕裂，退回 A. rgba。
- 模拟器 32.1.14 的 RGBA 帧行序是自上而下，和 proto 注释说的相反。

**通用要求**：

- **背压**：页面还没画完上一帧时，网关只保留最新一帧，旧帧直接丢掉，不排队。这就是之前“画面卡住后一卡一大段”那种情况的解法。
- **画面没变化时不传帧**：模拟器本身在画面不变时就不推帧，网关和页面空闲时也不能空转。

### 6.2 输入

- **坐标换算**：页面坐标先换算成设备像素坐标，要考虑页面缩放和旋转方向。
- **鼠标**：鼠标按下、移动、抬起转成 `sendTouch`，用同一个 `identifier`，抬起时 `pressure=0`。拖动就是滑动。
- **滚轮**：proto 里没有滚轮接口。默认做法是把一段滚轮转成一次短距离的 touch 滑动（`sendTouch` 序列）。备选做法是 `adb shell input scroll`。具体选哪种看实测手感。
- **键盘**：
  - 页面获得焦点后，把 `keydown` / `keyup` 转成 `sendKey`。可打印字符用 `text` 或 `key`，功能键用 W3C 键名。
  - 浏览器自己的快捷键（Cmd+R、Cmd+W 等）不拦截。Cmd+V 用来粘贴（见 6.3）。
  - 例外：屏幕有键盘焦点时，Android Studio 模拟器的按键快捷键给设备（⌘S 截图、⌘P 电源、⌘= / ⌘- 音量、⌘← / ⌘→ 向左 / 向右旋转、⌘⌫ 返回、⇧⌘H 主页、⌘O 最近），和用户在模拟器窗口里的习惯一致。
  - 中文和其他非 ASCII 文字走剪贴板（用户决定，2026-11-11）：Mac 输入法组字完成后（`compositionend`），先 `setClipboard`，再给模拟器发一次粘贴。不往模拟器里装输入法 APK。
    - 代价是会覆盖模拟器的剪贴板，界面上不用特别提示。
    - 第 0 阶段实测：`sendKey` 的 `text` 发 `中文abc`，只出来 `-abc`，中文被丢掉了。所以非 ASCII 字符一律走剪贴板。
- **按钮**：用 `sendKey` 加对应的键名实现，比如 `GoBack`、`GoHome`、`AppSwitch`、`AudioVolumeUp`、`AudioVolumeDown`、`Power`。旋转用模拟器的旋转接口，或者 `adb emu rotate`。

### 6.3 剪贴板

- Mac 到模拟器：在页面里按 Cmd+V 时，读取浏览器剪贴板，调用 `setClipboard`，然后发一次粘贴。
- 模拟器到 Mac：网关订阅 `streamClipboard`，有变化就推给页面，页面写入浏览器剪贴板。浏览器只允许在页面获得焦点时写剪贴板，写不了就降级成提示。

### 6.4 设备生命周期

- **列出 AVD**：`emulator -list-avds`，显示时附带 `config.ini` 里的分辨率、内存、Android 版本。
- **启动**：
  - 命令是 `emulator -avd <name> -no-window -grpc <port> -no-boot-anim`，gRPC 端口选一个空闲的；
  - 等 `sys.boot_completed=1` 后再连 gRPC；
  - 页面显示启动进度。
- **关闭**：`adb -s emulator-<port> emu kill`。
- **已在运行的模拟器**：网关读发现文件，直接接管，不重复启动。比如从 Android Studio 启动的、带 gRPC 的模拟器。
- **网关退出**：默认不关闭模拟器，下次启动网关时自动重新连上。

### 6.5 公网页面连本机网关（浏览器限制与安全）

浏览器的限制（来自 2026-11 的网络检索，没有在本机实测）：

- **Chrome 147 起**：公网页面用 WebSocket 连 localhost，会弹一次“访问本地网络”的权限框，用户允许后浏览器会按站点记住。
  - 页面必须是 https。
  - 从 Chrome 154 起，`WebSocket` 构造时可以传 `targetAddressSpace: "loopback"`，宿主模块要带上。
  - Chrome 156 起，企业策略也不能再关掉这个限制。
- **用户点了拒绝**：页面要能识别出连接被拒，然后告诉用户去哪里改回来：Chrome 设置 → 隐私和安全 → 网站设置。
- **Safari**：会把 `ws://localhost` 当成混合内容直接拦截，所以不支持（见第 2 节）。

网关安全，防止任意网页操控本机模拟器：

- 网关只监听 `127.0.0.1`。
- 只接受白名单里的 `Origin`，也就是正式页面的域名和本机保底页面。
- 网关每次启动都生成一个随机口令，WebSocket 连接要带上它。
  - **我的决定**：网关启动后自动打开浏览器，地址是 `https://droid.devpier.dev/app/#port=<端口>&token=<口令>`。口令放在 `#` 后面，浏览器不会把这部分发给托管服务器。
  - 页面读到之后存在本地，之后可以直接打开页面重连。
  - 口令失效时，提示用户重新运行网关。

版本兼容：

- 公网页面和每个人本机的网关版本可能不一样。
- 连接建立后，第一条消息互相报告协议版本。网关太旧时，页面提示升级网关，并给出升级命令。

保底入口：网关自己也托管一份同样的页面，地址是 `http://localhost:<port>`。公网页面打不开或者权限被拒时，可以用这个。

如果实测证明公网 https 页面连不上本机网关（权限框、CSP 都解决不了），就把 localhost 页面改成主入口，公网页面只放说明和下载入口（用户决定，2026-11-11）。不去做本机 wss 证书。

nsh 配置：

- `nsh.json` 的 `web.connect` 要允许 `localhost` / `127.0.0.1`，否则页面的 CSP（内容安全策略）会拦掉 WebSocket。
- 端口范围怎么写进去，以第 0 阶段验证的结果为准。
- 审查时发现一个风险：CSP 的 `connect-src` 里只写主机名、不写协议时，https 页面通常不放行 `ws://`；nsh 的主机名匹配规则也不看端口。第 0 阶段要实测，`ws://127.0.0.1:<port>` 在公网 https 页面上能不能真正连通。

### 6.6 分发与首次运行

- **分发形式**：
  - 网关和保底页面打包成一个可执行文件。我的决定是用 `bun build --compile`，用户的电脑上不需要装 Node。
  - 通过一条命令下载并运行，具体是安装脚本还是 Homebrew tap，交给实现者决定。
- **首次运行检查**：
  - 检查 Android SDK 在不在（按 `ANDROID_HOME`、`~/Library/Android/sdk` 的顺序找），以及 `emulator`、`platform-tools`、系统镜像是否齐全。
  - 缺东西时，列出要用 `sdkmanager` 下载的内容和大概大小，经用户同意后再装。
  - 没有任何 AVD 时，提供创建一个默认 AVD 的选项（arm64、约 4GB 内存、1080×2340）。
  - **安装引导放在网页上**（用户 2026-11-11 决定）：
    - 网关把检查结果推给页面。页面逐项列出缺什么、大概多大、对应的命令。
    - 能自动装的项目，页面上有“安装”和“创建默认设备”按钮。点击后先弹出确认框，写明要下载什么、多大、装到哪里；确认后由网关执行，页面显示进度和日志尾部。
    - Android SDK 许可证要用户本人同意：页面显示许可证全文和“同意”按钮，用户点了同意，网关才替用户回答 `sdkmanager --licenses`。
    - 命令行工具（cmdline-tools）也可以经确认后由网关从 Google 官方地址下载并解压。下载地址在实现时从官方仓库清单里读取，不写死。
    - 终端只打印一行“打开页面完成安装”和对应的手动命令，作为没有页面时的备用方式。
    - 设备列表为空时，提示“本机还没有模拟器设备”，旁边就是“创建默认设备”按钮。
- **不能写死本机路径**：SDK 路径、AVD 名称、端口全部自动发现。

### 6.8 审查 App 内的 H5 页面、切换到本机开发服务器（用户 2026-11-11 决定加入）

**目标**：在网页模拟器里，直接审查 App 内嵌 H5 页面的 DOM、Console、Network，并把这个 H5 的地址换成本机开发服务器上的页面，不用切到 `chrome://inspect`，也不用手敲 adb 命令。

**已实测**（2026-11-11，模拟器 `Pixel_5_API_34`，App 是一个开着 WebView 调试的 debug 包）：

- 系统是 `userdebug`（`ro.debuggable=1`）。debug 包的 WebView 会在 `/proc/net/unix` 里暴露 `webview_devtools_remote_<pid>`，pid 对应 App 进程。
- `adb forward tcp:<端口> localabstract:webview_devtools_remote_<pid>` 之后，`GET /json` 能列出页面（`title`、`url`、`webSocketDebuggerUrl`；`description` 里的 `visible` 表示是否在前台）。
- 通过 DevTools 协议的 `Network` 事件能拿到 H5 的全部请求：刷新这个 H5 页面一次，抓到 24 个请求，其中 XHR 4 个、Fetch 2 个，都带状态码。
- 改 `location.href` 能把 WebView 跳到本机服务器：
  - `adb reverse tcp:5174 tcp:5174` 之后用 `http://localhost:5174/`；
  - 也可以直接用 `http://10.0.2.2:5174/`。
  - 页面里的 `fetch` 正常。这个 debug 包允许 `http://` 明文请求。
- 跳转后，App 注入的 `window._dsbridge` 仍然存在；`window.dsBridge` 是页面自己引入的 JS 库，跳到不引入它的页面后就没有了。

**没测过**：

- release 包：WebView 默认不可调试，明文页面也可能被拦。
- Chrome 自带的 DevTools 前端，能不能从普通网页里打开并连上转发出来的端口。WebView 可能检查 WebSocket 的 Origin。

**设计**：

- 网关列出 WebView：
  - 用 `adb shell cat /proc/net/unix` 找出调试 socket，用 `ps` 把 pid 对应到包名；
  - 每个 socket 只建一次 `adb forward`，socket 消失或网关退出时移除；
  - 读 `/json` 得到页面列表，推给页面。
- 网关做一个 DevTools 代理：`ws://127.0.0.1:<网关端口>/devtools/<socket>/<pageId>` 转发到对应 WebView 的 DevTools 端口。
  - 转发时去掉浏览器带的 Origin 头，避开 WebView 的 Origin 检查。
  - 第 3 阶段要和画面连接一样，校验口令和 Origin，因为这个代理能完全控制 App 里的网页。
- 打开 DevTools：用 `/json` 里 `devtoolsFrontendUrl` 对应版本的托管前端，把 `ws=` 参数指向网关代理，在新标签页打开。
  - 打不开时降级：提示用户在 `chrome://inspect` 里找这个页面。
  - 具体走哪条路，以实施计划第一个任务的实测为准。
- 切换地址：页面上有一个地址栏，可以输入 `localhost:5173/path` 或完整 URL。
  - 地址的主机是 `localhost` 或 `127.0.0.1` 时，网关先执行 `adb reverse tcp:<端口> tcp:<端口>`，并记录下来，网关退出时移除；
  - 然后对选中的页面执行 DevTools 协议的 `Page.navigate`；
  - 加载完成后检查 `typeof window._dsbridge`，结果显示在页面上。
  - 加载失败时，按错误码给出提示，比如 `net::ERR_CLEARTEXT_NOT_PERMITTED` 提示“这个 App 禁止明文 http，请用 https 或 debug 包”。
- 一个可调试的 WebView 都没有时，提示“只有 debug 包或开启了 WebView 调试的 App 才能审查”。
- 不做：
  - 在网页模拟器页面里自己画一个 Network 面板，直接用 DevTools 就行；
  - 抓 App 原生请求，那需要代理和证书，是另一件事。

### 6.7 可观测性（方便调试）

- 页面角落显示：连接状态、帧率、最近一帧的延迟（`timestampUs` 到绘制完成的时间）。
- 网关在终端输出每个连接的事件和错误。加 `DEBUG` 开关后，可以打印每帧的大小和耗时。
- 这些指标同时 `console` 输出，方便在 DevTools 里看。

## 7. 技术选择（我的决定，可改）

- **网关**：
  - Node 22 + TypeScript；
  - gRPC 用 `@grpc/grpc-js` + `@grpc/proto-loader`，直接加载 SDK 里的 proto，不提交生成代码；
  - WebSocket 用 `ws`。
- **界面**：
  - nsh TSX，只用 web 目标。
  - 用本机构建的 nsh，路径由 `NSH` 环境变量给出（或直接用 `PATH` 里的 `nsh`）。编 wasm 时需要 `CC_wasm32_unknown_unknown` 和 `AR_wasm32_unknown_unknown` 指到 `/opt/homebrew/opt/llvm/bin`。
  - 只用 TSX，不写 Rust crate。
- **宿主模块**：TypeScript 写，编译成 `host.js`，用 WebGL2 画画面。
- **包管理**：pnpm，只用于网关和宿主模块。nsh 应用本身不需要 Node。

## 8. 分阶段

- **第 0 阶段：实测（一次性试验）**，两件事：
  1. 画面传输：连上 gRPC，用 A、B、C 三种方式把画面送到一个纯网页，测帧率、延迟和 CPU，定下 6.1 用哪种。
  2. nsh 嵌入：一个最小的 nsh web 应用加宿主模块，验证第 5 节列出的未验证点（canvas 能否稳定放进占位元素、键盘焦点、开发模式下 `web.host` 是否生效）。
  结果写回本文档。如果 nsh 嵌入走不通，停下来和用户讨论。
- **第 1 阶段：能用**。画面、触控和滑动、键盘、返回/主页/最近任务。只连已经在运行的模拟器。
- **第 2 阶段：好用**：
  - 页面上列出 AVD、启动、关闭；
  - 旋转、音量、电源、截图；
  - 剪贴板；
  - 滚轮；
  - 状态和帧率显示。
- **第 2.5 阶段：H5 调试**（见 6.8）：
  - 列出可审查的 H5 页面；
  - 一键打开 DevTools；
  - 地址栏切换到本机开发服务器，自动 `adb reverse`；
  - 跳转后检查 JSBridge。
- **第 3 阶段：分发给其他用户**：
  - 公网页面上线；
  - 口令和 Origin 校验；
  - 协议版本握手；
  - 单文件打包；
  - 首次运行时的环境检查和安装引导。
  - 用一台没装过 Android Studio 的 Apple Silicon Mac（或一个干净的用户账号）验证从零到能用的全过程。

## 9. 留给实现者决定

- 网关和页面之间 WebSocket 消息的具体格式。
- 页面的视觉样式和按钮布局：简洁就行，画面占主体。
- 自动选端口的策略，以及重连和超时的数值。
- 是否在第 2 阶段顺带显示 logcat（可选，不是目标）。
- 公网页面用一个独立购买的域名，整个域名只放这个页面（用户决定，2026-11-11）。原因：Chrome 的本地网络权限和网关的 Origin 白名单都是按域名判断的，和其他页面共用一个域名不安全。域名在 Cloudflare Registrar 购买，页面用 Cloudflare Pages 托管（用户决定，2026-11-11）；域名已购买：`devpier.dev`（用户 2026-11-11 告知，在 Cloudflare 购买）。公网页面用子域名 `https://droid.devpier.dev`（用户 2026-11-11 指定）。已知风险：Cloudflare 在中国大陆的访问速度和稳定性不可控。
- 安装方式（安装脚本或 Homebrew tap）。
