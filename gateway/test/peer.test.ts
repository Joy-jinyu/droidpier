import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { createPeerCheck, isEmulatorProcess, lsofPeer, parseLsof, type PeerLookup } from "../src/peer.ts";

test("isEmulatorProcess：模拟器的进程和 adb 算，浏览器不算", () => {
  for (const c of ["qemu-system-aarch64-headless", "qemu-system-aar", "qemu-system-x86_64", "emulator", "netsimd", "adb"]) assert.equal(isEmulatorProcess(c), true, c);
  for (const c of ["Google Chrome He", "Google Chrome Helper", "Safari", "node", "curl", "adbx", "myqemu-system"]) assert.equal(isEmulatorProcess(c), false, c);
});

const LSOF = [
  "p500", "cGoogle Chrome He", "f30", "n127.0.0.1:51000->127.0.0.1:7300",
  "p600", "cnode", "f40", "n127.0.0.1:7300->127.0.0.1:51000", "f41", "n127.0.0.1:7300->127.0.0.1:52000",
  "p700", "cqemu-system-aar", "f9", "n127.0.0.1:52000->127.0.0.1:7300", "",
].join("\n");

test("parseLsof：按本地端口挑出对端进程，不会挑到网关自己这一端", () => {
  assert.deepEqual(parseLsof(LSOF, 51000, 7300), { kind: "found", pid: 500, command: "Google Chrome He" });
  assert.deepEqual(parseLsof(LSOF, 52000, 7300), { kind: "found", pid: 700, command: "qemu-system-aar" });
});

test("parseLsof：只看得到网关这一端是 gone；连网关这一端都没有是 unknown", () => {
  const ownOnly = "p600\ncnode\nf40\nn127.0.0.1:7300->127.0.0.1:51000\n";
  assert.deepEqual(parseLsof(ownOnly, 51000, 7300), { kind: "gone" });
  assert.equal(parseLsof("", 51000, 7300).kind, "unknown");
  // 同一个端口连的是别的服务，不是网关
  assert.equal(parseLsof("p1\ncx\nf1\nn127.0.0.1:51000->127.0.0.1:9999\n", 51000, 7300).kind, "unknown");
});

/** 一对真实的本机 TCP 连接：返回服务端这一端的 socket。 */
async function serverSide(t: import("node:test").TestContext) {
  const srv = net.createServer();
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as net.AddressInfo).port;
  const accepted = new Promise<net.Socket>((r) => srv.once("connection", r));
  const client = net.connect(port, "127.0.0.1");
  const socket = await accepted;
  t.after(() => { client.destroy(); socket.destroy(); srv.close(); });
  return { socket, port, client };
}

const fixed = (info: Awaited<ReturnType<PeerLookup>>): PeerLookup & { calls: number } => {
  const f = Object.assign(async () => { f.calls++; return info; }, { calls: 0 });
  return f;
};

test("createPeerCheck：对端是模拟器进程 → 拒绝，原因里有进程名", async (t) => {
  const { socket, port } = await serverSide(t);
  const logs: string[] = [];
  const check = createPeerCheck({ lookup: fixed({ kind: "found", pid: 700, command: "qemu-system-aar" }), platform: "darwin", log: (s) => logs.push(s) });
  const v = await check(socket, port);
  assert.equal(v.ok, false);
  assert.match(!v.ok ? v.why : "", /qemu-system-aar.*pid 700/);
});

test("createPeerCheck：对端是浏览器 → 放行，不写日志；同一 socket 只查一次", async (t) => {
  const { socket, port } = await serverSide(t);
  const logs: string[] = [];
  const lookup = fixed({ kind: "found", pid: 500, command: "Google Chrome He" });
  const check = createPeerCheck({ lookup, platform: "darwin", log: (s) => logs.push(s) });
  assert.deepEqual(await check(socket, port), { ok: true });
  assert.deepEqual(await check(socket, port), { ok: true });
  assert.equal(lookup.calls, 1);
  assert.deepEqual(logs, []);
});

test("createPeerCheck：查询出错或查不清 → 放行并写日志", async (t) => {
  const { socket, port } = await serverSide(t);
  const logs: string[] = [];
  const failing: PeerLookup = async () => { throw new Error("spawn lsof ENOENT"); };
  assert.deepEqual(await createPeerCheck({ lookup: failing, platform: "darwin", log: (s) => logs.push(s) })(socket, port), { ok: true });
  assert.deepEqual(await createPeerCheck({ lookup: fixed({ kind: "unknown", reason: "lsof 超时" }), platform: "darwin", log: (s) => logs.push(s) })(socket, port), { ok: true });
  assert.equal(logs.length, 2);
  assert.match(logs[0], /放行.*spawn lsof ENOENT/);
  assert.match(logs[1], /放行.*lsof 超时/);
});

test("createPeerCheck：对端已经不在 → 拒绝", async (t) => {
  const { socket, port } = await serverSide(t);
  const v = await createPeerCheck({ lookup: fixed({ kind: "gone" }), platform: "darwin", log: () => {} })(socket, port);
  assert.equal(v.ok, false);
});

test("createPeerCheck：不是 macOS 时不查，只写一次日志", async (t) => {
  const { socket, port } = await serverSide(t);
  const logs: string[] = [];
  const lookup = fixed({ kind: "found", pid: 700, command: "qemu-system-aar" });
  const check = createPeerCheck({ lookup, platform: "linux", log: (s) => logs.push(s) });
  assert.deepEqual(await check(socket, port), { ok: true });
  assert.deepEqual(await check(socket, port), { ok: true });
  assert.equal(lookup.calls, 0);
  assert.equal(logs.length, 1);
});

test("lsofPeer（macOS）：查得到本进程发起的连接", { skip: process.platform !== "darwin" }, async (t) => {
  const { port, client } = await serverSide(t);
  const info = await lsofPeer(client.localPort!, port);
  assert.equal(info.kind, "found");
  assert.equal(info.kind === "found" && info.pid, process.pid);
});
