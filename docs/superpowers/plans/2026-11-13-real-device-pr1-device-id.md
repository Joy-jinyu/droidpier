# 真机支持 PR 1（设备 id 改为字符串）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 网关内部用 adb 序列号字符串（设备 id）标识设备，不再到处拼 `emulator-${serial}`，为后续接入真机打底；模拟器的行为一点不变。

**Architecture:**
- `adb.ts` 的 `device` / `long` 改收设备 id，不再加前缀；新增唯一的拼接点 `emulatorId(serial)`。
- `EmulatorSession` 增加 `id: string`；`server.ts` 里 H5 调试、重启、文件这几处按 id 认设备，日志用 id。
- 协议只加不改：`ready` 新增可选字段 `deviceId`，`serial` 原样保留，`PROTOCOL_VERSION` 不动。

**Tech Stack:** 不新增依赖。Node 22 直接跑 TS（只用可擦除语法），`node:test`。

**Spec:** `docs/superpowers/specs/2026-11-13-real-device-design.md`，第 6.1、6.2（adb 部分）、6.4、7 节的 PR 1

**前置：**
- 写代码前已和作者对齐 spec 第 8 节第 1、2 条。
- 开工前 `git fetch origin && git rebase origin/main`：仓库更新很快，下面的行号以 `8d4a84c` 为准，以符号名为准找位置。

## Global Constraints

- 注释、日志、界面文案用中文；只用可擦除的 TS 语法（不用 `enum`、`namespace`、参数属性）；`gateway/`、`shared/` 的 import 写 `.ts` 后缀。
- 不新增依赖。
- 协议只加不改：`ready.serial` 保留且仍是模拟器控制台端口；新增字段都是可选的；`PROTOCOL_VERSION` 保持 `1`。
- 模拟器行为不变：所有 adb 命令行和现在逐字节相同（仍是 `-s emulator-5554 …`），日志文字里的 `emulator-5554` 照旧出现。
- 只有模拟器才有的东西继续用数字端口：`Discovery.serial`、`AvdInfo.serial`、`StartJob.serial`、`stopAvd(serial)`、`avd.ts` 的解析。这些不在本 PR 改。
- 提交信息：`gateway: <英文祈使句>`，正文说明原因，72 列换行。
- 本 PR 不改 `host/`、`ui/`。

## Review Focus

1. **改漏的调用点**：仓库没有类型检查，数字传给改成 `string` 参数的函数不会报错，只会拼出 `-s 5554` 这种错误命令。→ Task 1、Task 2 各有一步 `rg` 检查，并在 `adb.test.ts` 里断言命令行逐字节不变。
2. **切换设备时 H5 调试状态没有清掉**：`dropDebug` 原来按数字比较，改成 id 后，两台不同模拟器的 id 不同才会清。→ Task 2 改现有的切换设备测试，让两台假会话的 id 不同，并断言旧设备被清、新设备按新 id 列页面。
3. **重启中的判断**：`isRebooting` 改按 id 比较后，同一个端口换了另一台 AVD 的情况不能误判。→ 沿用现有的重启测试，断言消息不变即可，不新增。
4. **旧页面收到带 `deviceId` 的 `ready`**：页面按字段名取值，多一个字段不受影响。→ Task 3 用公开页面连本地网关手动确认。
5. **WebView 集成测试写死 `5554`**：`webviews.it.test.ts` 调 `makeAdbExec(SERIAL)`，改签名后要传字符串。→ Task 2 一并改，并跑一次 `EMU_IT`。

---

### Task 1: adb 按设备 id 调用

**Files:**
- Modify: `gateway/src/adb.ts`（`createAdb` 返回的 `device`、`long`，新增 `emulatorId`）
- Modify: `gateway/src/lifecycle.ts:204`、`gateway/src/lifecycle.ts:243`（改用 `emulatorId`）
- Modify: `gateway/src/emulator.ts:257`（`adb.device(emulatorId(running.serial))`）
- Modify: `gateway/src/webviews.ts:295-297`（`makeAdbExec(id: string)`）
- Modify: `gateway/src/main.ts:143`、`:157`、`:160`（暂时传 `emulatorId(serial)`，Task 2 再换成会话的 id）
- Test: `gateway/test/adb.test.ts`

**Interfaces:**
- Produces:
  - `export function emulatorId(serial: number): string`，返回 `` `emulator-${serial}` ``，是网关里唯一拼这个前缀的地方。
  - `adb.device(id: string): (args: string[]) => Promise<string>`，执行 `adb -s <id> …`，按 id 排队。
  - `adb.long(id: string): (args: string[], timeoutMs: number) => Promise<string>`，队列键 `` `long:${id}` ``。
  - `makeAdbExec(id: string)`，等于 `adb.device(id)`。

- [ ] **Step 1: 改测试**

  `adb.test.ts` 里所有 `adb.device(5554)` / `adb.long(5554)` 改成 `adb.device("emulator-5554")` / `adb.long("emulator-5554")`（5556 同理），已有断言里的命令行字符串一个字都不改。再加两个测试：

  ```ts
  test("设备 id 原样放进 -s，不加前缀（真机序列号）", async () => {
    const calls: string[] = [];
    const adb = createAdb({ exec: async (args) => (calls.push(args.join(" ")), "") });
    await adb.device("R5CR10WN52H")(["shell", "true"]);
    await adb.long("192.168.1.5:5555")(["install", "x.apk"], 600_000);
    assert.deepEqual(calls, ["-s R5CR10WN52H shell true", "-s 192.168.1.5:5555 install x.apk"]);
  });

  test("emulatorId 拼出模拟器在 adb 里的名字", () => {
    assert.equal(emulatorId(5554), "emulator-5554");
  });
  ```

- [ ] **Step 2: 跑测试，确认失败**

  Run: `node --test gateway/test/adb.test.ts`
  Expected: FAIL。新测试拿到的是 `-s emulator-R5CR10WN52H …`，且 `emulatorId` 没有导出。

- [ ] **Step 3: 实现**

  按 Interfaces 改 `adb.ts`；doc 注释同步改成「参数是 `adb -s <设备 id>` 之后的部分」。`lifecycle.ts` 的两处 `` `emulator-${…}` ``、`emulator.ts:257`、`webviews.ts` 的 `makeAdbExec` 和 `main.ts` 的三处调用改为经 `emulatorId`。`reverse.ts:2` 的注释改成 `adb -s <设备 id>`。

- [ ] **Step 4: 跑全部单测**

  Run: `npm test`
  Expected: 全部 PASS（`*.it.test.ts` 自动跳过）。

- [ ] **Step 5: 检查没有改漏的调用点**

  Run: `rg -n 'emulator-\$\{' gateway/src`
  Expected: 只剩 `adb.ts` 里 `emulatorId` 的一处，以及只出现在日志字符串里的地方（`discovery.ts:114`、`server.ts` 的日志、`main.ts` 的日志）。

  Run: `rg -n '\.(device|long)\(' gateway/src`
  Expected: 每个调用传的都是 `emulatorId(...)` 或类型为 `string` 的变量。

- [ ] **Step 6: 提交**

  ```bash
  git add gateway/src/adb.ts gateway/src/lifecycle.ts gateway/src/emulator.ts gateway/src/webviews.ts gateway/src/main.ts gateway/src/reverse.ts gateway/test/adb.test.ts
  git commit -m "gateway: Address adb devices by their serial string"
  ```

### Task 2: 会话带设备 id，服务端按 id 认设备

**Files:**
- Modify: `gateway/src/emulator.ts`（`EmulatorSession` 加 `id`；`connectEmulator` 里填 `emulatorId(running.serial)`）
- Modify: `gateway/src/server.ts`：`DebugDeps.forDevice`（:102）、`FileOps.adb`（:114）、`rebootWait`（:140）、`Debug`（:158）、`dropDebug`（:161）、`debugFor`（:176）、`rebooting` / `isRebooting`（:268-269）、`switchTo`（:281）、`watch`（:299）、`ready`（:499）、`:516`、`:524`、上传（:705-717）、重启（:737-753）、日志（:661、:738、:753）、截图名（:928）
- Modify: `gateway/src/main.ts`（`rebootWait`、`files.adb`、`debug.forDevice` 改收 id；Task 1 里临时的 `emulatorId(serial)` 去掉）
- Modify: `gateway/src/webviews.ts`（`WebViewsDeps` 去掉没用到的 `serial` 字段）
- Modify: `shared/protocol.ts:247-248`（`ready` 加可选 `deviceId`）
- Test: `gateway/test/server.test.ts`、`gateway/test/webviews.test.ts`、`gateway/test/webviews.it.test.ts`、`gateway/test/session-cache.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `emulatorId`、`adb.device(id)`、`adb.long(id)`、`makeAdbExec(id)`。
- Produces:
  - `EmulatorSession.id: string`：设备 id，模拟器是 `emulator-<serial>`。`serial` 保留，含义不变。
  - `DebugDeps.forDevice(id: string): DeviceDebug`
  - `FileOps.adb(id: string, args: string[]): Promise<string>`
  - `ServerOpts.rebootWait?: (id: string) => Promise<"done" | "adb-down">`
  - `ServerMsg` 的 `ready`：`{ t: "ready"; version: number; device: …; serial: number; deviceId?: string }`。注释写明：`deviceId` 是 adb 里的设备名，旧网关不发；`serial` 是模拟器控制台端口。
  - `AvdOps.stop(serial: number)` **不变**（只有模拟器能关）。

- [ ] **Step 1: 改测试**

  - `FakeSession` 加 `id = "emulator-5554"`；`session-cache.test.ts` 的假会话同样加 `id`。
  - `server.test.ts` 里 5 处断言 `ready` 的地方（:252、:399、:404、:553、:572）在对象里加 `deviceId: "emulator-5554"`。
  - 假 `forDevice`（:845 附近）的参数名改成 `id`，`calls` 里记录的 `list` / `close` / `removeAll` 后面跟 id；
    断言 `"close 5554"`、`"removeAll 5554"` 的四处（:1047、:1058、:1066、:1566）改为 `"close emulator-5554"`、
    `"removeAll emulator-5554"`。:935、:1472 两处包装的参数类型改成 `(id: string)`。
  - 现有测试「切换到另一台设备：旧设备的转发和 reverse 被移除」（:1038）对应 Review Focus 第 2 条：
    在 `b.serial = 5556` 后面加 `b.id = "emulator-5556"`，结尾断言改为 `f.calls.includes("list emulator-5556")`。
    只改 serial 不改 id 时两台会话 id 相同，旧设备不会被清，这个测试会失败——这正是要锁住的行为。
  - 上传测试（:1649 附近）里断言 `files.adb` 收到的第一个参数是 `"emulator-5554"`。
  - `webviews.test.ts` 去掉传给 `createWebViews` 的 `serial`；`webviews.it.test.ts` 改成 `makeAdbExec(emulatorId(SERIAL))`。

- [ ] **Step 2: 跑测试，确认失败**

  Run: `node --test gateway/test/server.test.ts`
  Expected: FAIL。`ready` 少了 `deviceId`，`forDevice` 收到的是数字 `5554`。

- [ ] **Step 3: 实现**

  按 Interfaces 改。`server.ts` 里的 `Debug`、`rebooting` 字段名从 `serial` 改为 `id`，比较都用 `s.id`；日志里原来的 `` `emulator-${s.serial}` `` 改成 `s.id`（输出文字不变）；截图名回退值改成 `s.id`。`main.ts` 的 `serial` 变量只留给启动时那行打印。

- [ ] **Step 4: 跑全部单测**

  Run: `npm test`
  Expected: 全部 PASS。

- [ ] **Step 5: 检查没有改漏的调用点**

  Run: `rg -n 'serial' gateway/src/server.ts gateway/src/main.ts gateway/src/webviews.ts`
  Expected: 只剩 `ready` 消息里的 `serial: s.serial`、`AvdOps.stop(serial)` 及其调用 `opts.avd.stop(conn.session.serial)`、`main.ts` 里启动打印用的变量、`webviews.ts` 中 `adb forward --list` 格式说明的注释。

- [ ] **Step 6: 模拟器集成测试**

  先启动一台 arm64 AVD（不要停掉用户正在跑的 droidpier），然后：
  Run: `npm run test:it`
  Run: `EMU_IT=1 node --test gateway/test/webviews.it.test.ts`
  Expected: 都 PASS。

- [ ] **Step 7: 提交**

  ```bash
  git add gateway/src/emulator.ts gateway/src/server.ts gateway/src/main.ts gateway/src/webviews.ts shared/protocol.ts gateway/test/server.test.ts gateway/test/webviews.test.ts gateway/test/webviews.it.test.ts gateway/test/session-cache.test.ts
  git commit -m "gateway: Track the current device by its adb serial"
  ```

### Task 3: 术语与手动验收

**Files:**
- Modify: `CONTEXT.md`（新增「Device id」词条；`Serial` 词条补一句「设备身份用 Device id，Serial 只用于模拟器控制台」）

**Interfaces:**
- Consumes: Task 1、2 的全部改动。

- [ ] **Step 1: 更新 CONTEXT.md**

  在 Devices 下新增：

  ```markdown
  **Device id**:
  The name adb gives a device and the gateway's key for it: `emulator-5554` for an emulator, the USB serial
  (`R5CR10WN52H`) or `host:port` for a phone. Sent to the page as `ready.deviceId`.
  _Avoid_: serial (that is the emulator's console port), udid
  ```

  `Serial` 词条末尾加：`Only emulators have one; anything that must also work for a phone uses the Device id.`

- [ ] **Step 2: 手动验收（模拟器）**

  Run: `node gateway/src/main.ts --port 7306 --no-open`，Chrome 打开 `http://127.0.0.1:7306/app/` 和公开页面 `https://droid.devpier.dev/app/#port=7306` 各一次。
  Expected: 两个页面都能连上；画面、点击、打字中文、截图正常；H5 调试能列出页面并打开 DevTools；重启模拟器后能恢复；终端日志里设备名仍显示 `emulator-5554`。

- [ ] **Step 3: 提交并开 PR**

  ```bash
  git add CONTEXT.md
  git commit -m "docs: Name the device id the gateway keys devices by"
  ```

  PR 标题 `gateway: Key devices by their adb serial`。正文说明这是真机支持的第一步、模拟器行为不变，并按 `CONTRIBUTING.md` 写：

  ```markdown
  ## Protocol
  - `ready` gains an optional `deviceId` (the adb device name). `serial` is unchanged.
  - `PROTOCOL_VERSION` stays 1: older pages ignore the new field.
  ```

## 后续

PR 2–6 的计划在 PR 1 合入、和作者对齐后再分别写，各自一份：
`2026-11-xx-real-device-pr2-device-list.md`、`…-pr3-video.md`、`…-pr4-input.md`、`…-pr5-logcat.md`、`…-pr6-webmcp-docs.md`。
