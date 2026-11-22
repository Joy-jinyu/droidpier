import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import WebSocket, { WebSocketServer } from "ws";
import { startServer, type AvdOps, type DebugDeps, type SetupOps } from "../src/server.ts";
import type { CdpClient } from "../src/cdp.ts";
import type { AvdCatalog, EnvMissing, WebViewPage } from "../../shared/protocol.ts";
import { cachedSession } from "../src/session-cache.ts";
import type { EmulatorSession } from "../src/emulator.ts";
import { GATEWAY_LEVEL } from "../../shared/protocol.ts";
import type { LogFilter, LogLine } from "../../shared/logcat.ts";
import { BIN_SCREENSHOT, binKind, CLOSE_BAD_TOKEN, CLOSE_NO_HELLO, CLOSE_ORIGIN, CLOSE_VERSION, decodeFrameHeader, PROTOCOL_VERSION, type FrameHeader } from "../../shared/protocol.ts";
import { allowedOrigins } from "../src/auth.ts";
import { lsofSockets, type Snapshot } from "../src/peer.ts";
import { randomBytes } from "node:crypto";

const randomToken = () => randomBytes(32).toString("base64url");
import { screenshotName } from "../src/server.ts";
import { AdbUnresponsive } from "../src/adb.ts";
import { ADB_UNRESPONSIVE } from "../../shared/protocol.ts";

type Sub = { size: { width: number; height: number }; onFrame: (h: FrameHeader, d: Buffer) => void; active: boolean };

const EMU_CAPS = { rotate: true, reboot: true, stop: true, clipboard: true, input: true, scroll: false };

class FakeSession implements EmulatorSession {
  kind: "emulator" | "phone" = "emulator";
  caps = { rotate: true, reboot: true, stop: true, clipboard: true, input: true, scroll: false };
  device = { width: 1080, height: 2340 };
  serial = 5554;
  id = "emulator-5554";
  avdName: string | undefined = "Pixel_5_API_34";
  rotation: 0 | 90 | 180 | 270 = 0;
  subs: Sub[] = [];
  cancels = 0;
  touches: Array<{ x: number; y: number; down: boolean }> = [];
  calls: string[] = [];
  textDelayMs = 0;
  private closedCbs: Array<() => void> = [];

  frames(size: { width: number; height: number }, onFrame: (h: FrameHeader, d: Buffer) => void) {
    const sub: Sub = { size, onFrame, active: true };
    this.subs.push(sub);
    return () => {
      if (!sub.active) return;
      sub.active = false;
      this.cancels++;
    };
  }
  push(seq: number) {
    for (const s of this.subs) {
      if (!s.active) continue;
      s.onFrame({ seq, width: s.size.width, height: s.size.height, tsMs: Date.now() % 2 ** 32 }, Buffer.alloc(16, seq & 0xff));
    }
  }
  screenshotData: Buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // 伪 PNG 头
  async touch(x: number, y: number, down: boolean) { this.touches.push({ x, y, down }); this.calls.push("touch"); }
  keyError: Error | undefined;
  async key() {
    if (this.keyError) throw this.keyError;
    this.calls.push("key");
  }
  async text() {
    await new Promise((r) => setTimeout(r, this.textDelayMs));
    if (this.textError) throw this.textError;
    this.calls.push("text");
  }
  async screenshot(): Promise<Buffer> { return this.screenshotData; }
  reboots = 0;
  rebootError: Error | undefined;
  textError: Error | undefined;
  async reboot() {
    this.reboots++;
    if (this.rebootError) throw this.rebootError;
  }
  clips: string[] = [];
  async setClipboard(text: string) { this.clips.push(text); this.calls.push("setClipboard"); }
  async getClipboard() { return this.clips.at(-1) ?? ""; }
  private clipCbs: Array<(text: string) => void> = [];
  onClipboard(cb: (text: string) => void) { this.clipCbs.push(cb); }
  /** 设备里复制了内容。 */
  fireClipboard(text: string) { for (const cb of this.clipCbs) cb(text); }
  private rotationCbs: Array<(r: 0 | 90 | 180 | 270) => void> = [];
  async rotate(dir: "left" | "right" = "right") {
    this.fireRotation(((this.rotation + (dir === "left" ? 270 : 90)) % 360) as 0 | 90 | 180 | 270);
    return this.rotation;
  }
  onRotation(cb: (r: 0 | 90 | 180 | 270) => void) { this.rotationCbs.push(cb); }
  /** 模拟器报告方向变了（比如在模拟器窗口上转的）。 */
  fireRotation(r: 0 | 90 | 180 | 270) {
    this.rotation = r;
    for (const cb of this.rotationCbs) cb(r);
  }
  onClosed(cb: () => void) { this.closedCbs.push(cb); }
  close() {}
  fireClosed() { for (const cb of this.closedCbs) cb(); }
}

/** gateway 消息（hello 后最先发）单独收在 gateway 里，msgs 里是其余的文本消息。 */
type Client = { ws: WebSocket; msgs: any[]; gateway: any[]; frames: FrameHeader[]; binMsgs: ArrayBuffer[]; closed: Promise<number> };

const APPSPOT = "https://chrome-devtools-frontend.appspot.com";

/** 白名单要在启动前按端口算出来，所以先拿一个空闲端口。 */
async function freePort(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const port = (s.address() as net.AddressInfo).port;
  await new Promise((r) => s.close(r));
  return port;
}

async function setup(
  t: import("node:test").TestContext,
  session: FakeSession | null = new FakeSession(),
  getSession: () => Promise<EmulatorSession | null> = async () => session,
  avd?: AvdOps,
  debug?: DebugDeps,
  setupOps?: SetupOps,
  more: Partial<Parameters<typeof startServer>[0]> = {},
) {
  const staticDir = await mkdtemp(join(tmpdir(), "emu-static-"));
  await writeFile(join(staticDir, "index.html"), "<p>hi</p>");
  const logs: string[] = [];
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  // 测试客户端是 node 的 ws，不是浏览器：放开 WebSocket 的浏览器白名单（模拟器照样拒绝）
  const srv = await startServer({ port, allowedOrigins: allowedOrigins(null, port), staticDir, getSession, avd, debug, setup: setupOps, pollMs: 20, log: (s) => logs.push(s), peer: { allowAnyWsClient: true }, ...more });
  t.after(() => srv.close());
  const clients: Client[] = [];
  t.after(() => { for (const c of clients) c.ws.terminate(); });
  const connect = async (): Promise<Client> => {
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/`, { headers: { Origin: origin } });
    const c: Client = { ws, msgs: [], gateway: [], frames: [], binMsgs: [], closed: new Promise((r) => ws.on("close", (code) => r(code))) };
    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        const ab = (data as Buffer).buffer.slice((data as Buffer).byteOffset, (data as Buffer).byteOffset + (data as Buffer).byteLength);
        c.binMsgs.push(ab);
        if (binKind(ab) === 1) c.frames.push(decodeFrameHeader(new Uint8Array(ab)));
      }
      else {
        const m = JSON.parse(data.toString());
        (m.t === "gateway" ? c.gateway : c.msgs).push(m);
      }
    });
    await new Promise((r) => ws.on("open", r));
    clients.push(c);
    return c;
  };
  return { srv, logs, connect, session, staticDir, origin };
}

const until = async (cond: () => boolean, ms = 1000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hello = (c: Client, width = 540, height = 1170) => c.ws.send(JSON.stringify({ t: "hello", version: PROTOCOL_VERSION, width, height }));

/** 不经 connect() 直接连：自定义 Origin，收集文本消息和关闭码。 */
function rawClient(t: import("node:test").TestContext, url: string, origin?: string) {
  const ws = new WebSocket(url, origin === undefined ? {} : { headers: { Origin: origin } });
  const c = { ws, msgs: [] as any[], closed: new Promise<number>((r) => ws.on("close", (code) => r(code))) };
  ws.on("message", (d, isBinary) => { if (!isBinary) c.msgs.push(JSON.parse(d.toString())); });
  ws.on("error", () => {});
  t.after(() => ws.terminate());
  return c;
}

test("Origin 不在白名单 → 4003；没有 Origin 也是 4003", async (t) => {
  const { srv } = await setup(t);
  for (const origin of ["https://evil.example", APPSPOT, `http://127.0.0.1:${srv.port + 1}`, undefined]) {
    const c = rawClient(t, `ws://127.0.0.1:${srv.port}/`, origin);
    assert.equal(await c.closed, CLOSE_ORIGIN, String(origin));
  }
});

test("localhost:<端口> 也在白名单里", async (t) => {
  const { srv } = await setup(t);
  const c = rawClient(t, `ws://127.0.0.1:${srv.port}/`, `http://localhost:${srv.port}`);
  c.ws.once("open", () => c.ws.send(JSON.stringify({ t: "hello", version: PROTOCOL_VERSION, width: 540, height: 1170 })));
  await until(() => c.msgs.some((m) => m.t === "ready"));
});

test("白名单 Origin 的 hello 不带口令 → ready", async (t) => {
  const { srv, origin } = await setup(t);
  const c = rawClient(t, `ws://127.0.0.1:${srv.port}/`, origin);
  c.ws.once("open", () => c.ws.send(JSON.stringify({ t: "hello", version: PROTOCOL_VERSION, width: 540, height: 1170 })));
  await until(() => c.msgs.some((m) => m.t === "ready"));
  assert.ok(!c.msgs.some((m) => m.t === "error"));
});

test("旧页面在 hello 里带口令（任意值）→ 忽略口令，照样 ready", async (t) => {
  const { srv, origin } = await setup(t);
  for (const token of [randomToken(), "", "stale"]) {
    const c = rawClient(t, `ws://127.0.0.1:${srv.port}/`, origin);
    c.ws.once("open", () => c.ws.send(JSON.stringify({ t: "hello", version: PROTOCOL_VERSION, width: 540, height: 1170, token })));
    await until(() => c.msgs.some((m) => m.t === "ready"));
    assert.ok(!c.msgs.some((m) => m.t === "error"), token);
  }
});

test("外来 Origin 带不带口令都是 4003，不发 ready", async (t) => {
  const { srv } = await setup(t);
  for (const token of [undefined, randomToken()]) {
    const c = rawClient(t, `ws://127.0.0.1:${srv.port}/`, "https://evil.example");
    c.ws.once("open", () => c.ws.send(JSON.stringify({ t: "hello", version: PROTOCOL_VERSION, width: 540, height: 1170, token })));
    assert.equal(await c.closed, CLOSE_ORIGIN, String(token));
    assert.ok(!c.msgs.some((m) => m.t === "ready"));
  }
});

test("hello version 高于网关 → error gateway-outdated 含 upgrade 字段，4002 关闭", async (t) => {
  const { srv, origin } = await setup(t);
  const c = rawClient(t, `ws://127.0.0.1:${srv.port}/`, origin);
  c.ws.once("open", () => c.ws.send(JSON.stringify({ t: "hello", version: PROTOCOL_VERSION + 1, width: 540, height: 1170 })));
  assert.equal(await c.closed, CLOSE_VERSION);
  assert.equal(c.msgs.length, 1);
  assert.equal(c.msgs[0].t, "error");
  assert.equal(c.msgs[0].code, "gateway-outdated");
  assert.ok(typeof c.msgs[0].upgrade === "string" && c.msgs[0].upgrade.length > 0, "upgrade 字段应为非空字符串");
});

test("hello version 低于网关 → error page-outdated 含 upgrade 字段，4002 关闭", async (t) => {
  const { srv, origin } = await setup(t);
  const c = rawClient(t, `ws://127.0.0.1:${srv.port}/`, origin);
  c.ws.once("open", () => c.ws.send(JSON.stringify({ t: "hello", version: PROTOCOL_VERSION - 1, width: 540, height: 1170 })));
  assert.equal(await c.closed, CLOSE_VERSION);
  assert.equal(c.msgs.length, 1);
  assert.equal(c.msgs[0].t, "error");
  assert.equal(c.msgs[0].code, "page-outdated");
  assert.ok(typeof c.msgs[0].upgrade === "string" && c.msgs[0].upgrade.length > 0, "upgrade 字段应为非空字符串");
});

test("版本不对时带着旧口令 → 版本错误（4002）", async (t) => {
  const { srv, origin } = await setup(t);
  const c = rawClient(t, `ws://127.0.0.1:${srv.port}/`, origin);
  c.ws.once("open", () => c.ws.send(JSON.stringify({ t: "hello", version: PROTOCOL_VERSION + 1, width: 540, height: 1170, token: "wrong-token" })));
  assert.equal(await c.closed, CLOSE_VERSION);
  assert.equal(c.msgs[0].code, "gateway-outdated");
});

test("hello → ready", async (t) => {
  const { connect } = await setup(t);
  const c = await connect();
  hello(c);
  await until(() => c.msgs.length > 0);
  assert.equal(c.msgs[0].t, "ready");
});

test("未发 hello 先发 touch → 连接以 4000 关闭", async (t) => {
  const { connect } = await setup(t);
  const c = await connect();
  c.ws.send(JSON.stringify({ t: "touch", x: 1, y: 2, down: true }));
  assert.equal(await c.closed, CLOSE_NO_HELLO);
});

test("hello 后收到 ready，且 device 等于假会话的尺寸", async (t) => {
  const { connect } = await setup(t);
  const c = await connect();
  hello(c);
  await until(() => c.msgs.length > 0);
  assert.deepEqual(c.msgs[0], { t: "ready", version: PROTOCOL_VERSION, device: { width: 1080, height: 2340 }, serial: 5554, deviceId: "emulator-5554", kind: "emulator", caps: EMU_CAPS });
});

test("客户端不读时连推 100 帧，服务端发出的帧数不超过 3，且最后收到的那一帧的 seq 是 99", async (t) => {
  const { connect, session } = await setup(t);
  const c = await connect();
  hello(c);
  await until(() => session!.subs.length === 1);
  for (let i = 0; i < 100; i++) session!.push(i);
  await until(() => c.frames.at(-1)?.seq === 99);
  await sleep(50);
  assert.ok(c.frames.length <= 3, `收到 ${c.frames.length} 帧`);
  assert.equal(c.frames.at(-1)!.seq, 99);
  assert.deepEqual([c.frames[0].width, c.frames[0].height], [540, 1170]);
});

test("非法 JSON 不断开连接，之后发 touch 仍能到达假会话", async (t) => {
  const { connect, session, logs } = await setup(t);
  const c = await connect();
  hello(c);
  await until(() => c.msgs.length > 0);
  c.ws.send("{not json");
  c.ws.send(JSON.stringify({ t: "unknown" }));
  c.ws.send(JSON.stringify({ t: "touch", x: 10, y: 20, down: true }));
  await until(() => session!.touches.length === 1);
  assert.deepEqual(session!.touches[0], { x: 10, y: 20, down: true });
  assert.equal(c.ws.readyState, WebSocket.OPEN);
  assert.ok(logs.length >= 2);
});

test("resize 先取消旧订阅，再按新尺寸订阅", async (t) => {
  const { connect, session } = await setup(t);
  const c = await connect();
  hello(c);
  await until(() => session!.subs.length === 1);
  c.ws.send(JSON.stringify({ t: "resize", width: 1080, height: 2340 }));
  await until(() => session!.subs.length === 2);
  assert.equal(session!.subs[0].active, false);
  assert.deepEqual(session!.subs[1].size, { width: 1080, height: 2340 });
  session!.push(7);
  await until(() => c.frames.length === 1);
  assert.deepEqual([c.frames[0].width, c.frames[0].height], [1080, 2340]);
});

test("两个连接各自独立：关掉一个之后，另一个还能收到新帧；假会话的取消函数恰好被调用 1 次", async (t) => {
  const { connect, session } = await setup(t);
  const a = await connect();
  const b = await connect();
  hello(a);
  hello(b);
  await until(() => session!.subs.length === 2);
  a.ws.close();
  await a.closed;
  await until(() => session!.cancels === 1);
  session!.push(5);
  await until(() => b.frames.length === 1);
  assert.equal(b.frames[0].seq, 5);
  await sleep(30);
  assert.equal(session!.cancels, 1);
});

test("emulator 断开后会话报告 closed：所有客户端收到 status emulator-closed", async (t) => {
  // 退出后就发现不到它了；否则轮询会马上重新接上，最后一条变成 ready / orientation
  let gone = false;
  const s = new FakeSession();
  const { connect, session } = await setup(t, s, async () => (gone ? null : s));
  const a = await connect();
  const b = await connect();
  hello(a);
  hello(b);
  await until(() => session!.subs.length === 2);
  gone = true;
  session!.fireClosed();
  const want = { t: "status", state: "emulator-closed" };
  await until(() => [a, b].every((c) => c.msgs.some((m) => m.t === "status")));
  assert.deepEqual(a.msgs.at(-1), want);
  assert.deepEqual(b.msgs.at(-1), want);
});

test("没有模拟器：hello 后收到 status no-emulator，连接保持打开", async (t) => {
  const { connect } = await setup(t, null);
  const c = await connect();
  hello(c);
  await until(() => c.msgs.length > 0);
  assert.deepEqual(c.msgs[0], { t: "status", state: "no-emulator" });
  await sleep(50);
  assert.equal(c.ws.readyState, WebSocket.OPEN);
});

test("页面在 /app/ 下：/ 和 /app 跳到 /app/，/app/ 返回 staticDir 下的 index.html，越界路径不返回", async (t) => {
  const { srv } = await setup(t);
  for (const path of ["/", "/app"]) {
    const jump = await fetch(`http://127.0.0.1:${srv.port}${path}`, { redirect: "manual" });
    assert.equal(jump.status, 302, path);
    assert.equal(jump.headers.get("location"), "/app/", path);
  }
  assert.equal((await fetch(`http://127.0.0.1:${srv.port}/index.html`)).status, 404);
  const r = await fetch(`http://127.0.0.1:${srv.port}/app/`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") ?? "", /text\/html/);
  assert.equal(await r.text(), "<p>hi</p>");
  const bad = await fetch(`http://127.0.0.1:${srv.port}/..%2F..%2Fetc%2Fpasswd`);
  assert.equal(bad.status, 404);
  const bad2 = await fetch(`http://127.0.0.1:${srv.port}/app/..%2F..%2Fetc%2Fpasswd`);
  assert.equal(bad2.status, 404);
});

test("非法 UTF-8 帧不会让网关崩溃", async (t) => {
  const { srv, connect, origin } = await setup(t);
  const s = net.connect(srv.port, "127.0.0.1");
  t.after(() => s.destroy());
  s.on("error", () => {});
  await new Promise((r) => s.on("connect", r));
  s.write(`GET / HTTP/1.1\r\nHost: x\r\nOrigin: ${origin}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  await new Promise((r) => s.once("data", r));
  const mask = Buffer.from([1, 2, 3, 4]);
  const payload = Buffer.from([0xff, 0xfe].map((b, i) => b ^ mask[i]));
  s.write(Buffer.concat([Buffer.from([0x81, 0x80 | 2]), mask, payload]));
  await sleep(100);
  const c = await connect();
  hello(c);
  await until(() => c.msgs.length > 0);
  assert.equal(c.msgs[0].t, "ready");
});

test("输入按连接串行：text 未完成时发来的 key 排在它后面", async (t) => {
  const { connect, session } = await setup(t);
  session!.textDelayMs = 50;
  const c = await connect();
  hello(c);
  await until(() => c.msgs.length > 0);
  c.ws.send(JSON.stringify({ t: "text", text: "中文" }));
  c.ws.send(JSON.stringify({ t: "key", key: "Enter", eventType: "keypress" }));
  await until(() => session!.calls.length === 2);
  assert.deepEqual(session!.calls, ["text", "key"]);
});

test("模拟器退出后：已有连接收到 emulator-closed 并保持打开，出现新模拟器后自动收到 ready 和画面", async (t) => {
  const a = new FakeSession();
  const b = new FakeSession();
  b.device = { width: 720, height: 1600 };
  const queue: Array<FakeSession | null> = [a, null, b];
  const { connect } = await setup(t, null, cachedSession(async () => (queue.length ? queue.shift()! : null)));
  const c1 = await connect();
  hello(c1);
  await until(() => a.subs.length === 1);
  a.fireClosed();
  await until(() => c1.msgs.some((m) => m.t === "status"));
  assert.deepEqual(c1.msgs[2], { t: "status", state: "emulator-closed" });
  assert.equal(a.subs[0].active, false);
  await until(() => c1.msgs.length === 5);
  assert.deepEqual(c1.msgs[3], { t: "ready", version: PROTOCOL_VERSION, device: { width: 720, height: 1600 }, serial: 5554, deviceId: "emulator-5554", kind: "emulator", caps: EMU_CAPS });
  assert.equal(c1.ws.readyState, WebSocket.OPEN);
  const c2 = await connect();
  hello(c2);
  await until(() => c2.msgs.length > 0);
  assert.deepEqual(c2.msgs[0], { t: "ready", version: PROTOCOL_VERSION, device: { width: 720, height: 1600 }, serial: 5554, deviceId: "emulator-5554", kind: "emulator", caps: EMU_CAPS });
  await until(() => b.subs.length === 2);
  b.push(3);
  await until(() => c2.frames.length === 1 && c1.frames.length === 1);
  assert.equal(c2.frames[0].seq, 3);
});

test("帧尺寸取整并限制在设备尺寸内", async (t) => {
  const { connect, session } = await setup(t);
  const c1 = await connect();
  hello(c1, 1350.5, 2925.7);
  await until(() => session!.subs.length === 1);
  assert.deepEqual(session!.subs[0].size, { width: 1080, height: 2340 });
  const c2 = await connect();
  hello(c2, 540.4, 1170.6);
  await until(() => session!.subs.length === 2);
  assert.deepEqual(session!.subs[1].size, { width: 540, height: 1171 });
});

test("连接在按下状态关闭时网关补发抬起", async (t) => {
  const { connect, session } = await setup(t);
  const c = await connect();
  hello(c);
  await until(() => c.msgs.length > 0);
  c.ws.send(JSON.stringify({ t: "touch", x: 100, y: 200, down: true }));
  await until(() => session!.touches.length === 1);
  c.ws.close();
  await c.closed;
  await until(() => session!.touches.length === 2, 1000);
  assert.deepEqual(session!.touches[1], { x: 100, y: 200, down: false });
});

test("最后触摸已抬起时关闭连接不补发", async (t) => {
  const { connect, session } = await setup(t);
  const c = await connect();
  hello(c);
  await until(() => c.msgs.length > 0);
  c.ws.send(JSON.stringify({ t: "touch", x: 50, y: 60, down: true }));
  await until(() => session!.touches.length === 1);
  c.ws.send(JSON.stringify({ t: "touch", x: 50, y: 60, down: false }));
  await until(() => session!.touches.length === 2);
  c.ws.close();
  await c.closed;
  await sleep(50);
  assert.equal(session!.touches.length, 2);
});

/** 假的 AVD 操作：start 返回手动推进的任务；进行中的同名任务直接返回（同 lifecycle）。 */
function fakeAvd(sessions: Record<string, FakeSession>) {
  const calls: string[] = [];
  let job: any = null;
  let resolve!: (r: any) => void;
  let reject!: (e: Error) => void;
  let displayName: string | undefined;
  let deleted = false;
  let running: "no" | "grpc" | "no-grpc" = "no";
  // 设了 gate 时 delete 等它放行，用来测删除进行中的请求
  let gate: Promise<void> | null = null;
  // stuck：stop 发出去了但设备不停（测等待超时）
  let stuck = false;
  // lateSerial：开机任务刚建时串口还是 0，过一会儿才有（真实的发现文件要等模拟器写出来）
  let lateSerial = false;
  const ops: AvdOps = {
    list: async () => (deleted ? [] : [{ name: "A", running, ...(running !== "no" ? { serial: 5554 } : {}), ...(displayName ? { displayName } : {}) }]),
    start: (name) => {
      calls.push(`start ${name}`);
      if (job && job.name === name && job.progress === "booting") return job;
      job = { name, serial: lateSerial ? 0 : 5556, grpcPort: 8556, progress: "booting", done: new Promise((res, rej) => ((resolve = res), (reject = rej))) };
      if (lateSerial) { const j = job; setTimeout(() => (j.serial = 5556), 80); }
      job.done.catch(() => {});
      return job;
    },
    stop: async (serial) => {
      calls.push(`stop ${serial}`);
      if (stuck) return;
      if (serial === 5554) running = "no";
      // 停的是开机中的那台：开机任务失败结束
      if (job && job.serial === serial && job.progress === "booting") {
        job.progress = "failed";
        job.error = "已停止";
        reject(new Error("已停止"));
      }
    },
    use: async (name) => {
      calls.push(`use ${name}`);
      return sessions[name] ?? null;
    },
    rename: async (name, d) => {
      calls.push(`rename ${name}`);
      if (name !== "A") throw new Error(`没有这个设备：${name}`);
      displayName = d;
    },
    delete: async (name) => {
      calls.push(`delete ${name}`);
      if (gate) await gate;
      if (name !== "A" || deleted) throw new Error(`没有这个设备：${name}`);
      deleted = true;
    },
  };
  return {
    ops,
    calls,
    setRunning: (r: typeof running) => void (running = r),
    stick: () => void (stuck = true),
    serialLater: () => void (lateSerial = true),
    hold: () => {
      let release!: () => void;
      gate = new Promise((r) => (release = r));
      return () => { gate = null; release(); };
    },
    finish: () => {
      job.progress = "ready";
      resolve({ pid: 1, serial: 5556, grpcPort: 8556, avdName: job.name });
    },
    fail: (msg: string) => {
      job.progress = "failed";
      job.error = msg;
      reject(new Error(msg));
    },
  };
}

test("avds 返回 AVD 列表", async (t) => {
  const f = fakeAvd({});
  const { connect } = await setup(t, new FakeSession(), undefined, f.ops);
  const c = await connect();
  hello(c);
  await until(() => c.msgs.length > 0);
  c.ws.send(JSON.stringify({ t: "avds" }));
  await until(() => c.msgs.some((m) => m.t === "avds"));
  assert.deepEqual(c.msgs.find((m) => m.t === "avds"), { t: "avds", list: [{ name: "A", running: "no" }] });
});

test("renameAvd：回复成功，所有连接都收到带新显示名的 avds", async (t) => {
  const f = fakeAvd({});
  const { connect } = await setup(t, new FakeSession(), undefined, f.ops);
  const a = await connect();
  const b = await connect();
  hello(a);
  hello(b);
  await until(() => a.msgs.length > 0 && b.msgs.length > 0);
  a.ws.send(JSON.stringify({ t: "renameAvd", rid: 7, name: "A", displayName: "测试机" }));
  await until(() => a.msgs.some((m) => m.t === "renameAvd") && b.msgs.some((m) => m.t === "avds"));
  assert.deepEqual(a.msgs.find((m) => m.t === "renameAvd"), { t: "renameAvd", rid: 7, ok: true });
  assert.deepEqual(b.msgs.find((m) => m.t === "avds"), { t: "avds", list: [{ name: "A", running: "no", displayName: "测试机" }] });
  assert.equal(b.msgs.some((m) => m.t === "renameAvd"), false);
});

test("deleteAvd：回复成功，所有连接都收到删掉后的 avds", async (t) => {
  const f = fakeAvd({});
  const { connect } = await setup(t, new FakeSession(), undefined, f.ops);
  const a = await connect();
  const b = await connect();
  hello(a);
  hello(b);
  await until(() => a.msgs.length > 0 && b.msgs.length > 0);
  a.ws.send(JSON.stringify({ t: "deleteAvd", rid: 9, name: "A" }));
  await until(() => a.msgs.some((m) => m.t === "deleteAvd") && b.msgs.some((m) => m.t === "avds") && a.msgs.some((m) => m.t === "avds"));
  assert.deepEqual(a.msgs.find((m) => m.t === "deleteAvd"), { t: "deleteAvd", rid: 9, ok: true });
  assert.deepEqual(b.msgs.find((m) => m.t === "avds"), { t: "avds", list: [] });
  assert.equal(b.msgs.some((m) => m.t === "deleteAvd"), false);
});

test("deleteAvd：失败时回复原因，不广播 avds", async (t) => {
  const f = fakeAvd({});
  const { connect } = await setup(t, new FakeSession(), undefined, f.ops);
  const c = await connect();
  hello(c);
  await until(() => c.msgs.length > 0);
  c.ws.send(JSON.stringify({ t: "deleteAvd", rid: 10, name: "B" }));
  await until(() => c.msgs.some((m) => m.t === "deleteAvd"));
  assert.deepEqual(c.msgs.find((m) => m.t === "deleteAvd"), { t: "deleteAvd", rid: 10, ok: false, error: "没有这个设备：B" });
  await sleep(50);
  assert.equal(c.msgs.some((m) => m.t === "avds"), false);
});

test("deleteAvd：正在开机的设备不删，也不去问 AvdOps", async (t) => {
  const f = fakeAvd({});
  const { connect } = await setup(t, null, async () => null, f.ops);
  const c = await connect();
  hello(c);
  await until(() => c.msgs.length > 0);
  c.ws.send(JSON.stringify({ t: "start", name: "A" }));
  await until(() => c.msgs.some((m) => m.t === "boot"));
  c.ws.send(JSON.stringify({ t: "deleteAvd", rid: 11, name: "A" }));
  await until(() => c.msgs.some((m) => m.t === "deleteAvd"));
  assert.deepEqual(c.msgs.find((m) => m.t === "deleteAvd"), { t: "deleteAvd", rid: 11, ok: false, error: "这台设备正在开机，等它开机后先关闭再删除" });
  assert.equal(f.calls.includes("delete A"), false);
});

test("deleteAvd：列表里显示在运行（比如只有 adb 看得到的 no-grpc）时不删", async (t) => {
  const f = fakeAvd({});
  f.setRunning("no-grpc");
  const { connect } = await setup(t, new FakeSession(), undefined, f.ops);
  const c = await connect();
  hello(c);
  await until(() => c.msgs.length > 0);
  c.ws.send(JSON.stringify({ t: "deleteAvd", rid: 12, name: "A" }));
  await until(() => c.msgs.some((m) => m.t === "deleteAvd"));
  assert.deepEqual(c.msgs.find((m) => m.t === "deleteAvd"), { t: "deleteAvd", rid: 12, ok: false, error: "先关闭这台设备再删除" });
  assert.equal(f.calls.includes("delete A"), false);
});

test("deleteAvd 进行中：同一台再删、启动、切换、改名都拒绝，不去问 AvdOps", async (t) => {
  const f = fakeAvd({});
  const release = f.hold();
  const { connect } = await setup(t, new FakeSession(), undefined, f.ops);
  const c = await connect();
  hello(c);
  await until(() => c.msgs.length > 0);
  c.ws.send(JSON.stringify({ t: "deleteAvd", rid: 13, name: "A" }));
  await until(() => f.calls.includes("delete A"));
  c.ws.send(JSON.stringify({ t: "deleteAvd", rid: 14, name: "A" }));
  c.ws.send(JSON.stringify({ t: "start", name: "A" }));
  c.ws.send(JSON.stringify({ t: "use", name: "A" }));
  c.ws.send(JSON.stringify({ t: "renameAvd", rid: 15, name: "A", displayName: "x" }));
  await until(() => c.msgs.some((m) => m.t === "renameAvd") && c.msgs.filter((m) => m.t === "error").length >= 2 && c.msgs.some((m) => m.t === "deleteAvd"));
  assert.deepEqual(c.msgs.find((m) => m.t === "deleteAvd"), { t: "deleteAvd", rid: 14, ok: false, error: "正在删除这台设备" });
  assert.deepEqual(c.msgs.find((m) => m.t === "renameAvd"), { t: "renameAvd", rid: 15, ok: false, error: "正在删除这台设备" });
  assert.deepEqual(c.msgs.filter((m) => m.t === "error").map((m) => m.message), ["正在删除这台设备", "正在删除这台设备"]);
  assert.deepEqual(f.calls, ["delete A"]);
  release();
  await until(() => c.msgs.some((m) => m.t === "deleteAvd" && m.rid === 13));
  assert.deepEqual(c.msgs.find((m) => m.t === "deleteAvd" && m.rid === 13), { t: "deleteAvd", rid: 13, ok: true });
  // 删完就放开了：再删一次走到 AvdOps（这次是“没有这个设备”）
  c.ws.send(JSON.stringify({ t: "deleteAvd", rid: 16, name: "A" }));
  await until(() => c.msgs.some((m) => m.t === "deleteAvd" && m.rid === 16));
  assert.equal(f.calls.filter((x) => x === "delete A").length, 2);
});

test("renameAvd：失败时回复原因，不广播 avds", async (t) => {
  const f = fakeAvd({});
  const { connect } = await setup(t, new FakeSession(), undefined, f.ops);
  const c = await connect();
  hello(c);
  await until(() => c.msgs.length > 0);
  c.ws.send(JSON.stringify({ t: "renameAvd", rid: 8, name: "B", displayName: "x" }));
  await until(() => c.msgs.some((m) => m.t === "renameAvd"));
  assert.deepEqual(c.msgs.find((m) => m.t === "renameAvd"), { t: "renameAvd", rid: 8, ok: false, error: "没有这个设备：B" });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(c.msgs.some((m) => m.t === "avds"), false);
});

test("start：所有连接收到 booting 和 boot 进度；就绪后切到新会话，每个连接重新收到 ready 并订阅新画面", async (t) => {
  const b = new FakeSession();
  b.device = { width: 720, height: 1600 };
  const f = fakeAvd({ B: b });
  const { connect } = await setup(t, null, async () => null, f.ops);
  const c1 = await connect();
  const c2 = await connect();
  hello(c1);
  hello(c2);
  await until(() => c1.msgs.length > 0 && c2.msgs.length > 0);
  c1.ws.send(JSON.stringify({ t: "start", name: "B" }));
  await until(() => [c1, c2].every((c) => c.msgs.filter((m) => m.t === "boot").length >= 2));
  for (const c of [c1, c2]) {
    assert.ok(c.msgs.some((m) => m.t === "status" && m.state === "booting"));
    assert.deepEqual(c.msgs.find((m) => m.t === "boot"), { t: "boot", name: "B", progress: "booting" });
  }
  f.finish();
  await until(() => [c1, c2].every((c) => c.msgs.some((m) => m.t === "ready")));
  assert.deepEqual(f.calls, ["start B", "use B"]);
  for (const c of [c1, c2]) {
    assert.ok(c.msgs.some((m) => m.t === "boot" && m.progress === "ready"));
    await until(() => c.msgs.at(-1).t === "orientation");
    assert.deepEqual(c.msgs.at(-2), { t: "ready", version: PROTOCOL_VERSION, device: { width: 720, height: 1600 }, serial: 5554, deviceId: "emulator-5554", kind: "emulator", caps: EMU_CAPS });
  }
  await until(() => b.subs.length === 2);
  b.push(9);
  await until(() => c1.frames.length === 1 && c2.frames.length === 1);
});

test("use：切到另一台运行中的 AVD，旧订阅取消，重新 ready", async (t) => {
  const a = new FakeSession();
  const b = new FakeSession();
  b.device = { width: 720, height: 1600 };
  const f = fakeAvd({ B: b });
  const { connect } = await setup(t, a, undefined, f.ops);
  const c = await connect();
  hello(c);
  await until(() => a.subs.length === 1);
  c.ws.send(JSON.stringify({ t: "use", name: "B" }));
  await until(() => b.subs.length === 1);
  assert.equal(a.subs[0].active, false);
  assert.deepEqual(c.msgs.at(-2), { t: "ready", version: PROTOCOL_VERSION, device: { width: 720, height: 1600 }, serial: 5554, deviceId: "emulator-5554", kind: "emulator", caps: EMU_CAPS });
  assert.deepEqual(c.msgs.at(-1), { t: "orientation", rotation: 0 });
});

test("use 一台没在运行的 AVD：回 error，原会话不变", async (t) => {
  const a = new FakeSession();
  const f = fakeAvd({});
  const { connect } = await setup(t, a, undefined, f.ops);
  const c = await connect();
  hello(c);
  await until(() => a.subs.length === 1);
  c.ws.send(JSON.stringify({ t: "use", name: "X" }));
  await until(() => c.msgs.some((m) => m.t === "error"));
  assert.equal(a.subs[0].active, true);
});

test("stop：按当前会话的 serial 关闭模拟器", async (t) => {
  const a = new FakeSession();
  a.serial = 5560;
  const f = fakeAvd({});
  const { connect } = await setup(t, a, undefined, f.ops);
  const c = await connect();
  hello(c);
  await until(() => c.msgs.length > 0);
  c.ws.send(JSON.stringify({ t: "stop" }));
  await until(() => f.calls.length === 1);
  assert.deepEqual(f.calls, ["stop 5560"]);
});

test("重复 start 只挂一次回调、只调用一次 use", async (t) => {
  const b = new FakeSession();
  const f = fakeAvd({ B: b });
  const { connect } = await setup(t, null, async () => null, f.ops);
  const c1 = await connect();
  const c2 = await connect();
  hello(c1);
  hello(c2);
  await until(() => c1.msgs.length > 0 && c2.msgs.length > 0);
  c1.ws.send(JSON.stringify({ t: "start", name: "B" }));
  c2.ws.send(JSON.stringify({ t: "start", name: "B" }));
  await until(() => f.calls.filter((c) => c === "start B").length === 2);
  f.finish();
  await until(() => [c1, c2].every((c) => c.msgs.some((m) => m.t === "ready")));
  await sleep(50);
  assert.deepEqual(f.calls, ["start B", "start B", "use B"]);
  for (const c of [c1, c2]) {
    assert.equal(c.msgs.filter((m) => m.t === "ready").length, 1);
    assert.equal(c.msgs.filter((m) => m.t === "boot" && m.progress === "ready").length, 1);
  }
});

test("开机途中新连上的连接收到 status booting 和后续 boot", async (t) => {
  const f = fakeAvd({ B: new FakeSession() });
  const { connect } = await setup(t, null, async () => null, f.ops);
  const c1 = await connect();
  hello(c1);
  await until(() => c1.msgs.length > 0);
  c1.ws.send(JSON.stringify({ t: "start", name: "B" }));
  await until(() => c1.msgs.some((m) => m.t === "boot"));
  const c2 = await connect();
  hello(c2);
  await until(() => c2.msgs.filter((m) => m.t === "boot").length >= 2);
  assert.deepEqual(c2.msgs[0], { t: "status", state: "booting" });
  assert.deepEqual(c2.msgs[1], { t: "boot", name: "B", progress: "booting" });
});

test("start 失败时无会话的连接收到带 error 的 boot 和 no-emulator", async (t) => {
  const f = fakeAvd({});
  const { connect } = await setup(t, null, async () => null, f.ops);
  const c = await connect();
  hello(c);
  await until(() => c.msgs.length > 0);
  c.ws.send(JSON.stringify({ t: "start", name: "B" }));
  await until(() => c.msgs.some((m) => m.t === "boot"));
  f.fail("开机超时（180 秒）");
  await until(() => c.msgs.at(-1)?.state === "no-emulator");
  assert.ok(c.msgs.some((m) => m.t === "boot" && m.progress === "failed" && m.error === "开机超时（180 秒）"));
});

test("开机完成但 use 失败：广播 error，无会话的连接收到 no-emulator", async (t) => {
  const f = fakeAvd({});
  const { connect } = await setup(t, null, async () => null, f.ops);
  const c = await connect();
  hello(c);
  await until(() => c.msgs.length > 0);
  c.ws.send(JSON.stringify({ t: "start", name: "B" }));
  await until(() => c.msgs.some((m) => m.t === "boot"));
  f.finish();
  await until(() => c.msgs.some((m) => m.t === "error"));
  await until(() => c.msgs.at(-1)?.state === "no-emulator", 300);
});

test("ready 之后紧跟当前方向", async (t) => {
  const session = new FakeSession();
  session.rotation = 270;
  const { connect } = await setup(t, session);
  const c = await connect();
  hello(c);
  await until(() => c.msgs.length >= 2);
  assert.equal(c.msgs[0].t, "ready");
  assert.deepEqual(c.msgs[1], { t: "orientation", rotation: 270 });
});

test("rotate：会话转 90°，同一会话的所有连接收到新方向", async (t) => {
  const { connect, session } = await setup(t);
  const c1 = await connect();
  const c2 = await connect();
  hello(c1);
  hello(c2);
  await until(() => session!.subs.length === 2);
  c1.ws.send(JSON.stringify({ t: "rotate" }));
  await until(() => [c1, c2].every((c) => c.msgs.some((m) => m.t === "orientation" && m.rotation === 90)));
  assert.equal(session!.rotation, 90);
});

test("rotate 带 dir left：会话逆时针转 90°", async (t) => {
  const { connect, session } = await setup(t);
  const c = await connect();
  hello(c);
  await until(() => session!.subs.length === 1);
  c.ws.send(JSON.stringify({ t: "rotate", dir: "left" }));
  await until(() => c.msgs.some((m) => m.t === "orientation" && m.rotation === 270));
  assert.equal(session!.rotation, 270);
});

test("横屏时帧尺寸按转过来的设备尺寸限制", async (t) => {
  const { connect, session } = await setup(t);
  const c = await connect();
  hello(c);
  await until(() => session!.subs.length === 1);
  c.ws.send(JSON.stringify({ t: "rotate" }));
  await until(() => c.msgs.some((m) => m.t === "orientation" && m.rotation === 90));
  const before = session!.subs.length;
  c.ws.send(JSON.stringify({ t: "resize", width: 2925.4, height: 1350 }));
  await until(() => session!.subs.length === before + 1);
  assert.deepEqual(session!.subs.at(-1)!.size, { width: 2340, height: 1080 });
});

test("模拟器自己报告方向变了（没有 rotate 消息）：广播新方向，并按转过来的尺寸重新订阅", async (t) => {
  const { connect, session } = await setup(t);
  const c = await connect();
  hello(c, 1080, 2340);
  await until(() => session!.subs.length === 1);
  session!.fireRotation(90);
  await until(() => c.msgs.some((m) => m.t === "orientation" && m.rotation === 90));
  await until(() => session!.subs.length === 2);
  assert.equal(session!.subs[0].active, false);
  assert.deepEqual(session!.subs[1].size, { width: 1080, height: 1080 });
});

test("screenshot 请求：先收到文本 {t:'screenshot'}，再收到 binKind 为 2 的二进制，且只发给请求方", async (t) => {
  const { connect, session } = await setup(t);
  const c1 = await connect();
  const c2 = await connect();
  hello(c1);
  hello(c2);
  await until(() => session!.subs.length === 2);
  c1.ws.send(JSON.stringify({ t: "screenshot" }));
  await until(() => c1.msgs.some((m) => m.t === "screenshot"), 2000);
  await until(() => c1.binMsgs.some((b) => binKind(b) === BIN_SCREENSHOT), 2000);
  // 文本消息在前，二进制在后
  const textMsg = c1.msgs.find((m) => m.t === "screenshot");
  assert.ok(textMsg, "c1 应收到文本 screenshot 消息");
  // 文件名格式：screenshot-<avdName>-<yyyyMMdd-HHmmss>.png
  assert.match(textMsg.name, /^screenshot-Pixel_5_API_34-\d{8}-\d{6}\.png$/, "文件名格式正确");
  assert.ok(c1.binMsgs.some((b) => binKind(b) === BIN_SCREENSHOT), "c1 应收到 binKind=2 的二进制");
  // c2 不应收到截图消息
  await sleep(50);
  assert.ok(!c2.msgs.some((m) => m.t === "screenshot"), "c2 不应收到 screenshot 文本");
  assert.ok(!c2.binMsgs.some((b) => binKind(b) === BIN_SCREENSHOT), "c2 不应收到截图二进制");
});

test("截图还没回来时模拟器退出：网关不崩，截图仍按发起时的设备命名", async (t) => {
  // 模拟器退出后不再有会话可接，免得轮询把同一台又接回来
  let gone = false;
  const s = new FakeSession();
  const { connect, session } = await setup(t, s, async () => (gone ? null : s));
  let release!: () => void;
  session!.screenshot = () => new Promise<Buffer>((r) => { release = () => r(session!.screenshotData); });
  const c = await connect();
  hello(c);
  await until(() => session!.subs.length === 1);
  c.ws.send(JSON.stringify({ t: "screenshot" }));
  await until(() => release !== undefined);
  gone = true;
  session!.fireClosed();
  await until(() => c.msgs.some((m) => m.t === "status" && m.state === "emulator-closed"));
  release();
  await until(() => c.msgs.some((m) => m.t === "screenshot"));
  assert.match(c.msgs.find((m) => m.t === "screenshot").name, /^screenshot-Pixel_5_API_34-\d{8}-\d{6}\.png$/);
  await until(() => c.binMsgs.some((b) => binKind(b) === BIN_SCREENSHOT));
});

test("screenshotName 格式：screenshot-<device>-<yyyyMMdd-HHmmss>.png", () => {
  const d = new Date(2026, 10, 11, 18, 3, 16); // 2026-11-11 18:03:16 本地时间
  assert.equal(screenshotName("Pixel_5_API_34", d), "screenshot-Pixel_5_API_34-20261111-180316.png");
});

test("screenshotName 未知设备用 emulator-<serial> 形式也合法", () => {
  const d = new Date(2026, 0, 1, 0, 0, 5);
  assert.equal(screenshotName("emulator-5554", d), "screenshot-emulator-5554-20260101-000005.png");
});

test("clip：写入设备剪贴板，不触发粘贴", async (t) => {
  const { connect, session } = await setup(t);
  const c = await connect();
  hello(c);
  await until(() => c.msgs.some((m) => m.t === "ready"));
  c.ws.send(JSON.stringify({ t: "clip", text: "👍🏻中文" }));
  await until(() => session!.clips.length === 1);
  await sleep(30);
  assert.deepEqual(session!.clips, ["👍🏻中文"]);
  assert.deepEqual(session!.calls, ["setClipboard"]);
});

test("设备复制了内容：同一会话的所有连接收到 {t:'clip'}", async (t) => {
  const { connect, session } = await setup(t);
  const c1 = await connect();
  const c2 = await connect();
  hello(c1);
  hello(c2);
  await until(() => c1.msgs.some((m) => m.t === "ready") && c2.msgs.some((m) => m.t === "ready"));
  session!.fireClipboard("设备里的字");
  await until(() => c1.msgs.some((m) => m.t === "clip") && c2.msgs.some((m) => m.t === "clip"));
  assert.deepEqual(c1.msgs.find((m) => m.t === "clip"), { t: "clip", text: "设备里的字" });
  assert.deepEqual(c2.msgs.find((m) => m.t === "clip"), { t: "clip", text: "设备里的字" });
});

test("pause 取消这个连接的画面订阅，期间不发帧；resume 后重新订阅", async (t) => {
  const { connect, session } = await setup(t);
  const c = await connect();
  hello(c);
  await until(() => session!.subs.length === 1);
  c.ws.send(JSON.stringify({ t: "pause" }));
  await until(() => session!.cancels === 1);
  session!.push(1);
  await sleep(30);
  assert.equal(c.frames.length, 0);
  c.ws.send(JSON.stringify({ t: "resume" }));
  await until(() => session!.subs.length === 2);
  assert.equal(session!.subs[1].active, true);
  session!.push(2);
  await until(() => c.frames.length === 1);
  assert.equal(c.frames[0].seq, 2);
});

test("暂停期间 resize、旋转、切换会话都不订阅画面，resume 时按最新尺寸订阅一次", async (t) => {
  const a = new FakeSession();
  const b = new FakeSession();
  const f = fakeAvd({ B: b });
  const { connect } = await setup(t, a, undefined, f.ops);
  const c = await connect();
  hello(c);
  await until(() => a.subs.length === 1);
  c.ws.send(JSON.stringify({ t: "pause" }));
  await until(() => a.cancels === 1);
  c.ws.send(JSON.stringify({ t: "resize", width: 300, height: 600 }));
  a.fireRotation(0);
  c.ws.send(JSON.stringify({ t: "use", name: "B" }));
  await until(() => c.msgs.filter((m) => m.t === "ready").length === 2);
  await sleep(30);
  assert.equal(a.subs.length, 1);
  assert.equal(b.subs.length, 0);
  c.ws.send(JSON.stringify({ t: "resume" }));
  await until(() => b.subs.length === 1);
  assert.deepEqual(b.subs[0].size, { width: 300, height: 600 });
  await sleep(30);
  assert.equal(b.subs.length, 1);
});

const PAGE: WebViewPage = {
  socket: "webview_devtools_remote_123",
  pid: 123,
  pkg: "com.example.app",
  id: "p1",
  title: "Demo Page",
  url: "https://help.example.com/",
  visible: true,
  frontendUrl: "https://chrome-devtools-frontend.appspot.com/serve_rev/@abc/inspector.html?ws=127.0.0.1:9300/devtools/page/p1",
};

/** 假的 WebView 调试依赖：按设备记录调用；Page.navigate 等 navGate 放行后才触发 loadEventFired。 */
function fakeDebug(pages: WebViewPage[] = [PAGE]) {
  const calls: string[] = [];
  const f = {
    calls,
    pages,
    ensureError: undefined as Error | undefined,
    port: 9300,
    navGate: Promise.resolve(),
    navError: undefined as string | undefined,
    deps: undefined as unknown as DebugDeps,
  };
  f.deps = {
    forDevice: (id) => ({
      webviews: {
        list: async () => (calls.push(`list ${id}`), f.pages),
        portOf: (socket) => (f.pages.some((p) => p.socket === socket) ? f.port : undefined),
        close: async () => void calls.push(`close ${id}`),
      },
      reverses: {
        ensure: async (port) => {
          calls.push(`ensure ${id} ${port}`);
          if (f.ensureError) throw f.ensureError;
        },
        removeAll: async () => void calls.push(`removeAll ${id}`),
      },
    }),
    connectCdp: async (wsUrl) => {
      calls.push(`cdp ${wsUrl}`);
      const listeners = new Map<string, (p: any) => void>();
      let closedResolve!: () => void;
      const closed = new Promise<void>((r) => (closedResolve = r));
      const cdp: CdpClient = {
        async send(method, params?: any) {
          if (method === "Page.navigate") {
            calls.push(`navigate ${params.url}`);
            if (f.navError) return { frameId: "f", errorText: f.navError };
            f.navGate.then(() => listeners.get("Page.loadEventFired")?.({}));
            return { frameId: "f" };
          }
          if (method === "Runtime.evaluate") {
            const v: Record<string, unknown> = { "location.href": "http://localhost:5173/", "document.title": "Dev", "typeof window._dsbridge": "object" };
            return { result: { value: v[params.expression] } };
          }
          return {};
        },
        on(event, cb) {
          listeners.set(event, cb);
          return () => listeners.delete(event);
        },
        close() {
          calls.push("cdp close");
          closedResolve();
        },
        closed,
      };
      return cdp;
    },
  };
  return f;
}

const reply = (c: Client, t: string, rid: number) => c.msgs.find((m) => m.t === t && m.rid === rid);

let inspectRid = 1000;
/** 发 inspect，从回复的前端地址里取出 ws= 的值，拼成 DevTools 前端会连的地址。 */
async function inspectWs(c: Client, port: number, socket = PAGE.socket, id = "p1"): Promise<string> {
  const rid = ++inspectRid;
  c.ws.send(JSON.stringify({ t: "inspect", rid, socket, id }));
  await until(() => !!reply(c, "inspect", rid));
  const ws = new URL(reply(c, "inspect", rid).url).searchParams.get("ws")!;
  assert.ok(ws.startsWith(`127.0.0.1:${port}/devtools/`), ws);
  return `ws://${ws}`;
}

/** 假的 WebView DevTools 上游，接到连接就记下来。 */
async function upstream(t: import("node:test").TestContext) {
  const up = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise((r) => up.once("listening", r));
  const socks: WebSocket[] = [];
  up.on("connection", (ws) => socks.push(ws));
  t.after(() => new Promise<void>((r) => { for (const s of up.clients) s.terminate(); up.close(() => r()); }));
  return { port: (up.address() as { port: number }).port, socks };
}

async function debugSetup(t: import("node:test").TestContext, f = fakeDebug(), session = new FakeSession(), avd?: AvdOps) {
  const r = await setup(t, session, undefined, avd, f.deps);
  const c = await r.connect();
  hello(c);
  await until(() => c.msgs.some((m) => m.t === "ready"));
  return { ...r, c, f };
}

test("webviews 请求返回列表，rid 原样带回", async (t) => {
  const { c } = await debugSetup(t);
  c.ws.send(JSON.stringify({ t: "webviews", rid: 7 }));
  await until(() => !!reply(c, "webviews", 7));
  assert.deepEqual(reply(c, "webviews", 7), { t: "webviews", rid: 7, list: [PAGE] });
});

test("webviews 读列表失败：回复带 error，不当成空列表", async (t) => {
  const f = fakeDebug();
  const { c } = await debugSetup(t, f);
  f.deps.forDevice = ((orig) => (id: string) => {
    const d = orig(id);
    return { ...d, webviews: { ...d.webviews, list: async () => { throw new Error("adb 超时"); } } };
  })(f.deps.forDevice);
  c.ws.send(JSON.stringify({ t: "webviews", rid: 21 }));
  await until(() => !!reply(c, "webviews", 21));
  assert.deepEqual(reply(c, "webviews", 21), { t: "webviews", rid: 21, list: [], error: "读取 WebView 列表失败：adb 超时" });
});

test("navigate localhost:5173：先 ensure(5173) 再 navigate，成功后关闭 CDP 连接", async (t) => {
  const { c, f } = await debugSetup(t);
  c.ws.send(JSON.stringify({ t: "navigate", rid: 3, socket: PAGE.socket, id: "p1", address: "localhost:5173" }));
  await until(() => !!reply(c, "navigate", 3));
  assert.deepEqual(reply(c, "navigate", 3), { t: "navigate", rid: 3, ok: true, href: "http://localhost:5173/", title: "Dev", bridge: true });
  const ensureAt = f.calls.indexOf("ensure emulator-5554 5173");
  const navAt = f.calls.indexOf("navigate http://localhost:5173/");
  assert.ok(ensureAt >= 0 && navAt > ensureAt, f.calls.join(" | "));
  assert.ok(f.calls.includes(`cdp ws://127.0.0.1:9300/devtools/page/p1`));
  await until(() => f.calls.includes("cdp close"));
});

test("navigate 经 adb reverse 的地址报 ERR_EMPTY_RESPONSE：提示本机开发服务器没启动", async (t) => {
  const { c, f } = await debugSetup(t);
  f.navError = "net::ERR_EMPTY_RESPONSE";
  c.ws.send(JSON.stringify({ t: "navigate", rid: 11, socket: PAGE.socket, id: "p1", address: "localhost:5174" }));
  await until(() => !!reply(c, "navigate", 11));
  assert.deepEqual(reply(c, "navigate", 11), { t: "navigate", rid: 11, ok: false, error: "连不上这个地址：本机开发服务器启动了吗？" });
});

test("navigate 外部地址报 ERR_EMPTY_RESPONSE：原样返回，不提本机开发服务器", async (t) => {
  const { c, f } = await debugSetup(t);
  f.navError = "net::ERR_EMPTY_RESPONSE";
  c.ws.send(JSON.stringify({ t: "navigate", rid: 12, socket: PAGE.socket, id: "p1", address: "https://example.com" }));
  await until(() => !!reply(c, "navigate", 12));
  assert.deepEqual(reply(c, "navigate", 12), { t: "navigate", rid: 12, ok: false, error: "net::ERR_EMPTY_RESPONSE" });
});

test("navigate 地址非法：ok:false、error 为 地址格式不对，不调用 ensure", async (t) => {
  const { c, f } = await debugSetup(t);
  c.ws.send(JSON.stringify({ t: "navigate", rid: 4, socket: PAGE.socket, id: "p1", address: "local host:5173" }));
  await until(() => !!reply(c, "navigate", 4));
  assert.deepEqual(reply(c, "navigate", 4), { t: "navigate", rid: 4, ok: false, error: "地址格式不对" });
  assert.ok(!f.calls.some((x) => x.startsWith("ensure")));
});

test("navigate 页面已关闭（socket 不在列表里）：ok:false、error 为 页面已关闭", async (t) => {
  const { c, f } = await debugSetup(t);
  c.ws.send(JSON.stringify({ t: "navigate", rid: 5, socket: "webview_devtools_remote_999", id: "p1", address: "localhost:5173" }));
  await until(() => !!reply(c, "navigate", 5));
  assert.deepEqual(reply(c, "navigate", 5), { t: "navigate", rid: 5, ok: false, error: "页面已关闭" });
  assert.ok(!f.calls.some((x) => x.startsWith("ensure") || x.startsWith("cdp")));
});

test("navigate 时 adb reverse 失败：回 adb reverse 失败：<原因>，不连 CDP", async (t) => {
  const f = fakeDebug();
  f.ensureError = new Error("device offline");
  const { c } = await debugSetup(t, f);
  c.ws.send(JSON.stringify({ t: "navigate", rid: 6, socket: PAGE.socket, id: "p1", address: "localhost:5173" }));
  await until(() => !!reply(c, "navigate", 6));
  assert.deepEqual(reply(c, "navigate", 6), { t: "navigate", rid: 6, ok: false, error: "adb reverse 失败：device offline" });
  assert.ok(!f.calls.some((x) => x.startsWith("cdp")));
});

test("navigate 外部地址不执行 adb reverse", async (t) => {
  const { c, f } = await debugSetup(t);
  c.ws.send(JSON.stringify({ t: "navigate", rid: 8, socket: PAGE.socket, id: "p1", address: "10.0.2.2:5173" }));
  await until(() => !!reply(c, "navigate", 8));
  assert.equal(reply(c, "navigate", 8).ok, true);
  assert.ok(!f.calls.some((x) => x.startsWith("ensure")));
  assert.ok(f.calls.includes("navigate http://10.0.2.2:5173/"));
});

test("inspect：有 frontendUrl 回经网关代理的地址（测试客户端是网关自己的页面，前端也走网关代理），没有时回 chrome://inspect 提示", async (t) => {
  const bare: WebViewPage = { ...PAGE, socket: "chrome_devtools_remote", pid: undefined, pkg: undefined, id: "p2", title: "Tab", frontendUrl: undefined };
  const { c, srv } = await debugSetup(t, fakeDebug([PAGE, bare]));
  c.ws.send(JSON.stringify({ t: "inspect", rid: 1, socket: PAGE.socket, id: "p1" }));
  c.ws.send(JSON.stringify({ t: "inspect", rid: 2, socket: "chrome_devtools_remote", id: "p2" }));
  c.ws.send(JSON.stringify({ t: "inspect", rid: 3, socket: PAGE.socket, id: "gone" }));
  await until(() => [1, 2, 3].every((rid) => !!reply(c, "inspect", rid)));
  const url = reply(c, "inspect", 1).url as string;
  const prefix = `http://127.0.0.1:${srv.port}/devtools-frontend/serve_rev/@abc/devtools_app.html?ws=127.0.0.1:${srv.port}/devtools/${PAGE.socket}/p1/`;
  assert.ok(url.startsWith(prefix), url);
  assert.match(url.slice(prefix.length), /^[A-Za-z0-9_-]{22,}$/);
  assert.deepEqual(reply(c, "inspect", 2), { t: "inspect", rid: 2, hint: "在 chrome://inspect 里找：chrome_devtools_remote / Tab" });
  assert.deepEqual(reply(c, "inspect", 3), { t: "inspect", rid: 3, error: "页面已关闭" });
});

test("navigate 进行中：同一连接的 webviews 请求和输入不被它卡住", async (t) => {
  const f = fakeDebug();
  let release!: () => void;
  f.navGate = new Promise((r) => (release = r));
  const { c, session } = await debugSetup(t, f);
  c.ws.send(JSON.stringify({ t: "navigate", rid: 1, socket: PAGE.socket, id: "p1", address: "localhost:5173" }));
  await until(() => f.calls.some((x) => x.startsWith("navigate")));
  c.ws.send(JSON.stringify({ t: "webviews", rid: 2 }));
  c.ws.send(JSON.stringify({ t: "key", key: "a", eventType: "keypress" }));
  await until(() => !!reply(c, "webviews", 2) && session!.calls.includes("key"));
  assert.equal(reply(c, "navigate", 1), undefined);
  release();
  await until(() => !!reply(c, "navigate", 1));
  assert.equal(reply(c, "navigate", 1).ok, true);
});

test("切换到另一台设备：旧设备的转发和 reverse 被移除，之后的请求用新设备", async (t) => {
  const a = new FakeSession();
  const b = new FakeSession();
  b.serial = 5556;
  b.id = "emulator-5556";
  const fa = fakeAvd({ B: b });
  const { c, f } = await debugSetup(t, fakeDebug(), a, fa.ops);
  c.ws.send(JSON.stringify({ t: "webviews", rid: 1 }));
  await until(() => !!reply(c, "webviews", 1));
  c.ws.send(JSON.stringify({ t: "use", name: "B" }));
  await until(() => f.calls.includes("close emulator-5554") && f.calls.includes("removeAll emulator-5554"));
  c.ws.send(JSON.stringify({ t: "webviews", rid: 2 }));
  await until(() => !!reply(c, "webviews", 2));
  assert.ok(f.calls.includes("list emulator-5556"), f.calls.join(" | "));
});

test("模拟器退出：这台设备的转发和 reverse 被移除", async (t) => {
  const { c, f, session } = await debugSetup(t);
  c.ws.send(JSON.stringify({ t: "webviews", rid: 1 }));
  await until(() => !!reply(c, "webviews", 1));
  session!.fireClosed();
  await until(() => f.calls.includes("close emulator-5554") && f.calls.includes("removeAll emulator-5554"));
});

test("网关关闭时移除转发和 reverse", async (t) => {
  const { c, f, srv } = await debugSetup(t);
  c.ws.send(JSON.stringify({ t: "navigate", rid: 1, socket: PAGE.socket, id: "p1", address: "localhost:5173" }));
  await until(() => !!reply(c, "navigate", 1));
  await srv.close();
  assert.ok(f.calls.includes("close emulator-5554") && f.calls.includes("removeAll emulator-5554"), f.calls.join(" | "));
});

test("网关关闭不会被已升级但没发消息的连接卡住", async (t) => {
  const { srv, origin } = await setup(t);
  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/`, { headers: { Origin: origin } });
  await new Promise((r) => ws.on("open", r));
  const closing = srv.close();
  const result = await Promise.race([closing.then(() => "closed"), sleep(1000).then(() => "stuck")]);
  ws.terminate();
  assert.equal(result, "closed");
});

test("切换设备时断开指向旧设备的 DevTools 代理连接", async (t) => {
  const up = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise((r) => up.once("listening", r));
  const upSocks: WebSocket[] = [];
  up.on("connection", (ws) => upSocks.push(ws));
  t.after(() => new Promise<void>((r) => { for (const s of up.clients) s.terminate(); up.close(() => r()); }));
  const f = fakeDebug();
  f.port = (up.address() as { port: number }).port;
  const a = new FakeSession();
  const b = new FakeSession();
  b.serial = 5556;
  b.id = "emulator-5556";
  const fa = fakeAvd({ B: b });
  const { c, srv } = await debugSetup(t, f, a, fa.ops);
  const dt = new WebSocket(await inspectWs(c, srv.port), { headers: { Origin: APPSPOT } });
  dt.on("error", () => {});
  t.after(() => dt.terminate());
  const dtClosed = new Promise<void>((r) => dt.on("close", () => r()));
  await new Promise((r) => dt.once("open", r));
  await until(() => upSocks.length === 1);
  const upClosed = new Promise<void>((r) => upSocks[0].on("close", () => r()));
  c.ws.send(JSON.stringify({ t: "use", name: "B" }));
  await Promise.race([Promise.all([dtClosed, upClosed]), sleep(1000).then(() => { throw new Error("代理连接没有断开"); })]);
});

// Fix 5: 没有连接设备时应回复 error 而非空列表
test("webviews：没有连接设备时回 error:'没有连接设备'", async (t) => {
  const f = fakeDebug();
  // null session = 没有设备
  const r = await setup(t, null, async () => null, undefined, f.deps);
  const c = await r.connect();
  hello(c);
  await until(() => c.msgs.some((m) => m.t === "status"));
  c.ws.send(JSON.stringify({ t: "webviews", rid: 99 }));
  await until(() => !!reply(c, "webviews", 99));
  const msg = reply(c, "webviews", 99);
  assert.ok(msg?.error?.includes("没有连接设备"), `期望 error 含 "没有连接设备"，实际：${JSON.stringify(msg)}`);
});

test("inspect：没有连接设备时回 error:'没有连接设备'", async (t) => {
  const f = fakeDebug();
  const r = await setup(t, null, async () => null, undefined, f.deps);
  const c = await r.connect();
  hello(c);
  await until(() => c.msgs.some((m) => m.t === "status"));
  c.ws.send(JSON.stringify({ t: "inspect", rid: 100, socket: PAGE.socket, id: "p1" }));
  await until(() => !!reply(c, "inspect", 100));
  const msg = reply(c, "inspect", 100);
  assert.ok(msg?.error?.includes("没有连接设备"), `期望 error 含 "没有连接设备"，实际：${JSON.stringify(msg)}`);
});

// Fix 2: navigate 整体超时兜底（12s → 注入短值）
test("navigate 超时兜底：connectCdp 挂死时在 navigateTimeoutMs 内返回 {ok:false,error:超时}", async (t) => {
  const f = fakeDebug();
  // 覆盖 connectCdp：永远不 resolve（模拟 WS 握手无响应）
  f.deps = {
    ...f.deps,
    navigateTimeoutMs: 150,
    connectCdp: async (_wsUrl: string): Promise<CdpClient> => new Promise(() => {}),
  };
  const { c } = await debugSetup(t, f);
  const start = Date.now();
  c.ws.send(JSON.stringify({ t: "navigate", rid: 50, socket: PAGE.socket, id: "p1", address: "localhost:5173" }));
  await until(() => !!reply(c, "navigate", 50), 2000);
  const elapsed = Date.now() - start;
  const msg = reply(c, "navigate", 50);
  assert.ok(!msg.ok, "应返回 ok:false");
  assert.ok(msg.error?.includes("超时"), `error 应含 "超时"，实际：${JSON.stringify(msg.error)}`);
  assert.ok(elapsed < 1000, `应在 1s 内超时，实际 ${elapsed}ms`);
});

test("/devtools/：带 inspect 签发的票据、Origin 是 appspot 时接通上游", async (t) => {
  const up = await upstream(t);
  const f = fakeDebug();
  f.port = up.port;
  const { c, srv } = await debugSetup(t, f);
  const dt = rawClient(t, await inspectWs(c, srv.port), APPSPOT);
  await new Promise((r) => dt.ws.once("open", r));
  await until(() => up.socks.length === 1);
});

test("busy：H5 控制台连着时报“正在调试 H5”，关掉后恢复", async (t) => {
  const up = await upstream(t);
  const f = fakeDebug();
  f.port = up.port;
  const { c, srv } = await debugSetup(t, f);
  assert.equal(srv.busy(), null);
  const dt = rawClient(t, await inspectWs(c, srv.port), APPSPOT);
  await new Promise((r) => dt.ws.once("open", r));
  await until(() => up.socks.length === 1);
  assert.equal(srv.busy(), "正在调试 H5");
  dt.ws.close();
  await until(() => srv.busy() === null);
});

test("/devtools/：白名单里的 Origin 带票据也能接通", async (t) => {
  const up = await upstream(t);
  const f = fakeDebug();
  f.port = up.port;
  const { c, srv, origin } = await debugSetup(t, f);
  const dt = rawClient(t, await inspectWs(c, srv.port), origin);
  await new Promise((r) => dt.ws.once("open", r));
  await until(() => up.socks.length === 1);
});

test("/devtools/：票据用过一次就作废 → 4001", async (t) => {
  const up = await upstream(t);
  const f = fakeDebug();
  f.port = up.port;
  const { c, srv } = await debugSetup(t, f);
  const url = await inspectWs(c, srv.port);
  const first = rawClient(t, url, APPSPOT);
  await new Promise((r) => first.ws.once("open", r));
  const again = rawClient(t, url, APPSPOT);
  assert.equal(await again.closed, CLOSE_BAD_TOKEN);
  assert.equal(up.socks.length, 1);
});

test("/devtools/：没有票据、票据错、票据绑的是别的页面 → 4001，不连上游", async (t) => {
  const up = await upstream(t);
  const f = fakeDebug([PAGE, { ...PAGE, id: "p2" }]);
  f.port = up.port;
  const { c, srv } = await debugSetup(t, f);
  const forP2 = (await inspectWs(c, srv.port, PAGE.socket, "p2")).split("/").at(-1);
  for (const path of [
    `/devtools/${PAGE.socket}/p1`,
    `/devtools/${PAGE.socket}/p1/${randomToken()}`,
    `/devtools/${PAGE.socket}/p1/${forP2}`,
  ]) {
    const dt = rawClient(t, `ws://127.0.0.1:${srv.port}${path}`, APPSPOT);
    assert.equal(await dt.closed, CLOSE_BAD_TOKEN, path);
  }
  assert.equal(up.socks.length, 0);
});

test("/devtools/：Origin 不是 appspot 也不在白名单 → 4003，票据不作废", async (t) => {
  const up = await upstream(t);
  const f = fakeDebug();
  f.port = up.port;
  const { c, srv } = await debugSetup(t, f);
  const url = await inspectWs(c, srv.port);
  for (const origin of ["https://evil.example", undefined]) {
    const dt = rawClient(t, url, origin);
    assert.equal(await dt.closed, CLOSE_ORIGIN, String(origin));
  }
  assert.equal(up.socks.length, 0);
  const ok = rawClient(t, url, APPSPOT);
  await new Promise((r) => ok.ws.once("open", r));
});

/** 假的环境检查和安装器：记下 run 的调用，进度和许可证由测试手动推。 */
function fakeSetup(opts: { freeMb?: number; checkThrows?: boolean; catalog?: AvdCatalog; missing?: EnvMissing[] } = {}) {
  const runs: string[][] = [];
  const specs: unknown[] = [];
  const accepted: number[] = [];
  const rejected: number[] = [];
  let progress: ((p: { id: string; phase: "download" | "unpack" | "license" | "install" | "done" | "failed"; pct?: number; logTail: string }) => void) | undefined;
  let license: ((l: { id: number; name: string; text: string }) => void) | undefined;
  let finish!: () => void;
  let missing: EnvMissing[] = opts.missing ?? [
    { id: "emulator", detail: "没有模拟器程序", sizeMb: 400, diskMb: 1200, command: 'sdkmanager "emulator"', auto: true },
  ];
  const free = opts.freeMb ?? 100_000;
  const ops: SetupOps = {
    check: async () => {
      if (opts.checkThrows) throw new Error("读不了目录");
      return { ok: missing.length === 0, missing, sdkRoot: "/sdk", avdHome: "/avd", freeMb: free, avdFreeMb: free, sameDisk: true };
    },
    installer: {
      run: (ids, onProgress, onLicense, job) => {
        runs.push(ids);
        specs.push(job);
        progress = onProgress;
        license = onLicense;
        return new Promise<void>((r) => (finish = () => { missing = []; r(); }));
      },
      acceptLicenses: (id) => void accepted.push(id),
      rejectLicenses: (id) => void rejected.push(id),
      stop: () => {},
    },
    catalog: async () => opts.catalog ?? CATALOG,
  };
  return {
    ops, runs, specs, accepted, rejected,
    progress: (p: Parameters<NonNullable<typeof progress>>[0]) => progress!(p),
    license: (l: { id: number; name: string; text: string }) => license!(l),
    finish: () => finish(),
  };
}

test("hello 后先收到 env（没有模拟器时也发）", async (t) => {
  const f = fakeSetup();
  const { connect } = await setup(t, null, undefined, undefined, undefined, f.ops);
  const c = await connect();
  hello(c);
  await until(() => c.msgs.some((m) => m.t === "status"));
  assert.equal(c.msgs[0].t, "env");
  assert.equal(c.msgs[0].ok, false);
  assert.equal(c.msgs[0].missing[0].id, "emulator");
});

test("环境检查本身出错：env 是 ok:false 并带 error，不当成齐全", async (t) => {
  const f = fakeSetup({ checkThrows: true });
  const { connect } = await setup(t, null, undefined, undefined, undefined, f.ops);
  const c = await connect();
  hello(c);
  await until(() => c.msgs.some((m) => m.t === "env"));
  const env = c.msgs.find((m) => m.t === "env");
  assert.equal(env.ok, false);
  assert.match(env.error, /读不了目录/);
});

test("未确认（没收到 install）时不会执行任何安装", async (t) => {
  const f = fakeSetup();
  const { connect } = await setup(t, null, undefined, undefined, undefined, f.ops);
  const c = await connect();
  hello(c);
  await until(() => c.msgs.some((m) => m.t === "env"));
  // 同意许可证、别的消息都不是安装确认
  c.ws.send(JSON.stringify({ t: "acceptLicenses", id: 1 }));
  c.ws.send(JSON.stringify({ t: "avds" }));
  c.ws.send(JSON.stringify({ t: "install" }));
  c.ws.send(JSON.stringify({ t: "install", ids: "emulator" }));
  await sleep(80);
  assert.deepEqual(f.runs, []);
  assert.deepEqual(f.accepted, []);
});

test("install：按 ids 安装，进度和许可证广播给所有连接，结束后重发 env", async (t) => {
  const f = fakeSetup();
  const { connect } = await setup(t, null, undefined, undefined, undefined, f.ops);
  const a = await connect();
  const b = await connect();
  hello(a);
  hello(b);
  await until(() => a.msgs.some((m) => m.t === "env") && b.msgs.some((m) => m.t === "env"));
  a.ws.send(JSON.stringify({ t: "install", ids: ["emulator", "bogus"] }));
  await until(() => f.runs.length === 1);
  assert.deepEqual(f.runs, [["emulator"]]);
  // 安装进行中再点：不会开第二次
  a.ws.send(JSON.stringify({ t: "install", ids: ["emulator"] }));
  f.progress({ id: "emulator", phase: "license", logTail: "Accept? (y/N):" });
  f.license({ id: 7, name: "android-sdk-license", text: "Terms and Conditions" });
  await until(() => b.msgs.some((m) => m.t === "licenses"));
  assert.deepEqual(b.msgs.find((m) => m.t === "install"), { t: "install", progress: { id: "emulator", phase: "license", logTail: "Accept? (y/N):" } });
  assert.deepEqual(b.msgs.find((m) => m.t === "licenses"), { t: "licenses", licence: { id: 7, name: "android-sdk-license", text: "Terms and Conditions" } });
  // 后连上的页面也能拿到正在等的许可证
  const late = await connect();
  hello(late);
  await until(() => late.msgs.some((m) => m.t === "licenses"));
  b.ws.send(JSON.stringify({ t: "acceptLicenses", id: 7 }));
  await until(() => f.accepted.length === 1);
  assert.deepEqual(f.accepted, [7]);
  f.finish();
  await until(() => a.msgs.filter((m) => m.t === "env").length === 2);
  assert.equal(a.msgs.filter((m) => m.t === "env").at(-1).ok, true);
  assert.equal(f.runs.length, 1);
  assert.ok(a.msgs.some((m) => m.t === "licenses" && m.licence === null));
});

test("同意带的 id 不是正在显示的许可证：网关不转给安装器", async (t) => {
  const f = fakeSetup();
  const { connect } = await setup(t, null, undefined, undefined, undefined, f.ops);
  const c = await connect();
  hello(c);
  await until(() => c.msgs.some((m) => m.t === "env"));
  c.ws.send(JSON.stringify({ t: "install", ids: ["emulator"] }));
  await until(() => f.runs.length === 1);
  f.license({ id: 3, name: "android-sdk-license", text: "A" });
  f.license({ id: 4, name: "android-sdk-arm-dbt-license", text: "B" });
  await until(() => c.msgs.filter((m) => m.t === "licenses").length === 2);
  c.ws.send(JSON.stringify({ t: "acceptLicenses", id: 3 }));
  c.ws.send(JSON.stringify({ t: "rejectLicenses", id: 3 }));
  await sleep(50);
  assert.deepEqual(f.accepted, []);
  assert.deepEqual(f.rejected, []);
  c.ws.send(JSON.stringify({ t: "acceptLicenses", id: 4 }));
  await until(() => f.accepted.length === 1);
  assert.deepEqual(f.accepted, [4]);
});

test("磁盘不够：网关拒绝 install，和页面用同一套算法给出还差多少", async (t) => {
  // emulator 下载 400 + 安装后 1200 + 余量 1024 = 2624，剩 2000，差 624 MB
  const f = fakeSetup({ freeMb: 2000 });
  const { connect } = await setup(t, null, undefined, undefined, undefined, f.ops);
  const c = await connect();
  hello(c);
  await until(() => c.msgs.some((m) => m.t === "env"));
  c.ws.send(JSON.stringify({ t: "install", ids: ["emulator"] }));
  await until(() => c.msgs.some((m) => m.t === "error"));
  assert.match(c.msgs.find((m) => m.t === "error").message, /磁盘空间不足：还需要约 0\.6 GB/);
  assert.deepEqual(f.runs, []);
});

test("install 系统镜像：装环境检查里说的那个镜像（比如设备缺的 Android 15）", async (t) => {
  const pkg = "system-images;android-35;google_apis;arm64-v8a";
  const f = fakeSetup({ missing: [{ id: "system-image", detail: "设备 A 的系统镜像 Android 15 不在了", pkg, sizeMb: 1800, diskMb: 5400, auto: true }] });
  const c = await setupConnected(t, f);
  c.ws.send(JSON.stringify({ t: "install", ids: ["system-image"] }));
  await until(() => f.runs.length === 1);
  assert.deepEqual(f.specs, [{ image: pkg }]);
});

test("install 只装环境检查里缺的项：已装好的不重下，全都不缺时拒绝", async (t) => {
  // 只缺 emulator：页面要 platform-tools 也不给装（那会替换掉已有的 adb，也绕过了磁盘检查）
  const f = fakeSetup();
  const c = await setupConnected(t, f);
  c.ws.send(JSON.stringify({ t: "install", ids: ["platform-tools"] }));
  await until(() => c.msgs.some((m) => m.t === "error"));
  assert.match(c.msgs.find((m) => m.t === "error").message, /不缺/);
  assert.deepEqual(f.runs, []);
  c.ws.send(JSON.stringify({ t: "install", ids: ["platform-tools", "emulator"] }));
  await until(() => f.runs.length === 1);
  assert.deepEqual(f.runs, [["emulator"]]);
});

test("install system-image 但环境检查不缺镜像：拒绝，不会覆盖已装的 android-34", async (t) => {
  const f = fakeSetup();
  const c = await setupConnected(t, f);
  c.ws.send(JSON.stringify({ t: "install", ids: ["system-image"] }));
  await until(() => c.msgs.some((m) => m.t === "error"));
  assert.deepEqual(f.runs, []);
});

test("install 不能自动装的项：拒绝", async (t) => {
  const f = fakeSetup({ missing: [{ id: "system-image", detail: "x86_64", pkg: "system-images;android-29;google_apis;x86_64", auto: false }] });
  const c = await setupConnected(t, f);
  c.ws.send(JSON.stringify({ t: "install", ids: ["system-image"] }));
  await until(() => c.msgs.some((m) => m.t === "error"));
  assert.match(c.msgs.find((m) => m.t === "error").message, /不能自动安装/);
  assert.deepEqual(f.runs, []);
});

const IMG34 = { pkg: "system-images;android-34;google_apis;arm64-v8a", api: "34", apiLevel: 34, tag: "google_apis", installed: true, version: "Android 14" };
const IMG27 = { pkg: "system-images;android-27;google_apis;arm64-v8a", api: "27", apiLevel: 27, tag: "google_apis", installed: true, version: "Android 8.1" };
const IMG36 = { pkg: "system-images;android-36;google_apis;arm64-v8a", api: "36", apiLevel: 36, tag: "google_apis", installed: false, version: "Android 16", sizeMb: 1786, diskMb: 5358 };
const CATALOG: AvdCatalog = {
  devices: [{ id: "pixel_5", name: "Pixel 5", oem: "Google" }, { id: "Nexus 5X", name: "Nexus 5X", oem: "Google" }],
  images: [IMG34, IMG27, IMG36], existing: ["emu_web_default"],
  defaultDevice: "pixel_5", defaultImage: IMG34.pkg,
};
const createMsg = (over: object = {}) => JSON.stringify({ t: "createAvd", name: "Pixel_5_API_36", device: "pixel_5", image: IMG36.pkg, ...over });

async function setupConnected(t: import("node:test").TestContext, f: ReturnType<typeof fakeSetup>) {
  const { connect } = await setup(t, null, undefined, undefined, undefined, f.ops);
  const c = await connect();
  hello(c);
  await until(() => c.msgs.some((m) => m.t === "env"));
  return c;
}

test("catalog：回复机型和系统版本目录，不安装任何东西", async (t) => {
  const f = fakeSetup();
  const c = await setupConnected(t, f);
  c.ws.send(JSON.stringify({ t: "catalog" }));
  await until(() => c.msgs.some((m) => m.t === "catalog"));
  assert.deepEqual(c.msgs.find((m) => m.t === "catalog"), { t: "catalog", catalog: CATALOG });
  await sleep(30);
  assert.deepEqual(f.runs, []);
});

test("createAvd：镜像没装时先装镜像再建设备，spec 带名字、机型、镜像和内存", async (t) => {
  const f = fakeSetup();
  const c = await setupConnected(t, f);
  c.ws.send(createMsg());
  await until(() => f.runs.length === 1);
  assert.deepEqual(f.runs, [["system-image", "avd"]]);
  assert.deepEqual(f.specs, [{ avd: { name: "Pixel_5_API_36", device: "pixel_5", image: IMG36.pkg, ramMb: 4096 } }]);
});

test("createAvd：镜像已装只建设备；低于 API 28 的内存 2048", async (t) => {
  const f = fakeSetup();
  const c = await setupConnected(t, f);
  c.ws.send(createMsg({ name: "Nexus_5X_API_27", device: "Nexus 5X", image: IMG27.pkg }));
  await until(() => f.runs.length === 1);
  assert.deepEqual(f.runs, [["avd"]]);
  assert.deepEqual(f.specs, [{ avd: { name: "Nexus_5X_API_27", device: "Nexus 5X", image: IMG27.pkg, ramMb: 2048 } }]);
});

test("createAvd：重名、名字不合法、机型或镜像不在目录里，都拒绝且不安装", async (t) => {
  const f = fakeSetup();
  const c = await setupConnected(t, f);
  const bad = [
    [{ name: "EMU_WEB_DEFAULT" }, /已有同名设备 emu_web_default/],
    [{ name: "a b" }, /只能用/],
    [{ device: "tv_4k" }, /没有这个机型：tv_4k/],
    [{ image: "system-images;android-36;google_apis;x86_64" }, /没有这个系统版本/],
  ] as const;
  for (const [over, re] of bad) {
    const n = c.msgs.filter((m) => m.t === "error").length;
    c.ws.send(createMsg(over));
    await until(() => c.msgs.filter((m) => m.t === "error").length === n + 1);
    assert.match(c.msgs.filter((m) => m.t === "error").at(-1).message, re);
  }
  assert.deepEqual(f.runs, []);
});

test("createAvd：磁盘不够时网关拒绝，算上没装的镜像", async (t) => {
  // 镜像 1786 + 5358 + AVD 12288 + 余量 1024 = 20456，剩 15000 差 5456 MB
  const f = fakeSetup({ freeMb: 15000 });
  const c = await setupConnected(t, f);
  c.ws.send(createMsg());
  await until(() => c.msgs.some((m) => m.t === "error"));
  assert.match(c.msgs.find((m) => m.t === "error").message, /磁盘空间不足：还需要约 5\.3 GB/);
  assert.deepEqual(f.runs, []);
  // 镜像已装时只要 12288 + 1024，够
  c.ws.send(createMsg({ image: IMG34.pkg, name: "Pixel_5_API_34" }));
  await until(() => f.runs.length === 1);
  assert.deepEqual(f.runs, [["avd"]]);
});

test("install 不再接受 avd：建设备要走 createAvd", async (t) => {
  const f = fakeSetup();
  const c = await setupConnected(t, f);
  c.ws.send(JSON.stringify({ t: "install", ids: ["emulator", "avd"] }));
  await until(() => c.msgs.some((m) => m.t === "error"));
  assert.match(c.msgs.find((m) => m.t === "error").message, /创建设备/);
  assert.deepEqual(f.runs, []);
});

// ─────────────── adb 无响应的归类 ───────────────

test("webviews：adb 无响应时回复统一的话和 code，不带“读取失败”前缀", async (t) => {
  const f = fakeDebug();
  const { c } = await debugSetup(t, f);
  f.deps.forDevice = ((orig) => (id: string) => {
    const d = orig(id);
    return { ...d, webviews: { ...d.webviews, list: async () => { throw new AdbUnresponsive(); } } };
  })(f.deps.forDevice);
  c.ws.send(JSON.stringify({ t: "webviews", rid: 31 }));
  await until(() => !!reply(c, "webviews", 31));
  assert.deepEqual(reply(c, "webviews", 31), { t: "webviews", rid: 31, list: [], error: ADB_UNRESPONSIVE, code: "adb-unresponsive" });
});

test("navigate：adb reverse 无响应时回复统一的话和 code", async (t) => {
  const f = fakeDebug();
  f.ensureError = new AdbUnresponsive();
  const { c } = await debugSetup(t, f);
  c.ws.send(JSON.stringify({ t: "navigate", rid: 32, socket: PAGE.socket, id: "p1", address: "localhost:5173" }));
  await until(() => !!reply(c, "navigate", 32));
  assert.deepEqual(reply(c, "navigate", 32), { t: "navigate", rid: 32, ok: false, error: ADB_UNRESPONSIVE, code: "adb-unresponsive" });
});

test("输入中文时 adb 粘贴无响应：告诉这个页面 adb 没有响应", async (t) => {
  const { connect, session } = await setup(t);
  session!.textError = new AdbUnresponsive();
  const c = await connect();
  hello(c);
  await until(() => c.msgs.some((m) => m.t === "ready"));
  c.ws.send(JSON.stringify({ t: "text", text: "你好" }));
  await until(() => c.msgs.some((m) => m.t === "error"));
  assert.deepEqual(c.msgs.find((m) => m.t === "error"), { t: "error", code: "adb-unresponsive", message: ADB_UNRESPONSIVE });
});

test("模拟器拒绝按键时把原因告诉页面，不再只写网关日志", async (t) => {
  const { connect, session } = await setup(t);
  session!.keyError = new Error("12 UNIMPLEMENTED: sendKey");
  const c = await connect();
  hello(c);
  await until(() => c.msgs.some((m) => m.t === "ready"));
  c.ws.send(JSON.stringify({ t: "key", key: "GoBack", eventType: "keypress" }));
  await until(() => c.msgs.some((m) => m.t === "error"));
  assert.deepEqual(c.msgs.find((m) => m.t === "error"), { t: "error", message: "按键没有发出：12 UNIMPLEMENTED: sendKey" });
});

// ─────────────── 重启模拟器 ───────────────

/** 可控的开机等待：resolve 前一直在“重启中”。 */
function gatedWait() {
  const g = { calls: [] as string[], finish: (_r: "done" | "adb-down") => {} };
  const wait = (id: string) => new Promise<"done" | "adb-down">((r) => { g.calls.push(id); g.finish = r; });
  return { g, wait };
}

async function rebootSetup(t: import("node:test").TestContext, f = fakeDebug()) {
  const { g, wait } = gatedWait();
  const session = new FakeSession();
  const r = await setup(t, session, undefined, undefined, f.deps, undefined, { rebootWait: wait });
  const c = await r.connect();
  hello(c);
  await until(() => c.msgs.some((m) => m.t === "ready"));
  return { ...r, c, g, session, f };
}

test("reboot：没发 hello 就发，按未鉴权关闭，不重启", async (t) => {
  const { connect, session } = await setup(t);
  const c = await connect();
  c.ws.send(JSON.stringify({ t: "reboot" }));
  assert.equal(await c.closed, CLOSE_NO_HELLO);
  assert.equal(session!.reboots, 0);
});

test("reboot：重启中广播 rebooting，开机完成后恢复 connected 并告知结果", async (t) => {
  const { c, g, session, connect } = await rebootSetup(t);
  const other = await connect();
  hello(other);
  await until(() => other.msgs.some((m) => m.t === "ready"));
  c.ws.send(JSON.stringify({ t: "reboot" }));
  await until(() => c.msgs.some((m) => m.t === "status" && m.state === "rebooting") && other.msgs.some((m) => m.t === "status" && m.state === "rebooting"));
  assert.equal(session.reboots, 1);
  assert.deepEqual(g.calls, ["emulator-5554"]);
  g.finish("done");
  for (const x of [c, other]) {
    await until(() => x.msgs.some((m) => m.t === "reboot"));
    assert.deepEqual(x.msgs.find((m) => m.t === "reboot"), { t: "reboot", result: "done" });
    const states = x.msgs.filter((m) => m.t === "status").map((m) => m.state);
    assert.deepEqual(states.slice(-2), ["rebooting", "connected"]);
  }
});

test("reboot：同时只允许一个，第二个请求得到提示", async (t) => {
  const { c, g, session, connect } = await rebootSetup(t);
  const other = await connect();
  hello(other);
  await until(() => other.msgs.some((m) => m.t === "ready"));
  c.ws.send(JSON.stringify({ t: "reboot" }));
  await until(() => c.msgs.some((m) => m.state === "rebooting"));
  other.ws.send(JSON.stringify({ t: "reboot" }));
  await until(() => other.msgs.some((m) => m.t === "error"));
  assert.match(other.msgs.find((m) => m.t === "error").message, /正在重启/);
  assert.equal(session.reboots, 1);
  g.finish("done");
});

test("reboot：重启中丢掉输入、H5 列表直接回“正在重启”，并收掉旧的调试转发", async (t) => {
  const { c, g, session, f } = await rebootSetup(t);
  c.ws.send(JSON.stringify({ t: "webviews", rid: 1 }));
  await until(() => !!reply(c, "webviews", 1));
  c.ws.send(JSON.stringify({ t: "reboot" }));
  await until(() => c.msgs.some((m) => m.state === "rebooting"));
  await until(() => f.calls.includes("close emulator-5554") && f.calls.includes("removeAll emulator-5554"));
  c.ws.send(JSON.stringify({ t: "touch", x: 1, y: 2, down: true }));
  c.ws.send(JSON.stringify({ t: "key", key: "GoHome", eventType: "keypress" }));
  c.ws.send(JSON.stringify({ t: "webviews", rid: 2 }));
  await until(() => !!reply(c, "webviews", 2));
  assert.match(reply(c, "webviews", 2).error, /正在重启/);
  await sleep(30);
  assert.deepEqual(session.calls, []);
  g.finish("done");
  await until(() => c.msgs.some((m) => m.t === "reboot"));
  c.ws.send(JSON.stringify({ t: "key", key: "GoHome", eventType: "keypress" }));
  await until(() => session.calls.includes("key"));
});

test("reboot：重启中新连上的页面也看到 rebooting", async (t) => {
  const { c, g, connect } = await rebootSetup(t);
  c.ws.send(JSON.stringify({ t: "reboot" }));
  await until(() => c.msgs.some((m) => m.state === "rebooting"));
  const late = await connect();
  hello(late);
  await until(() => late.msgs.some((m) => m.t === "status" && m.state === "rebooting"));
  g.finish("adb-down");
  await until(() => late.msgs.some((m) => m.t === "reboot"));
  assert.deepEqual(late.msgs.find((m) => m.t === "reboot"), { t: "reboot", result: "adb-down" });
});

test("reboot：gRPC 重启指令失败，回 failed 并恢复 connected，可以再试", async (t) => {
  const { c, g, session } = await rebootSetup(t);
  session.rebootError = new Error("UNAVAILABLE");
  c.ws.send(JSON.stringify({ t: "reboot" }));
  await until(() => c.msgs.some((m) => m.t === "reboot"));
  assert.deepEqual(c.msgs.find((m) => m.t === "reboot"), { t: "reboot", result: "failed", error: "UNAVAILABLE" });
  assert.equal(c.msgs.filter((m) => m.t === "status").at(-1).state, "connected");
  assert.deepEqual(g.calls, []);
  session.rebootError = undefined;
  c.ws.send(JSON.stringify({ t: "reboot" }));
  await until(() => session.reboots === 2);
  g.finish("done");
});

test("reboot：没有连接设备时回提示", async (t) => {
  const { g, wait } = gatedWait();
  const r = await setup(t, null, async () => null, undefined, undefined, undefined, { rebootWait: wait });
  const c = await r.connect();
  hello(c);
  await until(() => c.msgs.some((m) => m.t === "status"));
  c.ws.send(JSON.stringify({ t: "reboot" }));
  await until(() => c.msgs.some((m) => m.t === "error"));
  assert.match(c.msgs.find((m) => m.t === "error").message, /没有连接设备/);
  assert.deepEqual(g.calls, []);
});

// ---- 拖文件进设备 ----
import { readdir, readFile as readFileFs } from "node:fs/promises";
import { encodeUploadChunk, UPLOAD_CHUNK_BYTES, UPLOAD_MAX_BYTES } from "../../shared/upload.ts";
import type { FileOps } from "../src/server.ts";

/** 假 adb：记下参数和调用时临时文件的内容；out / err 决定结果，gate 为真时挂起到 release()。 */
function fakeFiles(root: string) {
  const f = {
    calls: [] as Array<{ id: string; args: string[]; content: string | null }>,
    out: "Success\n",
    err: null as Error | null,
    gate: false,
    release: () => {},
    ops: {
      tmpRoot: root,
      adb: async (id: string, args: string[]) => {
        const local = args[0] === "install" ? args[3] : args[1];
        const content = await readFileFs(local, "utf8").catch(() => null);
        f.calls.push({ id, args, content });
        if (f.gate) await new Promise<void>((r) => (f.release = r));
        if (f.err) throw f.err;
        return f.out;
      },
    } satisfies FileOps,
  };
  return f;
}

async function uploadSetup(t: import("node:test").TestContext, session: FakeSession | null = new FakeSession()) {
  const root = await mkdtemp(join(tmpdir(), "emu-upload-"));
  const files = fakeFiles(root);
  const s = await setup(t, session, undefined, undefined, undefined, undefined, { files: files.ops });
  const c = await s.connect();
  hello(c);
  if (session) await until(() => c.msgs.some((m) => m.t === "ready"));
  else await until(() => c.msgs.some((m) => m.t === "status"));
  const ups = (id: number) => c.msgs.filter((m) => m.t === "upload" && m.id === id);
  const last = (id: number) => ups(id).at(-1);
  const tempEntries = () => readdir(root);
  return { ...s, c, files, root, ups, last, tempEntries };
}

const sendFile = async (c: Client, id: number, name: string, body: Buffer, ups: (id: number) => any[]) => {
  c.ws.send(JSON.stringify({ t: "upload", id, name, size: body.byteLength }));
  await until(() => ups(id).length > 0);
  if (ups(id)[0].state !== "uploading") return;
  for (let off = 0; off < body.byteLength; off += UPLOAD_CHUNK_BYTES) c.ws.send(encodeUploadChunk(id, body.subarray(off, off + UPLOAD_CHUNK_BYTES)));
};

test("传 APK：分片逐片确认，收齐后 adb install -r -t 临时文件，装完回 done 并删掉临时文件", async (t) => {
  const u = await uploadSetup(t);
  const body = Buffer.alloc(UPLOAD_CHUNK_BYTES * 2 + 10, "a");
  await sendFile(u.c, 1, "app-debug.apk", body, u.ups);
  await until(() => u.last(1)?.state === "done");
  const states = u.ups(1).map((m) => m.state);
  assert.deepEqual(states.filter((x) => x !== "uploading"), ["installing", "done"]);
  assert.deepEqual(u.ups(1).filter((m) => m.state === "uploading").map((m) => m.received), [0, UPLOAD_CHUNK_BYTES, 2 * UPLOAD_CHUNK_BYTES, body.byteLength]);
  assert.equal(u.files.calls.length, 1);
  const call = u.files.calls[0];
  assert.equal(call.id, "emulator-5554");
  assert.deepEqual(call.args.slice(0, 3), ["install", "-r", "-t"]);
  assert.ok(call.args[3].startsWith(u.root) && call.args[3].endsWith("/app-debug.apk"));
  assert.equal(call.content, body.toString("utf8"));
  await until(() => false, 50).catch(() => {});
  assert.deepEqual(await u.tempEntries(), []);
});

test("传普通文件：adb push 到下载文件夹，文件名只留最后一段", async (t) => {
  const u = await uploadSetup(t);
  await sendFile(u.c, 2, "../../etc/notes.txt", Buffer.from("hello"), u.ups);
  await until(() => u.last(2)?.state === "done");
  assert.ok(u.ups(2).some((m) => m.state === "pushing"));
  const call = u.files.calls[0];
  assert.equal(call.args[0], "push");
  assert.ok(call.args[1].startsWith(u.root) && call.args[1].endsWith("/notes.txt"));
  assert.equal(call.args[2], "/sdcard/Download/notes.txt");
  assert.equal(call.content, "hello");
});

test("空文件也能传：不发分片，直接进下一步", async (t) => {
  const u = await uploadSetup(t);
  await sendFile(u.c, 3, "empty.txt", Buffer.alloc(0), u.ups);
  await until(() => u.last(3)?.state === "done");
  assert.equal(u.files.calls[0].content, "");
});

test("安装失败：回 failed，带 adb 的失败码和中文说明，临时文件删掉", async (t) => {
  const u = await uploadSetup(t);
  u.files.err = new Error("Command failed: adb install\nadb: failed to install /x/a.apk: Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: signatures do not match]");
  await sendFile(u.c, 4, "a.apk", Buffer.from("x"), u.ups);
  await until(() => u.last(4)?.state === "failed");
  assert.match(u.last(4).error, /^INSTALL_FAILED_UPDATE_INCOMPATIBLE（.*签名.*）$/);
  await until(() => false, 50).catch(() => {});
  assert.deepEqual(await u.tempEntries(), []);
});

test("adb 退出 0 但输出里有 Failure：也算失败", async (t) => {
  const u = await uploadSetup(t);
  u.files.out = "Performing Streamed Install\nFailure [INSTALL_FAILED_NO_MATCHING_ABIS: Failed to extract native libraries]\n";
  await sendFile(u.c, 5, "a.apk", Buffer.from("x"), u.ups);
  await until(() => u.last(5)?.state === "failed");
  assert.match(u.last(5).error, /arm64/);
});

test("传到一半连接断开：临时文件删掉，不跑 adb", async (t) => {
  const u = await uploadSetup(t);
  const body = Buffer.alloc(UPLOAD_CHUNK_BYTES * 3, "b");
  u.c.ws.send(JSON.stringify({ t: "upload", id: 6, name: "big.apk", size: body.byteLength }));
  await until(() => u.ups(6).length > 0);
  u.c.ws.send(encodeUploadChunk(6, body.subarray(0, UPLOAD_CHUNK_BYTES)));
  await until(() => u.last(6)?.received === UPLOAD_CHUNK_BYTES);
  assert.equal((await u.tempEntries()).length, 1);
  u.c.ws.terminate();
  await until(() => u.logs.some((l) => l.includes("连接断开")));
  await sleep(50);
  assert.deepEqual(await u.tempEntries(), []);
  assert.equal(u.files.calls.length, 0);
});

test("安装途中连接断开：等 adb 结束后再删临时文件", async (t) => {
  const u = await uploadSetup(t);
  u.files.gate = true;
  await sendFile(u.c, 7, "a.apk", Buffer.from("x"), u.ups);
  await until(() => u.files.calls.length === 1);
  u.c.ws.terminate();
  await sleep(50);
  assert.equal((await u.tempEntries()).length, 1);
  u.files.release();
  await sleep(50);
  assert.deepEqual(await u.tempEntries(), []);
});

test("超过 2 GB：直接拒绝，不建临时文件", async (t) => {
  const u = await uploadSetup(t);
  u.c.ws.send(JSON.stringify({ t: "upload", id: 8, name: "huge.apk", size: UPLOAD_MAX_BYTES + 1 }));
  await until(() => u.ups(8).length > 0);
  assert.equal(u.last(8).state, "failed");
  assert.match(u.last(8).error, /太大/);
  assert.deepEqual(await u.tempEntries(), []);
});

test("文件名不合法、不支持的格式：拒绝", async (t) => {
  const u = await uploadSetup(t);
  u.c.ws.send(JSON.stringify({ t: "upload", id: 9, name: "../..", size: 1 }));
  u.c.ws.send(JSON.stringify({ t: "upload", id: 10, name: "game.xapk", size: 1 }));
  await until(() => u.ups(9).length > 0 && u.ups(10).length > 0);
  assert.deepEqual(u.last(9), { t: "upload", id: 9, state: "failed", error: "文件名不合法" });
  assert.deepEqual(u.last(10), { t: "upload", id: 10, state: "failed", error: "暂不支持 .xapk，请提供 .apk" });
  assert.deepEqual(await u.tempEntries(), []);
});

test("没有连接设备：拒绝", async (t) => {
  const u = await uploadSetup(t, null);
  u.c.ws.send(JSON.stringify({ t: "upload", id: 11, name: "a.apk", size: 1 }));
  await until(() => u.ups(11).length > 0);
  assert.deepEqual(u.last(11), { t: "upload", id: 11, state: "failed", error: "没有连接设备" });
});

test("上一个还在收分片时来了新的：上一个作废、删临时文件，新的照常完成", async (t) => {
  const u = await uploadSetup(t);
  u.c.ws.send(JSON.stringify({ t: "upload", id: 12, name: "a.apk", size: 3 }));
  await until(() => u.ups(12).length > 0);
  u.c.ws.send(JSON.stringify({ t: "upload", id: 13, name: "b.apk", size: 3 }));
  await until(() => u.last(12)?.state === "failed" && u.ups(13).length > 0);
  u.c.ws.send(encodeUploadChunk(13, Buffer.from("abc")));
  await until(() => u.last(13)?.state === "done");
  assert.deepEqual(u.files.calls.map((c) => c.args[3].split("/").pop()), ["b.apk"]);
  await sleep(50);
  assert.deepEqual(await u.tempEntries(), []);
});

test("页面取消正在收的文件：删临时文件，让出位置，下一个能传", async (t) => {
  const u = await uploadSetup(t);
  u.c.ws.send(JSON.stringify({ t: "upload", id: 20, name: "a.apk", size: 10 }));
  await until(() => u.ups(20).length > 0);
  u.c.ws.send(encodeUploadChunk(20, Buffer.from("abc")));
  await until(() => u.last(20)?.received === 3);
  u.c.ws.send(JSON.stringify({ t: "uploadCancel", id: 20 }));
  await until(() => u.last(20)?.state === "failed");
  await sleep(50);
  assert.deepEqual(await u.tempEntries(), []);
  await sendFile(u.c, 21, "b.txt", Buffer.from("hi"), u.ups);
  await until(() => u.last(21)?.state === "done");
  assert.equal(u.files.calls.length, 1);
});

test("取消时 adb 已经在装：等它结束再删临时文件，结果照常回报；期间能开始传下一个", async (t) => {
  const u = await uploadSetup(t);
  u.files.gate = true;
  await sendFile(u.c, 22, "a.apk", Buffer.from("x"), u.ups);
  await until(() => u.files.calls.length === 1);
  u.c.ws.send(JSON.stringify({ t: "uploadCancel", id: 22 }));
  u.c.ws.send(JSON.stringify({ t: "upload", id: 23, name: "b.txt", size: 1 }));
  await until(() => u.ups(23).length > 0);
  assert.equal(u.ups(23)[0].state, "uploading");
  assert.ok((await u.tempEntries()).length >= 1);
  u.files.release();
  await until(() => u.last(22)?.state === "done");
});

test("收分片阶段太久没有新分片：中止并删临时文件", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "emu-upload-"));
  const files = fakeFiles(root);
  const s = await setup(t, new FakeSession(), undefined, undefined, undefined, undefined, { files: { ...files.ops, idleMs: 60 } });
  const c = await s.connect();
  hello(c);
  await until(() => c.msgs.some((m) => m.t === "ready"));
  c.ws.send(JSON.stringify({ t: "upload", id: 24, name: "a.apk", size: 10 }));
  await until(() => c.msgs.some((m) => m.t === "upload" && m.state === "failed"), 2000);
  assert.match(c.msgs.find((m) => m.t === "upload" && m.state === "failed").error, /太久/);
  await sleep(50);
  assert.deepEqual(await readdir(root), []);
});

test("收齐时设备已换成另一台（同一个 serial）：不安装", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "emu-upload-"));
  const files = fakeFiles(root);
  const first = new FakeSession();
  let cur: FakeSession | null = first;
  const s = await setup(t, first, async () => cur, undefined, undefined, undefined, { files: files.ops });
  const c = await s.connect();
  hello(c);
  await until(() => c.msgs.some((m) => m.t === "ready"));
  c.ws.send(JSON.stringify({ t: "upload", id: 25, name: "a.apk", size: 3 }));
  await until(() => c.msgs.some((m) => m.t === "upload" && m.id === 25));
  const other = new FakeSession();
  other.avdName = "Other_AVD";
  cur = other;
  first.fireClosed();
  await until(() => c.msgs.filter((m) => m.t === "ready").length === 2);
  c.ws.send(encodeUploadChunk(25, Buffer.from("abc")));
  await until(() => c.msgs.some((m) => m.t === "upload" && m.id === 25 && m.state === "failed"));
  assert.equal(c.msgs.find((m) => m.t === "upload" && m.id === 25 && m.state === "failed").error, "设备已切换，没有安装");
  assert.equal(files.calls.length, 0);
});

test("超过 2 MiB 的单条消息：网关关闭连接（1009）", async (t) => {
  const u = await uploadSetup(t);
  u.c.ws.send(Buffer.alloc(3 * 1024 * 1024));
  assert.equal(await u.c.closed, 1009);
});

test("分片超过声明的大小：中止并删掉临时文件", async (t) => {
  const u = await uploadSetup(t);
  u.c.ws.send(JSON.stringify({ t: "upload", id: 14, name: "a.apk", size: 2 }));
  await until(() => u.ups(14).length > 0);
  u.c.ws.send(encodeUploadChunk(14, Buffer.from("abc")));
  await until(() => u.last(14)?.state === "failed");
  assert.match(u.last(14).error, /超过/);
  await sleep(50);
  assert.deepEqual(await u.tempEntries(), []);
  assert.equal(u.files.calls.length, 0);
});

test("连模拟器失败（不是没有模拟器）：hello 后除了 no-emulator 还收到带原因的 error", async (t) => {
  const { connect } = await setup(t, null, async () => {
    throw new Error("Cannot compose insecure credentials");
  });
  const c = await connect();
  hello(c);
  await until(() => c.msgs.some((m) => m.t === "error"));
  assert.ok(c.msgs.some((m) => m.t === "status" && m.state === "no-emulator"));
  const err = c.msgs.find((m) => m.t === "error");
  assert.match(err.message, /连不上模拟器：Cannot compose insecure credentials/);
});

test("切换设备时连接失败：error 里带上真正的原因", async (t) => {
  const ops = fakeAvd({}).ops;
  ops.use = async () => {
    throw new Error("UNAUTHENTICATED: bad token");
  };
  const { connect } = await setup(t, new FakeSession(), undefined, ops);
  const c = await connect();
  hello(c);
  await until(() => c.msgs.some((m) => m.t === "ready"));
  c.ws.send(JSON.stringify({ t: "use", name: "B" }));
  await until(() => c.msgs.some((m) => m.t === "error"));
  assert.match(c.msgs.find((m) => m.t === "error").message, /B 连不上：UNAUTHENTICATED: bad token/);
});

/** 用裸 TCP 发一个请求，返回状态行。Host 等头完全由调用方决定。 */
async function rawRequest(port: number, head: string): Promise<string> {
  const s = net.connect(port, "127.0.0.1");
  s.on("error", () => {});
  s.write(head);
  let buf = "";
  for await (const chunk of s) {
    buf += chunk.toString();
    if (buf.includes("\r\n")) break;
  }
  s.destroy();
  return buf.split("\r\n")[0];
}
const wsHead = (port: number, host = `127.0.0.1:${port}`, origin = `http://127.0.0.1:${port}`) =>
  `GET / HTTP/1.1\r\nHost: ${host}\r\nOrigin: ${origin}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${randomBytes(16).toString("base64")}\r\n\r\n`;
const getHead = (path: string, host: string) => `GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`;
/** 对端进程改名：本机真实连接（不管是谁发起的）都当成 command 持有的；不是 macOS 时造一个。 */
const peerIs = (command: string) => ({
  platform: "darwin",
  lookup: async (gatewayPort: number): Promise<Snapshot> => {
    const snap = process.platform === "darwin" ? await lsofSockets(gatewayPort) : { holders: new Map(), own: new Set<number>() };
    for (const [p, hs] of snap.holders) snap.holders.set(p, hs.map(() => ({ pid: 4321, command })));
    return snap;
  },
});

test("对端是模拟器进程（qemu-system-*）：WebSocket 升级和 HTTP 请求都是 403，日志写出进程名", { skip: process.platform !== "darwin" }, async (t) => {
  const { srv, logs, origin } = await setup(t, new FakeSession(), undefined, undefined, undefined, undefined, { peer: { ...peerIs("qemu-system-aarch64-headless"), allowAnyWsClient: true } });
  // 伪造了白名单里的 Origin 也不行；就算放开了浏览器白名单也不行
  assert.equal(await rawRequest(srv.port, wsHead(srv.port, undefined, "https://droid.devpier.dev")), "HTTP/1.1 403 Forbidden");
  assert.equal(await rawRequest(srv.port, wsHead(srv.port, undefined, origin)), "HTTP/1.1 403 Forbidden");
  assert.match(await rawRequest(srv.port, getHead("/healthz", `127.0.0.1:${srv.port}`)), /^HTTP\/1\.1 403/);
  // Host 先查：Host 不对直接 421
  assert.equal(await rawRequest(srv.port, wsHead(srv.port, "10.0.2.2:" + srv.port)), "HTTP/1.1 421 Misdirected Request");
  assert.ok(logs.some((l) => /拒绝 WebSocket：.*qemu-system-aarch64-headless（pid 4321）/.test(l)), logs.join("\n"));
  assert.ok(logs.some((l) => /拒绝 HTTP 请求：.*qemu-system-aarch64-headless/.test(l)), logs.join("\n"));
});

test("对端是 Chrome 的网络进程：不放开白名单也照常连上，收到 ready", { skip: process.platform !== "darwin" }, async (t) => {
  const { connect, logs } = await setup(t, new FakeSession(), undefined, undefined, undefined, undefined, { peer: { ...peerIs("Google Chrome Helper (Aperitif)"), allowAnyWsClient: false } });
  const c = await connect();
  hello(c);
  await until(() => c.msgs.some((m) => m.t === "ready"));
  assert.equal(logs.some((l) => l.startsWith("拒绝")), false);
});

test("对端是 node（不是浏览器）且没放开白名单：WebSocket 403，HTTP 照常", { skip: process.platform !== "darwin" }, async (t) => {
  const { srv, logs, origin } = await setup(t, new FakeSession(), undefined, undefined, undefined, undefined, { peer: { allowAnyWsClient: false } });
  assert.equal(await rawRequest(srv.port, wsHead(srv.port, undefined, origin)), "HTTP/1.1 403 Forbidden");
  assert.match(await rawRequest(srv.port, getHead("/healthz", `127.0.0.1:${srv.port}`)), /^HTTP\/1\.1 200/);
  assert.ok(logs.some((l) => /拒绝 WebSocket：WebSocket 只收 Chrome \/ Edge，这条来自 node/.test(l)), logs.join("\n"));
});

test("查不了对端进程（lsof 出错）：WebSocket 503 不握手，HTTP 放行并写日志", async (t) => {
  const peer = { platform: "darwin", lookup: async () => { throw new Error("lsof 超时"); } };
  const { srv, logs, origin } = await setup(t, new FakeSession(), undefined, undefined, undefined, undefined, { peer });
  assert.equal(await rawRequest(srv.port, wsHead(srv.port, undefined, origin)), "HTTP/1.1 503 Service Unavailable");
  assert.match(await rawRequest(srv.port, getHead("/healthz", `127.0.0.1:${srv.port}`)), /^HTTP\/1\.1 200/);
  assert.ok(logs.some((l) => /HTTP 请求放行.*lsof 超时/.test(l)), logs.join("\n"));
});

test("start / use 的名字不合 AVD 名规则：回一条错误，不去启动或切换", async (t) => {
  const f = fakeAvd({});
  const { connect } = await setup(t, null, async () => null, f.ops);
  const c = await connect();
  hello(c);
  await until(() => c.msgs.length > 0);
  for (const t of ["start", "use"]) c.ws.send(JSON.stringify({ t, name: "../A" }));
  await until(() => c.msgs.filter((m) => m.t === "error").length === 2);
  for (const m of c.msgs.filter((m) => m.t === "error")) assert.match(m.message, /^设备名不对：/);
  assert.deepEqual(f.calls, []);
});

test("Host 不是 127.0.0.1:<端口> 或 localhost:<端口>：HTTP 和 WebSocket 升级都是 421", async (t) => {
  const { srv } = await setup(t);
  for (const host of ["droid.devpier.dev", "evil.example:" + srv.port, `127.0.0.1:${srv.port + 1}`]) {
    assert.match(await rawRequest(srv.port, getHead("/healthz", host)), /^HTTP\/1\.1 421/, host);
    assert.equal(await rawRequest(srv.port, wsHead(srv.port, host)), "HTTP/1.1 421 Misdirected Request", host);
  }
  assert.match(await rawRequest(srv.port, getHead("/healthz", `localhost:${srv.port}`)), /^HTTP\/1\.1 200/);
  assert.equal(await rawRequest(srv.port, wsHead(srv.port, `localhost:${srv.port}`)), "HTTP/1.1 101 Switching Protocols");
});

test("deleteAvd：失败原因带本机路径的细节只写日志，不发给页面", async (t) => {
  const f = fakeAvd({});
  f.ops.delete = async () => { throw new Error("删除 A 失败，详情见网关日志", { cause: new Error("EACCES: permission denied, rmdir '/home/u/.android/avd/A.avd'") }); };
  const { connect, logs } = await setup(t, new FakeSession(), undefined, f.ops);
  const c = await connect();
  hello(c);
  await until(() => c.msgs.length > 0);
  c.ws.send(JSON.stringify({ t: "deleteAvd", rid: 11, name: "A" }));
  await until(() => c.msgs.some((m) => m.t === "deleteAvd"));
  assert.deepEqual(c.msgs.find((m) => m.t === "deleteAvd"), { t: "deleteAvd", rid: 11, ok: false, error: "删除 A 失败，详情见网关日志" });
  assert.ok(logs.some((l) => l.includes("删除设备 A 失败") && l.includes("/home/u/.android/avd/A.avd")), logs.join("\n"));
});

/** 假的自动更新：request 返回给定的结果并计数。 */
function fakeUpdate(o: { autoUpdate: boolean; report?: { state: string; message?: string } }) {
  let requests = 0;
  return {
    get requests() { return requests; },
    opts: {
      autoUpdate: o.autoUpdate,
      request: async () => (requests++, (o.report ?? { state: "latest" }) as never),
      last: () => ({ at: Date.UTC(2026, 10, 13, 2, 0), report: { state: "latest" as const } }),
    },
  };
}

test("hello 之后最先发 gateway：功能级别、版本、是不是后台服务、自动更新开没开", async (t) => {
  const u = fakeUpdate({ autoUpdate: true });
  const { connect } = await setup(t, new FakeSession(), undefined, undefined, undefined, undefined, { version: "2026-11-13T00:00:00.000Z", service: true, update: u.opts });
  const c = await connect();
  const order: string[] = [];
  c.ws.on("message", (d, isBinary) => { if (!isBinary) order.push(JSON.parse(d.toString()).t); });
  hello(c);
  await until(() => c.msgs.some((m) => m.t === "ready"));
  assert.deepEqual(c.gateway, [{ t: "gateway", level: GATEWAY_LEVEL, version: "2026-11-13T00:00:00.000Z", service: true, autoUpdate: true }]);
  assert.equal(order[0], "gateway");
});

test("update：hello 之前发的不算（连接被关掉），不会触发检查", async (t) => {
  const u = fakeUpdate({ autoUpdate: true });
  const { connect } = await setup(t, new FakeSession(), undefined, undefined, undefined, undefined, { service: true, update: u.opts });
  const c = await connect();
  c.ws.send(JSON.stringify({ t: "update" }));
  assert.equal(await c.closed, CLOSE_NO_HELLO);
  assert.equal(u.requests, 0);
});

test("update：后台服务开着自动更新时马上检查一次，回复检查结果", async (t) => {
  const u = fakeUpdate({ autoUpdate: true, report: { state: "deferred", message: "正在安装 SDK" } });
  const { connect } = await setup(t, new FakeSession(), undefined, undefined, undefined, undefined, { service: true, update: u.opts });
  const c = await connect();
  hello(c);
  await until(() => c.msgs.length > 0);
  c.ws.send(JSON.stringify({ t: "update", url: "https://evil.test/x.tar.xz" }));
  await until(() => c.msgs.some((m) => m.t === "update" && m.state !== "checking"));
  assert.deepEqual(c.msgs.filter((m) => m.t === "update"), [{ t: "update", state: "checking" }, { t: "update", state: "deferred", message: "正在安装 SDK" }]);
  assert.equal(u.requests, 1);
});

test("update：关了自动更新（或前台运行）时回复 off，不检查", async (t) => {
  const u = fakeUpdate({ autoUpdate: false });
  const { connect } = await setup(t, new FakeSession(), undefined, undefined, undefined, undefined, { update: u.opts });
  const c = await connect();
  hello(c);
  await until(() => c.msgs.length > 0);
  c.ws.send(JSON.stringify({ t: "update" }));
  await until(() => c.msgs.some((m) => m.t === "update"));
  assert.deepEqual(c.msgs.find((m) => m.t === "update"), { t: "update", state: "off" });
  assert.equal(u.requests, 0);
});

test("update：要重启时所有页面都收到 restarting", async (t) => {
  const u = fakeUpdate({ autoUpdate: true, report: { state: "restarting" } });
  const { connect } = await setup(t, new FakeSession(), undefined, undefined, undefined, undefined, { service: true, update: u.opts });
  const a = await connect();
  const b = await connect();
  hello(a);
  hello(b);
  await until(() => a.msgs.length > 0 && b.msgs.length > 0);
  a.ws.send(JSON.stringify({ t: "update" }));
  await until(() => b.msgs.some((m) => m.t === "update"));
  assert.deepEqual(b.msgs.find((m) => m.t === "update"), { t: "update", state: "restarting" });
});

test("busy：删除设备期间报“正在删除设备”，删完恢复", async (t) => {
  const f = fakeAvd({});
  const release = f.hold();
  const { srv, connect } = await setup(t, new FakeSession(), undefined, f.ops);
  const c = await connect();
  hello(c);
  await until(() => c.msgs.length > 0);
  assert.equal(srv.busy(), null);
  c.ws.send(JSON.stringify({ t: "deleteAvd", rid: 30, name: "A" }));
  await until(() => f.calls.includes("delete A"));
  assert.equal(srv.busy(), "正在删除设备");
  release();
  await until(() => c.msgs.some((m) => m.t === "deleteAvd"));
  assert.equal(srv.busy(), null);
});

test("busy：开机任务进行中报“设备正在开机”", async (t) => {
  const f = fakeAvd({});
  const { srv, connect } = await setup(t, null, async () => null, f.ops);
  const c = await connect();
  hello(c);
  await until(() => c.msgs.length > 0);
  c.ws.send(JSON.stringify({ t: "start", name: "A" }));
  await until(() => c.msgs.some((m) => m.t === "boot"));
  assert.equal(srv.busy(), "设备正在开机");
});

test("/healthz 带上自动更新开没开和上次检查的结果", async (t) => {
  const u = fakeUpdate({ autoUpdate: true });
  const { srv } = await setup(t, new FakeSession(), undefined, undefined, undefined, undefined, { service: true, update: u.opts });
  const body = await (await fetch(`http://127.0.0.1:${srv.port}/healthz`)).json();
  assert.deepEqual(body.update, { auto: true, last: { at: "2026-11-13T02:00:00.000Z", state: "latest" } });
});

// ─────────────── 真机列表 ───────────────

import type { PhoneInfo } from "../../shared/protocol.ts";

const PHONE: PhoneInfo = { id: "R5CR10WN52H", state: "device", manufacturer: "samsung", model: "SM-G9910", android: "12" };

function fakePhones(initial: PhoneInfo[]) {
  const cbs: Array<(l: PhoneInfo[]) => void> = [];
  let list = initial;
  return {
    ops: { list: () => list, onChange: (cb: (l: PhoneInfo[]) => void) => void cbs.push(cb) },
    set(l: PhoneInfo[]) { list = l; for (const cb of cbs) cb(l); },
  };
}

test("带 phones 时 hello 后收到一次真机列表，排在 env 之后", async (t) => {
  const p = fakePhones([PHONE]);
  const { connect } = await setup(t, new FakeSession(), undefined, undefined, undefined, fakeSetup().ops, { phones: p.ops });
  const c = await connect();
  hello(c);
  await until(() => c.msgs.some((m) => m.t === "phones"));
  assert.deepEqual(c.msgs.find((m) => m.t === "phones"), { t: "phones", list: [PHONE] });
  assert.ok(c.msgs.findIndex((m) => m.t === "env") < c.msgs.findIndex((m) => m.t === "phones"));
});

test("真机列表变化时广播给所有已 hello 的连接", async (t) => {
  const p = fakePhones([]);
  const { connect } = await setup(t, new FakeSession(), undefined, undefined, undefined, undefined, { phones: p.ops });
  const a = await connect();
  const b = await connect();
  hello(a);
  hello(b);
  await until(() => a.msgs.some((m) => m.t === "phones") && b.msgs.some((m) => m.t === "phones"));
  p.set([PHONE]);
  await until(() => [a, b].every((c) => c.msgs.filter((m) => m.t === "phones").length === 2));
  assert.deepEqual(b.msgs.filter((m) => m.t === "phones").at(-1), { t: "phones", list: [PHONE] });
});

test("不带 phones 时不发真机列表", async (t) => {
  const { connect } = await setup(t);
  const c = await connect();
  hello(c);
  await until(() => c.msgs.some((m) => m.t === "ready"));
  await sleep(50);
  assert.ok(!c.msgs.some((m) => m.t === "phones"));
});

test("stopAvd：停掉列表里在运行的设备，等它停了再回复，所有连接都收到新的 avds", async (t) => {
  const f = fakeAvd({});
  f.setRunning("grpc");
  const { connect } = await setup(t, new FakeSession(), undefined, f.ops);
  const a = await connect();
  const b = await connect();
  hello(a);
  hello(b);
  await until(() => a.msgs.length > 0 && b.msgs.length > 0);
  a.ws.send(JSON.stringify({ t: "stopAvd", rid: 20, name: "A" }));
  await until(() => a.msgs.some((m) => m.t === "stopAvd") && b.msgs.some((m) => m.t === "avds"));
  assert.deepEqual(a.msgs.find((m) => m.t === "stopAvd"), { t: "stopAvd", rid: 20, ok: true });
  assert.deepEqual(f.calls, ["stop 5554"]);
  assert.deepEqual(b.msgs.findLast((m) => m.t === "avds"), { t: "avds", list: [{ name: "A", running: "no" }] });
});

test("stopAvd：开机中的设备按开机任务的串口停", async (t) => {
  const f = fakeAvd({});
  const { connect } = await setup(t, null, async () => null, f.ops);
  const c = await connect();
  hello(c);
  await until(() => c.msgs.length > 0);
  c.ws.send(JSON.stringify({ t: "start", name: "A" }));
  await until(() => c.msgs.some((m) => m.t === "boot"));
  c.ws.send(JSON.stringify({ t: "stopAvd", rid: 21, name: "A" }));
  await until(() => c.msgs.some((m) => m.t === "stopAvd"));
  assert.deepEqual(c.msgs.find((m) => m.t === "stopAvd"), { t: "stopAvd", rid: 21, ok: true });
  assert.ok(f.calls.includes("stop 5556"));
});

test("stopAvd：没在运行的设备回复原因，不去停", async (t) => {
  const f = fakeAvd({});
  const { connect } = await setup(t, new FakeSession(), undefined, f.ops);
  const c = await connect();
  hello(c);
  await until(() => c.msgs.length > 0);
  c.ws.send(JSON.stringify({ t: "stopAvd", rid: 22, name: "A" }));
  await until(() => c.msgs.some((m) => m.t === "stopAvd"));
  assert.deepEqual(c.msgs.find((m) => m.t === "stopAvd"), { t: "stopAvd", rid: 22, ok: false, error: "这台设备没有在运行" });
  assert.deepEqual(f.calls, []);
});

test("stopAvd：发了停止但设备一直不停时，等满时间回复超时", async (t) => {
  const f = fakeAvd({});
  f.setRunning("grpc");
  f.stick();
  const { connect } = await setup(t, new FakeSession(), undefined, f.ops, undefined, undefined, { stopWaitMs: 150 });
  const c = await connect();
  hello(c);
  await until(() => c.msgs.length > 0);
  c.ws.send(JSON.stringify({ t: "stopAvd", rid: 23, name: "A" }));
  await until(() => c.msgs.some((m) => m.t === "stopAvd"));
  assert.deepEqual(c.msgs.find((m) => m.t === "stopAvd"), { t: "stopAvd", rid: 23, ok: false, error: "已经发出停止指令，但设备还在运行，稍后再试" });
});

test("deleteAvd 带 stop：运行中的设备先停再删", async (t) => {
  const f = fakeAvd({});
  f.setRunning("grpc");
  const { connect } = await setup(t, new FakeSession(), undefined, f.ops);
  const c = await connect();
  hello(c);
  await until(() => c.msgs.length > 0);
  c.ws.send(JSON.stringify({ t: "deleteAvd", rid: 24, name: "A", stop: true }));
  await until(() => c.msgs.some((m) => m.t === "deleteAvd"));
  assert.deepEqual(c.msgs.find((m) => m.t === "deleteAvd"), { t: "deleteAvd", rid: 24, ok: true });
  assert.deepEqual(f.calls, ["stop 5554", "delete A"]);
});

test("deleteAvd 带 stop：开机中的设备也先停再删", async (t) => {
  const f = fakeAvd({});
  const { connect } = await setup(t, null, async () => null, f.ops);
  const c = await connect();
  hello(c);
  await until(() => c.msgs.length > 0);
  c.ws.send(JSON.stringify({ t: "start", name: "A" }));
  await until(() => c.msgs.some((m) => m.t === "boot"));
  c.ws.send(JSON.stringify({ t: "deleteAvd", rid: 25, name: "A", stop: true }));
  await until(() => c.msgs.some((m) => m.t === "deleteAvd"));
  assert.deepEqual(c.msgs.find((m) => m.t === "deleteAvd"), { t: "deleteAvd", rid: 25, ok: true });
  assert.ok(f.calls.indexOf("stop 5556") < f.calls.indexOf("delete A"));
});

test("stopAvd：开机任务刚建、还没有串口时，等串口出来再停，不去停 emulator-0", async (t) => {
  const f = fakeAvd({});
  f.serialLater();
  const { connect } = await setup(t, null, async () => null, f.ops);
  const c = await connect();
  hello(c);
  await until(() => c.msgs.length > 0);
  c.ws.send(JSON.stringify({ t: "start", name: "A" }));
  await until(() => c.msgs.some((m) => m.t === "boot"));
  c.ws.send(JSON.stringify({ t: "stopAvd", rid: 26, name: "A" }));
  await until(() => c.msgs.some((m) => m.t === "stopAvd"));
  assert.deepEqual(c.msgs.find((m) => m.t === "stopAvd"), { t: "stopAvd", rid: 26, ok: true });
  assert.equal(f.calls.includes("stop 0"), false);
  assert.ok(f.calls.includes("stop 5556"));
});

// ─────────────── 真机会话（PR 3） ───────────────

import { BIN_VIDEO, decodeVideoHeader } from "../../shared/protocol.ts";
import type { VideoPacket } from "../src/emulator.ts";

class FakePhone extends FakeSession {
  videoSubs: Array<(p: VideoPacket) => void> = [];
  keyRequests = 0;
  constructor(id = "R5CR10WN52H") {
    super();
    this.kind = "phone";
    this.caps = { rotate: false, reboot: false, stop: false, clipboard: true, input: true, scroll: true };
    this.id = id;
    this.serial = 0;
    this.avdName = undefined;
    this.device = { width: 864, height: 1920 };
  }
  video(cb: (p: VideoPacket) => void) {
    this.videoSubs.push(cb);
    return () => { this.videoSubs = this.videoSubs.filter((x) => x !== cb); };
  }
  requestKeyFrame() { this.keyRequests++; }
  scrolls: Array<[number, number, number, number]> = [];
  async scroll(x: number, y: number, dx: number, dy: number) { this.scrolls.push([x, y, dx, dy]); this.calls.push("scroll"); }
  pushPacket(kind: "config" | "key" | "delta", tag: number) {
    for (const cb of this.videoSubs) cb({ config: kind === "config", key: kind === "key", data: Buffer.from([tag]), width: 864, height: 1920 });
  }
}

const PHONE_OK: PhoneInfo = { id: "R5CR10WN52H", state: "device", manufacturer: "samsung", model: "SM-G9910", android: "12" };
const videoTags = (c: Client) => c.binMsgs.filter((b) => binKind(b) === BIN_VIDEO).map((b) => new Uint8Array(b)[20]);

/** 先接上模拟器，再切到真机。 */
async function phoneSetup(t: import("node:test").TestContext, phone = new FakePhone(), emu = new FakeSession(), more: Partial<Parameters<typeof startServer>[0]> = {}) {
  const p = fakePhones([PHONE_OK]);
  const fa = fakeAvd({ [phone.id]: phone });
  const s = await setup(t, emu, async () => emu, fa.ops, undefined, undefined, { phones: p.ops, ...more });
  const c = await s.connect();
  hello(c);
  await until(() => c.msgs.some((m) => m.t === "ready"));
  c.ws.send(JSON.stringify({ t: "use", name: phone.id }));
  await until(() => c.msgs.some((m) => m.t === "ready" && m.kind === "phone"));
  return { ...s, c, p, fa, phone, emu };
}

test("use 真机 id：ready 带 kind=phone 和 caps，之后收到 BIN_VIDEO，不收 BIN_FRAME", async (t) => {
  const { c, phone } = await phoneSetup(t);
  const ready = c.msgs.filter((m) => m.t === "ready").at(-1);
  assert.deepEqual(ready, { t: "ready", version: PROTOCOL_VERSION, device: { width: 864, height: 1920 }, serial: 0, deviceId: "R5CR10WN52H", kind: "phone", caps: phone.caps });
  const framesBefore = c.binMsgs.filter((b) => binKind(b) === 1).length;
  phone.pushPacket("config", 1);
  phone.pushPacket("key", 2);
  await until(() => videoTags(c).length === 2);
  assert.deepEqual(videoTags(c), [1, 2]);
  assert.deepEqual(decodeVideoHeader(new Uint8Array(c.binMsgs.filter((b) => binKind(b) === BIN_VIDEO)[1])), { seq: 1, config: false, key: true, width: 864, height: 1920 });
  assert.equal(c.binMsgs.filter((b) => binKind(b) === 1).length, framesBefore);
});

test("真机：订阅时请求一次关键帧；P 帧在关键帧之前不发", async (t) => {
  const { c, phone } = await phoneSetup(t);
  assert.equal(phone.keyRequests, 1);
  phone.pushPacket("delta", 1);
  phone.pushPacket("key", 2);
  phone.pushPacket("delta", 3);
  await until(() => videoTags(c).length === 2);
  assert.deepEqual(videoTags(c), [2, 3]);
});

test("真机会话关闭：页面收到 phone-closed", async (t) => {
  const { c, phone } = await phoneSetup(t);
  phone.fireClosed();
  await until(() => c.msgs.some((m) => m.t === "status" && m.state === "phone-closed"));
});

test("选过真机后，没有会话的连接不会被 ticker 接上模拟器", async (t) => {
  const { c, phone } = await phoneSetup(t);
  const readies = () => c.msgs.filter((m) => m.t === "ready").length;
  const before = readies();
  phone.fireClosed();
  await sleep(120);
  assert.equal(readies(), before);
});

test("选过的真机重新出现为 device：自动重连并接上", async (t) => {
  const { c, p, phone, fa } = await phoneSetup(t);
  phone.fireClosed();
  p.set([{ ...PHONE_OK, state: "offline" }]);
  await sleep(30);
  const uses = () => fa.calls.filter((x) => x === "use R5CR10WN52H").length;
  assert.equal(uses(), 1);
  p.set([PHONE_OK]);
  await until(() => uses() === 2);
  await until(() => c.msgs.filter((m) => m.t === "ready" && m.kind === "phone").length === 2);
});

test("选过的真机掉线期间新开页面：收到 phone-closed，不会被接到模拟器", async (t) => {
  const { connect, phone, p } = await phoneSetup(t);
  phone.fireClosed();
  // 拔线后列表里它也不再可用（否则新页面会触发重连，见下面「插回后才开页面」）
  p.set([{ ...PHONE_OK, state: "offline" }]);
  const c2 = await connect();
  hello(c2);
  await until(() => c2.msgs.some((m) => m.t === "status"));
  await sleep(60);
  assert.deepEqual(c2.msgs.filter((m) => m.t === "status").map((m) => m.state), ["phone-closed"]);
  assert.ok(!c2.msgs.some((m) => m.t === "ready"));
});

test("rotate / reboot / stop 对真机回「这台设备不支持」，不调用会话", async (t) => {
  const { c, phone, fa } = await phoneSetup(t);
  for (const t2 of ["rotate", "reboot", "stop"]) c.ws.send(JSON.stringify({ t: t2 }));
  await until(() => c.msgs.filter((m) => m.t === "error").length === 3);
  assert.deepEqual(c.msgs.filter((m) => m.t === "error").map((m) => m.message), ["这台设备不支持旋转", "这台设备不支持重启", "这台设备不支持关机"]);
  assert.ok(!phone.calls.some((x) => x.startsWith("rotate") || x.startsWith("reboot")));
  assert.ok(!fa.calls.some((x) => x.startsWith("stop")));
});

test("use 一台不在真机列表里、名字也不合法的设备（如拔线后的 192.168.1.5:5555）：仍按原来的规则报「设备名不对」", async (t) => {
  const { c } = await phoneSetup(t);
  c.ws.send(JSON.stringify({ t: "use", name: "192.168.1.5:5555" }));
  await until(() => c.msgs.some((m) => m.t === "error"));
  assert.match(c.msgs.find((m) => m.t === "error").message, /^设备名不对/);
});

test("use 真机时连接失败：页面收到带真实原因的错误", async (t) => {
  const p = fakePhones([PHONE_OK]);
  const fa = fakeAvd({});
  fa.ops.use = async () => { throw new Error("5 秒内连不上手机上的 scrcpy 服务端"); };
  const s = await setup(t, new FakeSession(), undefined, fa.ops, undefined, undefined, { phones: p.ops });
  const c = await s.connect();
  hello(c);
  await until(() => c.msgs.some((m) => m.t === "ready"));
  c.ws.send(JSON.stringify({ t: "use", name: "R5CR10WN52H" }));
  await until(() => c.msgs.some((m) => m.t === "error"));
  assert.equal(c.msgs.find((m) => m.t === "error").message, "R5CR10WN52H 连不上：5 秒内连不上手机上的 scrcpy 服务端");
});

test("pause 后不再收到 BIN_VIDEO；resume 后从关键帧重新开始", async (t) => {
  const { c, phone } = await phoneSetup(t);
  phone.pushPacket("key", 1);
  await until(() => videoTags(c).length === 1);
  c.ws.send(JSON.stringify({ t: "pause" }));
  await sleep(30);
  phone.pushPacket("delta", 2);
  c.ws.send(JSON.stringify({ t: "resume" }));
  await until(() => phone.keyRequests === 2);
  phone.pushPacket("delta", 3);
  phone.pushPacket("key", 4);
  await until(() => videoTags(c).length === 2);
  assert.deepEqual(videoTags(c), [1, 4]);
});

test("真机掉线期间没有页面在线，插回后才开页面：自动连上", async (t) => {
  const { c, connect, p, phone } = await phoneSetup(t);
  c.ws.close();
  await sleep(30);
  phone.fireClosed();
  p.set([{ ...PHONE_OK, state: "offline" }]);
  p.set([PHONE_OK]);
  await sleep(30);
  const c2 = await connect();
  hello(c2);
  await until(() => c2.msgs.some((m) => m.t === "ready" && m.kind === "phone"));
});

test("自动重连失败：没会话的页面收到带原因的错误", async (t) => {
  const { c, p, phone, fa } = await phoneSetup(t);
  fa.ops.use = async () => { throw new Error("5 秒内连不上手机上的 scrcpy 服务端"); };
  phone.fireClosed();
  p.set([{ ...PHONE_OK, state: "offline" }]);
  p.set([PHONE_OK]);
  await until(() => c.msgs.some((m) => m.t === "error"));
  assert.equal(c.msgs.find((m) => m.t === "error").message, "重新连接 R5CR10WN52H 失败：5 秒内连不上手机上的 scrcpy 服务端");
});

test("用户切到模拟器的同时真机插回：不会再连回真机，页面停在模拟器上", async (t) => {
  const { c, p, phone, fa, emu } = await phoneSetup(t);
  phone.fireClosed();
  let releaseA!: () => void;
  const orig = fa.ops.use;
  const used: string[] = [];
  fa.ops.use = async (name) => {
    used.push(name);
    if (name === "A") {
      await new Promise<void>((r) => (releaseA = r));
      return emu;
    }
    return orig(name);
  };
  c.ws.send(JSON.stringify({ t: "use", name: "A" }));
  await until(() => used.includes("A"));
  p.set([{ ...PHONE_OK, state: "offline" }]);
  p.set([PHONE_OK]);
  await sleep(30);
  releaseA();
  await until(() => c.msgs.filter((m) => m.t === "ready").at(-1)?.kind === "emulator");
  await sleep(60);
  assert.deepEqual(used, ["A"]);
  assert.equal(c.msgs.filter((m) => m.t === "ready").at(-1)?.kind, "emulator");
});

test("真机会话收到 scroll 时转给 session.scroll", async (t) => {
  const { c, phone } = await phoneSetup(t);
  c.ws.send(JSON.stringify({ t: "scroll", x: 10, y: 20, dx: 0, dy: 120 }));
  await until(() => phone.scrolls.length === 1);
  assert.deepEqual(phone.scrolls, [[10, 20, 0, 120]]);
});

test("模拟器会话收到 scroll 时忽略，不报错", async (t) => {
  const emu = new FakeSession();
  const s = await setup(t, emu);
  const c = await s.connect();
  hello(c);
  await until(() => c.msgs.some((m) => m.t === "ready"));
  c.ws.send(JSON.stringify({ t: "scroll", x: 10, y: 20, dx: 0, dy: 120 }));
  c.ws.send(JSON.stringify({ t: "touch", x: 1, y: 2, down: true }));
  await until(() => emu.calls.includes("touch"));
  assert.deepEqual(emu.calls, ["touch"]);
  assert.equal(c.msgs.some((m) => m.t === "error"), false);
});

test("真机的 touch / key / text / clip 照常转给会话", async (t) => {
  const { c, phone } = await phoneSetup(t);
  c.ws.send(JSON.stringify({ t: "touch", x: 1, y: 2, down: true }));
  c.ws.send(JSON.stringify({ t: "key", key: "GoBack", eventType: "keypress" }));
  c.ws.send(JSON.stringify({ t: "text", text: "中文" }));
  c.ws.send(JSON.stringify({ t: "clip", text: "x" }));
  await until(() => phone.calls.length >= 4);
  assert.deepEqual(phone.calls.filter((x) => ["touch", "key", "text", "setClipboard"].includes(x)), ["touch", "key", "text", "setClipboard"]);
});

// ─────────────── 日志面板（PR 5） ───────────────

type FakeLogSub = { id: string; filters: LogFilter[]; closed: boolean; push(lines: LogLine[], reset: boolean): void };
function fakeLogcat() {
  const subs: FakeLogSub[] = [];
  const hub = {
    subscribe(id: string, f: LogFilter, onBatch: (lines: LogLine[], reset: boolean) => void) {
      const sub: FakeLogSub = { id, filters: [f], closed: false, push: onBatch };
      subs.push(sub);
      return { setFilter: (nf: LogFilter) => void sub.filters.push(nf), close: () => void (sub.closed = true) };
    },
    close() {},
  };
  return { hub, subs };
}
const LOG_ALL: LogFilter = { pkg: null, level: "V", text: "" };
const logLine = (n: number): LogLine => ({ n, time: "11-16 18:00:52.531", pid: 1, tid: 1, level: "I", tag: "T", msg: `m${n}` });

test("logcatOpen 订阅当前设备，批次以 logcat 消息发给这个页面", async (t) => {
  const lc = fakeLogcat();
  const s = await setup(t, new FakeSession(), undefined, undefined, undefined, undefined, { logcat: lc.hub });
  const c = await s.connect();
  hello(c);
  await until(() => c.msgs.some((m) => m.t === "ready"));
  c.ws.send(JSON.stringify({ t: "logcatOpen", filter: LOG_ALL }));
  await until(() => lc.subs.length === 1);
  assert.equal(lc.subs[0].id, "emulator-5554");
  assert.deepEqual(lc.subs[0].filters, [LOG_ALL]);
  lc.subs[0].push([logLine(1)], true);
  await until(() => c.msgs.some((m) => m.t === "logcat"));
  assert.deepEqual(c.msgs.find((m) => m.t === "logcat"), { t: "logcat", lines: [logLine(1)], reset: true });
});

test("logcatFilter 改过滤条件；logcatClose 和断开连接都会 close 订阅", async (t) => {
  const lc = fakeLogcat();
  const s = await setup(t, new FakeSession(), undefined, undefined, undefined, undefined, { logcat: lc.hub });
  const c = await s.connect();
  hello(c);
  await until(() => c.msgs.some((m) => m.t === "ready"));
  c.ws.send(JSON.stringify({ t: "logcatOpen", filter: LOG_ALL }));
  const w: LogFilter = { pkg: "com.a", level: "W", text: "x" };
  c.ws.send(JSON.stringify({ t: "logcatFilter", filter: w }));
  await until(() => lc.subs[0]?.filters.length === 2);
  assert.deepEqual(lc.subs[0].filters[1], w);
  c.ws.send(JSON.stringify({ t: "logcatClose" }));
  await until(() => lc.subs[0].closed);
  c.ws.send(JSON.stringify({ t: "logcatOpen", filter: LOG_ALL }));
  await until(() => lc.subs.length === 2);
  c.ws.close();
  await until(() => lc.subs[1].closed);
});

test("面板开着时切到另一台设备：旧订阅 close，用原条件订阅新设备", async (t) => {
  const lc = fakeLogcat();
  const phone = new FakePhone();
  const emu = new FakeSession();
  const p = fakePhones([PHONE_OK]);
  const fa = fakeAvd({ [phone.id]: phone });
  const s = await setup(t, emu, async () => emu, fa.ops, undefined, undefined, { phones: p.ops, logcat: lc.hub });
  const c = await s.connect();
  hello(c);
  await until(() => c.msgs.some((m) => m.t === "ready"));
  const f: LogFilter = { pkg: null, level: "E", text: "" };
  c.ws.send(JSON.stringify({ t: "logcatOpen", filter: f }));
  await until(() => lc.subs.length === 1);
  c.ws.send(JSON.stringify({ t: "use", name: phone.id }));
  await until(() => lc.subs.length === 2);
  assert.equal(lc.subs[0].closed, true);
  assert.equal(lc.subs[1].id, phone.id);
  assert.deepEqual(lc.subs[1].filters, [f]);
});

test("logcatApps 回前台 App 和运行中的 App", async (t) => {
  const s = await setup(t, new FakeSession(), undefined, undefined, undefined, undefined, {
    logcat: fakeLogcat().hub,
    apps: async (id) => ({ foreground: id === "emulator-5554" ? "com.a" : null, apps: ["com.a", "com.b"] }),
  });
  const c = await s.connect();
  hello(c);
  await until(() => c.msgs.some((m) => m.t === "ready"));
  c.ws.send(JSON.stringify({ t: "logcatApps", rid: 9 }));
  await until(() => c.msgs.some((m) => m.t === "logcatApps"));
  assert.deepEqual(c.msgs.find((m) => m.t === "logcatApps"), { t: "logcatApps", rid: 9, foreground: "com.a", apps: ["com.a", "com.b"] });
});

test("logcatRead 把设备、条件、行数交给网关读日志，原样回行；出错时回 error", async (t) => {
  const calls: unknown[] = [];
  const line: LogLine = { n: 1, time: "11-16 18:00:52.531", pid: 7, tid: 7, level: "E", tag: "App", msg: "boom" };
  let fail = false;
  const s = await setup(t, new FakeSession(), undefined, undefined, undefined, undefined, {
    logcatRead: async (id, f, limit) => {
      calls.push([id, f, limit]);
      if (fail) throw new Error("adb 没有响应");
      return [line];
    },
  });
  const c = await s.connect();
  hello(c);
  await until(() => c.msgs.some((m) => m.t === "ready"));
  const filter = { pkg: "com.a", level: "E", text: "" };
  c.ws.send(JSON.stringify({ t: "logcatRead", rid: 4, filter, limit: 20 }));
  await until(() => c.msgs.some((m) => m.t === "logcatRead"));
  assert.deepEqual(calls, [["emulator-5554", filter, 20]]);
  assert.deepEqual(c.msgs.find((m) => m.t === "logcatRead"), { t: "logcatRead", rid: 4, lines: [line] });
  fail = true;
  c.ws.send(JSON.stringify({ t: "logcatRead", rid: 5, filter, limit: 20 }));
  await until(() => c.msgs.some((m) => m.t === "logcatRead" && m.rid === 5));
  assert.deepEqual(c.msgs.find((m) => m.t === "logcatRead" && m.rid === 5), { t: "logcatRead", rid: 5, lines: [], error: "adb 没有响应" });
});

test("logcatRead：手机上 adb 没有响应时说手机的情况，不让人去重启模拟器", async (t) => {
  const phone = new FakeSession();
  phone.kind = "phone";
  const s = await setup(t, phone, undefined, undefined, undefined, undefined, {
    logcatRead: async () => { throw new AdbUnresponsive(); },
  });
  const c = await s.connect();
  hello(c);
  await until(() => c.msgs.some((m) => m.t === "ready"));
  c.ws.send(JSON.stringify({ t: "logcatRead", rid: 7, filter: LOG_ALL, limit: 10 }));
  await until(() => c.msgs.some((m) => m.t === "logcatRead"));
  const err = String(c.msgs.find((m) => m.t === "logcatRead").error);
  assert.match(err, /手机/);
  assert.doesNotMatch(err, /模拟器/);
});

test("没配读日志的网关回 logcatRead 错误", async (t) => {
  const s = await setup(t);
  const c = await s.connect();
  hello(c);
  await until(() => c.msgs.some((m) => m.t === "ready"));
  c.ws.send(JSON.stringify({ t: "logcatRead", rid: 6, filter: LOG_ALL, limit: 10 }));
  await until(() => c.msgs.some((m) => m.t === "logcatRead"));
  assert.deepEqual(c.msgs.find((m) => m.t === "logcatRead"), { t: "logcatRead", rid: 6, lines: [], error: "网关不支持读日志" });
});

test("没配日志的网关收到 logcatOpen 回错误", async (t) => {
  const s = await setup(t);
  const c = await s.connect();
  hello(c);
  await until(() => c.msgs.some((m) => m.t === "ready"));
  c.ws.send(JSON.stringify({ t: "logcatOpen", filter: LOG_ALL }));
  await until(() => c.msgs.some((m) => m.t === "error"));
  assert.equal(c.msgs.find((m) => m.t === "error").message, "网关不支持日志");
});

// ─────────────── 真机重启（PR 7） ───────────────

/** 能重启的真机，重启等待由测试放行。 */
async function phoneRebootSetup(t: import("node:test").TestContext) {
  const { g, wait } = gatedWait();
  const phone = new FakePhone();
  phone.caps = { ...phone.caps, reboot: true };
  const r = await phoneSetup(t, phone, new FakeSession(), { rebootWait: wait });
  const uses: string[] = [];
  const orig = r.fa.ops.use;
  r.fa.ops.use = async (name) => (uses.push(name), orig(name));
  return { ...r, g, uses };
}

test("真机重启：会话关闭时页面看到 rebooting，开机完成后重新连上并收到 done", async (t) => {
  const { c, g, phone, uses } = await phoneRebootSetup(t);
  const readies = () => c.msgs.filter((m) => m.t === "ready" && m.kind === "phone").length;
  const before = readies();
  c.ws.send(JSON.stringify({ t: "reboot" }));
  await until(() => g.calls.length === 1);
  assert.equal(phone.reboots, 1);
  phone.fireClosed();
  await sleep(30);
  const states = c.msgs.filter((m) => m.t === "status").map((m) => m.state);
  assert.ok(states.includes("rebooting"));
  assert.ok(!states.includes("phone-closed"));
  g.finish("done");
  await until(() => c.msgs.some((m) => m.t === "reboot"));
  assert.deepEqual(uses, ["R5CR10WN52H"]);
  assert.equal(readies(), before + 1);
  assert.deepEqual(c.msgs.find((m) => m.t === "reboot"), { t: "reboot", result: "done" });
});

test("真机重启：重启期间手机列表变化不触发重连", async (t) => {
  const { c, g, p, phone, uses } = await phoneRebootSetup(t);
  c.ws.send(JSON.stringify({ t: "reboot" }));
  await until(() => g.calls.length === 1);
  phone.fireClosed();
  p.set([{ ...PHONE_OK, state: "offline" }]);
  p.set([PHONE_OK]);
  await sleep(60);
  assert.deepEqual(uses, []);
  assert.ok(!c.msgs.some((m) => m.t === "error"));
  g.finish("done");
  await until(() => c.msgs.some((m) => m.t === "reboot"));
  assert.deepEqual(uses, ["R5CR10WN52H"]);
});

test("真机重启：重启后重连失败发 failed，之后手机列表变化时按老办法连上", async (t) => {
  const { c, g, p, phone, fa, uses, connect } = await phoneRebootSetup(t);
  const ok = fa.ops.use;
  let first = true;
  fa.ops.use = async (name) => {
    if (first) {
      first = false;
      uses.push(name);
      throw new Error("5 秒内连不上手机上的 scrcpy 服务端");
    }
    return ok(name);
  };
  const before = c.msgs.filter((m) => m.t === "ready" && m.kind === "phone").length;
  c.ws.send(JSON.stringify({ t: "reboot" }));
  await until(() => g.calls.length === 1);
  phone.fireClosed();
  const late = await connect();
  hello(late);
  await until(() => late.msgs.some((m) => m.t === "status"));
  g.finish("done");
  await until(() => c.msgs.some((m) => m.t === "reboot"));
  const r = c.msgs.find((m) => m.t === "reboot");
  assert.equal(r.result, "failed");
  assert.match(r.error, /scrcpy/);
  // 重启期间新开的页面也不能停在「重启中」
  await until(() => late.msgs.filter((m) => m.t === "status").at(-1)?.state === "phone-closed");
  p.set([{ ...PHONE_OK, state: "offline" }]);
  p.set([PHONE_OK]);
  await until(() => c.msgs.filter((m) => m.t === "ready" && m.kind === "phone").length === before + 1);
});

test("真机重启：两分钟没开机完成发 adb-down，不重连", async (t) => {
  const { c, g, p, phone, uses } = await phoneRebootSetup(t);
  c.ws.send(JSON.stringify({ t: "reboot" }));
  await until(() => g.calls.length === 1);
  phone.fireClosed();
  // 两分钟没开机完成时手机还不在 adb 的在线列表里
  p.set([{ ...PHONE_OK, state: "offline" }]);
  g.finish("adb-down");
  await until(() => c.msgs.some((m) => m.t === "reboot"));
  assert.deepEqual(c.msgs.find((m) => m.t === "reboot"), { t: "reboot", result: "adb-down" });
  assert.deepEqual(uses, []);
});

test("真机重启：重启期间新开的页面看到 rebooting，重连后也被接上", async (t) => {
  const { c, g, phone, connect } = await phoneRebootSetup(t);
  c.ws.send(JSON.stringify({ t: "reboot" }));
  await until(() => g.calls.length === 1);
  phone.fireClosed();
  const c2 = await connect();
  hello(c2);
  await until(() => c2.msgs.some((m) => m.t === "status"));
  assert.deepEqual(c2.msgs.filter((m) => m.t === "status").map((m) => m.state), ["rebooting"]);
  g.finish("done");
  await until(() => c2.msgs.some((m) => m.t === "ready" && m.kind === "phone"));
});

test("真机重启：重启中途有人 use 这台手机，回「设备正在重启」，不打断重启流程", async (t) => {
  const { c, g, phone, connect, uses } = await phoneRebootSetup(t);
  c.ws.send(JSON.stringify({ t: "reboot" }));
  await until(() => g.calls.length === 1);
  phone.fireClosed();
  const late = await connect();
  hello(late);
  await until(() => late.msgs.some((m) => m.t === "status"));
  late.ws.send(JSON.stringify({ t: "use", name: phone.id }));
  await until(() => late.msgs.some((m) => m.t === "error"));
  assert.match(late.msgs.find((m) => m.t === "error").message, /正在重启/);
  assert.deepEqual(uses, []);
  g.finish("done");
  await until(() => c.msgs.some((m) => m.t === "reboot"));
  assert.deepEqual(c.msgs.find((m) => m.t === "reboot"), { t: "reboot", result: "done" });
  await until(() => late.msgs.some((m) => m.t === "ready" && m.kind === "phone"));
});

test("真机重启：adb reboot 报错时手机多半已经在重启，照样等开机并重连", async (t) => {
  const { c, g, phone, uses } = await phoneRebootSetup(t);
  phone.reboot = async () => { phone.reboots++; throw new AdbUnresponsive(); };
  c.ws.send(JSON.stringify({ t: "reboot" }));
  await until(() => g.calls.length === 1);
  phone.fireClosed();
  g.finish("done");
  await until(() => c.msgs.some((m) => m.t === "reboot"));
  assert.deepEqual(c.msgs.find((m) => m.t === "reboot"), { t: "reboot", result: "done" });
  assert.deepEqual(uses, ["R5CR10WN52H"]);
});

// ─────────────── MuMu 模拟器 ───────────────

import type { MumuInfo } from "../../shared/protocol.ts";

const MUMU: MumuInfo = { index: 0, name: "我的安卓", state: "stopped" };

function fakeMumu(initial: MumuInfo[] | null, opts: { fail?: string; appClosed?: boolean } = {}) {
  const cbs: Array<(l: MumuInfo[]) => void> = [];
  let list = initial;
  const calls: string[] = [];
  return {
    calls,
    ops: {
      list: () => list,
      appClosed: () => opts.appClosed === true,
      launch: async () => { calls.push("launch"); if (opts.fail) throw new Error(opts.fail); },
      onChange: (cb: (l: MumuInfo[]) => void) => void cbs.push(cb),
      open: async (i: number) => { calls.push(`open ${i}`); if (opts.fail) throw new Error(opts.fail); },
      close: async (i: number) => { calls.push(`close ${i}`); if (opts.fail) throw new Error(opts.fail); },
    },
    set(l: MumuInfo[]) { list = l; for (const cb of cbs) cb(l); },
  };
}

test("装了 MuMu 时 hello 后收到一次 MuMu 列表，变化时广播", async (t) => {
  const m = fakeMumu([MUMU]);
  const { connect } = await setup(t, new FakeSession(), undefined, undefined, undefined, undefined, { mumu: m.ops });
  const c = await connect();
  hello(c);
  await until(() => c.msgs.some((x) => x.t === "mumu"));
  assert.deepEqual(c.msgs.find((x) => x.t === "mumu"), { t: "mumu", list: [MUMU] });
  m.set([{ ...MUMU, state: "running", adbId: "127.0.0.1:16384" }]);
  await until(() => c.msgs.filter((x) => x.t === "mumu").length === 2);
  assert.deepEqual(c.msgs.filter((x) => x.t === "mumu").at(-1), { t: "mumu", list: [{ ...MUMU, state: "running", adbId: "127.0.0.1:16384" }] });
});

test("没装 MuMu（列表是 null）时不发 MuMu 列表", async (t) => {
  const { connect } = await setup(t, new FakeSession(), undefined, undefined, undefined, undefined, { mumu: fakeMumu(null).ops });
  const c = await connect();
  hello(c);
  await until(() => c.msgs.some((x) => x.t === "ready"));
  await sleep(50);
  assert.ok(!c.msgs.some((x) => x.t === "mumu"));
});

test("mumuOpen / mumuClose 交给 MuMu 模块执行", async (t) => {
  const m = fakeMumu([MUMU]);
  const { connect } = await setup(t, new FakeSession(), undefined, undefined, undefined, undefined, { mumu: m.ops });
  const c = await connect();
  hello(c);
  await until(() => c.msgs.some((x) => x.t === "mumu"));
  c.ws.send(JSON.stringify({ t: "mumuOpen", index: 0 }));
  c.ws.send(JSON.stringify({ t: "mumuClose", index: 0 }));
  await until(() => m.calls.length === 2);
  assert.deepEqual(m.calls, ["open 0", "close 0"]);
});

test("MuMu 开机失败：把原因发回发起的页面", async (t) => {
  const m = fakeMumu([MUMU], { fail: "license expired" });
  const { connect } = await setup(t, new FakeSession(), undefined, undefined, undefined, undefined, { mumu: m.ops });
  const c = await connect();
  hello(c);
  await until(() => c.msgs.some((x) => x.t === "mumu"));
  c.ws.send(JSON.stringify({ t: "mumuOpen", index: 0 }));
  await until(() => c.msgs.some((x) => x.t === "error"));
  assert.deepEqual(c.msgs.find((x) => x.t === "error"), { t: "error", message: "MuMu 开机失败：license expired" });
});

test("/devtools-frontend/：只代理 appspot 上带版本号的前端文件，带上只许连回网关的 CSP；别的路径 404，不去取", async (t) => {
  const fetched: string[] = [];
  const fetchFrontend = (async (url: string) => {
    fetched.push(url);
    return new Response("<html>devtools</html>", { headers: { "content-type": "text/html", "cache-control": "public, max-age=31536000" } });
  }) as typeof fetch;
  const { srv } = await setup(t, new FakeSession(), undefined, undefined, undefined, undefined, { fetchFrontend });
  const r = await fetch(`http://127.0.0.1:${srv.port}/devtools-frontend/serve_rev/@0123abcd/devtools_app.html`);
  assert.equal(await r.text(), "<html>devtools</html>");
  assert.equal(r.headers.get("content-security-policy"), `connect-src 'self'; frame-ancestors http://127.0.0.1:${srv.port} http://localhost:${srv.port}`);
  assert.equal(r.headers.get("cache-control"), "public, max-age=31536000");
  assert.deepEqual(fetched, ["https://chrome-devtools-frontend.appspot.com/serve_rev/@0123abcd/devtools_app.html"]);
  for (const bad of ["evil.com/x.js", "serve_rev/abc/x.js", "serve_rev/@0123abcd/..%2F..%2Fx", "serve_rev/@0123abcd/a%3Fb"]) {
    assert.equal((await fetch(`http://127.0.0.1:${srv.port}/devtools-frontend/${bad}`)).status, 404, bad);
  }
  assert.equal(fetched.length, 1);
});

test("装了 MuMu 但播放器没打开：mumu 消息带 appClosed；mumuLaunch 交给 MuMu 模块打开播放器", async (t) => {
  const m = fakeMumu([], { appClosed: true });
  const { connect } = await setup(t, new FakeSession(), undefined, undefined, undefined, undefined, { mumu: m.ops });
  const c = await connect();
  hello(c);
  await until(() => c.msgs.some((x) => x.t === "mumu"));
  assert.deepEqual(c.msgs.find((x) => x.t === "mumu"), { t: "mumu", list: [], appClosed: true });
  c.ws.send(JSON.stringify({ t: "mumuLaunch" }));
  await until(() => m.calls.includes("launch"));
});

test("打开 MuMuPlayer 失败：把原因发回发起的页面", async (t) => {
  const m = fakeMumu([], { appClosed: true, fail: "Unable to find application named 'MuMuPlayer'" });
  const { connect } = await setup(t, new FakeSession(), undefined, undefined, undefined, undefined, { mumu: m.ops });
  const c = await connect();
  hello(c);
  await until(() => c.msgs.some((x) => x.t === "mumu"));
  c.ws.send(JSON.stringify({ t: "mumuLaunch" }));
  await until(() => c.msgs.some((x) => x.t === "error"));
  assert.deepEqual(c.msgs.find((x) => x.t === "error"), { t: "error", message: "打开 MuMu 失败：Unable to find application named 'MuMuPlayer'" });
});

// ─────────────── iOS 模拟器 ───────────────

import type { IosSimInfo } from "../../shared/protocol.ts";

const IOS_UDID = "0A67FFC2-A5BD-43AB-9AA9-6E22B5511D40";
const IOS_SIM: IosSimInfo = { udid: IOS_UDID, name: "iPhone 11", runtime: "iOS 27.0", state: "booted" };

function fakeIosSims(initial: IosSimInfo[] | null, opts: { fail?: string } = {}) {
  const cbs: Array<(l: IosSimInfo[]) => void> = [];
  let list = initial;
  const calls: string[] = [];
  return {
    calls,
    ops: {
      list: () => list,
      onChange: (cb: (l: IosSimInfo[]) => void) => void cbs.push(cb),
      open: async (u: string) => { calls.push(`open ${u}`); if (opts.fail) throw new Error(opts.fail); },
      close: async (u: string) => { calls.push(`close ${u}`); if (opts.fail) throw new Error(opts.fail); },
      booted: (u: string) => (list ?? []).some((s) => s.udid === u && s.state === "booted"),
    },
    set(l: IosSimInfo[]) { list = l; for (const cb of cbs) cb(l); },
  };
}

class FakeIosSim extends FakePhone {
  constructor() {
    super(IOS_UDID);
    this.caps = { rotate: false, reboot: false, stop: false, clipboard: true, input: false, scroll: false, adb: false };
    this.device = { width: 828, height: 1792 };
  }
}

/** 先接上模拟器，再切到 iOS 模拟器。 */
async function iosSetup(t: import("node:test").TestContext, more: Partial<Parameters<typeof startServer>[0]> = {}) {
  const sim = new FakeIosSim();
  const emu = new FakeSession();
  const i = fakeIosSims([IOS_SIM]);
  const fa = fakeAvd({ [IOS_UDID]: sim });
  const s = await setup(t, emu, async () => emu, fa.ops, undefined, undefined, { iosSims: i.ops, ...more });
  const c = await s.connect();
  hello(c);
  await until(() => c.msgs.some((m) => m.t === "ready"));
  c.ws.send(JSON.stringify({ t: "use", name: IOS_UDID }));
  await until(() => c.msgs.some((m) => m.t === "ready" && m.deviceId === IOS_UDID));
  return { ...s, c, i, sim, emu };
}

test("装了 Xcode 时 hello 后收到一次 iOS 模拟器列表，变化时广播；没装（null）时不发", async (t) => {
  const i = fakeIosSims([IOS_SIM]);
  const { connect } = await setup(t, new FakeSession(), undefined, undefined, undefined, undefined, { iosSims: i.ops });
  const c = await connect();
  hello(c);
  await until(() => c.msgs.some((x) => x.t === "iosSims"));
  assert.deepEqual(c.msgs.find((x) => x.t === "iosSims"), { t: "iosSims", list: [IOS_SIM] });
  i.set([{ ...IOS_SIM, state: "shutdown" }]);
  await until(() => c.msgs.filter((x) => x.t === "iosSims").length === 2);

  const none = await setup(t, new FakeSession(), undefined, undefined, undefined, undefined, { iosSims: fakeIosSims(null).ops });
  const c2 = await none.connect();
  hello(c2);
  await until(() => c2.msgs.some((x) => x.t === "ready"));
  await sleep(50);
  assert.ok(!c2.msgs.some((x) => x.t === "iosSims"));
});

test("use 开着的 iOS 模拟器的 UDID：ready 带 caps.adb=false，画面走 BIN_VIDEO", async (t) => {
  const { c, sim } = await iosSetup(t);
  const ready = c.msgs.filter((m) => m.t === "ready").at(-1);
  assert.deepEqual(ready, { t: "ready", version: PROTOCOL_VERSION, device: { width: 828, height: 1792 }, serial: 0, deviceId: IOS_UDID, kind: "phone", caps: sim.caps });
  sim.pushPacket("config", 1);
  sim.pushPacket("key", 2);
  await until(() => videoTags(c).length === 2);
});

test("use 没开机的 iOS 模拟器 UDID：当普通设备名找，找不到就回没有在运行", async (t) => {
  const i = fakeIosSims([{ ...IOS_SIM, state: "shutdown" }]);
  const fa = fakeAvd({});
  const { connect } = await setup(t, new FakeSession(), undefined, fa.ops, undefined, undefined, { iosSims: i.ops });
  const c = await connect();
  hello(c);
  await until(() => c.msgs.some((m) => m.t === "ready"));
  c.ws.send(JSON.stringify({ t: "use", name: IOS_UDID }));
  await until(() => c.msgs.some((m) => m.t === "error"));
  assert.equal((c.msgs.find((m) => m.t === "error") as { message: string }).message, `${IOS_UDID} 没有在运行或没开 gRPC`);
});

test("iOS 模拟器会话关闭：页面收到 emulator-closed（不是等手机插回的 phone-closed），ticker 照常接管别的设备", async (t) => {
  const { c, sim } = await iosSetup(t);
  const readies = () => c.msgs.filter((m) => m.t === "ready").length;
  const before = readies();
  sim.fireClosed();
  await until(() => c.msgs.some((m) => m.t === "status" && m.state === "emulator-closed"));
  assert.ok(!c.msgs.some((m) => m.t === "status" && m.state === "phone-closed"));
  await until(() => readies() > before);
});

test("iOS 模拟器（caps.adb=false）：H5 列表、日志、传文件直接回不支持，不碰 adb", async (t) => {
  const debugCalls: string[] = [];
  const debug = { forDevice: (id: string) => { debugCalls.push(id); throw new Error("不该调到"); }, connectCdp: async () => { throw new Error("no"); } } as unknown as DebugDeps;
  const { c } = await iosSetup(t, { debug, logcatRead: async () => { throw new Error("不该调到"); }, files: { adb: async () => { throw new Error("不该调到"); } } });
  c.ws.send(JSON.stringify({ t: "webviews", rid: 7 }));
  await until(() => c.msgs.some((m) => m.t === "webviews" && m.rid === 7));
  assert.equal((c.msgs.find((m) => m.t === "webviews") as { error?: string }).error, "iOS 模拟器暂不支持这个功能");
  c.ws.send(JSON.stringify({ t: "logcatRead", rid: 8, filter: { level: "V", text: "", pkg: null }, limit: 10 }));
  await until(() => c.msgs.some((m) => m.t === "logcatRead"));
  assert.equal((c.msgs.find((m) => m.t === "logcatRead") as { error?: string }).error, "iOS 模拟器暂不支持这个功能");
  c.ws.send(JSON.stringify({ t: "upload", id: 1, name: "a.apk", size: 10 }));
  await until(() => c.msgs.some((m) => m.t === "upload" && m.state === "failed"));
  assert.equal((c.msgs.find((m) => m.t === "upload" && m.state === "failed") as { error?: string }).error, "iOS 模拟器暂不支持这个功能");
  assert.deepEqual(debugCalls, []);
});

test("iosSimOpen / iosSimClose 交给 iOS 模拟器模块；失败时把原因发回发起的页面", async (t) => {
  const i = fakeIosSims([IOS_SIM], { fail: "Unable to boot device in current state: Booted" });
  const { connect } = await setup(t, new FakeSession(), undefined, undefined, undefined, undefined, { iosSims: i.ops });
  const c = await connect();
  hello(c);
  await until(() => c.msgs.some((x) => x.t === "iosSims"));
  c.ws.send(JSON.stringify({ t: "iosSimOpen", udid: IOS_UDID }));
  c.ws.send(JSON.stringify({ t: "iosSimClose", udid: IOS_UDID }));
  await until(() => i.calls.length === 2);
  assert.deepEqual(i.calls, [`open ${IOS_UDID}`, `close ${IOS_UDID}`]);
  await until(() => c.msgs.filter((x) => x.t === "error").length === 2);
  assert.deepEqual(c.msgs.find((x) => x.t === "error"), { t: "error", message: "iOS 模拟器开机失败：Unable to boot device in current state: Booted" });
});

test("iOS 模拟器（caps.input=false）：按键和文字直接丢掉，不逐个回错误", async (t) => {
  const { c, sim } = await iosSetup(t);
  c.ws.send(JSON.stringify({ t: "key", key: "a", eventType: "keydown" }));
  c.ws.send(JSON.stringify({ t: "text", text: "hi" }));
  c.ws.send(JSON.stringify({ t: "touch", x: 1, y: 2, down: true }));
  await until(() => sim.calls.includes("touch"));
  await sleep(50);
  assert.ok(!c.msgs.some((m) => m.t === "error"));
  assert.ok(!sim.calls.includes("key") && !sim.calls.includes("text"));
});

// ─────────────── iOS 模拟器的 H5 调试 ───────────────

async function iosInspectorSetup(t: import("node:test").TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "webinspector-"));
  await writeFile(join(dir, "Main.html"), '<html><head><script src="Main.js"></script></head></html>');
  await writeFile(join(dir, "Main.js"), "/* frontend */");
  const shim = join(dir, "..", `shim-${Date.now()}.js`);
  await writeFile(shim, "/* shim */");
  const sent: string[] = [];
  let toFrontend: ((m: string) => void) | null = null;
  let closed = 0;
  const inspector = {
    list: async () => [{ socket: "PID:1", id: "1", title: "Example", url: "https://example.com/", pkg: "com.apple.mobilesafari", visible: true }],
    open: async () => ({
      send: (m: string) => void sent.push(m),
      onMessage: (cb: (m: string) => void) => void (toFrontend = cb),
      onClose: () => {},
      close: () => void closed++,
    }),
    close: () => {},
  } as unknown as import("../src/ios-inspector.ts").IosInspector;
  const s = await iosSetup(t, { ios: { inspector: () => ({ inspector, version: "27.0", ios: "27.0" }), webInspectorDir: dir, hostShim: shim } });
  return { ...s, port: s.srv.port, sent, push: (m: string) => toFrontend?.(m), closed: () => closed };
}

test("iOS 会话：webviews 列出 WebKit 页面；inspect 给出网关自己提供的 WebKit 调试界面地址", async (t) => {
  const { c, port } = await iosInspectorSetup(t);
  c.ws.send(JSON.stringify({ t: "webviews", rid: 1 }));
  await until(() => c.msgs.some((m) => m.t === "webviews"));
  assert.deepEqual((c.msgs.find((m) => m.t === "webviews") as { list: unknown[] }).list.length, 1);
  c.ws.send(JSON.stringify({ t: "inspect", rid: 2, socket: "PID:1", id: "1" }));
  await until(() => c.msgs.some((m) => m.t === "inspect"));
  const url = new URL((c.msgs.find((m) => m.t === "inspect") as { url: string }).url);
  assert.equal(url.origin, `http://127.0.0.1:${port}`);
  assert.equal(url.pathname, "/webinspector/Main.html");
  assert.match(url.searchParams.get("ws")!, new RegExp(`^127\\.0\\.0\\.1:${port}/webinspector/ws/PID%3A1/1/[^/]+$`));
  assert.equal(url.searchParams.get("version"), "27.0");
});

test("/webinspector/：Main.html 在 Main.js 前插入替身，替身单独提供；目录外的文件 404", async (t) => {
  const { port } = await iosInspectorSetup(t);
  const mainRes = await fetch(`http://127.0.0.1:${port}/webinspector/Main.html`);
  assert.match(mainRes.headers.get("content-security-policy") ?? "", /^connect-src 'self'; frame-ancestors .*http:\/\/127\.0\.0\.1:\d+/);
  const main = await mainRes.text();
  assert.match(main, /<script src="droidpier-host\.js"><\/script>\s*<script src="Main\.js"><\/script>/);
  assert.equal(await (await fetch(`http://127.0.0.1:${port}/webinspector/droidpier-host.js`)).text(), "/* shim */");
  assert.equal((await fetch(`http://127.0.0.1:${port}/webinspector/..%2F..%2Fetc%2Fpasswd`)).status, 404);
});

test("iOS 调试通道：带票据从网关本机地址连上后双向转发；票据只能用一次，别的 Origin 拒绝", async (t) => {
  const { c, port, sent, push } = await iosInspectorSetup(t);
  c.ws.send(JSON.stringify({ t: "inspect", rid: 2, socket: "PID:1", id: "1" }));
  await until(() => c.msgs.some((m) => m.t === "inspect"));
  const wsPath = new URL((c.msgs.find((m) => m.t === "inspect") as { url: string }).url).searchParams.get("ws")!;
  const evil = new WebSocket(`ws://${wsPath}`, { headers: { Origin: "https://evil.test" } });
  assert.equal(await new Promise((r) => evil.on("close", (code) => r(code))), CLOSE_ORIGIN);
  const fe = new WebSocket(`ws://${wsPath}`, { headers: { Origin: `http://127.0.0.1:${port}` } });
  const got: string[] = [];
  fe.on("message", (d) => got.push(d.toString()));
  await new Promise((r) => fe.on("open", r));
  fe.send('{"id":1,"method":"Runtime.evaluate"}');
  await until(() => sent.length === 1);
  push('{"id":1,"result":{}}');
  await until(() => got.length === 1);
  assert.equal(got[0], '{"id":1,"result":{}}');
  fe.close();
  const again = new WebSocket(`ws://${wsPath}`, { headers: { Origin: `http://127.0.0.1:${port}` } });
  assert.equal(await new Promise((r) => again.on("close", (code) => r(code))), CLOSE_BAD_TOKEN);
});
