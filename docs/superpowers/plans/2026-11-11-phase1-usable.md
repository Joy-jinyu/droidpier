# android-emu-web 第 1 阶段（能用）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 连上一台**已经在运行**的模拟器，在 nsh 网页里看到原始分辨率的实时画面，能点、能滑、能用键盘打字（含中文），还有返回、主页、最近任务三个按钮。

**Architecture:**
- 网关（Node + TS）通过发现文件找到模拟器，用 gRPC 的 mmap 方式订阅画面，经 WebSocket 推给页面。
- 页面是 nsh TSX 应用加 `web.host` 宿主模块：宿主模块持有 WebSocket，在 `[data-testid="screen"]` 里用 WebGL 画画面，并直接处理画面上的输入。
- 网关和宿主模块共用 `shared/` 里的协议和输入映射代码。
- 第 0 阶段的 `spike/` 原样保留作参考，正式代码不依赖它。

**Tech Stack:**
- Node 22（直接运行 `.ts`）、`node:test`；
- `@grpc/grpc-js`、`@grpc/proto-loader`、`ws`；
- `bun build`，把宿主模块打成一个 ESM 文件；
- WebGL2；
- nsh（本机构建的版本）。

**Spec:** `docs/superpowers/specs/2026-11-11-android-emu-web-design.md`

## Global Constraints

- 网关只监听 `127.0.0.1`。
- 画面方案：rgba-mmap。按 CSS 尺寸 × `devicePixelRatio` 取帧，帧的行序是自上而下（模拟器 32.1.14 实测）。
- mmap 文件的 handle 写成 `file://<绝对路径>`。读帧同一时间只读一次，其间到达的通知只保留最新一个。
- 背压：网关只保留最新一帧，靠 `ws.send` 的回调触发下一次发送，不轮询。画面不变时不发帧。
- 和平台相关的值（SDK 路径、发现文件目录、可执行文件名、镜像 ABI）只放在 `gateway/src/platform.ts`。第一版只实现 macOS arm64。
- 中文等非 ASCII 字符走剪贴板：先 `setClipboard`，再发一次粘贴。不往模拟器里装输入法。
- 不拦截浏览器快捷键：带 Cmd 的组合键一律不 `preventDefault`，Cmd+V 除外。
- **本机调试不用 `nsh run`**：它在整台机器上同一时间只能有一个开发会话，会顶掉本机其他项目的 nsh 开发服务器。改用 `nsh package ui --target web` 打包，由网关托管。只有用户明确同意时才用 `nsh run`。
- nsh 命令统一用 `$NSH`（环境变量，指向本机构建的 nsh 可执行文件），并设置下面两个环境变量：
  - `CC_wasm32_unknown_unknown=/opt/homebrew/opt/llvm/bin/clang`
  - `AR_wasm32_unknown_unknown=/opt/homebrew/opt/llvm/bin/llvm-ar`
- 测试命令：`pnpm test`，等价于 `node --test gateway/test/*.test.ts shared/test/*.test.ts`。
- 提交信息格式：`<type>(<scope>): <description>`，结尾加 `Co-Authored-By` 行。只在 `feat/*` 分支上提交，main 有 hook 拦截。

## Review Focus

1. **模拟器中途退出或重启**：页面显示“已断开”，网关不崩溃；模拟器回来后页面自动重连并恢复画面。对应 Task 4 的测试“emulator 断开后会话报告 closed”。
2. **浏览器窗口在两块屏幕（DPR 不同）之间拖动，或者页面被缩放**：画面要按新的像素尺寸重新订阅，不能一直糊着。对应 Task 5 Step 4 的检查。
3. **拖动时鼠标移出画布再松开**：模拟器必须收到抬起事件，不能卡在“按住”状态。对应 Task 3 的测试“pointer 离开画布后抬起仍发送 up”。
4. **页面发来非法 JSON 或未知消息**：网关忽略并记日志，连接不断开，进程不崩溃。对应 Task 4 的测试。
5. **同时打开两个页面标签**：两个都能看到画面，一个关掉不影响另一个；gRPC 流按连接各自取消。对应 Task 4 的测试“两个连接各自独立”。

---

### Task 1: 平台常量和共享协议

**Files:**
- Create: `gateway/src/platform.ts`、`shared/protocol.ts`、`shared/test/protocol.test.ts`
- Modify:
  - `gateway/src/sdk.ts`：把 `sdkRoot` 移到 platform.ts，这里改成从 platform 导入。
  - `gateway/src/discovery.ts`：`DISCOVERY_DIR` 改从 platform 导入。
  - `package.json`：加上 `test` 脚本。

**Interfaces:**
- Produces（`gateway/src/platform.ts`）：
  - `sdkRoot(): string`
  - `discoveryDir(): string`
  - `protoPath(): string`，指向 `emulator/lib/emulator_controller.proto`
- Produces（`shared/protocol.ts`）：
  - `PROTOCOL_VERSION = 1`
  - `FRAME_HEADER_BYTES = 20`：第一个 u32 是二进制消息类型，`BIN_FRAME = 1`；第 2 阶段会加 `BIN_SCREENSHOT = 2`，这里预留
  - `encodeFrameHeader(h: FrameHeader): Uint8Array`
  - `binKind(buf: ArrayBuffer | Uint8Array): number`
  - `decodeFrameHeader(buf: ArrayBuffer | Uint8Array): FrameHeader`，其中 `FrameHeader = { seq: number; width: number; height: number; tsMs: number }`，编码后依次是 kind、seq、width、height、tsMs，五个 u32 小端，`tsMs` 取 `timestampUs/1000` 的低 32 位
  - 客户端消息 `ClientMsg`：
    - `{t:"hello",version:number,width:number,height:number}`
    - `{t:"touch",x:number,y:number,down:boolean}`
    - `{t:"key",key:string,eventType:"keydown"|"keyup"|"keypress"}`
    - `{t:"text",text:string}`
    - `{t:"resize",width:number,height:number}`
  - 服务端消息 `ServerMsg`：
    - `{t:"ready",version:number,device:{width:number,height:number}}`
    - `{t:"status",state:"connected"|"no-emulator"|"emulator-closed"}`
    - `{t:"error",message:string}`
  - `parseClientMsg(raw: string): ClientMsg | null`：非法 JSON 或未知的 `t` 一律返回 `null`

- [ ] **Step 1：写失败的测试 `shared/test/protocol.test.ts`。**
  - 帧头往返：`decodeFrameHeader(encodeFrameHeader({seq:7,width:1080,height:2340,tsMs:123}))` 深等于原对象。
  - `encodeFrameHeader` 的结果长度是 20，前 4 字节读出来是 `BIN_FRAME`（1）。
  - `binKind(buf)` 读出类型：帧是 1，其他值原样返回。
  - `parseClientMsg('{"t":"touch","x":1,"y":2,"down":true}')` 深等于 `{t:"touch",x:1,y:2,down:true}`。
  - `parseClientMsg("not json")` 是 `null`。
  - `parseClientMsg('{"t":"rm -rf"}')` 是 `null`。
  - `parseClientMsg('{"t":"touch","x":"1"}')` 是 `null`，因为字段类型不对。
- [ ] **Step 2：** 运行 `pnpm test`。**预期**：失败，报模块不存在。
- [ ] **Step 3：** 实现 `shared/protocol.ts` 和 `gateway/src/platform.ts`。`platform.ts` 的 `sdkRoot` 逻辑和原来一样：先用 `ANDROID_HOME`，没有就用 `~/Library/Android/sdk`。然后改 `sdk.ts` 和 `discovery.ts` 的导入。
- [ ] **Step 4：** 运行 `pnpm test`。**预期**：全部通过，原有的 11 个测试也要过。
- [ ] **Step 5：** 提交：`feat(shared): add frame header and message protocol`。

### Task 2: 坐标和键盘映射（纯函数）

**Files:**
- Create: `shared/input-map.ts`、`shared/test/input-map.test.ts`

**Interfaces:**
- Produces:
  - `toDevice(p: {x:number,y:number}, rect: {left:number,top:number,width:number,height:number}, device: {width:number,height:number}): {x:number,y:number}`：把页面坐标换算成设备像素坐标，四舍五入，并夹到 `[0, width-1]` 和 `[0, height-1]` 范围内。旋转放到第 2 阶段，这里只处理竖屏。
  - `keyToMsg(e: {key:string, metaKey:boolean, ctrlKey:boolean, altKey:boolean, isComposing:boolean}, type: "keydown"|"keyup"): ClientMsg | null`。规则依次是：
    - `metaKey` 为真 → 返回 `null`，交给浏览器处理。
    - `isComposing` 为真 → 返回 `null`，由组字结束事件处理。
    - `key` 是单个 ASCII 可打印字符（码值 0x20–0x7E）：`keydown` 时返回 `{t:"key",key,eventType:"keypress"}`；`keyup` 时返回 `null`。
    - `key` 在功能键表里 → `{t:"key",key,eventType:type}`。功能键表：`Enter`、`Backspace`、`Delete`、`Tab`、`Escape`、`ArrowUp`、`ArrowDown`、`ArrowLeft`、`ArrowRight`、`Home`、`End`、`PageUp`、`PageDown`。
    - 其他情况 → `null`。
  - `textToMsgs(text: string): ClientMsg[]`：纯 ASCII 返回 `[{t:"key",key:<每个字符>,eventType:"keypress"}…]`；只要含有非 ASCII 字符，就返回 `[{t:"text",text}]`，交给网关走剪贴板。

- [ ] **Step 1：写失败的测试。**
  - `toDevice({x:270,y:585},{left:0,top:0,width:540,height:1170},{width:1080,height:2340})` 深等于 `{x:540,y:1170}`。
  - `toDevice({x:-5,y:2000},{left:0,top:0,width:540,height:1170},{width:1080,height:2340})` 深等于 `{x:0,y:2339}`，因为超出范围要夹住。
  - `toDevice({x:110,y:20},{left:100,top:10,width:540,height:1170},{width:1080,height:2340})` 深等于 `{x:20,y:20}`。
  - `keyToMsg({key:"a",metaKey:false,ctrlKey:false,altKey:false,isComposing:false},"keydown")` 深等于 `{t:"key",key:"a",eventType:"keypress"}`。
  - `keyToMsg(<key:"a">,"keyup")` 是 `null`。
  - `keyToMsg(<key:"r", metaKey:true>,"keydown")` 是 `null`。
  - `keyToMsg(<key:"Backspace">,"keyup")` 深等于 `{t:"key",key:"Backspace",eventType:"keyup"}`。
  - `keyToMsg(<key:"Process", isComposing:true>,"keydown")` 是 `null`。
  - `textToMsgs("hi")` 的长度是 2。
  - `textToMsgs("中文abc")` 深等于 `[{t:"text",text:"中文abc"}]`。
- [ ] **Step 2：** 运行 `pnpm test`，**预期**失败。
- [ ] **Step 3：** 实现 `shared/input-map.ts`。
- [ ] **Step 4：** 运行 `pnpm test`，**预期**通过。
- [ ] **Step 5：** 提交：`feat(shared): map page coordinates and keys to emulator input`。

### Task 3: 宿主模块的指针处理（抬起不丢）

**Files:**
- Create: `host/src/pointer.ts`、`shared/test/pointer.test.ts`。测试放在 `shared/test` 下，用 node 运行；被测逻辑不依赖 DOM。

**Interfaces:**
- Consumes：Task 2 的 `toDevice`。
- Produces：`createPointerTracker(send: (m: ClientMsg) => void, geom: () => {rect, device}): { down(e: {clientX,clientY,pointerId}): void; move(e): void; up(e): void; cancel(): void }`。
  - 只跟踪一个指针（`identifier` 固定为 0）。
  - 没有按下时，`move` 不发消息。
  - `up` 和 `cancel` 都会补发一次 `down:false`，并且只发一次。
  - 在宿主模块里，canvas 要用 `setPointerCapture`。`pointercancel` 和 `lostpointercapture` 都调用 `cancel()`。

- [ ] **Step 1：写失败的测试。**
  - 序列 down(10,10) → move(20,20) → up(30,30)：发出 3 条消息，最后一条 `down:false`。
  - 没有 down 时调用 move：发出 0 条消息。
  - down → cancel → up：只发 2 条消息，也就是一条 down 加一条 `down:false`，后面的 up 不再重复发。
  - 测试名：“pointer 离开画布后抬起仍发送 up”。场景是 down 之后，画布外的 up 依然按画布矩形换算并发出，坐标被夹到边界上。
- [ ] **Step 2：** 运行 `pnpm test`，**预期**失败。
- [ ] **Step 3：** 实现 `createPointerTracker`。
- [ ] **Step 4：** 运行 `pnpm test`，**预期**通过。
- [ ] **Step 5：** 提交：`feat(host): track a single pointer and always release it`。

### Task 4: 网关：模拟器会话和 WebSocket 服务

**Files:**
- Create:
  - `gateway/src/emulator.ts`
  - `gateway/src/server.ts`
  - `gateway/src/main.ts`
  - `gateway/test/server.test.ts`，用假会话测试
  - `gateway/test/emulator.it.test.ts`，需要真模拟器；环境变量 `EMU_IT=1` 时才运行，否则跳过
- Modify：`package.json`。加脚本 `"start": "node gateway/src/main.ts"`、`"test:it": "EMU_IT=1 node --test gateway/test/emulator.it.test.ts"`。

**Interfaces:**
- Consumes：
  - Task 1 的 `protocol`、`platform`；
  - 已有的 `findRunning`、`loadController`、`LatestFrame`。
- Produces（`gateway/src/emulator.ts`）：
  - `interface EmulatorSession { device: {width:number,height:number}; frames(size:{width:number,height:number}, onFrame:(h:FrameHeader, data:Buffer)=>void): () => void; touch(x:number,y:number,down:boolean): Promise<void>; key(key:string, eventType:"keydown"|"keyup"|"keypress"): Promise<void>; text(text:string): Promise<void>; onClosed(cb:()=>void): void; close(): void }`
    - `frames` 返回一个取消函数。
    - `text` 的实现：先 `setClipboard({text})`，再发一次粘贴。粘贴键在 Step 3 里实测确定：先试 `sendKey({key:"Paste", eventType:"keypress"})`；不生效就改用 `adb -s emulator-<serial> shell input keyevent 279`，并把选用哪种写进代码注释。
  - `connectEmulator(running: Running, timeoutMs = 3000): Promise<EmulatorSession>`
    - 用带 deadline 的 `getStatus` 确认能连通。连不上就 reject，错误消息要包含端口号。
    - `device` 从 `getStatus.hardwareConfig` 里的 `hw.lcd.width` 和 `hw.lcd.height` 读取。
- Produces（`gateway/src/server.ts`）：
  - `startServer(opts: {port:number, staticDir:string, getSession: () => Promise<EmulatorSession | null>, log?: (s:string)=>void}): Promise<{port:number, close():Promise<void>}>`
    - 每个连接的第一条消息必须是 `hello`，否则关闭连接，关闭码 4000。
    - 收到 `hello` 后回 `ready`，然后用 `hello` 里的宽高开始订阅画面。
    - 收到 `resize` 时，先取消旧订阅，再按新尺寸重新订阅。
    - 发帧逻辑：用 `LatestFrame` 暂存；没有正在发送的帧时就发，在 `ws.send` 的回调里取下一帧接着发。
    - 连接关闭时取消订阅。
    - 会话报告 closed 时，向所有连接发 `{t:"status",state:"emulator-closed"}`。
    - 非法消息只记一条日志，连接保留。
    - `GET /` 和静态文件从 `staticDir` 提供。
- Produces（`gateway/src/main.ts`）：
  - 默认端口 `7300`，可以用 `--port` 改。
  - 静态目录是 `ui/.nsh/out/Emu Web`。打包产物的实际位置在仓库根目录的 `.nsh/out/Emu Web`，以 Step 6 实测为准，结果写进常量。
  - 启动后打印 `android-emu-web: http://127.0.0.1:<port>/  (emulator-<serial>)`。没有模拟器时打印原因，但网关不退出，页面会显示 `no-emulator`。
  - 设置环境变量 `DEBUG=1` 时，每秒打印一行：每个连接的收帧数、发帧数、丢帧数、平均帧大小、从模拟器到网关的延迟（设计 6.7 节）。

- [ ] **Step 1：写 `server.test.ts` 的失败测试。** 用 `FakeSession` 实现 `EmulatorSession`，可以手动推帧。用 `ws` 客户端连接，测试以下几项：
  - “未发 hello 先发 touch → 连接以 4000 关闭”。
  - “hello 后收到 ready，且 device 等于假会话的尺寸”。
  - “客户端不读时连推 100 帧，服务端发出的帧数不超过 3，且最后收到的那一帧的 seq 是 99”。
  - “非法 JSON 不断开连接，之后发 touch 仍能到达假会话”。
  - “两个连接各自独立：关掉一个之后，另一个还能收到新帧；假会话的取消函数恰好被调用 1 次”。
  - “emulator 断开后会话报告 closed：所有客户端收到 status emulator-closed”。
- [ ] **Step 2：** 运行 `pnpm test`，**预期**失败。
- [ ] **Step 3：实现 `emulator.ts`。**
  - mmap 读帧的方式沿用 `spike` 里 `bench-server.ts` 的做法：同一时间只读一次，只保留最新的通知。
  - mmap 文件建在 `os.tmpdir()` 下，订阅取消或会话关闭时删除。
  - 写 `emulator.it.test.ts`，覆盖三项：
    - “connectEmulator 读到 device 1080x2340”；
    - “frames 在 sendKey GoHome 之后 2s 内至少回调 1 次，且 header 的宽高等于请求的尺寸”；
    - “text('中文 ab') 之后用 getClipboard 读回的文本相同”。
  - 运行 `pnpm test:it`。**预期**：在 `emulator-5554` 上全部通过。粘贴键最终用哪种方式，记在代码注释里。
- [ ] **Step 4：** 实现 `server.ts` 和 `main.ts`。运行 `pnpm test`，**预期**：全部通过。
- [ ] **Step 5：** 运行 `node gateway/src/main.ts`。**预期**：打印出地址。然后把模拟器的发现目录指向一个空目录（设置 `HOME=<空目录>`）再运行一次，**预期**：打印“没有找到”的原因，进程不退出。
- [ ] **Step 6：** 提交：`feat(gateway): serve emulator frames and input over WebSocket`。

### Task 5: 宿主模块和 nsh 界面

**Files:**
- Create:
  - `host/src/main.ts`：导出 `createHost`
  - `host/src/renderer.ts`
  - `host/src/connection.ts`
- Modify：
  - `ui/App.tsx`：改成正式界面；
  - `ui/nsh.json`；
  - `package.json`：加 `"build:host": "bun build host/src/main.ts --outfile ui/host.js --format esm --target browser"` 和 `"build:ui": "pnpm build:host && <NSH 环境变量> $NSH package ui --target web"`；
  - `.gitignore`：加上 `ui/host.js`，它是构建产物。
- Delete：原来的 `ui/host.js` 试验代码。删之前先用 `rg` 确认没有别处引用它。

**Interfaces:**
- Consumes：Task 1 的协议，Task 2、3 的映射和指针处理，Task 4 的网关地址（`ws://127.0.0.1:7300`）。
- Produces：
  - `host.call` 支持的函数：
    - `emu.key({key})`：返回 `{ok:true}`；
    - `emu.status()`：返回 `{state, fps, latencyMs}`。
  - `hostEvent` 推送的事件：
    - `emu.status`：`{state:"connecting"|"connected"|"no-emulator"|"emulator-closed"|"disconnected"}`；
    - `emu.stats`：`{fps:number, latencyMs:number}`，每秒推一次。
  - TSX 应用：
    - 顶部一行三个按钮：返回（`GoBack`）、主页（`GoHome`）、最近任务（`AppSwitch`）。
    - 按钮旁显示状态文字和帧率。
    - 下方是 `<View testID="screen" style={{width:540,height:1170}} />`。
    - 中文界面文案：“连接中…”、“已连接”、“没有找到运行中的模拟器”、“模拟器已关闭”、“与网关断开，正在重连…”。

- [ ] **Step 1：实现宿主模块的连接、绘制和输入。**
  - 连接：建立后先发 `hello`，宽高取 CSS 540×1170 乘以 DPR。断开后每 1 秒重连一次。
  - 绘制：WebGL2 纹理，统一上下翻转；只在 `requestAnimationFrame` 里绘制最新的一帧。
  - DPR 变化：用 `matchMedia('(resolution: …dppx)')` 监听 DPR，变化时发 `resize` 并重建纹理。
  - 键盘：canvas 设成 `tabIndex=0`，点击时获得焦点。`keydown` / `keyup` 走 `keyToMsg`。`compositionend` 的结果走 `textToMsgs`，为此要在 canvas 上叠一个隐藏的 `<textarea>` 来接收输入法组字。
  - 统计：每秒通过 `hostEvent` 推一次 `emu.stats`，并且 `console.debug` 一行指标。
- [ ] **Step 2：** 运行 `pnpm build:ui`。**预期**：生成 `ui/host.js` 和打包产物。再运行 `pnpm start` 并打开地址。
- [ ] **Step 3：真实浏览器验收，需要在用户的 Chrome 里做，交付时附截图。**
  1. 画面清晰，和 scrcpy 窗口逐像素对比，文字边缘一样锐利；
  2. 点击桌面图标能打开 App；
  3. 上下滑动能开关应用抽屉；
  4. 在搜索框里打出 `hello` 和 `中文`；
  5. 返回、主页、最近任务三个按钮都生效；
  6. 快速滑动 10 秒，**目视检查有没有画面撕裂**（画面上下两半错位）。如果出现撕裂，改用 rgba 方式，也就是不传 transport 字段，然后重测并在 ledger 里记一条 Ruling。
- [ ] **Step 4：Review Focus 第 1、2 条的检查。**
  - 运行 `adb -s emulator-5554 emu kill` 关掉模拟器。**预期**：页面显示“模拟器已关闭”，网关不崩溃。
  - 重新启动模拟器（`emulator -avd Pixel_5_API_34 -no-window -grpc 8554 -no-boot-anim`），然后刷新页面。**预期**：画面恢复。
  - 把 Chrome 的缩放从 100% 改成 125%，再改回来。**预期**：画面一直清晰，网关日志里能看到 `resize`。
- [ ] **Step 5：** 用第 0 阶段的口径复测一次：把 `spike/measure.ts` 的页面目标改成指向正式页面。**预期**：每秒帧数中位数不低于 50；CPU 不超过 scrcpy 的 1.5 倍。数据记进 `spike/NOTES.md`。
- [ ] **Step 6：** 提交：`feat(ui): show the live emulator screen in the nsh web app`。
