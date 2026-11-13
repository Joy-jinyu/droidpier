# 真机支持设计

日期：2026-11-13 状态：草稿，待用户确认，再拿去和作者对齐

## 1. 为什么做

团队里调 App 内 H5 的同学，大部分时间对着的是 USB 插着的真机，不是模拟器。现在调真机要开三样东西：
scrcpy 看画面、`chrome://inspect` 调 WebView、Android Studio 或终端看 logcat。Droidpier 已经把模拟器的这三件事
放进了一个页面，用户希望真机也一样，给团队用，完整程度向 Android Studio 的 Running Devices + Logcat 看齐。

代码以 PR 的形式提给 twosugar/droidpier，不 fork（用户决定，2026-11-13）。

## 2. 目标

1. 设备列表里同时列出模拟器和 USB 真机（用户决定：完整向 Android Studio 看齐）。真机显示型号、Android 版本和 adb 状态；
   `unauthorized` 时提示「在手机上允许 USB 调试」，`offline` 时提示重新插拔。
2. 选中一台真机后，页面上能：
   - 看到实时画面，跟随手机自己的横竖屏；
   - 鼠标点击、拖动、滚轮滚动，键盘打字（含中文），返回 / 主页 / 最近任务 / 音量 / 电源键；
   - Mac 和手机剪贴板互通；
   - 截图、装 APK、传文件；
   - 现有的 H5 调试（WebView 列表、内嵌 DevTools、指向本机开发服务）照常可用。
3. 新增日志面板（logcat），模拟器和真机都能用：按 App（包名）、级别、tag、文本过滤，暂停、清空、跟随滚动。
4. WebMCP 工具对真机同样可用，对真机不适用的工具明确返回「这台设备不支持」。
5. 只有真机、没装模拟器的用户，不会被「先安装模拟器」挡住：真机只需要 platform-tools（adb）。
6. **成功标准**：
   - 真机画面和操作的延迟、流畅度和直接用 scrcpy 相当（同一台手机、同一根线对比）；
   - 拔线、手机锁屏、重新授权都能在页面上看到明确状态，不出现「画面卡住不动、点了没反应」；
   - 日志面板开着、日志刷屏时，页面不卡，Mac 的 CPU 不因此明显升高。

## 3. 不做 / 反目标

- **第一版不做**（以后可以加，结构上不堵死）：
  - 无线调试配对（`adb pair`）、Wi-Fi 连接。已经用 `adb connect` 连上的无线设备，因为和 USB 设备在 adb 里没区别，顺带支持；
  - 声音转发；
  - 多点触控（双指缩放）；
  - 同时操作多台设备。保持原设计「一次只连一台」，只是这台可以是真机；
  - Android Studio 的文件浏览器、布局检查器、录屏、App Inspection；
  - Intel Mac、Windows（沿用原设计：平台相关的东西集中在 `platform.ts`）。
- **反目标（功能能用也算失败）**：
  - 真机比 scrcpy 明显卡、延迟明显高；
  - 页面空闲、或日志面板关着时，网关还在持续占 CPU（日志不订阅就不读）；
  - 改动让模拟器现有体验变差：模拟器继续走现在的 gRPC + 共享内存 RGBA 通路，帧率和延迟不能退步；
  - 在手机上留下东西：断开后 scrcpy 进程退出、推上去的文件删除、adb forward 移除。

## 4. 约束与已核实事实

- 仓库约定（`AGENTS.md`、`CONTRIBUTING.md`）：注释、日志、界面文案用中文；只用可擦除的 TS 语法；副作用放在依赖注入对象后面；
  纯逻辑放小模块并配单测；协议只在 `shared/protocol.ts`；每条 adb 调用都有超时；依赖只有 `ws`、`@grpc/grpc-js`、
  `@grpc/proto-loader`、`sharp`，加新东西要给理由；一个 PR 只做一件事，标题 `<area>: <祈使句>`。
- 现在和模拟器绑死的地方（2026-11-13 读 `8d4a84c` 的代码）：
  - **设备身份**：`serial: number` 贯穿网关、协议、host、页面，`adb.device(serial)` 统一拼 `emulator-${serial}`
    （`gateway/src/adb.ts:69-73`）；`avd.ts:141` 用 `/^emulator-(\d+)\s+device/` 解析 `adb devices`，真机被丢掉；
    页面和 host 把 `0` 当「没有设备」。
  - **adb 调用**：同一台设备的命令排队、5 秒超时、输出缓冲（`adb.ts:53-64`）。没有长期运行的子进程接口，
    logcat、scrcpy 这类流直接放进去会挡住同设备的其他命令或被杀掉。
  - **画面**：`emulator.ts` 拿 RGBA，`server.ts` 的 `LatestFrame` 只留最新一帧、丢旧帧，`host/src/renderer.ts` 用 WebGL 画 RGBA；
    WebMCP 截图直接读 RGBA。每次窗口尺寸、DPR、旋转、暂停都会按新尺寸重新订阅。
  - **输入**：单指 `touch`（坐标是竖屏面板像素），滚轮转成一串 `touch` 模拟滑动，按键是 W3C 键名交给 gRPC `sendKey`，
    中文和粘贴走 gRPC `setClipboard` + `adb input keyevent 279`。
  - **模拟器独有**：旋转（`setPhysicalModel`）、重启（`setVmState RESET`）、关闭（`emu kill`）、启动 / 新建 / 改名 AVD、SDK 安装、
    设备退出检测（pid 存活 + gRPC UNAVAILABLE）、1 秒一次的自动接管第一台模拟器（`server.ts:418-429`）。
  - **已经只靠 adb 的**：WebView 列表与转发（`webviews.ts`）、`adb reverse`（`reverse.ts`）、DevTools 代理、装 APK / push、
    重启后等待开机。改掉设备身份后真机可直接用。
  - **没有 logcat**：代码里没有，原设计把它列为可选。
  - **协议演进**：页面会忽略不认识的二进制种类和 JSON 消息，新增 `BIN_VIDEO`、日志消息不破坏旧页面；
    改 `ready.serial` 的类型或 `AvdInfo` 的含义则会。
- scrcpy：最新 v5.0.1（2026-10-08），release 里单独提供 `scrcpy-server-v5.0.1` 和 `SHA256SUMS`，Apache-2.0。
  服务端通过 `app_process` 启动，提供视频、音频、控制三条连接；控制连接双向，手机剪贴板变化从这里回传
  （`doc/develop.md`）。下文的消息类型和字段以 v5.0.1 的 `doc/develop.md` 和服务端源码为准，实现前逐条核对。

## 5. 方案选择

| 方案 | 做法 | 取舍 |
| --- | --- | --- |
| **1. scrcpy-server + WebCodecs（选定）** | adb 推 scrcpy-server 到手机，拿 H.264 视频流和控制连接；网关只转发，页面用 WebCodecs 硬件解码 | 流畅度天然对齐 scrcpy，不写 Android 端代码；要锁版本、页面新写一套视频渲染和输入映射 |
| 2. 只用 adb | `screencap` 轮询 + `input tap` | 简单，但 1–3 帧/秒、输入延迟上百毫秒，违反反目标，只能当兜底 |
| 3. 自研手机端程序 | 类似 Android Studio 的 screen-sharing-agent | 完全可控，工作量是方案 1 的几倍，效果和 scrcpy 相当 |

用户选方案 1（2026-11-13）。

## 6. 设计

### 6.1 设备模型

- 设备的唯一标识改为 **设备 id**：adb 里的序列号字符串（`emulator-5554`、`R5CR10WN52H`、`192.168.1.5:5555`）。
  模拟器原来的 `serial`（控制台端口）只在模拟器内部用，不再当身份。
- 设备分两类，用 `kind` 区分：`emulator`（AVD）和 `phone`（adb 里非模拟器的设备）。
- 每个会话带一份 **能力表**，页面和 WebMCP 只看能力表决定显示什么，不再看 `running === "grpc"`：

  | 能力 | 模拟器 | 真机 |
  | --- | --- | --- |
  | `rotate`（主动转屏） | ✅ | ❌（跟随手机） |
  | `reboot` | gRPC，adb 卡住也能用 | `adb reboot`，adb 卡住时不可用 |
  | `stop`（关机） | ✅ `emu kill` | ❌ |
  | `screenshot` | gRPC PNG | `adb exec-out screencap -p` |
  | `clipboard` / `paste` | gRPC | scrcpy 控制连接 |
  | `h5` / `install` / `push` / `logcat` | ✅ | ✅ |

### 6.2 网关

- **adb**：
  - `adb.device(id: string)` 去掉 `emulator-` 前缀，所有调用点改传设备 id。这是一个不改行为的纯重构，单独一个 PR。
  - 新增 `adb.spawn(id, args)`：长期运行的子进程，不进排队、不设总超时，挂进现有的 `killAdbChildren`，
    网关退出时一并结束。logcat、scrcpy 服务端、`track-devices` 都走它。
  - **adb 从哪来**（我的选择）：SDK 里有 `platform-tools/adb` 就用它（现状不变）；SDK 里没有时，退到 PATH 上的 adb
    （比如 Homebrew 的 `android-platform-tools`）。两份都在时只用 SDK 那份，避免两个版本的 adb server 互相杀掉。
    都没有时提示安装方式，不自己下载 platform-tools 压缩包，以免绕过页面上逐份同意许可证的流程。
- **设备发现**：用 `adb track-devices -l` 长连接跟踪设备插拔和状态变化，取代真机部分的轮询；模拟器的发现文件逻辑不变。
  设备列表合并两路：AVD（含运行状态）+ adb 设备（排除 `emulator-*`，那些归到对应 AVD 上）。
- **会话接口**：把 `EmulatorSession` 的对外部分抽成 `DeviceSession`（帧、输入、剪贴板、截图、关闭事件、能力表），
  现有模拟器实现不动行为；新增 `PhoneSession` 用 scrcpy 实现。`session-cache` 的「当前设备」从 AVD id 改为设备 id。
- **自动接管**（用户决定，2026-11-13）：
  - 真机**不自动连**。插上手机只出现在列表里，用户点「切换到这台」才推 scrcpy、点亮屏幕、同步画面和剪贴板——同事可能只是插着充电。
  - 本次网关运行期间连过的手机，拔线或重新授权后再出现，自动恢复连接；网关重启后不记得，要重新点。
  - 模拟器保持现状：1 秒一次的 `ticker` 在用户没选过设备时接管第一台模拟器；用户选过真机后，不再被新冒出来的模拟器抢走。
- **PhoneSession（scrcpy）**：
  - scrcpy-server v5.0.1 **打进网关可执行文件**（我的选择：约 90KB，离线可用，不在运行时下载；构建时按 `SHA256SUMS`
    校验，仓库附 Apache-2.0 NOTICE）。连接时 `adb push` 到 `/data/local/tmp/droidpier-scrcpy-<版本>.jar`。
  - 用 `app_process` 启动，参数取：`scid=<随机>`、`tunnel_forward=true`、`audio=false`、`video_codec=h264`、
    `max_size=<页面请求的长边>`、`control=true`、`clipboard_autosync=true`、`stay_awake=true`、`power_on=true`、
    `cleanup=true`。`adb forward tcp:<端口> localabstract:scrcpy_<scid>` 后按顺序连视频、控制两条连接。
    端口从现有的端口分配器拿，和 H5 转发共用一套记账。
  - **尺寸**：scrcpy 的 `max_size` 只能在启动时定。页面尺寸变化时，长边差不到 20% 就不动（浏览器缩放即可），
    超过才重启服务端（我的阈值，实现时可调）。重启期间页面保留最后一帧。
  - **转屏**：手机转屏后视频流会带新的编码配置和新的宽高，网关据此向页面发 `orientation` 和新尺寸，不需要轮询。
  - **结束**：拔线（`track-devices` 报设备消失）、`unauthorized`、服务端退出都会关闭会话，页面显示对应状态；
    关闭时移除 forward，`cleanup=true` 让服务端自己删掉 jar。
- **视频转发**：
  - 新二进制种类 `BIN_VIDEO`：头部 `[kind, seq, flags, width, height, ptsHi, ptsLo]`（u32 小端），flags 标记
    「编码配置」和「关键帧」，后面是 scrcpy 给的 H.264 数据。旧页面会忽略这个种类。
  - **背压**：不能像 RGBA 那样只留最新一帧（丢 P 帧会花屏）。WebSocket 发送缓冲超过阈值时，丢掉之后的帧直到下一个关键帧，
    并通过控制连接请求一个新的关键帧（scrcpy 的 reset video 消息；实现前核对 v5.0.1 的消息号）。
  - 暂停（页面隐藏）时停止转发，恢复时等关键帧再发。
- **输入**（页面消息格式基本不变，网关把它翻译成 scrcpy 控制消息）：
  - `touch` → inject touch event。坐标换算到**当前视频帧**的宽高，scrcpy 要求附带的屏幕尺寸和当前视频尺寸一致，
    不一致会丢弃。换算放在 `shared/` 里的纯函数，带单测。
  - 新增 `scroll` 消息（页面的滚轮对真机发原生滚动事件，比模拟滑动更准）；模拟器继续用现有的滑动模拟。
  - `key`：W3C 键名 → Android keycode + meta 的对照表（`GoBack`→`KEYCODE_BACK`、`GoHome`→`KEYCODE_HOME`、
    `AppSwitch`→`KEYCODE_APP_SWITCH`、音量、电源，以及方向键、回车、删除等），放在 `shared/` 带单测。
  - `text`：ASCII 用 inject text；含非 ASCII（中文、emoji）用 set clipboard 并带 paste 标志，一步完成。
  - `clip`：set clipboard。手机剪贴板变化由控制连接回传，走现有的剪贴板同步到 Mac。
- **logcat**（模拟器和真机共用）：
  - 页面打开日志面板时才 `adb.spawn(id, ["logcat", "-v", "threadtime", "-T", "500"])`（先给最近 500 行），关闭面板就结束进程。
  - 网关逐行解析成 `{时间, pid, tid, 级别, tag, 内容}`，按页面设的过滤条件先过滤，再每 100ms 合批发一次
    （我的数值），避免刷屏时每行一条消息。
  - 「按 App 过滤」：网关用 `pidof <包名>` 找 pid，App 重启后 pid 会变，所以每隔几秒、以及看到 `ActivityManager`
    的启动日志时重新查一次。
  - 网关只保留最近一段（例如 5 万行）用于页面重连时回放，超过就丢最旧的。
- **SDK 检查**：`env.ok` 拆成两部分，「adb 可用」是必需，「模拟器 / 系统镜像 / AVD」是可选。只有真机时不弹安装引导，
  设备列表空态改成同时提示「插上手机并打开 USB 调试」和「创建模拟器」。

### 6.3 页面和 host 模块

- **渲染**：host 新增视频渲染器，用 WebCodecs `VideoDecoder`（`avc1`，Annex-B）解码，把 `VideoFrame` 画到同一块 canvas 上；
  RGBA 渲染器原样保留给模拟器。按会话类型选渲染器。
- **截图给 WebMCP**：视频渲染器保留最后一个 `VideoFrame` 的拷贝，`snapshot()` 从它生成 JPEG，接口不变。
- **设备框比例**：用 `ready.device` 的宽高，不再从 AVD 配置里取（真机不在 AVD 列表里）。
- **侧栏**：分「模拟器」和「真机」两组。真机行显示型号、Android 版本、状态（可用 / 未授权 / 离线）和「切换到这台」。
- **按键区**：按能力表显示。真机隐藏旋转和关闭；重启仍在，确认文案写「重启手机」。
- **日志面板**：放在右侧 DevTools 所在的位置，用标签页和「H5 调试」切换。顶部是包名下拉（默认当前前台 App）、级别、
  tag / 文本搜索、暂停、清空、跟随滚动；列表虚拟滚动，只渲染可见行；级别用颜色区分。
- **状态文案**：「没有连接设备」「模拟器已关闭」等改成按设备类型说；真机拔线显示「手机已断开」，未授权显示授权提示。
- **延迟统计**：真机的时间戳是手机时钟，不能和 Mac 时间相减，真机只显示帧率不显示延迟。

### 6.4 协议

- `ready` 增加 `deviceId: string`、`kind`、`caps`（能力表）；`AvdInfo` 之外新增真机条目类型，设备列表消息带两类。
- 新增：`BIN_VIDEO`、`scroll`、`logcat.open / close / filter`（页面 → 网关）、`logcat.lines`（网关 → 页面）。
- **不升 `PROTOCOL_VERSION`**（我的选择）。`compatibility()` 要求页面和网关版本完全相等
  （`shared/protocol.ts:14`），而每次合进 main 都会同时上线公开页面和网关下载包（`.github/workflows/pages.yml`），
  升版本会让所有没重装网关的用户当天连模拟器都用不了。所以全部按「只加不改」做：
  - `ready.serial` 保留，模拟器照旧填控制台端口，真机填 `0`；新增可选字段 `deviceId`、`kind`、`caps`；
  - 设备列表消息里 AVD 条目不变，真机放在新的可选字段里；
  - 新页面遇到旧网关（没有 `deviceId`）时按现在的模拟器逻辑走，不显示真机分组和日志面板；
  - 旧页面会忽略 `BIN_VIDEO` 和新消息，看不到真机，但模拟器照常可用。
  PR 里仍按 `CONTRIBUTING.md` 在 `## Protocol` 写明新增了什么、版本没动。

### 6.5 WebMCP

- `droidpier_list_devices` 列出两类设备；`droidpier_start_device` 对真机等于「切换到这台」。
- `droidpier_rotate`、`droidpier_stop_device` 对真机返回「这台设备不支持」；`droidpier_reboot` 对真机改为 adb 重启，仍先弹确认。
- 新增 `droidpier_read_logcat`：按包名 / 级别 / 关键词取最近 N 行（只读）。
- 描述文案把「模拟器」改成「设备」。

## 7. 拆分与验证

按「一个 PR 只做一件事」拆，每个都能单独合并、单独验证。因为合进 main 就会上线，真机相关的 PR 2–4 放在网关启动参数
`--phones` 后面（我的选择），默认关闭，用户看不到「能看到但连不上」「有画面但点不动」这种半成品；PR 4 合入、真机验收通过后，
再用一个小 PR 把它改成默认打开并删掉这个参数。日志面板（PR 5）对模拟器本身就完整可用，不需要开关。

1. **gateway：设备 id 改为字符串**。纯重构，模拟器行为不变，现有单测和模拟器集成测试全过。
2. **gateway：adb 长进程 + track-devices，设备列表带真机**。页面能看到真机和授权状态，还不能连。
3. **gateway + host：真机画面**（PhoneSession 视频部分、`BIN_VIDEO`、WebCodecs 渲染器、能力表、协议升到 2）。
4. **gateway：真机输入和剪贴板**（touch / scroll / key / text / clip 翻译）。
5. **gateway + ui：日志面板**（模拟器和真机共用）。
6. **host + docs：WebMCP、README、CONTEXT.md 术语更新**（`Serial`、`Session`、`Emulator` 的定义都要改，新增「设备 id」「真机」）。

验证：

- 单测（`node --test`）：scrcpy 控制消息编码、视频包头解析、键名对照、坐标换算、logcat 行解析和过滤、`track-devices` 输出解析、
  背压丢帧到关键帧的逻辑。
- 新增真机集成测试，`PHONE_IT=1 PHONE_IT_SERIAL=<序列号>` 才跑，和现有 `EMU_IT` 同样的方式跳过。
- 真机验收（本机已有 Samsung SM-G9910、Android 版本待查）：画面、点击、滚动、中文输入、剪贴板双向、转屏、截图、装 APK、
  H5 调试（HK debug 包打开一个 WebView）、日志面板刷屏时的 CPU、拔线 / 重新授权的状态。和 scrcpy 同机对比延迟与帧率。
- 模拟器回归：现有集成测试 + 手动跑一遍，确认帧率、延迟不退步。

## 8. 需要和作者对齐的

在写第一行代码之前，先拿这份设计找作者，至少确认第 1 条；作者只收一部分（比如只收日志面板）时，范围和第一个 PR 都要改。

1. 原设计「只做模拟器」「不做业务相关功能」，CONTEXT.md 把产品定义成「驱动官方模拟器」——真机和日志面板是否接受进主线。
2. 协议「只加不改、不升版本」的做法，以及 `--phones` 开关过渡的方式是否认可。
3. 把 scrcpy-server（Apache-2.0）打进网关可执行文件，附 NOTICE。
4. CONTEXT.md 里 `Serial`、`Session`、`Emulator` 的定义要改，术语按作者习惯定。
5. 拆成 6 个 PR 的顺序和粒度。

## 9. 留给实现者决定的

- scrcpy v5.0.1 各控制消息的具体编号和字段，以它的源码为准；
- 尺寸重启阈值、logcat 合批间隔和保留行数的具体数值，实测后调整，并按仓库习惯在注释里写明出处；
- 日志面板的具体布局和配色，沿用页面现有风格；
- 设备 id 在 URL、日志里的显示方式（序列号可能含冒号和点，比如无线设备）。
