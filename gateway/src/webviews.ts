import net from "node:net";
import type { WebViewPage } from "../../shared/protocol.ts";
import { adb } from "./adb.ts";

// 匹配 webview_devtools_remote_<pid> 和 chrome_devtools_remote
const DEVTOOLS_SOCKET_RE = /^(webview_devtools_remote_\d+|chrome_devtools_remote)$/;

/** 解析 /proc/net/unix，返回去重后的 devtools socket 名（不含 @ 前缀）。 */
export function parseDevtoolsSockets(procNetUnix: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of procNetUnix.split("\n")) {
    const col = line.trimEnd().split(/\s+/).pop() ?? "";
    if (!col.startsWith("@")) continue;
    const name = col.slice(1);
    if (!DEVTOOLS_SOCKET_RE.test(name)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }
  return result;
}

export type { WebViewPage };

type WebViewsDeps = {
  exec: (args: string[]) => Promise<string>;
  fetchJson: (port: number) => Promise<any[]>;
  freePort: () => Promise<number>;
  /** list()/close() 移除转发后调用，通知端口分配器释放保留位。 */
  releasePort?: (port: number) => void;
  /**
   * 连续 list 失败的退避时间序列（毫秒）；超出序列末尾则用最后一个值。
   * 默认 [3000, 6000, 12000, 30000]。测试时注入短值。
   */
  backoffMs?: number[];
};

/** 从 socket 名提取 pid（webview_devtools_remote_<pid>；chrome_devtools_remote 无 pid）。 */
function pidFromSocket(socket: string): number | undefined {
  const m = socket.match(/^webview_devtools_remote_(\d+)$/);
  return m ? Number(m[1]) : undefined;
}

/**
 * 解析 description 字段里的 visible 标志；非法 JSON 视为 false。
 * never_attached 或 empty 为 true 时强制为不可见（即便 visible:true）。
 */
function parseVisible(description: string | undefined): boolean {
  if (!description) return false;
  try {
    const d = JSON.parse(description);
    if (d?.never_attached || d?.empty) return false;
    return d?.visible === true;
  } catch {
    return false;
  }
}

/**
 * 创建 WebViews 管理器。
 * - list() 每次重新读 /proc/net/unix；新 socket 建立 adb forward，消失的移除。
 * - portOf() 返回当前映射端口。
 * - close() 移除本实例建立的全部转发。
 *
 * TODO: Phase 3 Task 1 — 在此处加口令和 Origin 校验，与 HTTP 代理层共用同一套机制。
 */
export function createWebViews(deps: WebViewsDeps) {
  const { exec, fetchJson, freePort, releasePort } = deps;
  const BACKOFF_SCHEDULE = deps.backoffMs ?? [3000, 6000, 12000, 30000];

  // socket → 本机端口
  const socketToPort = new Map<string, number>();
  // socket → 包名缓存（pid 不变时无需再查）
  const socketToPkg = new Map<string, string>();
  // socket → 上一次 /json 的结果：socket 还在但这次没答上来（DevTools 连着、页面正在重载时会慢）就沿用，免得页面在列表里闪没
  const socketToItems = new Map<string, any[]>();

  // 连续失败退避：记录失败次数和下次允许调用的时间戳
  let consecutiveFailures = 0;
  let backoffUntil = 0;
  let lastError: Error | undefined;

  // 先忘掉映射再移除：移除失败时也不再把这个端口当成可用的转发
  async function removeForward(socket: string, port: number): Promise<void> {
    socketToPort.delete(socket);
    socketToPkg.delete(socket);
    socketToItems.delete(socket);
    releasePort?.(port);
    await exec(["forward", "--remove", `tcp:${port}`]);
  }

  async function list(): Promise<WebViewPage[]> {
    // 退避：连续失败时不再调用 adb，直接返回上次错误
    if (consecutiveFailures > 0 && Date.now() < backoffUntil) {
      throw lastError!;
    }

    let raw: string;
    try {
      raw = await exec(["shell", "cat", "/proc/net/unix"]);
    } catch (e) {
      consecutiveFailures++;
      const delay = BACKOFF_SCHEDULE[Math.min(consecutiveFailures - 1, BACKOFF_SCHEDULE.length - 1)];
      backoffUntil = Date.now() + delay;
      lastError = e as Error;
      throw e;
    }
    consecutiveFailures = 0;
    lastError = undefined;

    const current = new Set(parseDevtoolsSockets(raw));

    // 移除已消失的 socket
    for (const [socket, port] of socketToPort) {
      if (!current.has(socket)) {
        await removeForward(socket, port);
      }
    }

    // 新出现的 socket：建立转发；forward 失败时释放已分配的端口
    for (const socket of current) {
      if (!socketToPort.has(socket)) {
        const port = await freePort();
        try {
          await exec(["forward", `tcp:${port}`, `localabstract:${socket}`]);
        } catch (e) {
          releasePort?.(port);
          throw e;
        }
        socketToPort.set(socket, port);
      }
    }

    // 查询每个 socket 的页面列表
    const pages: WebViewPage[] = [];
    for (const socket of current) {
      const port = socketToPort.get(socket)!;
      const pid = pidFromSocket(socket);

      // 包名：pid 存在时查一次后缓存
      let pkg: string | undefined;
      if (pid !== undefined) {
        if (!socketToPkg.has(socket)) {
          const out = await exec(["shell", "ps", "-p", String(pid), "-o", "NAME="]);
          const name = out.trim();
          if (name) socketToPkg.set(socket, name);
        }
        pkg = socketToPkg.get(socket);
      }

      let items: any[];
      try {
        items = await fetchJson(port);
        socketToItems.set(socket, items);
      } catch {
        items = socketToItems.get(socket) ?? [];
      }

      for (const item of items) {
        pages.push({
          socket,
          pid,
          pkg,
          id: String(item.id ?? ""),
          title: String(item.title ?? ""),
          url: String(item.url ?? ""),
          visible: parseVisible(item.description),
          frontendUrl: item.devtoolsFrontendUrl || undefined,
        });
      }
    }

    // visible 在前，再按包名排序
    pages.sort((a, b) => {
      if (a.visible !== b.visible) return a.visible ? -1 : 1;
      return (a.pkg ?? "").localeCompare(b.pkg ?? "");
    });

    return pages;
  }

  function portOf(socket: string): number | undefined {
    return socketToPort.get(socket);
  }

  async function close(): Promise<void> {
    const all = [...socketToPort];
    const results = await Promise.allSettled(all.map(([socket, port]) => removeForward(socket, port)));
    const failed = all.flatMap(([, port], i) => {
      const r = results[i];
      return r.status === "rejected" ? [`tcp:${port}：${(r.reason as Error)?.message ?? r.reason}`] : [];
    });
    if (failed.length) throw new Error(`部分 adb forward 没移除：${failed.join("；")}`);
  }

  return { list, portOf, close };
}

// ─────────────────────────── 端口分配器 ───────────────────────────

const BASE_PORT = 9300;

/** 解析 `adb forward --list` 输出，返回已占用的本机 TCP 端口集合。 */
function parseForwardPorts(forwardList: string): Set<number> {
  const ports = new Set<number>();
  for (const line of forwardList.split("\n")) {
    // 格式：<serial> tcp:<port> <remote>
    const m = line.trim().match(/\btcp:(\d+)\b/);
    if (m) ports.add(Number(m[1]));
  }
  return ports;
}

/**
 * TCP 探测：仅 ECONNREFUSED 视为空闲。
 * adb 在转发目标 socket 已死时会先 accept 再 RST，错误码为 ECONNRESET——视为占用。
 */
function probePort(port: number): Promise<boolean> {
  return new Promise((res) => {
    const s = net.connect(port, "127.0.0.1");
    s.setTimeout(300);
    s.once("connect", () => (s.destroy(), res(false)));
    s.once("timeout", () => (s.destroy(), res(false)));
    s.once("error", (err: NodeJS.ErrnoException) => res(err.code === "ECONNREFUSED"));
  });
}

/**
 * 创建端口分配器。
 * - acquire()：串行分配，跳过 adb forward --list 里已有的端口和本分配器已保留的端口。
 * - release(port)：forward 移除后调用，解除保留。
 *
 * @param listForwards - 返回 `adb forward --list` 输出的函数（生产：调用真实 adb；测试：注入假值）。
 * @param probe - TCP 探测函数（生产：只接受 ECONNREFUSED；测试：注入假值）。
 */
export function createFreePortAllocator(
  listForwards: () => Promise<string> = () => adb.run(["forward", "--list"]),
  probe: (port: number) => Promise<boolean> = probePort,
) {
  // 本分配器已分配但尚未 release 的端口
  const reserved = new Set<number>();
  // 串行化：每次分配排在上一次之后
  let chain: Promise<void> = Promise.resolve();

  function acquire(): Promise<number> {
    const p = chain.then(async () => {
      const forwardList = await listForwards();
      const existing = parseForwardPorts(forwardList);
      for (let port = BASE_PORT; ; port++) {
        if (reserved.has(port) || existing.has(port)) continue;
        if (!(await probe(port))) continue;
        reserved.add(port);
        return port;
      }
    });
    // chain 只追踪"是否完成"，不传播错误（错误由 p 的调用者处理）
    chain = p.then(() => {}, () => {});
    return p;
  }

  function release(port: number): void {
    reserved.delete(port);
  }

  return { acquire, release };
}

// 模块级默认分配器（生产用）
const defaultAllocator = createFreePortAllocator();

/** 找到下一个空闲端口（≥9300）。生产用；测试请用 createFreePortAllocator 注入假依赖。 */
export function findFreePort(): Promise<number> {
  return defaultAllocator.acquire();
}

/** 释放由 findFreePort 分配的端口。 */
export function releasePort(port: number): void {
  defaultAllocator.release(port);
}

/** 默认的 fetchJson：GET http://127.0.0.1:<port>/json，超时 2 秒。 */
export async function defaultFetchJson(port: number): Promise<any[]> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 2000);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json`, { signal: ctrl.signal });
    return await res.json();
  } finally {
    clearTimeout(tid);
  }
}

/** 生产用 exec：adb -s <设备 id> <args>，和网关里其他 adb 调用共用这台设备的队列。 */
export function makeAdbExec(id: string) {
  return adb.device(id);
}
