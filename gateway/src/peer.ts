import { execFile } from "node:child_process";
import type { Socket } from "node:net";

/** 持有某个 socket 的进程。 */
export type Holder = { pid: number; command: string };

/** 一次查询看到的网关端口上的连接：holders 是对端端口 → 持有对端那一头的进程；own 是网关自己这一头看得到的对端端口。 */
export type Snapshot = { holders: Map<number, Holder[]>; own: Set<number> };

/** 查网关端口上的所有连接。查不了时抛错；lsof 不存在时抛的错带 code "ENOENT"。 */
export type SocketsLookup = (gatewayPort: number) => Promise<Snapshot>;

/**
 * 模拟器里的 App 访问 10.0.2.2:<端口> 时，本机上发起连接的是模拟器自己的进程（qemu-system-*，新版本的 Wi-Fi 走 netsimd）；
 * 设备里访问 adb reverse 过的端口时，发起连接的是 adb。这些进程什么请求都不收。
 */
export function isEmulatorProcess(command: string): boolean {
  return /^(qemu-system|emulator|netsimd)/i.test(command) || command === "adb";
}

/**
 * WebSocket 只收 Chrome / Edge（页面只支持这两种）的网络进程，本机代理（whistle、Charles、mitmproxy…）转发的也不收。
 * 进程名 lsof 最多给 32 个字符，"Helper (…)" 可能被截断，所以 "Helper " 之后不限。
 * 2026-11-13 实测 Chrome 157 的网络进程叫 "Google Chrome Helper (Aperitif)"。
 */
export function isBrowserProcess(command: string): boolean {
  return /^(Google Chrome|Microsoft Edge|Chromium)( (Beta|Dev|Canary))?( Helper( .*)?)?$/.test(command);
}

/** 解析 `lsof -iTCP:<网关端口> -F pcn` 的输出。 */
export function parseLsof(out: string, gatewayPort: number): Snapshot {
  const holders = new Map<number, Holder[]>();
  const own = new Set<number>();
  const conn = /^127\.0\.0\.1:(\d+)->127\.0\.0\.1:(\d+)$/;
  let pid = 0;
  let command = "";
  for (const line of out.split("\n")) {
    const v = line.slice(1);
    if (line[0] === "p") (pid = Number(v)), (command = "");
    else if (line[0] === "c") command = v;
    else if (line[0] === "n") {
      const m = conn.exec(v);
      if (!m) continue;
      const [local, remote] = [Number(m[1]), Number(m[2])];
      if (local === gatewayPort) own.add(remote);
      else if (remote === gatewayPort) {
        const list = holders.get(local) ?? [];
        if (!list.some((h) => h.pid === pid)) list.push({ pid, command });
        holders.set(local, list);
      }
    }
  }
  return { holders, own };
}

/** macOS：/usr/sbin/lsof 一次列出网关端口上的所有连接（launchd 拉起的后台服务 PATH 很短，写全路径）。+c 0 要完整的进程名（不加时只有前 9 个字符）。 */
export const lsofSockets: SocketsLookup = (gatewayPort) =>
  new Promise((resolve, reject) => {
    execFile("/usr/sbin/lsof", ["-nP", "+c", "0", `-iTCP:${gatewayPort}`, "-Fpcn"], { timeout: 2000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      // 没有匹配时退出码是 1；网关的监听 socket 总在，真没输出时 parseLsof 给出空结果，由调用方判断
      if (err && !(err.code === 1 && !err.killed)) {
        reject(err.killed ? new Error("lsof 超时") : err);
        return;
      }
      resolve(parseLsof(stdout, gatewayPort));
    });
  });

/** 一条连接查出来的结果。off：不检查（不是 macOS、没有 lsof）；busy：排队的连接太多。 */
type Lookup =
  | { kind: "found"; holders: Holder[] }
  | { kind: "gone" }
  | { kind: "unknown"; reason: string }
  | { kind: "busy" }
  | { kind: "off" };

/** 结论：ok 放行；否则按 status 回 HTTP 错误，why 写进日志。 */
export type PeerVerdict = { ok: true } | { ok: false; status: 403 | 503; why: string };

/** 测试和脚本用：设成 1 时 WebSocket 不要求对端是 Chrome / Edge（模拟器、adb 照样拒绝）。 */
export const ALLOW_ANY_WS_ENV = "DROIDPIER_ALLOW_ANY_WS_CLIENT";

const names = (hs: Holder[]) => hs.map((h) => `${h.command}（pid ${h.pid}）`).join("、");

/**
 * 按连接的对端进程决定收不收。
 * - 持有对端的进程里有模拟器的（isEmulatorProcess）：一律 403；WebSocket 还要求全部持有者都是浏览器（isBrowserProcess），否则 403
 * - 网关这一头在、对端没有进程持有：对端已经关掉（比如发完请求立刻断开），403
 * - 查不了（lsof 出错、超时）或排队太多：WebSocket 503（页面每秒重连），普通 HTTP 放行并写日志（HTTP 没有改状态的接口）
 * 同一时间最多跑一个 lsof：排队的连接等下一次一起查，队列满了直接 503，模拟器里的 App 开几千个连接也不会刷出几千个 lsof。
 * 找到了的结果按 socket 缓存；没有 lsof 时整个检查关掉，只写一次日志。
 */
export function createPeerCheck(opts: { lookup?: SocketsLookup; platform?: string; log: (s: string) => void; maxPending?: number; allowAnyWsClient?: boolean }) {
  const lookup = opts.lookup ?? lsofSockets;
  const maxPending = opts.maxPending ?? 64;
  const allowAnyWs = opts.allowAnyWsClient ?? process.env[ALLOW_ANY_WS_ENV] === "1";
  if (allowAnyWs) opts.log(`${ALLOW_ANY_WS_ENV}=1：WebSocket 不要求对端是 Chrome / Edge，只用于测试和脚本`);
  const platform = opts.platform ?? process.platform;
  let off = platform !== "darwin";
  if (off) opts.log(`不是 macOS（${platform}），不检查连接来自哪个进程`);

  const cache = new WeakMap<Socket, Lookup>();
  type Waiter = { peerPort: number; resolve: (l: Lookup) => void };
  let queue: Waiter[] = [];
  let inFlight = 0;
  let running = false;
  const pump = async (gatewayPort: number) => {
    running = true;
    while (queue.length > 0) {
      const batch = queue;
      queue = [];
      inFlight = batch.length;
      // lsof 开始之后才接进来的连接可能不在这次输出里，它们留在 queue 里等下一次
      const snap = await lookup(gatewayPort).then((s) => s, (e: NodeJS.ErrnoException) => e);
      inFlight = 0;
      if (snap instanceof Error && snap.code === "ENOENT") {
        off = true;
        opts.log(`没有 lsof（${snap.message}），不检查连接来自哪个进程`);
      }
      for (const w of batch) {
        if (off) w.resolve({ kind: "off" });
        else if (snap instanceof Error) w.resolve({ kind: "unknown", reason: snap.message });
        else {
          const hs = snap.holders.get(w.peerPort);
          if (hs) w.resolve({ kind: "found", holders: hs });
          else if (snap.own.has(w.peerPort)) w.resolve({ kind: "gone" });
          else w.resolve({ kind: "unknown", reason: "lsof 的输出里没有这条连接" });
        }
      }
    }
    running = false;
  };
  const find = (socket: Socket, gatewayPort: number): Promise<Lookup> => {
    if (off) return Promise.resolve({ kind: "off" });
    const hit = cache.get(socket);
    if (hit) return Promise.resolve(hit);
    const peerPort = socket.remotePort;
    if (peerPort === undefined) return Promise.resolve({ kind: "gone" });
    if (queue.length + inFlight >= maxPending) return Promise.resolve({ kind: "busy" });
    return new Promise<Lookup>((resolve) => {
      queue.push({ peerPort, resolve });
      if (!running) void pump(gatewayPort);
    }).then((l) => {
      if (l.kind === "found" || l.kind === "gone") cache.set(socket, l);
      return l;
    });
  };

  return async (socket: Socket, gatewayPort: number, kind: "http" | "ws"): Promise<PeerVerdict> => {
    const port = socket.remotePort;
    const l = await find(socket, gatewayPort);
    switch (l.kind) {
      case "off":
        return { ok: true };
      case "busy":
        return { ok: false, status: 503, why: `等待检查的连接超过 ${maxPending} 条（端口 ${port}）` };
      case "gone":
        return { ok: false, status: 403, why: `端口 ${port} 的对端已不在` };
      case "unknown":
        if (kind === "ws") return { ok: false, status: 503, why: `查不到端口 ${port} 的对端进程：${l.reason}` };
        opts.log(`查不到端口 ${port} 的对端进程，HTTP 请求放行：${l.reason}`);
        return { ok: true };
      case "found":
        if (l.holders.some((h) => isEmulatorProcess(h.command))) return { ok: false, status: 403, why: `连接来自模拟器 ${names(l.holders)}，端口 ${port}` };
        if (kind === "ws" && !allowAnyWs && !l.holders.every((h) => isBrowserProcess(h.command))) {
          return { ok: false, status: 403, why: `WebSocket 只收 Chrome / Edge，这条来自 ${names(l.holders)}，端口 ${port}` };
        }
        return { ok: true };
    }
  };
}
