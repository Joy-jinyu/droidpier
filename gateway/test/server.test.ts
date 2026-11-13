import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import WebSocket, { WebSocketServer } from "ws";
import { startServer, type AvdOps, type DebugDeps, type SetupOps } from "../src/server.ts";
import type { CdpClient } from "../src/cdp.ts";
import type { AvdCatalog, WebViewPage } from "../../shared/protocol.ts";
import { cachedSession } from "../src/session-cache.ts";
import type { EmulatorSession } from "../src/emulator.ts";
import { BIN_SCREENSHOT, binKind, CLOSE_BAD_TOKEN, CLOSE_NO_HELLO, CLOSE_ORIGIN, CLOSE_VERSION, decodeFrameHeader, PROTOCOL_VERSION, type FrameHeader } from "../../shared/protocol.ts";
import { allowedOrigins } from "../src/auth.ts";
import { randomBytes } from "node:crypto";

const randomToken = () => randomBytes(32).toString("base64url");
import { screenshotName } from "../src/server.ts";
import { AdbUnresponsive } from "../src/adb.ts";
import { ADB_UNRESPONSIVE } from "../../shared/protocol.ts";

type Sub = { size: { width: number; height: number }; onFrame: (h: FrameHeader, d: Buffer) => void; active: boolean };

class FakeSession implements EmulatorSession {
  device = { width: 1080, height: 2340 };
  serial = 5554;
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
  async key() { this.calls.push("key"); }
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

type Client = { ws: WebSocket; msgs: any[]; frames: FrameHeader[]; binMsgs: ArrayBuffer[]; closed: Promise<number> };

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
  const srv = await startServer({ port, allowedOrigins: allowedOrigins(null, port), staticDir, getSession, avd, debug, setup: setupOps, pollMs: 20, log: (s) => logs.push(s), ...more });
  t.after(() => srv.close());
  const clients: Client[] = [];
  t.after(() => { for (const c of clients) c.ws.terminate(); });
  const connect = async (): Promise<Client> => {
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/`, { headers: { Origin: origin } });
    const c: Client = { ws, msgs: [], frames: [], binMsgs: [], closed: new Promise((r) => ws.on("close", (code) => r(code))) };
    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        const ab = (data as Buffer).buffer.slice((data as Buffer).byteOffset, (data as Buffer).byteOffset + (data as Buffer).byteLength);
        c.binMsgs.push(ab);
        if (binKind(ab) === 1) c.frames.push(decodeFrameHeader(new Uint8Array(ab)));
      }
      else c.msgs.push(JSON.parse(data.toString()));
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
  assert.deepEqual(c.msgs[0], { t: "ready", version: PROTOCOL_VERSION, device: { width: 1080, height: 2340 }, serial: 5554 });
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
  const { connect, session } = await setup(t);
  const a = await connect();
  const b = await connect();
  hello(a);
  hello(b);
  await until(() => session!.subs.length === 2);
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
  assert.deepEqual(c1.msgs[3], { t: "ready", version: PROTOCOL_VERSION, device: { width: 720, height: 1600 }, serial: 5554 });
  assert.equal(c1.ws.readyState, WebSocket.OPEN);
  const c2 = await connect();
  hello(c2);
  await until(() => c2.msgs.length > 0);
  assert.deepEqual(c2.msgs[0], { t: "ready", version: PROTOCOL_VERSION, device: { width: 720, height: 1600 }, serial: 5554 });
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
  const ops: AvdOps = {
    list: async () => (deleted ? [] : [{ name: "A", running, ...(displayName ? { displayName } : {}) }]),
    start: (name) => {
      calls.push(`start ${name}`);
      if (job && job.name === name && job.progress === "booting") return job;
      job = { name, serial: 5556, grpcPort: 8556, progress: "booting", done: new Promise((res, rej) => ((resolve = res), (reject = rej))) };
      job.done.catch(() => {});
      return job;
    },
    stop: async (serial) => void calls.push(`stop ${serial}`),
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
    assert.deepEqual(c.msgs.at(-2), { t: "ready", version: PROTOCOL_VERSION, device: { width: 720, height: 1600 }, serial: 5554 });
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
  assert.deepEqual(c.msgs.at(-2), { t: "ready", version: PROTOCOL_VERSION, device: { width: 720, height: 1600 }, serial: 5554 });
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
    forDevice: (serial) => ({
      webviews: {
        list: async () => (calls.push(`list ${serial}`), f.pages),
        portOf: (socket) => (f.pages.some((p) => p.socket === socket) ? f.port : undefined),
        close: async () => void calls.push(`close ${serial}`),
      },
      reverses: {
        ensure: async (port) => {
          calls.push(`ensure ${serial} ${port}`);
          if (f.ensureError) throw f.ensureError;
        },
        removeAll: async () => void calls.push(`removeAll ${serial}`),
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
  f.deps.forDevice = ((orig) => (serial: number) => {
    const d = orig(serial);
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
  const ensureAt = f.calls.indexOf("ensure 5554 5173");
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

test("inspect：有 frontendUrl 回经网关代理的地址，没有时回 chrome://inspect 提示", async (t) => {
  const bare: WebViewPage = { ...PAGE, socket: "chrome_devtools_remote", pid: undefined, pkg: undefined, id: "p2", title: "Tab", frontendUrl: undefined };
  const { c, srv } = await debugSetup(t, fakeDebug([PAGE, bare]));
  c.ws.send(JSON.stringify({ t: "inspect", rid: 1, socket: PAGE.socket, id: "p1" }));
  c.ws.send(JSON.stringify({ t: "inspect", rid: 2, socket: "chrome_devtools_remote", id: "p2" }));
  c.ws.send(JSON.stringify({ t: "inspect", rid: 3, socket: PAGE.socket, id: "gone" }));
  await until(() => [1, 2, 3].every((rid) => !!reply(c, "inspect", rid)));
  const url = reply(c, "inspect", 1).url as string;
  const prefix = `https://chrome-devtools-frontend.appspot.com/serve_rev/@abc/devtools_app.html?ws=127.0.0.1:${srv.port}/devtools/${PAGE.socket}/p1/`;
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
  const fa = fakeAvd({ B: b });
  const { c, f } = await debugSetup(t, fakeDebug(), a, fa.ops);
  c.ws.send(JSON.stringify({ t: "webviews", rid: 1 }));
  await until(() => !!reply(c, "webviews", 1));
  c.ws.send(JSON.stringify({ t: "use", name: "B" }));
  await until(() => f.calls.includes("close 5554") && f.calls.includes("removeAll 5554"));
  c.ws.send(JSON.stringify({ t: "webviews", rid: 2 }));
  await until(() => !!reply(c, "webviews", 2));
  assert.ok(f.calls.includes("list 5556"), f.calls.join(" | "));
});

test("模拟器退出：这台设备的转发和 reverse 被移除", async (t) => {
  const { c, f, session } = await debugSetup(t);
  c.ws.send(JSON.stringify({ t: "webviews", rid: 1 }));
  await until(() => !!reply(c, "webviews", 1));
  session!.fireClosed();
  await until(() => f.calls.includes("close 5554") && f.calls.includes("removeAll 5554"));
});

test("网关关闭时移除转发和 reverse", async (t) => {
  const { c, f, srv } = await debugSetup(t);
  c.ws.send(JSON.stringify({ t: "navigate", rid: 1, socket: PAGE.socket, id: "p1", address: "localhost:5173" }));
  await until(() => !!reply(c, "navigate", 1));
  await srv.close();
  assert.ok(f.calls.includes("close 5554") && f.calls.includes("removeAll 5554"), f.calls.join(" | "));
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
function fakeSetup(opts: { freeMb?: number; java?: boolean; checkThrows?: boolean; catalog?: AvdCatalog } = {}) {
  const runs: string[][] = [];
  const specs: unknown[] = [];
  const accepted: number[] = [];
  const rejected: number[] = [];
  let progress: ((p: { id: string; phase: "download" | "unpack" | "license" | "install" | "done" | "failed"; pct?: number; logTail: string }) => void) | undefined;
  let license: ((l: { id: number; name: string; text: string }) => void) | undefined;
  let finish!: () => void;
  let missing: Array<{ id: "emulator" | "java"; detail: string; sizeMb?: number; diskMb?: number; command?: string; auto: boolean }> = [
    { id: "emulator", detail: "没有模拟器程序", sizeMb: 400, diskMb: 1200, command: 'sdkmanager "emulator"', auto: true },
  ];
  if (opts.java === false) missing.unshift({ id: "java", detail: "需要 Java", auto: false });
  const free = opts.freeMb ?? 100_000;
  const ops: SetupOps = {
    check: async () => {
      if (opts.checkThrows) throw new Error("读不了目录");
      return { ok: missing.length === 0, missing, sdkRoot: "/sdk", avdHome: "/avd", androidCli: false, javaHome: opts.java === false ? null : "/jdk", freeMb: free, avdFreeMb: free, sameDisk: true };
    },
    installer: {
      run: (ids, onProgress, onLicense, spec) => {
        runs.push(ids);
        specs.push(spec);
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

test("没有 Java：网关拒绝要 sdkmanager 的安装", async (t) => {
  const f = fakeSetup({ java: false });
  const { connect } = await setup(t, null, undefined, undefined, undefined, f.ops);
  const c = await connect();
  hello(c);
  await until(() => c.msgs.some((m) => m.t === "env"));
  c.ws.send(JSON.stringify({ t: "install", ids: ["emulator"] }));
  await until(() => c.msgs.some((m) => m.t === "error"));
  assert.match(c.msgs.find((m) => m.t === "error").message, /需要 Java/);
  assert.deepEqual(f.runs, []);
});

const IMG34 = { pkg: "system-images;android-34;google_apis;arm64-v8a", api: "34", apiLevel: 34, tag: "google_apis", installed: true, version: "Android 14" };
const IMG27 = { pkg: "system-images;android-27;google_apis;arm64-v8a", api: "27", apiLevel: 27, tag: "google_apis", installed: true, version: "Android 8.1" };
const IMG36 = { pkg: "system-images;android-36;google_apis;arm64-v8a", api: "36", apiLevel: 36, tag: "google_apis", installed: false, version: "Android 16", sizeMb: 1786, diskMb: 5358 };
const CATALOG: AvdCatalog = {
  devices: [{ id: "pixel_5", name: "Pixel 5", oem: "Google" }, { id: "Nexus 5X", name: "Nexus 5X", oem: "Google" }],
  images: [IMG34, IMG27, IMG36], existing: ["emu_web_default"],
  defaultDevice: "pixel_5", defaultImage: IMG34.pkg, needTools: false,
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
  assert.deepEqual(f.specs, [{ name: "Pixel_5_API_36", device: "pixel_5", image: IMG36.pkg, ramMb: 4096 }]);
});

test("createAvd：镜像已装只建设备；低于 API 28 的内存 2048", async (t) => {
  const f = fakeSetup();
  const c = await setupConnected(t, f);
  c.ws.send(createMsg({ name: "Nexus_5X_API_27", device: "Nexus 5X", image: IMG27.pkg }));
  await until(() => f.runs.length === 1);
  assert.deepEqual(f.runs, [["avd"]]);
  assert.deepEqual(f.specs, [{ name: "Nexus_5X_API_27", device: "Nexus 5X", image: IMG27.pkg, ramMb: 2048 }]);
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

test("createAvd：没有命令行工具时拒绝", async (t) => {
  const f = fakeSetup({ catalog: { ...CATALOG, devices: [], defaultDevice: null, needTools: true } });
  const c = await setupConnected(t, f);
  c.ws.send(createMsg());
  await until(() => c.msgs.some((m) => m.t === "error"));
  assert.match(c.msgs.find((m) => m.t === "error").message, /先安装命令行工具/);
  assert.deepEqual(f.runs, []);
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
  f.deps.forDevice = ((orig) => (serial: number) => {
    const d = orig(serial);
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

// ─────────────── 重启模拟器 ───────────────

/** 可控的开机等待：resolve 前一直在“重启中”。 */
function gatedWait() {
  const g = { calls: [] as number[], finish: (_r: "done" | "adb-down") => {} };
  const wait = (serial: number) => new Promise<"done" | "adb-down">((r) => { g.calls.push(serial); g.finish = r; });
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
  assert.deepEqual(g.calls, [5554]);
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
  await until(() => f.calls.includes("close 5554") && f.calls.includes("removeAll 5554"));
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
    calls: [] as Array<{ serial: number; args: string[]; content: string | null }>,
    out: "Success\n",
    err: null as Error | null,
    gate: false,
    release: () => {},
    ops: {
      tmpRoot: root,
      adb: async (serial: number, args: string[]) => {
        const local = args[0] === "install" ? args[3] : args[1];
        const content = await readFileFs(local, "utf8").catch(() => null);
        f.calls.push({ serial, args, content });
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
  assert.equal(call.serial, 5554);
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
