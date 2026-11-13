import { execFile } from "node:child_process";
import type { Socket } from "node:net";

/**
 * 一条连到网关的 TCP 连接，对端是本机哪个进程。
 * - found：找到了对端进程
 * - gone：查询正常（看得到网关自己这一端），但没有进程持有对端：对端已经关掉了，或是别的用户的进程
 * - unknown：查不了（命令出错、超时、输出里连网关自己这一端都没有）
 */
export type PeerInfo = { kind: "found"; pid: number; command: string } | { kind: "gone" } | { kind: "unknown"; reason: string };

/** 按两端端口查对端进程。 */
export type PeerLookup = (peerPort: number, gatewayPort: number) => Promise<PeerInfo>;

/**
 * 模拟器里的 App 访问 10.0.2.2:<端口> 时，本机上发起连接的是模拟器自己的进程（qemu-system-*，新版本的 Wi-Fi 走 netsimd）；
 * 设备里访问 adb reverse 过的端口时，发起连接的是 adb。真正的页面都来自浏览器，这些进程一律不收。
 */
export function isEmulatorProcess(command: string): boolean {
  return /^(qemu-system|emulator|netsimd)/i.test(command) || command === "adb";
}

/** 解析 `lsof -F pcn` 的输出，找本地端是 127.0.0.1:<peerPort>、对端是网关端口的那个进程。 */
export function parseLsof(out: string, peerPort: number, gatewayPort: number): PeerInfo {
  const peerName = `127.0.0.1:${peerPort}->127.0.0.1:${gatewayPort}`;
  const ownName = `127.0.0.1:${gatewayPort}->127.0.0.1:${peerPort}`;
  let pid = 0;
  let command = "";
  let found: PeerInfo | null = null;
  let ownSeen = false;
  for (const line of out.split("\n")) {
    const v = line.slice(1);
    if (line[0] === "p") (pid = Number(v)), (command = "");
    else if (line[0] === "c") command = v;
    else if (line[0] === "n" && v === peerName) found ??= { kind: "found", pid, command };
    else if (line[0] === "n" && v === ownName) ownSeen = true;
  }
  if (found) return found;
  return ownSeen ? { kind: "gone" } : { kind: "unknown", reason: "lsof 的输出里没有网关这一端" };
}

/** macOS：用 /usr/sbin/lsof 查（launchd 拉起的后台服务 PATH 很短，写全路径）。+c 0 要完整的进程名（不加时只有前 9 个字符）。 */
export const lsofPeer: PeerLookup = (peerPort, gatewayPort) =>
  new Promise((resolve) => {
    execFile("/usr/sbin/lsof", ["-nP", "+c", "0", `-iTCP@127.0.0.1:${peerPort}`, "-Fpcn"], { timeout: 2000 }, (err, stdout) => {
      // 没有匹配时 lsof 退出码是 1，输出为空；网关自己这一端总在，所以空输出交给 parseLsof 判成 unknown
      if (err && !(err.code === 1 && !err.killed)) {
        resolve({ kind: "unknown", reason: err.killed ? "lsof 超时" : err.message });
        return;
      }
      resolve(parseLsof(stdout, peerPort, gatewayPort));
    });
  });

/** 对端检查的结论：ok 放行；refuse 拒绝，why 写进日志。 */
export type PeerVerdict = { ok: true } | { ok: false; why: string };

/**
 * 拒绝来自模拟器里面的连接（gateway/src/peer.ts 顶部的 isEmulatorProcess）。
 * 只认得出是模拟器、或对端已经没了时才拒绝；lsof 出错、超时时放行并写日志，免得 lsof 出问题时把真正的页面也挡在外面。
 * 结论按 socket 缓存：同一条连接上的 HTTP 请求和之后的 WebSocket 升级只查一次。
 */
export function createPeerCheck(opts: { lookup?: PeerLookup; platform?: string; log: (s: string) => void }) {
  const lookup = opts.lookup ?? lsofPeer;
  const enabled = (opts.platform ?? process.platform) === "darwin";
  let skipLogged = false;
  const cache = new WeakMap<Socket, Promise<PeerVerdict>>();
  const decide = async (socket: Socket, gatewayPort: number): Promise<PeerVerdict> => {
    const peerPort = socket.remotePort;
    if (peerPort === undefined) return { ok: false, why: "连接已断开" };
    const started = Date.now();
    const info = await lookup(peerPort, gatewayPort).catch((e: Error): PeerInfo => ({ kind: "unknown", reason: e.message }));
    const ms = Date.now() - started;
    if (info.kind === "found" && isEmulatorProcess(info.command)) return { ok: false, why: `连接来自模拟器进程 ${info.command}（pid ${info.pid}，端口 ${peerPort}，查询 ${ms}ms）` };
    if (info.kind === "gone") return { ok: false, why: `端口 ${peerPort} 的对端已不在（查询 ${ms}ms）` };
    if (info.kind === "unknown") opts.log(`查不到端口 ${peerPort} 的对端进程，放行：${info.reason}（${ms}ms）`);
    return { ok: true };
  };
  return (socket: Socket, gatewayPort: number): Promise<PeerVerdict> => {
    if (!enabled) {
      if (!skipLogged) opts.log(`不是 macOS（${opts.platform ?? process.platform}），不检查连接来自哪个进程`);
      skipLogged = true;
      return Promise.resolve({ ok: true });
    }
    let v = cache.get(socket);
    if (!v) cache.set(socket, (v = decide(socket, gatewayPort)));
    return v;
  };
}
