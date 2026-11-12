# android-emu-web 第 2.5 阶段（H5 调试）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在网页模拟器里列出 App 内可审查的 H5 页面，一键打开它的 DevTools（DOM、Console、Network），并用一个地址栏把这个 H5 换成本机开发服务器上的页面。跳转后自动检查 JSBridge 还在不在。

**Architecture:**
- 网关新增三块：
  - `webviews.ts`：经 adb 找到 WebView 调试 socket，建立转发，读页面列表；
  - DevTools 代理：网关上的一个 WebSocket 路径，转发到对应 WebView，转发时去掉 Origin 头；
  - `reverse.ts`：管理 `adb reverse`。
- 跳转使用一个很小的 DevTools 协议客户端：`Page.navigate`，等页面加载完，再执行 `Runtime.evaluate` 检查 JSBridge。
- 页面侧在 TSX 里加一个“H5 调试”面板，通过 `host.call` 调宿主模块，宿主模块再经 WebSocket 请求网关。

**Tech Stack:** 同第 1 阶段，不新增依赖。DevTools 代理和协议客户端都用现有的 `ws`。

**Spec:** `docs/superpowers/specs/2026-11-11-android-emu-web-design.md`，第 6.8 节

**前置：** 第 1 阶段已完成。这个阶段和第 2 阶段都要改 `shared/protocol.ts` 和 `gateway/src/server.ts`，所以要**按顺序**做，不能和第 2 阶段并行。

## Global Constraints

- 第 1 阶段计划的 Global Constraints 全部沿用：只监听 `127.0.0.1`，平台相关的值只放在 `platform.ts`，本机不用 `nsh run`，按顺序处理输入，提交格式不变。
- 调试 socket 的名字匹配 `webview_devtools_remote_<pid>` 和 `chrome_devtools_remote`（模拟器里的 Chrome 浏览器）。pid 通过 `adb shell ps -p <pid> -o NAME=` 换成包名。
- 每个 socket 只建一个 `adb forward`，本机端口从 9300 往上找空闲的。socket 消失时移除转发；网关退出时（SIGINT、SIGTERM、SIGHUP）移除这个网关建立的所有转发和 `adb reverse`。不能动不是本网关建立的转发。
- 只有主机是 `localhost` 或 `127.0.0.1` 的地址才执行 `adb reverse`。`10.0.2.2` 和外部地址直接跳转。
- 没写协议的地址默认补 `http://`。
- 已实测的事实（第 6.8 节）：
  - `/json` 返回 `title`、`url`、`webSocketDebuggerUrl`、`devtoolsFrontendUrl`，`description` 是 JSON 字符串，里面的 `visible` 表示页面是否在前台。
  - debug 包允许明文 http。
  - App 注入的 JSBridge 在 `window._dsbridge` 上。
- DevTools 代理能完全控制 App 里的网页。第 3 阶段的口令和 Origin 校验要同样作用在它上面，本阶段先在代码里留一条注释，指向第 3 阶段计划 Task 1。
- 实测用的 App：模拟器里一个开着 WebView 调试的 debug 包，下文写作 `com.example.app.debug`。启动后点它界面上一个不需要登录的按钮，会打开一个 App 内的 H5 页面（下文叫“测试 H5”）。**不要在 App 里输入任何账号信息。**

## Review Focus

1. **App 退出，或 WebView 页面关掉后，列表还留着旧条目，或者代理连着一个已经失效的端口**：列表要在 3 秒内更新；代理连接要关闭，并告诉页面“页面已关闭”。对应 Task 1、Task 2 的测试。
2. **同一个 App 里有多个 WebView 页面，包括不可见的预加载页**（实测里就有一个 `data:text/html` 的空白页）：列表按 `visible` 排序，可见的在前；不可见的页面要标出来，避免用户审查错页面。对应 Task 1 的测试。
3. **用户输入的地址格式五花八门**：`localhost:5173`、`127.0.0.1:5173/a?b=1#c`、`http://localhost`（没写端口时默认 80）、`https://example.com`、带空格的地址。都要能正确识别要不要执行 `adb reverse`、用哪个端口。对应 Task 3 的测试。
4. **跳转失败**：开发服务器没启动、App 禁止明文、地址拼错。页面要显示具体原因，不能一直卡在“跳转中”。对应 Task 3 的测试和 Task 5 的实测。
5. **网关退出后残留 `adb reverse` 或 `adb forward`**：下次启动时不能因为端口被占用而失败；退出时要清理干净。对应 Task 3 的测试和 Task 5 的检查。

---

### Task 1: 列出可审查的 WebView 页面

**Files:**
- Create: `gateway/src/webviews.ts`、`gateway/test/webviews.test.ts`
- Modify: `gateway/src/platform.ts`，如果需要新的 adb 相关常量
- Test（集成）：`gateway/test/webviews.it.test.ts`，只在 `EMU_IT=1` 时运行

**Interfaces:**
- Produces：
  - `parseDevtoolsSockets(procNetUnix: string): string[]`：去重后的 socket 名字。
  - `type WebViewPage = { socket: string; pid?: number; pkg?: string; id: string; title: string; url: string; visible: boolean; frontendUrl?: string }`
  - `createWebViews(deps: { serial: number; exec: (args: string[]) => Promise<string>; fetchJson: (port: number) => Promise<any[]>; freePort: () => Promise<number> }): { list(): Promise<WebViewPage[]>; portOf(socket: string): number | undefined; close(): Promise<void> }`
    - `list()` 每次都重新读取 `/proc/net/unix`：新出现的 socket 建立转发，消失的移除转发。
    - 结果先按 `visible` 排序（可见的在前），再按包名排序。
    - `close()` 移除所有转发。
    - `exec` 收到的是 `adb -s emulator-<serial>` 后面的参数。

- [ ] **Step 1：写失败的测试，用假的 `exec` 和 `fetchJson`。**
  - `parseDevtoolsSockets(<两行 webview_devtools_remote_6642，一行 chrome_devtools_remote，几行无关内容>)` 深等于 `["webview_devtools_remote_6642","chrome_devtools_remote"]`。
  - “列表按 visible 排序并带上包名”：`/json` 返回两个页面，测试 H5 的 `visible:true`，`data:` 页面的 `visible:false`；结果第一项是测试 H5，`pkg` 是 `com.example.app.debug`。
  - “socket 消失后移除转发”：第二次调用 `list()` 时那个 socket 已经不在，`exec` 收到 `forward --remove tcp:<端口>`，结果为空。
  - “同一个 socket 只 forward 一次”：连续调用 `list()` 两次，`forward tcp:` 只执行了 1 次。
  - “close 移除全部转发”。
  - `description` 不是合法 JSON 时，`visible` 按 false 处理，不抛错。
- [ ] **Step 2：** 运行 `pnpm test`，**预期**失败。
- [ ] **Step 3：** 实现。默认的 `fetchJson` 用 `fetch("http://127.0.0.1:<端口>/json")`，超时 2 秒。
- [ ] **Step 4：** 运行 `pnpm test`，**预期**通过。
- [ ] **Step 5：写集成测试并真机运行。**
  - 测试内容：先 `monkey` 启动被测 App（包名由 `EMU_IT_PKG` 指定），再点打开测试 H5 的按钮（按钮文字由 `EMU_IT_OPEN_LABEL` 指定），点之前先用 `uiautomator dump` 找到按钮位置。断言列表里有一个 `visible` 为 true、`url` 以 `EMU_IT_URL_PREFIX` 开头的页面。最后按返回键和主页键。
  - 运行 `pnpm test:it`，**预期**通过。
- [ ] **Step 6：** 提交：`feat(gateway): list debuggable WebView pages`。

### Task 2: DevTools 代理，并实测能不能打开 DevTools 前端

**Files:**
- Create: `gateway/src/devtools-proxy.ts`、`gateway/test/devtools-proxy.test.ts`
- Modify: `gateway/src/server.ts`。WebSocket 升级请求按路径分流：`/devtools/<socket>/<pageId>` 交给代理，其他照旧。

**Interfaces:**
- Consumes：Task 1 的 `portOf(socket)`。
- Produces：
  - `proxyDevtools(client: WebSocket, upstreamUrl: string): void`：双向转发文本消息和二进制消息，任意一端关闭，另一端也关闭。连上游时**不带 Origin 头**。
  - 网关路径：`ws://127.0.0.1:<网关端口>/devtools/<socket>/<pageId>`，上游是 `ws://127.0.0.1:<portOf(socket)>/devtools/page/<pageId>`。socket 不存在时，用关闭码 4404 拒绝。
  - `inspectUrl(page: WebViewPage, gatewayPort: number): string`：把 `page.frontendUrl` 里的 `ws=` 参数替换成 `127.0.0.1:<网关端口>/devtools/<socket>/<id>`，其他部分保持不变。
  - 代码里留注释：第 3 阶段计划 Task 1 的口令和 Origin 校验要覆盖这个路径。

- [ ] **Step 1：写失败的测试。** 用一个假的上游 `ws` 服务器，它会记录收到的握手请求头。
  - “双向转发”：客户端发 `{"id":1}`，上游收到同样的内容；上游回 `{"id":1,"result":{}}`，客户端收到同样的内容。
  - “上游握手不带 Origin”：客户端带 `Origin: https://evil.example` 连接，上游收到的请求头里没有 `origin`。
  - “上游关闭 → 客户端关闭”，以及反过来。
  - “未知 socket → 4404”。
  - `inspectUrl` 把 `ws=127.0.0.1:9300/devtools/page/AB` 换成 `ws=127.0.0.1:7300/devtools/webview_devtools_remote_6642/AB`。
- [ ] **Step 2：** 运行 `pnpm test`，**预期**失败。
- [ ] **Step 3：** 实现。
- [ ] **Step 4：** 运行 `pnpm test`，**预期**通过。
- [ ] **Step 5：实测打开 DevTools 前端，这一步决定 Task 4 用哪条路。**
  - 打开测试 H5 之后，在一个独立的 Chrome 里打开 `inspectUrl(...)` 得到的地址。这个 Chrome 用独立的临时配置目录，调试端口在 9450–9460 之间，不要碰用户自己的 Chrome。
  - 检查三件事：DevTools 能连上；Elements 面板能看到 DOM；刷新 H5 后 Network 面板里有请求。截图存到工作区的 `shots/` 目录。
  - 托管前端连本机 WebSocket 时，可能遇到 Chrome 的本地网络权限框、混合内容拦截，或者前端版本不匹配。逐一记录现象，并在 ledger 里写一条 Ruling，选定以下其中一条路：
    - (a) 托管前端加网关代理，也就是这里的方案；
    - (b) 网关自己托管 DevTools 前端，前提是本机 Chrome 有可用的前端文件，否则不选；
    - (c) 降级为显示 `chrome://inspect` 的操作说明，按钮旁写明“在 chrome://inspect 里找：<包名> / <标题>”。
  - 三条都不行时，停下来找用户。
- [ ] **Step 6：** 提交：`feat(gateway): proxy WebView DevTools without the Origin header`。

### Task 3: 地址解析、adb reverse 和跳转

**Files:**
- Create: `shared/target-url.ts`、`shared/test/target-url.test.ts`、`gateway/src/reverse.ts`、`gateway/src/cdp.ts`、`gateway/test/reverse.test.ts`、`gateway/test/cdp.test.ts`

**Interfaces:**
- Produces（`shared/target-url.ts`）：`normalizeTarget(input: string): { url: string; reversePort?: number } | { error: string }`
  - 先去掉首尾空格；没写协议就补 `http://`；用 `URL` 解析。
  - 主机是 `localhost` 或 `127.0.0.1` 时，`reversePort` 取端口；没写端口时，http 用 80，https 用 443。
  - 解析失败时返回 `{error:"地址格式不对"}`。
- Produces（`gateway/src/reverse.ts`）：`createReverses(exec): { ensure(port: number): Promise<void>; removeAll(): Promise<void>; list(): number[] }`。`ensure` 对同一个端口只执行一次 `reverse tcp:<端口> tcp:<端口>`。`removeAll` 只移除这个网关建立的反向转发。
- Produces（`gateway/src/cdp.ts`）：
  - `connectCdp(wsUrl: string): Promise<{ send(method: string, params?: object): Promise<any>; on(event: string, cb: (params: any) => void): () => void; close(): void }>`
  - `navigateAndCheck(cdp, url: string, timeoutMs = 10000): Promise<{ ok: true; href: string; title: string; bridge: boolean } | { ok: false; error: string }>`。执行顺序：
    1. `Page.enable`；
    2. `Page.navigate({url})`：返回值里有 `errorText` 时，直接返回 `{ok:false, error: 映射后的中文}`；
    3. 等 `Page.loadEventFired`，超时就返回 `{ok:false,error:"页面加载超时"}`；
    4. 用 `Runtime.evaluate` 读 `location.href`、`document.title`、`typeof window._dsbridge === "object"`。
  - 错误映射：
    - `net::ERR_CLEARTEXT_NOT_PERMITTED` → “这个 App 禁止明文 http，请用 https 或 debug 包”；
    - `net::ERR_CONNECTION_REFUSED` → “连不上这个地址：本机开发服务器启动了吗？”；
    - `net::ERR_NAME_NOT_RESOLVED` → “域名解析失败”；
    - 其他错误原样显示。

- [ ] **Step 1：写失败的测试。**
  - `normalizeTarget("localhost:5173")` 深等于 `{url:"http://localhost:5173/",reversePort:5173}`。
  - `normalizeTarget(" 127.0.0.1:5173/a?b=1#c ")` 的 `reversePort` 是 5173，`url` 以 `/a?b=1#c` 结尾。
  - `normalizeTarget("http://localhost")` 的 `reversePort` 是 80。
  - `normalizeTarget("https://example.com/x")` 没有 `reversePort`。
  - `normalizeTarget("http://10.0.2.2:5173")` 没有 `reversePort`。
  - `normalizeTarget("::::")` 返回 `{error}`。
  - reverse：`ensure(5173)` 调用两次，只执行一次 `reverse`；`removeAll` 只移除自己建立的那些。
  - cdp：用一个假的 CDP 服务器（`ws`）。
    - “navigate 成功后返回 href、title、bridge=true”：假服务器在 `Runtime.evaluate` 时回 `_dsbridge` 为 object。
    - “errorText ERR_CLEARTEXT_NOT_PERMITTED 映射成中文提示”。
    - “loadEventFired 不来时 10s 超时”：测试里把超时传成 100ms。
- [ ] **Step 2：** 运行 `pnpm test`，**预期**失败。
- [ ] **Step 3：** 实现。
- [ ] **Step 4：** 运行 `pnpm test`，**预期**通过。
- [ ] **Step 5：** 提交：`feat(gateway): navigate a WebView to a local dev server`。

### Task 4: 协议、网关接线和退出清理

**Files:**
- Modify: `shared/protocol.ts`、`shared/test/protocol.test.ts`、`gateway/src/server.ts`、`gateway/src/main.ts`、`gateway/test/server.test.ts`

**Interfaces:**
- Protocol 新增消息，都带请求编号 `rid: number`，回复里原样带回：
  - 客户端 `{t:"webviews",rid}` → 服务端 `{t:"webviews",rid,list:WebViewPage[]}`；
  - 客户端 `{t:"inspect",rid,socket,id}` → 服务端 `{t:"inspect",rid,url}`，如果 Task 2 选了 (c) 路线，回 `{t:"inspect",rid,hint}`；
  - 客户端 `{t:"navigate",rid,socket,id,address}` → 服务端 `{t:"navigate",rid,ok,href?,title?,bridge?,error?}`。
  - `parseClientMsg` 要校验这几条新消息的字段类型。
- `main.ts` 的退出处理要调用 `webviews.close()` 和 `reverses.removeAll()`。

- [ ] **Step 1：写失败的测试，假会话之外再注入假的 webviews、reverses 和 cdp。**
  - “webviews 请求返回列表且 rid 对应”。
  - “navigate localhost:5173 → 先 ensure(5173) 再 navigate”。
  - “navigate 地址非法 → ok:false 且 error 为 地址格式不对，不调用 ensure”。
  - “页面已关闭（socket 不在列表里）→ ok:false error 页面已关闭”。
  - 协议测试：字段缺失或类型不对的新消息，`parseClientMsg` 返回 `null`。
- [ ] **Step 2：** 运行 `pnpm test`，**预期**失败。
- [ ] **Step 3：** 实现。
- [ ] **Step 4：** 运行 `pnpm test`，**预期**通过。再运行 `pnpm test:it`，**预期**通过。
- [ ] **Step 5：退出清理检查。** 启动网关，从页面触发一次 `navigate localhost:5174`，然后用 SIGTERM 结束网关。**预期**：`adb reverse --list` 和 `adb forward --list` 里都没有这个网关建立的项。
- [ ] **Step 6：** 提交：`feat(gateway): expose WebView listing, inspect and navigate`。

### Task 5: H5 调试面板和真机验收

**Files:**
- Modify: `host/src/main.ts`、`host/src/connection.ts`（加请求和回复的对应：按 `rid` 匹配，超时 15 秒）、`ui/App.tsx`

**Interfaces:**
- `host.call` 新增：
  - `emu.webviews()`：返回 `WebViewPage[]`；
  - `emu.inspect({socket,id})`：宿主模块用 `window.open(url, "_blank")` 打开 DevTools，或者把 `hint` 返回给 TSX 显示；
  - `emu.navigate({socket,id,address})`：返回跳转结果。
- 面板放在画面右侧，标题“H5 调试”：
  - 页面列表：每行显示标题、地址（太长时中间省略）、包名。不在前台的页面标“后台”并淡化显示。面板打开时每 3 秒刷新一次，也可以手动点“刷新”。
  - 每行一个“审查”按钮。
  - 地址栏：占位文字“localhost:5173/path”，右边一个“跳转”按钮，作用在当前选中的那一行。没选中时按钮禁用。
  - 结果行：
    - 成功：“已跳转：<标题> JSBridge：在 / 不在”；
    - 失败：显示网关给的中文原因。
  - 空列表时提示：“没有可审查的 H5。只有 debug 包或开启了 WebView 调试的 App 才能审查；先在 App 里打开一个 H5 页面。”
- 写界面前先按 UI 规范（交互状态、无障碍、文案）检查一遍。文案用上面写的中文。

- [ ] **Step 1：** 实现面板，并接好 `host.call`。运行 `pnpm build:ui && pnpm start`。
- [ ] **Step 2：真机验收。** 用独立的 Chrome（独立临时配置目录、调试端口 9450–9460、CDP 真实输入），截图存到 `shots/`：
  1. 打开测试 H5 后，3 秒内列表里出现它，排在第一行，并且不带“后台”标记；预加载的 `data:` 页面带“后台”标记。
  2. 点“审查”，按 Task 2 选定的路线打开 DevTools；刷新 H5 后，Network 面板里有请求。如果选的是 (c)，就核对提示文案。
  3. 在本机执行 `python3 -m http.server 5174 --bind 127.0.0.1`，放一个测试页面。地址栏输入 `localhost:5174`，点跳转。**预期**：显示“已跳转：<标题> JSBridge：在”，模拟器画面也变成测试页。
  4. 关掉本机服务器，再跳一次。**预期**：显示“连不上这个地址：本机开发服务器启动了吗？”。
  5. 在 App 里按返回键退出 H5。**预期**：3 秒内列表更新。
  6. 用 Ctrl+C 结束网关。**预期**：`adb reverse --list` 和 `adb forward --list` 都清理干净。
- [ ] **Step 3：** 提交：`feat(ui): debug in-app H5 pages from the web emulator`。
