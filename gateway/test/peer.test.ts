import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { createPeerCheck, isBrowserProcess, isEmulatorProcess, lsofSockets, parseLsof, type Holder, type Snapshot, type SocketsLookup } from "../src/peer.ts";

test("isEmulatorProcess：模拟器的进程和 adb 算，浏览器不算", () => {
  for (const c of ["qemu-system-aarch64-headless", "qemu-system-x86_64", "emulator", "netsimd", "adb"]) assert.equal(isEmulatorProcess(c), true, c);
  for (const c of ["Google Chrome Helper", "Safari", "node", "curl", "adbx", "myqemu-system"]) assert.equal(isEmulatorProcess(c), false, c);
});

test("isBrowserProcess：Chrome / Edge / Chromium 及其 Helper（含被截到 32 个字符的）算，别的都不算", () => {
  for (const c of [
    "Google Chrome", "Google Chrome Helper", "Google Chrome Helper (Aperitif)", "Google Chrome Canary Helper (Ape",
    "Google Chrome Beta Helper", "Microsoft Edge", "Microsoft Edge Helper", "Microsoft Edge Dev Helper (Aperi", "Chromium Helper",
  ]) assert.equal(isBrowserProcess(c), true, c);
  for (const c of ["node", "Safari", "com.apple.WebKit.Networking", "whistle", "Charles", "Proxyman", "mitmproxy", "Google Chrome Helperx", "Google Chromex", "qemu-system-aarch64-headless", ""]) {
    assert.equal(isBrowserProcess(c), false, c);
  }
});

const LSOF = [
  "p600", "cnode", "f20", "n127.0.0.1:7300", "f40", "n127.0.0.1:7300->127.0.0.1:51000", "f41", "n127.0.0.1:7300->127.0.0.1:52000", "f42", "n127.0.0.1:7300->127.0.0.1:53000",
  "p500", "cGoogle Chrome Helper (Aperitif)", "f30", "n127.0.0.1:51000->127.0.0.1:7300",
  "p700", "cqemu-system-aarch64-headless", "f9", "n127.0.0.1:52000->127.0.0.1:7300",
  "p800", "cwhistle", "f3", "n127.0.0.1:52000->127.0.0.1:7300", "n10.0.0.2:52000->10.0.0.9:7300", "",
].join("\n");

test("parseLsof：按对端端口收集所有持有者，另记下网关这一头看得到的端口", () => {
  const snap = parseLsof(LSOF, 7300);
  assert.deepEqual(snap.holders.get(51000), [{ pid: 500, command: "Google Chrome Helper (Aperitif)" }]);
  assert.deepEqual(snap.holders.get(52000), [{ pid: 700, command: "qemu-system-aarch64-headless" }, { pid: 800, command: "whistle" }]);
  assert.equal(snap.holders.has(53000), false);
  assert.deepEqual([...snap.own].sort(), [51000, 52000, 53000]);
});

/** 一对真实的本机 TCP 连接：返回服务端这一头的 socket。 */
async function pair(t: import("node:test").TestContext, srv?: net.Server) {
  const server = srv ?? net.createServer();
  if (!srv) {
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    t.after(() => server.close());
  }
  const port = (server.address() as net.AddressInfo).port;
  const accepted = new Promise<net.Socket>((r) => server.once("connection", r));
  const client = net.connect(port, "127.0.0.1");
  const socket = await accepted;
  t.after(() => { client.destroy(); socket.destroy(); });
  return { socket, port, client, server };
}

/** 假 lookup：按对端端口给持有者；记调用次数和最大并发。 */
function fakeLookup(by: (peerPort: number) => Holder[] | "gone" | undefined, delayMs = 0) {
  const stats = { calls: 0, running: 0, maxRunning: 0 };
  const ports = new Set<number>();
  const lookup: SocketsLookup = async () => {
    stats.calls++;
    stats.running++;
    stats.maxRunning = Math.max(stats.maxRunning, stats.running);
    await new Promise((r) => setTimeout(r, delayMs));
    stats.running--;
    const snap: Snapshot = { holders: new Map(), own: new Set() };
    for (const p of ports) {
      const v = by(p);
      snap.own.add(p);
      if (Array.isArray(v)) snap.holders.set(p, v);
    }
    return snap;
  };
  return { lookup, stats, watch: (p: number) => ports.add(p) };
}

const opts = (lookup: SocketsLookup, logs: string[] = [], more = {}) => ({ lookup, platform: "darwin", log: (s: string) => logs.push(s), ...more });

test("模拟器持有对端：HTTP 和 WebSocket 都 403，原因里有进程名", async (t) => {
  const { socket, port } = await pair(t);
  const f = fakeLookup(() => [{ pid: 700, command: "qemu-system-aarch64-headless" }]);
  f.watch(socket.remotePort!);
  const check = createPeerCheck(opts(f.lookup));
  for (const kind of ["http", "ws"] as const) {
    const v = await check(socket, port, kind);
    assert.equal(v.ok, false);
    assert.equal(!v.ok && v.status, 403);
    assert.match(!v.ok ? v.why : "", /qemu-system-aarch64-headless（pid 700）/);
  }
  assert.equal(f.stats.calls, 1, "同一 socket 只查一次");
});

test("Chrome 持有对端：HTTP 和 WebSocket 都放行，不写日志", async (t) => {
  const { socket, port } = await pair(t);
  const f = fakeLookup(() => [{ pid: 500, command: "Google Chrome Helper (Aperitif)" }]);
  f.watch(socket.remotePort!);
  const logs: string[] = [];
  const check = createPeerCheck(opts(f.lookup, logs));
  assert.deepEqual(await check(socket, port, "http"), { ok: true });
  assert.deepEqual(await check(socket, port, "ws"), { ok: true });
  assert.deepEqual(logs, []);
});

test("WebSocket 只收浏览器：node、本机代理 403；有一个持有者不是浏览器也 403；HTTP 照收", async (t) => {
  for (const holders of [[{ pid: 1, command: "node" }], [{ pid: 2, command: "whistle" }], [{ pid: 500, command: "Google Chrome Helper" }, { pid: 3, command: "mitmproxy" }]]) {
    const { socket, port } = await pair(t);
    const f = fakeLookup(() => holders);
    f.watch(socket.remotePort!);
    const check = createPeerCheck(opts(f.lookup));
    assert.deepEqual(await check(socket, port, "http"), { ok: true });
    const v = await check(socket, port, "ws");
    assert.equal(!v.ok && v.status, 403, JSON.stringify(holders));
  }
});

test("allowAnyWsClient（DROIDPIER_ALLOW_ANY_WS_CLIENT=1）：WebSocket 收 node，但模拟器照样 403", async (t) => {
  const a = await pair(t);
  const b = await pair(t);
  const f = fakeLookup((p) => (p === a.socket.remotePort ? [{ pid: 1, command: "node" }] : [{ pid: 700, command: "qemu-system-aarch64-headless" }]));
  f.watch(a.socket.remotePort!);
  f.watch(b.socket.remotePort!);
  const logs: string[] = [];
  const check = createPeerCheck(opts(f.lookup, logs, { allowAnyWsClient: true }));
  assert.deepEqual(await check(a.socket, a.port, "ws"), { ok: true });
  assert.equal((await check(b.socket, b.port, "ws")).ok, false);
  assert.match(logs[0], /DROIDPIER_ALLOW_ANY_WS_CLIENT=1/);
});

test("对端已不在（网关这一头在，没有进程持有对端）：403", async (t) => {
  const { socket, port } = await pair(t);
  const f = fakeLookup(() => "gone");
  f.watch(socket.remotePort!);
  const v = await createPeerCheck(opts(f.lookup))(socket, port, "ws");
  assert.equal(!v.ok && v.status, 403);
});

test("lsof 出错或超时：WebSocket 503，HTTP 放行并写日志；结果不缓存，下次再查", async (t) => {
  const { socket, port } = await pair(t);
  let calls = 0;
  const failing: SocketsLookup = async () => { calls++; throw new Error("lsof 超时"); };
  const logs: string[] = [];
  const check = createPeerCheck(opts(failing, logs));
  const ws = await check(socket, port, "ws");
  assert.equal(!ws.ok && ws.status, 503);
  assert.deepEqual(await check(socket, port, "http"), { ok: true });
  assert.equal(calls, 2);
  assert.ok(logs.some((l) => /HTTP 请求放行.*lsof 超时/.test(l)), logs.join("\n"));
});

test("没有 lsof（ENOENT）：整个检查关掉，只写一次日志，之后不再调用", async (t) => {
  const { socket, port } = await pair(t);
  let calls = 0;
  const missing: SocketsLookup = async () => { calls++; throw Object.assign(new Error("spawn /usr/sbin/lsof ENOENT"), { code: "ENOENT" }); };
  const logs: string[] = [];
  const check = createPeerCheck(opts(missing, logs));
  assert.deepEqual(await check(socket, port, "ws"), { ok: true });
  assert.deepEqual(await check(socket, port, "ws"), { ok: true });
  assert.equal(calls, 1);
  assert.equal(logs.filter((l) => l.includes("没有 lsof")).length, 1);
});

test("不是 macOS 时不查，只写一次日志", async (t) => {
  const { socket, port } = await pair(t);
  const f = fakeLookup(() => [{ pid: 700, command: "qemu-system-aarch64-headless" }]);
  const logs: string[] = [];
  const check = createPeerCheck({ lookup: f.lookup, platform: "linux", log: (s) => logs.push(s) });
  assert.deepEqual(await check(socket, port, "ws"), { ok: true });
  assert.deepEqual(await check(socket, port, "http"), { ok: true });
  assert.equal(f.stats.calls, 0);
  assert.equal(logs.length, 1);
});

test("同一时间最多一个 lsof：一起来的连接合并查；排队超过上限的直接 503", async (t) => {
  const first = await pair(t);
  const sockets = [first];
  for (let i = 0; i < 29; i++) sockets.push(await pair(t, first.server));
  const f = fakeLookup(() => [{ pid: 500, command: "Google Chrome Helper" }], 30);
  for (const s of sockets) f.watch(s.socket.remotePort!);
  const check = createPeerCheck(opts(f.lookup, [], { maxPending: 20 }));
  const verdicts = await Promise.all(sockets.map((s) => check(s.socket, first.port, "ws")));
  assert.equal(f.stats.maxRunning, 1);
  assert.ok(f.stats.calls <= 3, `lsof 跑了 ${f.stats.calls} 次`);
  assert.equal(verdicts.filter((v) => v.ok).length, 20);
  assert.ok(verdicts.filter((v) => !v.ok).every((v) => !v.ok && v.status === 503));
  // 排空之后新连接照常检查
  assert.deepEqual(await check(sockets[29].socket, first.port, "ws"), { ok: true });
});

test("lsofSockets（macOS）：一次查到本进程两头的连接", { skip: process.platform !== "darwin" }, async (t) => {
  const { port, client } = await pair(t);
  const snap = await lsofSockets(port);
  assert.deepEqual(snap.holders.get(client.localPort!), [{ pid: process.pid, command: "node" }]);
  assert.ok(snap.own.has(client.localPort!));
});
