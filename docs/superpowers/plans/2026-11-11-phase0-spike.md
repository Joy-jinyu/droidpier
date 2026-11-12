# android-emu-web 第 0 阶段（实测）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用实测数据定下两件事：画面走哪种传输方式（设计 6.1 的 A / B / C），以及 nsh 网页版里能不能稳定嵌入我们自己的画布。结论写回设计文档。

**Architecture:**
- 一个最小的 Node 网关：用 gRPC 连上已经在运行的模拟器，按 A / B / C 三种模式把画面帧通过 WebSocket 推出去。
- 一个纯 HTML 测速页：用 WebGL 显示画面，统计帧率和“点击 → 画面变化”的延迟。
- 一个最小的 nsh web 应用，加上它的 `host.js`：验证画布嵌入、键盘焦点、开发模式下 `web.host` 是否生效，以及 CSP。
- 这一阶段只做试验，代码可以扔掉。只有发现文件解析和“只留最新一帧”两块逻辑会留到第 1 阶段，所以只给这两块写单元测试。

**Tech Stack:**
- Node 22.22（直接运行 `.ts`，已验证内置类型剥离可用）、`node:test`；
- `@grpc/grpc-js`、`@grpc/proto-loader`、`ws`；
- `sharp`，用于 JPEG 编码；
- WebGL2；
- nsh（本机构建的版本）。

**Spec:** `docs/superpowers/specs/2026-11-11-android-emu-web-design.md`

## Global Constraints

- 网关只监听 `127.0.0.1`。
- proto 直接加载 `$ANDROID_HOME/emulator/lib/emulator_controller.proto`：
  - `ANDROID_HOME` 未设置时，用 `~/Library/Android/sdk`；
  - 包名 `android.emulation.control`，服务名 `EmulatorController`；
  - 不提交任何生成的代码。
- 发现文件的位置是 `~/Library/Caches/TemporaryItems/avd/running/pid_<pid>.ini`，要读的字段：`grpc.port`、`grpc.token`（可选）、`port.serial`。
- 测试条件：设备 1080×2340，页面画布 540×1170。
- 达标线（三条同时满足）：
  - 帧率不低于 50；
  - 点击到画面变化的延迟不比 scrcpy 高；
  - 网关加模拟器的 CPU 占用不超过 scrcpy 的 1.5 倍。
- 背压：只保留最新一帧，旧帧丢掉不排队。画面不变时不发帧。
- nsh 命令统一用 `$NSH`（环境变量，指向本机构建的 nsh 可执行文件），并且设置下面两个环境变量：
  - `CC_wasm32_unknown_unknown=/opt/homebrew/opt/llvm/bin/clang`
  - `AR_wasm32_unknown_unknown=/opt/homebrew/opt/llvm/bin/llvm-ar`
- 浏览器只用 Chrome。
- 三种方案都不达标，或者 nsh 嵌入走不通时：停下来，带着数据找用户，不进入第 1 阶段。

## Review Focus

1. **模拟器没在运行，或者没开 gRPC**：网关要打印一句明确的原因（找不到发现文件 / 端口连不上）然后退出，不能挂起不动。对应 Task 2 的测试。
2. **发现文件目录里有已经退出的模拟器留下的旧文件**：只能选 pid 还活着的那个。对应 Task 2 的测试。
3. **页面绘制慢于推帧**：内存不能涨，只发最新帧。对应 Task 3 的 `LatestFrame` 测试。
4. **WebSocket 断开后网关还在订阅画面流**：gRPC 流要取消，不能空转占 CPU。对应 Task 3 的 Step 6 手动检查。
5. **nsh 重新渲染占位 View 的兄弟节点或样式时，画布被移走**：对应 Task 5 的检查项。

---

### Task 1: 项目骨架和 gRPC 连通

**Files:**
- Create: `package.json`、`gateway/src/sdk.ts`、`gateway/src/smoke.ts`、`.gitignore`（忽略 `node_modules`、`.nsh`、`spike/out`）

**Interfaces:**
- Produces:
  - `sdkRoot(): string`：返回 SDK 根目录。
  - `loadController(port: number, token?: string): EmulatorControllerClient`：带 token 时，每次调用都加上 `authorization: Bearer <token>` 元数据。

- [ ] **Step 1：** 在项目根目录运行 `pnpm init`，再运行 `pnpm add @grpc/grpc-js @grpc/proto-loader ws sharp` 和 `pnpm add -D @types/ws @types/node`。`package.json` 里写上 `"type": "module"`。
- [ ] **Step 2：** 在 `gateway/src/sdk.ts` 里实现 `sdkRoot` 和 `loadController`。proto-loader 的选项用 `{ keepCase: true, longs: Number, enums: String, defaults: true }`。
- [ ] **Step 3：** 写 `gateway/src/smoke.ts`。它连上 `127.0.0.1:8554`，依次做三件事：
  1. 调用 `getStatus` 并打印返回结果；
  2. 调用 `sendKey({ eventType: "keypress", key: "GoHome" })`；
  3. 调用 `sendKey({ eventType: "keypress", text: "中文abc" })`，这一步要事先点开设备上的一个输入框，实测中文能不能直接打进去。
- [ ] **Step 4：** 运行 `node gateway/src/smoke.ts`。

  **预期**：打印出 `getStatus` 的结果（里面有 `booted: true`），设备回到桌面。把中文 `text` 的实测结果记到 `spike/NOTES.md`：能打出来，还是只出来 `abc`。
- [ ] **Step 5：** 这个目录还不是 git 仓库。是否运行 `git init` 并提交，要先经用户同意；没同意就跳过这一步。

### Task 2: 发现文件解析（保留到第 1 阶段）

**Files:**
- Create: `gateway/src/discovery.ts`、`gateway/test/discovery.test.ts`

**Interfaces:**
- Produces:
  - `parseDiscovery(text: string): { grpcPort: number; token?: string; serial: number }`
  - `findRunning(dir: string, isAlive: (pid: number) => boolean): Promise<{ pid: number; grpcPort: number; token?: string; serial: number } | null>`

- [ ] **Step 1：写失败的测试。**
  - `parseDiscovery("port.serial=5554\ngrpc.port=8554\n")` 应该等于 `{ grpcPort: 8554, serial: 5554 }`。
  - 带上 `grpc.token=abc` 时，结果里应该有 `token: "abc"`。
  - 文本里缺少 `grpc.port` 时，应该抛出错误，消息包含 `grpc.port`。
  - `findRunning`：在临时目录里放 `pid_1.ini` 和 `pid_2.ini`，`isAlive` 只对 2 返回 true，结果应该是 pid 2。
  - 目录不存在时，`findRunning` 返回 `null`。
- [ ] **Step 2：** 运行 `node --test gateway/test/`。**预期**：失败，报模块不存在。
- [ ] **Step 3：** 实现这两个函数。`isAlive` 的默认实现用 `process.kill(pid, 0)`。
- [ ] **Step 4：** 再运行 `node --test gateway/test/`。**预期**：全部通过。
- [ ] **Step 5：** 修改 `smoke.ts`，改用 `findRunning` 找端口。找不到时打印 `没有找到带 gRPC 的运行中模拟器（<目录>）`，并以退出码 1 退出。分别在模拟器关闭和运行时各跑一次，确认结果符合预期。

### Task 3: 帧推送网关（三种模式）

**Files:**
- Create: `gateway/src/latest-frame.ts`、`gateway/test/latest-frame.test.ts`、`gateway/src/bench-server.ts`

**Interfaces:**
- Consumes：Task 1 的 `loadController`，Task 2 的 `findRunning`。
- Produces:
  - `class LatestFrame<T> { put(f: T): void; take(): T | undefined; dropped: number }`：`put` 会覆盖还没被取走的帧，同时让 `dropped` 加 1。
  - 一个 WebSocket 服务，地址是 `ws://127.0.0.1:8765/?mode=rgba|rgba-mmap|jpeg|png`。
    - 每条二进制消息的结构：一个 16 字节的头，后面接数据。头部依次是 `u32 seq`、`u32 width`、`u32 height`，以及 `u32` 的网关收到该帧的时间（`performance.now()` 的整数毫秒），全部小端序。
    - 页面发来的文本消息格式是 `{"t":"touch","x":<设备 px>,"y":<设备 px>,"down":boolean}`，网关把它转成 `sendTouch`，`identifier` 固定为 0，抬起时 `pressure` 为 0，按下时为 1。

- [ ] **Step 1：写失败的测试。**
  - 依次 `put` 1、2、3 后，`take()` 应该返回 3，`dropped` 应该是 2。
  - 再调用一次 `take()`，应该返回 `undefined`。
- [ ] **Step 2：** 运行 `node --test gateway/test/`，**预期**失败。实现 `LatestFrame` 后再跑一次，**预期**通过。
- [ ] **Step 3：实现 `bench-server.ts` 的四种模式。**
  - **`rgba`**：用 `streamScreenshot({ format: "RGBA8888", width: 540, height: 1170 })`，帧数据直接从消息里取。
  - **`rgba-mmap`**：
    - 先在 `os.tmpdir()` 下建一个文件，大小为 `540*1170*4` 字节；
    - 订阅时加上 `transport: { channel: "MMAP", handle: <文件路径> }`；
    - 每次收到通知，就从文件里读出整帧。Node 没有 mmap，用 `fs.read` 读进一个预先分配好的 Buffer，所以这个模式的结果要扣掉这次读文件的开销。
  - **`jpeg`**：取 rgba 帧，用 `sharp(raw, { raw: { width, height, channels: 4 } }).jpeg({ quality: 80 })` 编码成 JPEG。
  - **`png`**：订阅时用 `format: "PNG"`，收到的数据原样转发。
  - **发送规则**：只在 `ws.bufferedAmount === 0` 时发 `LatestFrame` 里的帧，否则留着等下一次。
  - **断开处理**：WebSocket 关闭时调用 gRPC 流的 `call.cancel()`。
- [ ] **Step 4：** 运行 `DEBUG=1 node gateway/src/bench-server.ts`。**预期**：终端每秒打印一行，包含模式、每秒收到的帧数、发送的帧数、丢掉的帧数、平均每帧字节数。
- [ ] **Step 5：** 在 Task 4 的页面空闲（设备画面不动）10 秒。**预期**：这段时间每秒收到的帧数是 0 或者接近 0，说明画面不变时不发帧。
- [ ] **Step 6：** 关掉页面后运行 `ps -o %cpu= -p <网关 pid>`。**预期**：几秒内降到 1% 以下，说明 gRPC 流已经取消。

### Task 4: 纯网页测速页

**Files:**
- Create: `spike/bench.html`（单文件，内联脚本），由 `bench-server.ts` 在 `http://127.0.0.1:8765/` 上提供。

**Interfaces:**
- Consumes：Task 3 定义的二进制帧格式和 touch 消息格式。

- [ ] **Step 1：页面结构。**
  - 用下拉框选择模式，切换时重新连接 WebSocket。
  - 一个 540×1170 的画布：`rgba` 系列模式用 WebGL2 的 `texImage2D` 上传纹理后绘制，`jpeg` 和 `png` 模式先用 `createImageBitmap` 解码，再上传纹理。
  - 角落显示每秒帧数和最近一次点击延迟。
  - 在画布上按下和抬起鼠标时，把坐标乘以 2 换算成设备坐标，再发 touch 消息。
- [ ] **Step 2：点击延迟的测法。**
  - 鼠标按下时，记下 `t0 = performance.now()`。
  - 之后收到的帧里，第一个 `seq` 比按下时最新 `seq` 大、而且和上一帧内容不同的帧，等它画完之后，在 `requestAnimationFrame` 回调里记下 `t1`。
  - 延迟就是 `t1 - t0`。比较内容是否不同时，抽样比较 64 个像素就够了。
  - 测的时候点击桌面上的图标，这样画面一定会变。
- [ ] **Step 3：** 在 Chrome 里打开 `http://127.0.0.1:8765/`，四种模式各测一遍。

  每种模式都做同样的事：持续拖动桌面翻页 10 秒，再点击 10 次，记录平均帧率和点击延迟的中位数。同时运行下面这条命令采集 CPU：

  ```bash
  ps -o %cpu=,comm= -p <qemu pid>,<网关 pid>
  ```

  每秒采样一次，采集 10 秒。
- [ ] **Step 4：测 scrcpy 基线。**
  - 关掉测速页，运行 `scrcpy -s emulator-5554 --no-audio`，做同样的拖动和点击。
  - CPU 采集 qemu 和 scrcpy 两个进程。
  - 点击延迟用 `scrcpy --print-fps` 估不出来，所以改成录屏估算：用 Mac 的录屏（`screencapture -v`），从鼠标按下到画面变化，逐帧数。录屏要用户同意才能做；不同意的话，就只比较帧率和 CPU，并在报告里说明延迟这一项缺了基线。
- [ ] **Step 5：** 把四种模式加 scrcpy 的数据填进 `spike/NOTES.md` 的表格，列是：模式、帧率、点击延迟中位数、qemu CPU、网关 CPU、每帧字节数。

### Task 5: nsh 嵌入验证

**Files:**
- Create: `ui/nsh.json`、`ui/App.tsx`、`ui/host.js`、`ui/tsconfig.json`，参照 nsh 源码里 `examples/host-echo` 的写法。

**Interfaces:**
- Consumes：Task 3 的 WebSocket 帧格式。`host.js` 里可以直接复用 bench 页的绘制代码，复制过去就行，这是试验代码。
- Produces：`spike/NOTES.md` 里四项验证的结论，每项都是“通过”或“不通过 + 现象”。

- [ ] **Step 1：`nsh.json`。**
  - `"capabilities": { "host": ["emu.*"] }`
  - `"web": { "host": "./host.js", "connect": ["127.0.0.1", "localhost"] }`
- [ ] **Step 2：`App.tsx`。**
  - 上方放一行按钮：返回、主页，再加一个“切换”按钮，点一下就改一次 signal。这个 signal 同时控制两件事：占位 View 旁边的一个兄弟节点出现还是消失，以及占位 View 的 `backgroundColor`。
  - 下方是 `<View testID="screen" style={{ width: 540, height: 1170 }} />`。
  - 返回和主页两个按钮调用 `host.call("emu.key", { key: "GoBack" | "GoHome" })`。
- [ ] **Step 3：`host.js`。**
  - `createHost(player)` 里用一个 `MutationObserver` 等 `[data-testid="screen"]` 出现。出现后在它里面 `appendChild` 一个画布，画布连 `ws://127.0.0.1:8765/?mode=<Task 4 表现最好的模式>`。
  - `call("emu.key", …)` 通过 WebSocket 发 `{"t":"key","key":…}`。`bench-server.ts` 要加上这种消息的处理：转成 `sendKey`，`eventType` 用 `keypress`。
  - 画布设成 `tabIndex = 0`，把它收到的 `keydown` 都打印到 `console.log`。
- [ ] **Step 4：** 运行 `$NSH run ui --target web`，用 Chrome 打开它输出的地址。逐项检查：

  - **(a) 开发模式下宿主模块是否生效**：画布出现，画面在动，返回和主页按钮能用。
  - **(b) 重新渲染后画布还在不在**：连续点 20 次“切换”，每次都在控制台运行 `document.querySelector('[data-testid=screen] canvas')`，结果都不能是 `null`，而且画面一直在更新。

    如果不通过，就改用退路方案：把画布挂到 `document.body` 上，用 `position: fixed` 叠在占位元素上方，再用 `ResizeObserver` 和 `getBoundingClientRect` 跟着占位元素移动。改完重新测 (b)，并在笔记里写清楚最后用的是哪种方式。
  - **(c) 键盘事件能不能到画布**：点一下画布，然后按 `a`、`Enter`、`Backspace`，控制台里应该看到三条 `keydown`。再确认 Cmd+R 仍然能刷新页面，说明浏览器自己的快捷键没被拦。
  - **(d) CSP 会不会拦 WebSocket**：在 DevTools 的 Console 里，不能出现 `Refused to connect` 这类 CSP 报错。
- [ ] **Step 5：公网 https 页面实测。这一步要先问用户。**
  - 要做的是：运行 `$NSH package ui --target web` 打出静态站点，再上传到一个 https 地址，比如某个静态托管服务。这属于对外发布，必须先得到用户同意，并由用户指定上传到哪里。
  - 上传后用 Chrome 打开，记录四件事：
    - 有没有弹出访问本地网络的权限框；
    - 允许之后能不能连上 `ws://127.0.0.1:8765`；
    - 有没有 CSP 报错；
    - `new WebSocket(url, { targetAddressSpace: "loopback" })` 这种写法在本机 Chrome 版本上是否被接受。
  - 用户不同意的话，把这一项标成“未验证”，留到第 3 阶段。

### Task 6: 写结论

**Files:**
- Modify：设计文档的第 6.1 节和第 5 节的“未验证”段落。
- Create：`spike/NOTES.md`。前面几个任务已经在往里写数据了，这里做最后整理。

- [ ] **Step 1：** 按达标线判断用哪种画面方案。在 6.1 节写上“选定：X”，后面附上测得的数据表。三种都不达标的话，写“均未达标”，然后停下来找用户。
- [ ] **Step 2：** 第 5 节里每个“未验证”的条目，都改成实测结论；中文 `text` 的实测结果写进 6.2 节。
- [ ] **Step 3：** 向用户汇报四件事：选了哪种方案、nsh 嵌入用的是哪种方式、还有哪些项没验证，以及第 1–3 阶段的计划现在可以开始写了。
