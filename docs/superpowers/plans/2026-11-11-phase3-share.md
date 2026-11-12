# android-emu-web 第 3 阶段（分发给其他用户）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 其他开发者在自己的 Apple Silicon Mac 上运行一条命令装好网关，打开公网 https 页面就能用自己的模拟器。缺 SDK 或系统镜像时，按提示经本人同意后安装；网关有口令和来源校验，别的网页不能操控它。

**Architecture:**
- 网关加三样东西：口令和 Origin 白名单、协议版本握手、首次运行的环境检查。
- 网关和保底页面用 `bun build --compile` 打成一个可执行文件。
- 公网页面是同一份 nsh 打包产物，部署到用户自购域名下的 Cloudflare Pages。宿主模块从网址 `#` 后面读端口和口令，用 `targetAddressSpace:"loopback"` 连本机网关，并能识别“本地网络权限被拒”和“浏览器不支持”这两种情况。

**Tech Stack:** 同前两阶段，再加 `bun build --compile`、Android `sdkmanager` / `avdmanager`、Cloudflare Pages。

**Spec:** `docs/superpowers/specs/2026-11-11-android-emu-web-design.md`

**前置：** 第 1、2 阶段的计划都已完成。`ClientMsg` 里的 `hello` 消息新增必填字段 `token`，由于还没有对外发布，`PROTOCOL_VERSION` 仍然是 1。

## Global Constraints

- 前两阶段的 Global Constraints 全部沿用。
- 只支持 Chrome 和 Edge。用其他浏览器打开时，显示“请用 Chrome 或 Edge 打开”，不尝试连接。
- 公网页面使用独立购买的域名，整个域名只放这个页面。域名在 Cloudflare Registrar 购买，页面托管在 Cloudflare Pages。域名已购买：`devpier.dev`（Cloudflare）。公网页面地址定为 `https://droid.devpier.dev`（用户指定），也就是 `PUBLIC_ORIGIN` 的值。Task 6 之前代码里先用 `null` 占位。
- 口令放在网址 `#` 后面：`https://droid.devpier.dev/app/#port=<端口>&token=<口令>`（网页模拟器放在 `/app/` 路径下，根路径是官网首页，和官网计划 `2026-11-11-site.md` 保持一致），绝不放进 query 参数。
- 口令每次启动网关都重新生成：32 字节随机数，编码成 base64url。
- Origin 白名单：
  - `PUBLIC_ORIGIN`；
  - `http://127.0.0.1:<网关端口>`；
  - `http://localhost:<网关端口>`。
- 公网页面最终连不上本机网关时（权限框和 CSP 都解决不了），改用 localhost 页面作为主入口，公网页面只放说明和下载入口（用户决定）。不做本机 wss 证书。
- 安装 SDK 组件、创建 AVD、上传或部署任何东西，都**必须先得到用户本人的明确同意**。安装和创建由用户在网页上点按钮并在确认框里确认后才执行；许可证由用户本人在页面上点“同意”。
- 第一版只做 darwin-arm64。和平台相关的部分全部放在 `platform.ts`。

## Review Focus

1. **用户在 Chrome 的“访问本地网络”权限框里点了拒绝**：页面要能识别出来，并显示怎么改回来（Chrome 设置 → 隐私和安全 → 网站设置），不能一直显示“连接中”。对应 Task 3 的测试和 Task 6 的实测。
2. **网关重启后口令变了，页面还用着旧口令**：显示“口令已失效，请重新运行网关打开的链接”，不能无限重连。对应 Task 1、Task 3 的测试。
3. **公网页面已经更新，用户本机的网关还是旧版本**：页面提示升级，并给出升级命令；页面比网关旧时也要能正常提示。对应 Task 2 的测试。
4. **用户的机器上只有 Android Studio 自带的 SDK，但没有 `cmdline-tools`（也就没有 sdkmanager）**：页面要说明缺什么，并提供经确认后自动下载（校验 sha1）的选项，不能报一句看不懂的错误。对应 Task 4 的测试。
5. **别的网站的页面尝试连 `ws://127.0.0.1:7300`**：网关因为 Origin 不对而拒绝，关闭码 4003；就算猜到了端口，没有口令也连不上。对应 Task 1 的测试。

---

### Task 1: 口令和 Origin 校验

**Files:**
- Create: `gateway/src/auth.ts`、`gateway/test/auth.test.ts`
- Modify: `gateway/src/server.ts`、`gateway/src/main.ts`、`shared/protocol.ts`

**Interfaces:**
- Produces：
  - `newToken(): string`：生成 43 个字符的 base64url 字符串。
  - `allowedOrigins(publicOrigin: string | null, port: number): string[]`
  - `checkUpgrade(origin: string | undefined, allowed: string[]): boolean`：`origin` 为空时返回 false，因为浏览器一定会带 Origin。
  - `startServer` 的选项增加 `token: string` 和 `allowedOrigins: string[]`：
    - WebSocket 升级时 Origin 不在白名单里，就拒绝并关闭，关闭码 4003；
    - `hello.token` 不对，关闭码 4001，并在关闭前先发 `{t:"error",code:"bad-token"}`。
  - `main.ts` 启动时生成口令，打印并自动打开 `<入口>/app/#port=<端口>&token=<口令>`，用 macOS 的 `open` 命令。
    - 入口在 `PUBLIC_ORIGIN` 为 `null` 时是 `http://127.0.0.1:<端口>`。
    - `--no-open` 参数不自动打开浏览器。

- [ ] **Step 1：写失败的测试。**
  - `newToken()` 长度是 43，并且符合 `/^[A-Za-z0-9_-]+$/`；连续生成 1000 个，没有重复。
  - `checkUpgrade("https://evil.example", allowedOrigins("https://emu.example.dev",7300))` 是 false。
  - `checkUpgrade("http://127.0.0.1:7300", …)` 是 true。
  - `checkUpgrade(undefined, …)` 是 false。
  - server 测试：“Origin 不在白名单 → 4003”；“token 错 → 先收到 bad-token 再 4001 关闭”；“token 对 → ready”。
- [ ] **Step 2：** 运行 `pnpm test`，**预期**失败。
- [ ] **Step 3：** 实现。
- [ ] **Step 4：** 运行 `pnpm test`，**预期**通过。
- [ ] **Step 5：** 提交：`feat(gateway): require a launch token and allowed origins`。

### Task 2: 协议版本握手

**Files:**
- Modify: `shared/protocol.ts`、`shared/test/protocol.test.ts`、`gateway/src/server.ts`、`host/src/connection.ts`

**Interfaces:**
- Produces：`compatibility(client: number, gateway: number): "ok" | "gateway-outdated" | "page-outdated"`。版本号相等返回 `ok`，页面版本更高返回 `gateway-outdated`，网关版本更高返回 `page-outdated`。
- 网关处理 `hello` 时：
  - 不是 `ok`：先发 `{t:"error",code:<结果>,gatewayVersion,upgrade:"curl -fsSL <安装脚本地址> | sh"}`，再以 4002 关闭；
  - 安装脚本地址在 Task 5 确定，在那之前用常量 `INSTALL_CMD` 占位。
- 宿主模块收到这两种错误时停止重连，通过 `hostEvent("emu.status",{state:"gateway-outdated"|"page-outdated", upgrade})` 通知 TSX 显示对应提示：
  - 网关太旧：“网关版本过旧，请运行：<命令>”；
  - 页面太旧：“页面版本过旧，请强制刷新”。

- [ ] **Step 1：写失败的测试。**
  - `compatibility(1,1)` 是 `"ok"`；`compatibility(2,1)` 是 `"gateway-outdated"`；`compatibility(1,2)` 是 `"page-outdated"`。
  - server 测试：“hello version=2 → 收到 error gateway-outdated 且含 upgrade 字段，4002 关闭”。
- [ ] **Step 2：** 运行 `pnpm test`，**预期**失败。
- [ ] **Step 3：** 实现。
- [ ] **Step 4：** 运行 `pnpm test`，**预期**通过。
- [ ] **Step 5：** 提交：`feat(shared): negotiate protocol version on connect`。

### Task 3: 宿主模块：读口令、本地网络权限、浏览器检查

**Files:**
- Create: `host/src/launch.ts`、`shared/test/launch.test.ts`（纯函数，用 node 测）
- Modify: `host/src/connection.ts`、`host/src/main.ts`、`ui/App.tsx`

**Interfaces:**
- Produces：
  - `parseLaunchHash(hash: string): {port:number, token:string} | null`：解析 `#port=7300&token=abc`，缺任意一个字段就返回 `null`。
  - `isSupportedBrowser(brands: {brand:string}[] | undefined): boolean`：品牌里包含 `Google Chrome` 或 `Microsoft Edge` 时返回 true；`undefined` 返回 false，因为 Safari 和 Firefox 没有 `userAgentData`。
  - `classifyFailure(input: {opened:boolean, closeCode?:number, pageIsPublic:boolean, attempts:number}): "lna-denied" | "bad-token" | "outdated" | "no-gateway" | "retry"`。规则：
    - `closeCode` 为 4001 → `bad-token`；
    - `closeCode` 为 4002 → `outdated`；
    - 没有成功连上过（`!opened`）、页面是公网页面、并且已经连续失败至少 3 次 → `lna-denied`；
    - 没有成功连上过、并且是 localhost 页面 → `no-gateway`；
    - 其他情况 → `retry`。
  - 连接流程：
    - 先从 `location.hash` 读端口和口令，成功就存进 `localStorage`（读写都要 try/catch），然后用 `history.replaceState` 把 `#` 部分从地址栏去掉；
    - `hash` 里没有，就从 `localStorage` 读；还是没有，状态设为 `need-launch`。
  - 创建 WebSocket：`new WebSocket(url, {targetAddressSpace:"loopback"})`。这个构造参数在不支持的版本上会抛异常，抛了就退回不带参数的写法。
  - TSX 文案：
    - `need-launch`：“请先在终端运行网关（安装命令见下方）”；
    - `lna-denied`：“Chrome 阻止了访问本机：请到 设置 → 隐私和安全 → 网站设置 中允许本站访问本地网络，然后刷新”；
    - `bad-token`：“口令已失效，请重新运行网关打开的链接”；
    - `no-gateway`：“没有连上本机网关，请确认它在运行”；
    - `unsupported-browser`：“请用 Chrome 或 Edge 打开”。

- [ ] **Step 1：写失败的测试。**
  - `parseLaunchHash("#port=7300&token=abc")` 深等于 `{port:7300,token:"abc"}`。
  - `parseLaunchHash("#port=7300")` 是 `null`。
  - `parseLaunchHash("")` 是 `null`。
  - `isSupportedBrowser([{brand:"Google Chrome"}])` 是 true；`isSupportedBrowser([{brand:"Chromium"}])` 是 false；`isSupportedBrowser(undefined)` 是 false。
  - `classifyFailure({opened:false,pageIsPublic:true,attempts:3})` 是 `"lna-denied"`；同样的输入但 `attempts:1`，结果是 `"retry"`。
  - `classifyFailure({opened:true,closeCode:4001,pageIsPublic:true,attempts:1})` 是 `"bad-token"`。
- [ ] **Step 2：** 运行 `pnpm test`，**预期**失败。
- [ ] **Step 3：** 实现，并接入宿主模块和 TSX。
- [ ] **Step 4：** 运行 `pnpm test`，**预期**通过。
- [ ] **Step 5：localhost 保底页面的检查。**
  - 用网关自动打开的地址访问，**预期**：能连上，地址栏里的 `#` 部分被去掉。
  - 刷新页面，**预期**：仍然能连上，因为口令已存进 `localStorage`。
  - 重启网关后刷新，**预期**：显示“口令已失效”。
- [ ] **Step 6：** 提交：`feat(host): read the launch token and explain connection failures`。

### Task 4: 首次运行的环境检查和网页安装引导（用户 2026-11-11 决定做到网页上）

**Files:**
- Create: `gateway/src/setup.ts`、`gateway/test/setup.test.ts`、`gateway/src/installer.ts`、`gateway/test/installer.test.ts`
- Modify:
  - `gateway/src/platform.ts`：增加 `sdkmanagerBin()`、`avdmanagerBin()`（路径是 `cmdline-tools/latest/bin/`），以及 `cmdlineToolsManifestUrl()`；
  - `gateway/src/server.ts`、`gateway/src/main.ts`、`shared/protocol.ts`；
  - `host/src/main.ts`、`ui/App.tsx`。

**Interfaces:**
- Produces（`setup.ts`）：
  - `checkEnv(deps): Promise<{ ok: boolean; missing: Array<{ id: "sdk"|"cmdline-tools"|"emulator"|"platform-tools"|"system-image"|"avd"; detail: string; sizeMb?: number; command?: string; auto: boolean }> }>`
    - 系统镜像固定为 `system-images;android-34;google_apis;arm64-v8a`。
    - 缺失项按这个顺序排列：sdk → cmdline-tools → emulator → platform-tools → system-image → avd。
    - 每项的 `auto` 表示能否由网关自动完成。所有项都可以自动完成，前提是用户在页面上确认过。
    - `command` 是对应的手动命令，`sizeMb` 是大致大小：emulator 约 400、platform-tools 约 15、系统镜像约 1500、cmdline-tools 约 150。
- Produces（`installer.ts`）：`createInstaller(deps): { run(ids: string[], onProgress: (p: {id: string; phase: "download"|"unpack"|"license"|"install"|"done"|"failed"; pct?: number; logTail: string}) => void): Promise<void>; acceptLicenses(): void }`
  - cmdline-tools：先下载 `cmdlineToolsManifestUrl()` 指向的 Google 官方仓库清单（`repository2-3.xml`，Task 实现时先读官方文档确认地址），从中找出 macOS 版命令行工具的 zip 地址和 sha1。下载后校验 sha1，再解压到 `<sdk>/cmdline-tools/latest/`。sha1 对不上就失败，不解压。
  - sdkmanager 安装包：运行 `sdkmanager --install <包名>`，解析输出里的百分比作为进度。
  - 许可证：执行 `sdkmanager --licenses` 时，把许可证正文推给页面，阶段设为 `license`。只有页面上的用户点了“同意”（调用 `acceptLicenses()`）之后，才往 stdin 写 `y`。用户不同意，这一项就失败。
  - 创建 AVD：`avdmanager create avd -n emu_web_default -k "<系统镜像>" -d pixel_5`，然后把 `config.ini` 里的 `hw.ramSize` 改成 4096。
- Protocol：
  - 服务端 `{t:"env",ok,missing}`：连接 `ready` 前后都发；
  - 客户端 `{t:"install",ids}`；
  - 服务端 `{t:"install",progress}`，每次进度更新都发；
  - 服务端 `{t:"licenses",text}`；
  - 客户端 `{t:"acceptLicenses"}`。
- 页面（TSX）：
  - 有缺失项时，在画面区域显示“环境检查”卡片：逐项列出名称、缺什么、大小和手动命令（可复制），每项旁边有“安装”按钮，另外有一个“全部安装”。
  - 点击后先弹确认框，写明要下载哪些、总大小、装到哪个目录，用户确认后才发 `install`。
  - 安装过程中显示每项的阶段、百分比和最后几行日志。
  - 到许可证阶段时，显示许可证全文，配“同意”和“不同意”两个按钮。
  - 设备列表为空时，提示“本机还没有模拟器设备”，并放一个“创建默认设备”按钮，走同一条安装流程，确认框里写明设备名、内存和分辨率。
- 终端：`main.ts` 启动时运行 `checkEnv`。有缺失就打印一行“打开页面完成安装：<地址>”，再逐项打印手动命令。终端里不提问。

- [ ] **Step 1：写失败的测试，用假的文件系统、`exec`、`fetch` 和子进程。**
  - `checkEnv`：
    - 什么都没有时，`missing` 的第一项是 `sdk`；
    - 缺系统镜像时，`command` 是 `sdkmanager "system-images;android-34;google_apis;arm64-v8a"`，`sizeMb` 是 1500；
    - 齐全时，`ok` 为 true，`missing` 为空数组。
  - `installer`：
    - “sha1 不符 → failed 且没有解压”；
    - “未调用 acceptLicenses 时不向 stdin 写 y，阶段停在 license”；
    - “调用 acceptLicenses 后写 y 并继续”；
    - “sdkmanager 输出 `[====    ] 45%` 时进度 pct 为 45”；
    - “创建 AVD 后 config.ini 的 hw.ramSize 为 4096”。
  - server：“未确认（没收到 install）时不会执行任何安装”。
- [ ] **Step 2：** 运行 `pnpm test`，**预期**失败。
- [ ] **Step 3：** 实现 `setup.ts`、`installer.ts`、协议和页面。动手写界面前先按 UI 规范（交互状态、无障碍、文案）检查一遍。
- [ ] **Step 4：** 运行 `pnpm test`，**预期**通过。再在本机运行 `pnpm start`，**预期**：环境齐全，页面上不显示环境检查卡片。
- [ ] **Step 5：在干净环境里验证。** 用一个临时的 `ANDROID_HOME`（空目录）和一个临时的 `ANDROID_AVD_HOME` 启动网关。**预期**：页面列出全部缺失项。
  - 点击“全部安装”前要先问用户：这会下载约 2GB 的内容。用户同意后再执行。
  - 走完 cmdline-tools、许可证、模拟器程序、系统镜像、默认设备这一整套流程。**预期**：能启动这台新设备并看到画面。
  - 结束后删除临时目录。
- [ ] **Step 6：** 提交：`feat(gateway): guide first-run setup from the page`。

### Task 5: 打包成单个可执行文件和安装脚本

**Files:**
- Create: `scripts/build-binary.ts`、`scripts/install.sh`
- Modify:
  - `package.json`：加 `"build:bin": "pnpm build:ui && bun scripts/build-binary.ts"`；
  - `gateway/src/server.ts`：静态文件改成从嵌入的资源里读。

**Interfaces:**
- Produces：
  - 产物 `dist/android-emu-web-darwin-arm64`。用 `bun build gateway/src/main.ts --compile --target bun-darwin-arm64`，并把 nsh 打包产物整个目录作为嵌入文件。嵌入方式以 bun 当前文档为准，**先读文档再动手**。
  - `scripts/install.sh`：下载上面这个文件，放到 `~/.local/bin/android-emu-web`，加上可执行权限，打印“运行 android-emu-web 启动”。
  - **下载地址需要用户决定**：放在 Cloudflare Pages 的同一个域名下，还是放到 GitHub Release。在用户回答之前，这一步先停下。
  - 依赖清理：`sharp` 只有第 0 阶段的试验代码用到。从生产依赖里移除之前，先用 `rg "sharp" gateway host shared` 确认结果为 0；然后把它挪到 `devDependencies`，或者把 spike 单独处理。

- [ ] **Step 1：兼容性检查。** 运行 `bun build … --compile` 之后执行 `./dist/android-emu-web-darwin-arm64 --no-open`。**预期**：能连上模拟器，页面可用。要特别确认 `@grpc/grpc-js` 和 `@grpc/proto-loader` 在 bun 打包后的可执行文件里能正常工作。如果不能，停下来记录现象，并评估两个替代方案：改用 Node 的 SEA，或者在 bun 里换一个 gRPC 客户端。这个结论**要找用户确认**，不自行换方案。
- [ ] **Step 2：** 写 `install.sh`。用一个临时的 `HOME` 跑一遍，**预期**：文件装好，可以运行。
- [ ] **Step 3：** 检查文件大小和启动时间，记录下来。**预期**：启动到打印出地址不超过 2 秒。
- [ ] **Step 4：** 提交：`build: package the gateway as a single binary`。

### Task 6: 公网页面上线和 Chrome 本地网络权限实测（需要用户）

**Files:**
- Modify: `gateway/src/auth.ts` 里的 `PUBLIC_ORIGIN` 常量、`ui/nsh.json`（如果需要）
- Create: `docs/deploy.md`，写清部署步骤

- [ ] **Step 1（用户）：** 确认已买好的域名，以及 Cloudflare 账号的访问方式。部署和上传都要用户明确同意。
- [ ] **Step 2：** 把 `PUBLIC_ORIGIN` 设成 `https://<域名>`，运行 `pnpm build:ui`。然后用用户同意的方式部署到 Cloudflare Pages：`wrangler pages deploy "<打包产物目录>"`，或者在 Cloudflare 控制台上传。
- [ ] **Step 3：在一个干净的 Chrome 配置里实测，逐项记录：**
  - 打开网关给出的 `https://droid.devpier.dev/app/#port=…&token=…`，**预期**：弹出“访问本地网络”的权限框。
  - 点“允许”，**预期**：画面出现，可以操作。
  - 换一个干净配置，这次点“拒绝”，**预期**：页面显示 `lna-denied` 的提示文案。
  - 在 DevTools 里确认没有 CSP 报错，`targetAddressSpace` 也没有导致异常。
- [ ] **Step 4：** 如果 Step 3 证明公网页面连不上本机网关，按用户之前的决定处理：把 `PUBLIC_ORIGIN` 设为 `null`，localhost 页面成为主入口，公网页面只放说明和下载入口。改完向用户汇报。
- [ ] **Step 5：** 提交：`feat(ui): publish the page on its own domain`。

### Task 7: 从零开始的整体验证（需要用户）

- [ ] **Step 1（用户）：** 准备一台没装过 Android Studio 的 Apple Silicon Mac，或者在本机新建一个 macOS 用户账号。
- [ ] **Step 2：** 在那台机器或账号上，按 `docs/deploy.md` 里写给其他用户的说明从头走一遍：运行安装命令 → 运行网关 → 根据提示补装 SDK（cmdline-tools 需要手动下载）→ 创建默认 AVD → 打开公网页面 → 能看到画面并操作。记录每一步的耗时和卡住的地方。
- [ ] **Step 3：** 卡住的地方都改进对应的提示文案或文档，然后再走一遍，直到能顺利走通。
- [ ] **Step 4：** 提交：`docs: write the user setup guide`。
