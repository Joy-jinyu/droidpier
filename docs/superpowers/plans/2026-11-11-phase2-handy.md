# android-emu-web 第 2 阶段（好用）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在网页里列出本机 AVD，可以启动或关闭；补齐旋转、音量、电源、截图、剪贴板、滚轮，以及状态和帧率显示。做到不打开 Android Studio、不记命令就能日常使用。

**Architecture:** 在第 1 阶段的网关上加一个 AVD 管理模块：列出 AVD，启动和关闭模拟器，并报告开机进度。协议增加设备管理消息和按钮消息。宿主模块补上滚轮、剪贴板和截图。TSX 应用加上设备列表和完整的按钮栏。

**Tech Stack:** 同第 1 阶段，不新增依赖。

**Spec:** `docs/superpowers/specs/2026-11-11-android-emu-web-design.md`

**前置：** 第 1 阶段计划 `2026-11-11-phase1-usable.md` 已完成，它定义的 `EmulatorSession`、`startServer`、`ClientMsg` / `ServerMsg`、`toDevice` 都按原样沿用。

## Global Constraints

- 第 1 阶段计划的 Global Constraints 全部沿用。
- 启动模拟器的命令：`emulator -avd <name> -no-window -grpc <port> -no-boot-anim`，`-gpu host`。gRPC 端口从 8554 开始，往上找第一个空闲的偶数端口。
- 开机完成的判断：`adb -s emulator-<serial> shell getprop sys.boot_completed` 返回 `1`。超过 180 秒算超时。
- 关闭模拟器：`adb -s emulator-<serial> emu kill`。
- 网关退出时不关闭模拟器。
- 已经在运行、开了 gRPC 的模拟器直接接管，不重复启动；没开 gRPC 的，在列表里标“运行中（未开 gRPC，无法接管）”。
- 截图：调用 `getScreenshot({format:"PNG"})`，取原始分辨率，存成文件名 `screenshot-<AVD名>-<yyyyMMdd-HHmmss>.png` 下载。
- 剪贴板：Mac 到模拟器用 Cmd+V；模拟器到 Mac 用 `streamClipboard`，页面有焦点时写入浏览器剪贴板，写不了就在页面上提示“模拟器剪贴板已更新，点击复制”。
- 页面空闲时（画面不变、没有输入），网关 CPU 不超过 1%，用 `ps -o time=` 的增量统计 10 秒。

## Review Focus

1. **启动一个已经在运行的 AVD**（比如用户自己在终端里启动的）：不能再起第二个实例，要直接接管或者给出提示。对应 Task 1 的测试“列表合并运行状态”和 Task 2 的测试。
2. **启动中途用户关掉页面，或者再点一次“启动”**：不能并发启动两个，进度要能在重新打开的页面上继续显示。对应 Task 2 的测试“重复 start 返回同一个进行中的任务”。
3. **AVD 的 `config.ini` 缺字段或者格式奇怪**（老 AVD、手改过的）：列表照常显示，缺的字段留空。对应 Task 1 的测试。
4. **横屏后点击位置偏了**：旋转之后，坐标换算必须按新方向计算。对应 Task 3 的测试。
5. **剪贴板里的大文本或者 emoji**：完整往返，不截断，不乱码。对应 Task 5 的集成测试。

---

### Task 1: AVD 列表

**Files:**
- Create: `gateway/src/avd.ts`、`gateway/test/avd.test.ts`、`gateway/test/fixtures/avd/`（放几个 `config.ini` 样例，取自本机 3 个 AVD，再加一个缺字段的）
- Modify: `gateway/src/platform.ts`，加上 `emulatorBin()`、`adbBin()`、`avdHome()`（默认 `~/.android/avd`，可用 `ANDROID_AVD_HOME` 覆盖）。

**Interfaces:**
- Produces：
  - `type AvdInfo = { name: string; width?: number; height?: number; ramMb?: number; apiLevel?: number; abi?: string; running: "no" | "grpc" | "no-grpc"; serial?: number; grpcPort?: number }`
  - `parseAvdConfig(text: string): Pick<AvdInfo, "width"|"height"|"ramMb"|"apiLevel"|"abi">`，读这几个字段：
    - `hw.lcd.width`、`hw.lcd.height`、`hw.ramSize`（单位 MB；带 `M` / `G` 后缀时要换算）、`abi.type`；
    - `image.sysdir.1` 里的 `android-<N>`。
  - `listAvds(): Promise<AvdInfo[]>`：用 `emulator -list-avds` 拿名字，读每个 AVD 的 `<avdHome>/<name>.avd/config.ini`。运行状态按下面的方式合并：
    - 通过 `findRunning` 的发现文件，拿到 `avd.name` 和 `grpc.port`；
    - 发现文件里没有 gRPC 端口，但 `adb devices` 里有对应串口的，算 `no-grpc`。
  - 这次要用到发现文件里的 `avd.name`。所以在 `discovery.ts` 的 `Discovery` 里加上可选字段 `avdName?: string`，并补一条测试。

- [ ] **Step 1：写失败的测试。**
  - `parseAvdConfig(<Pixel_5_API_34 样例>)` 深等于 `{width:1080,height:2340,ramMb:4096,apiLevel:34,abi:"arm64-v8a"}`。
  - `hw.ramSize=2G` 解析成 2048。
  - 缺字段的样例：只返回存在的字段，不抛错。
  - “列表合并运行状态”：注入一个假的 `exec` 和一个发现文件目录，结果里正在运行的 AVD 是 `running:"grpc"`，并带上 `grpcPort`。
  - `parseDiscovery` 能读出 `avd.name`。
- [ ] **Step 2：** 运行 `pnpm test`，**预期**失败。
- [ ] **Step 3：** 实现 `listAvds` 等函数。`listAvds(deps = {exec, discoveryDir, avdHome})` 用参数注入依赖，方便测试。
- [ ] **Step 4：** 运行 `pnpm test`，**预期**通过。再在本机运行 `node -e` 调用 `listAvds()`，**预期**列出 3 个 AVD，其中 `Pixel_5_API_34` 显示正在运行。
- [ ] **Step 5：** 提交：`feat(gateway): list AVDs with their running state`。

### Task 2: 启动和关闭模拟器

**Files:**
- Create: `gateway/src/lifecycle.ts`、`gateway/test/lifecycle.test.ts`
- Modify:
  - `gateway/src/server.ts`：新增消息处理，并且会话改为可以切换；
  - `shared/protocol.ts`：新增消息类型，`PROTOCOL_VERSION` 保持 1，因为还没有对外发布。

**Interfaces:**
- Produces（`lifecycle.ts`）：
  - `startAvd(name: string, deps): StartJob`。其中 `StartJob = { name; serial; grpcPort; progress: "spawning"|"booting"|"ready"|"failed"; error?: string; done: Promise<Running> }`。
    - 同名 AVD 已经有一个启动中的任务时，直接返回那个任务，不新开。
    - 这个 AVD 已经在运行且开了 gRPC 时，返回一个 `progress:"ready"` 的任务。
  - `stopAvd(serial: number, deps): Promise<void>`
- Protocol 新增：
  - 客户端消息：
    - `{t:"avds"}`
    - `{t:"start",name:string}`
    - `{t:"stop"}`：关闭当前连接的这台
    - `{t:"use",name:string}`：切换到一台已经在运行的 AVD
  - 服务端消息：
    - `{t:"avds",list:AvdInfo[]}`
    - `{t:"boot",name:string,progress:string,error?:string}`
    - 原有的 `{t:"status"}` 增加 `"booting"` 状态

- [ ] **Step 1：写失败的测试，用假的 `spawn` / `exec` / 时钟。**
  - “重复 start 返回同一个进行中的任务”。
  - “getprop 返回 1 后 progress 变为 ready，done resolve 的 grpcPort 等于分配的端口”。
  - “超过 180s 未就绪 → failed，error 包含 '超时'，并结束子进程”。
  - “已在运行（grpc）的 AVD → 立即 ready，不调用 spawn”。
  - “端口分配跳过被占用的 8554，得到 8556”。
- [ ] **Step 2：** 运行 `pnpm test`，**预期**失败。
- [ ] **Step 3：实现。**
  - `spawn` 的子进程要 `detached:true` 并且 `unref()`，这样网关退出后模拟器还在。
  - `server.ts` 收到 `start` 后，每 1 秒广播一次 `boot` 进度。状态变成 ready 后，连上新的会话，给每个连接重新发 `ready` 并重新订阅画面。
- [ ] **Step 4：** 运行 `pnpm test`，**预期**通过。
- [ ] **Step 5：真机验证。**
  - 关闭 `Pixel_5_API_34`，在页面上启动 `android10-chrome80`。**预期**：显示开机进度，20 秒左右出现画面。
  - 点“关闭”。**预期**：模拟器进程消失，页面显示“未连接设备”。
  - 关掉网关再重新启动，**预期**：模拟器还在运行，能自动接管。
- [ ] **Step 6：** 提交：`feat(gateway): start and stop AVDs from the page`。

### Task 3: 旋转和坐标

**Files:**
- Modify: `shared/input-map.ts`、`shared/test/input-map.test.ts`、`gateway/src/emulator.ts`、`shared/protocol.ts`

**Interfaces:**
- 改动：`toDevice` 增加第 4 个参数 `rotation: 0|90|180|270`，默认 0。
  - 帧的宽高随旋转对调。页面画布的 CSS 尺寸由宿主模块按帧的宽高比调整：横屏时是 1170×540。
- 新增：`EmulatorSession.rotate(): Promise<0|90|180|270>`，每次顺时针转 90°。
  - 优先用 gRPC 的 `setPhysicalModel`（rotation 模型）。实测不生效的话，改用 `adb emu rotate`。
  - 返回新的方向。
- Protocol：
  - 客户端消息 `{t:"rotate"}`；
  - 服务端消息 `{t:"orientation",rotation}`。

- [ ] **Step 1：写失败的测试。**
  - `toDevice({x:0,y:0}, 横屏 rect 1170x540, {width:1080,height:2340}, 90)` 深等于预期的角点。
  - 竖屏和横屏下，画布四个角映射到设备的四个角：共 4 种方向，每种方向测 4 个角。
  - 预期值写成表格：方向为 90° 时，画布左上角映射到设备 `(0, 2339)`。实现时要先在真机上确认这一点，再把表格补全。
- [ ] **Step 2：** 运行 `pnpm test`，**预期**失败。
- [ ] **Step 3：** 实现 `toDevice` 的旋转部分和 `rotate`。
- [ ] **Step 4：** 运行 `pnpm test`，**预期**通过。
- [ ] **Step 5：真机验证。** 打开设置页，旋转到横屏，点击“网络和互联网”。**预期**：打开的确实是这一项。四个方向都要试一遍。
- [ ] **Step 6：** 提交：`feat(shared): map input through screen rotation`。

### Task 4: 音量、电源、截图按钮

**Files:**
- Modify: `gateway/src/emulator.ts`、`gateway/src/server.ts`、`shared/protocol.ts`、`host/src/main.ts`、`ui/App.tsx`

**Interfaces:**
- 按钮沿用已有的 `key` 消息：`AudioVolumeUp`、`AudioVolumeDown`、`Power`，`eventType` 都是 `keypress`。
- 截图：
  - 客户端消息 `{t:"screenshot"}`；
  - 网关的处理：调用 `getScreenshot({format:"PNG"})`，回一条服务端文本消息 `{t:"screenshot",name:string,size:number}`，紧接着发一条二进制消息：开头 4 字节是 u32 小端的 `BIN_SCREENSHOT`（2），后面接 PNG 数据。类型字段第 1 阶段已经预留，画面帧的格式不用改。
- `host.call("emu.screenshot")`：宿主模块收到二进制 PNG 后，用 `URL.createObjectURL` 加 `<a download>` 触发下载。

- [ ] **Step 1：写失败的测试。**
  - 协议测试：`binKind` 对截图消息返回 `BIN_SCREENSHOT`（2）。
  - server 测试：“screenshot 请求后客户端先收到文本 `{t:"screenshot"}` 再收到 binKind 为 2 的二进制”。
- [ ] **Step 2：** 运行 `pnpm test`，**预期**失败。
- [ ] **Step 3：** 实现。
- [ ] **Step 4：** 运行 `pnpm test`，**预期**通过。
- [ ] **Step 5：真机验证。**
  - 依次点音量加、音量减、电源。**预期**：电源会让屏幕熄灭，再点一次亮起。
  - 点截图。**预期**：下载的 PNG 是 1080×2340，内容和当前画面一致。
- [ ] **Step 6：** 提交：`feat(gateway): add volume, power and screenshot controls`。

### Task 5: 剪贴板互通

**Files:**
- Modify: `gateway/src/emulator.ts`、`gateway/src/server.ts`、`shared/protocol.ts`、`host/src/main.ts`
- Test: `gateway/test/emulator.it.test.ts`，在原文件里新增用例

**Interfaces:**
- Protocol：
  - 客户端消息 `{t:"clip",text}`：网关收到后调用 `setClipboard`，不发粘贴。
  - 服务端消息 `{t:"clip",text}`：来自 `streamClipboard`。
- 宿主模块的处理：
  - Cmd+V：在 canvas 或 textarea 的 `paste` 事件里读 `clipboardData.getData("text/plain")`。
    - 纯 ASCII：用 `textToMsgs` 逐字发送。
    - 否则：走 `{t:"text"}`，也就是第 1 阶段做好的“剪贴板 + 粘贴”。
  - 收到服务端的 `clip`：调用 `navigator.clipboard.writeText`。失败时，通过 `hostEvent("emu.clip",{text})` 让 TSX 显示一个“点击复制”的提示条。

- [ ] **Step 1：写失败的集成测试（`EMU_IT=1`）。**
  - “setClipboard 500KB 文本后 getClipboard 完整相同”。
  - “emoji '👍🏻中文' 往返相同”。
  - “streamClipboard 在设备内复制后 1s 内收到新内容”：设备内复制用 `adb shell` 触发，具体方式实现时确定，写进测试注释。
- [ ] **Step 2：** 运行 `pnpm test:it`，**预期**失败（因为还没实现消息处理）。
- [ ] **Step 3：** 实现。
- [ ] **Step 4：** 运行 `pnpm test:it`，**预期**通过。
- [ ] **Step 5：真机验证。**
  - 在 Mac 上复制一段中文，到页面里按 Cmd+V。**预期**：模拟器搜索框里出现这段中文。
  - 在模拟器里长按文字选择复制，然后在 Mac 上 Cmd+V 粘贴。**预期**：内容一致。
- [ ] **Step 6：** 提交：`feat(host): sync the clipboard both ways`。

### Task 6: 滚轮

**Files:**
- Modify: `shared/input-map.ts`、`shared/test/input-map.test.ts`、`host/src/main.ts`

**Interfaces:**
- Produces：`wheelToSwipe(deltaY: number, at: {x,y}, device: {width,height}): Array<{x,y,down:boolean,delayMs:number}>`
  - 每 100 像素的 `deltaY` 对应设备上 300 像素的滑动，单次滑动最长 900 像素。
  - 每次滑动拆成 8 步，每步间隔 8ms。
  - 滑动方向和 `deltaY` 相反：滚轮往下，手指往上滑。
  - 宿主模块里，`wheel` 事件按 50ms 合并成一次滑动；上一次滑动还没发完时，新的滚动量累计到下一次。
  - 备选方案是 `adb shell input scroll`，只有手感不行时才换，换的话要在 ledger 里记一条 Ruling。

- [ ] **Step 1：写失败的测试。**
  - `wheelToSwipe(100,{x:540,y:1170},{width:1080,height:2340})`：第一个点是 `down:true` 且 `y=1170`；最后一个点是 `down:false` 且 `y=870`；中间是 8 个移动点。
  - `wheelToSwipe(-1000,…)` 的总位移是 900，因为有上限。
  - 起点在 `y=100`、往上滑 300 的情况：终点被夹到 0。
- [ ] **Step 2：** 运行 `pnpm test`，**预期**失败。
- [ ] **Step 3：** 实现。
- [ ] **Step 4：** 运行 `pnpm test`，**预期**通过。
- [ ] **Step 5：真机验证。** 在设置页用触控板和鼠标滚轮滚动。**预期**：列表跟手滚动，不会误触点击。
- [ ] **Step 6：** 提交：`feat(host): scroll with the mouse wheel`。

### Task 7: 设备列表界面、状态显示和空闲 CPU

**Files:**
- Modify: `ui/App.tsx`、`host/src/main.ts`、`gateway/src/server.ts`

**Interfaces:**
- `host.call` 新增：
  - `emu.avds()`：返回 `AvdInfo[]`；
  - `emu.start({name})`；
  - `emu.stop()`；
  - `emu.use({name})`；
  - `emu.rotate()`；
  - `emu.screenshot()`。
- `hostEvent` 新增：
  - `emu.avds`：列表变化时推送；
  - `emu.boot`：开机进度。
- TSX 界面：
  - 左侧是设备列表。每台显示：名称、分辨率、Android 版本、状态（未运行 / 启动中 xx 秒 / 运行中 / 运行中但无法接管），以及启动或关闭按钮。
  - 顶部按钮栏：返回、主页、最近任务、旋转、音量+、音量−、电源、截图。
  - 右上角显示状态：连接状态、帧率、延迟（从模拟器的 `timestampUs` 到绘制完成），每秒更新一次。
  - 设备列表为空时，显示“本机还没有模拟器设备。第 3 阶段会在这里提供“创建默认设备”；现在可以先用 Android Studio 的设备管理器创建一个。”。第 3 阶段 Task 4 会把这里换成按钮。
  - 界面文案全部用中文。视觉要简洁，画面占主体。动手前先按 UI 规范（交互状态、无障碍、文案）检查一遍。

- [ ] **Step 1：** 实现界面和对应的 `host.call` / `hostEvent`。
- [ ] **Step 2：** 运行 `pnpm build:ui && pnpm start`，在 Chrome 里打开。逐项操作上面列的每个按钮和设备操作，**预期**：都能用，交付时附截图。
- [ ] **Step 2.5：标签页在后台时暂停推帧（第 1 阶段总审查发现）。** 页面在 `visibilitychange` 变为 hidden 时发 `{t:"pause"}`，重新可见时发 `{t:"resume"}`；网关收到 pause 就取消这个连接的画面订阅，收到 resume 再重新订阅。先写 server 测试：“pause 后假会话的取消函数被调用，resume 后重新订阅”，看着它失败再实现。验证方法：模拟器里放一个持续变化的画面，把标签页切到后台 10 秒，网关和 Chrome 的 CPU 增量都接近 0。
- [ ] **Step 3：空闲 CPU 检查。** 页面打开但不操作，画面不变，持续 10 秒。用 `ps -o time=` 的增量计算网关 CPU。**预期**：不超过 1%。超过的话，用 `node --cpu-prof` 定位原因并修复。
- [ ] **Step 4：** 提交：`feat(ui): manage devices and show live status`。
