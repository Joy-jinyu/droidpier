import WebSocket from "ws";
import net from "node:net";
import type { WebViewPage } from "../../shared/protocol.ts";
import { adb } from "./adb.ts";

// 匹配 webview_devtools_remote_<pid>、Chrome 的 chrome_devtools_remote 和其他 Chromium 浏览器的 <包名>_devtools_remote
const DEVTOOLS_SOCKET_RE = /^(webview_devtools_remote_\d+|chrome_devtools_remote|[A-Za-z][\w.]*_devtools_remote)$/;
const WEBVIEW_SOCKET_RE = /^webview_devtools_remote_\d+$/;

/** 浏览器 socket 按名字推出的包名：chrome_devtools_remote 是 Chrome，<包名>_devtools_remote 取前面的包名；WebView 的 socket 返回 undefined。 */
export function browserPkgFromSocket(socket: string): string | undefined {
  if (WEBVIEW_SOCKET_RE.test(socket)) return undefined;
  if (socket === "chrome_devtools_remote") return "com.android.chrome";
  return socket.match(/^(.+)_devtools_remote$/)?.[1];
}

/** 从 dumpsys activity 的 topResumedActivity / mResumedActivity 行取前台 App 的包名，读不出时返回 null。 */
export function parseResumedPkg(out: string): string | null {
  return out.match(/ResumedActivity[:=]\s*ActivityRecord\{\S+ u\d+ ([\w.]+)\//)?.[1] ?? null;
}

/**
 * 从 dumpsys window windows 取包名为 pkg 的窗口的 mAppBounds：App 能用的区域（去掉状态栏和导航栏，设备像素，按显示方向）。
 * 窗口按从上到下列出，取第一个；找不到时 null。
 */
export function parseAppBounds(out: string, pkg: string): WebViewPage["rect"] | null {
  for (const block of out.split(/\n(?=\s*Window #\d+ )/)) {
    if (block.match(/^\s*Window #\d+ Window\{\S+ u\d+ ([\w.]+)\//)?.[1] !== pkg) continue;
    const m = block.match(/mAppBounds=Rect\((-?\d+), (-?\d+) - (-?\d+), (-?\d+)\)/);
    if (!m) continue;
    const [l, t, r, b] = m.slice(1).map(Number);
    if (r > l && b > t) return { x: l, y: t, width: r - l, height: b - t };
  }
  return null;
}

/** 解析 /proc/net/unix，返回去重后的 devtools socket 名（不含 @ 前缀）。 */
export function parseDevtoolsSockets(procNetUnix: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of procNetUnix.split("\n")) {
    const col = line.trimEnd().split(/\s+/).pop() ?? "";
    if (!col.startsWith("@")) continue;
    const name = col.slice(1);
    // Stetho（stetho_<包名>_devtools_remote）调的是 App 本身，不是网页
    if (!DEVTOOLS_SOCKET_RE.test(name) || name.startsWith("stetho_")) continue;
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
  /** GET /json/version；浏览器 socket 靠里面的 Android-Package 认包名，不传或读不到时按 socket 名推。 */
  fetchVersion?: (port: number) => Promise<any>;
  freePort: () => Promise<number>;
  /** list() 等一个 socket 的 /json 最多多久，超过就先用上次的结果；默认 2000，测试注入短值。 */
  jsonWaitMs?: number;
  /** 当前时间（毫秒），前台 App 缓存用；测试注入。 */
  now?: () => number;
  /** list()/close() 移除转发后调用，通知端口分配器释放保留位。 */
  releasePort?: (port: number) => void;
  /**
   * 连续 list 失败的退避时间序列（毫秒）；超出序列末尾则用最后一个值。
   * 默认 [3000, 6000, 12000, 30000]。测试时注入短值。
   */
  backoffMs?: number[];
  /**
   * 问浏览器的一个标签页现在显示没有（document.visibilityState）；不回话（被系统回收的后台标签）返回 null。
   * 不传时只能按 /json 的顺序猜。
   */
  tabVisibility?: (port: number, id: string) => Promise<"visible" | "hidden" | null>;
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
  const d = parseDescription(description);
  if (!d || d.never_attached || d.empty) return false;
  return d.visible === true;
}

function parseDescription(description: string | undefined): any {
  if (!description) return undefined;
  try {
    return JSON.parse(description);
  } catch {
    return undefined;
  }
}

/** WebView 在屏幕上的位置（设备像素，按当前显示方向），来自 description 的 screenX/screenY/width/height；没贴到窗口上的不给。 */
function parseRect(description: string | undefined): WebViewPage["rect"] {
  const d = parseDescription(description);
  if (!d || d.never_attached || d.empty) return undefined;
  const { screenX: x, screenY: y, width, height } = d;
  if (![x, y, width, height].every((n) => typeof n === "number" && Number.isFinite(n)) || width <= 0 || height <= 0) return undefined;
  return { x, y, width, height };
}

/** list() 等 /json 的默认时长：WebView 正常时几十毫秒就回，DevTools 连着、页面在重载时会慢一些。 */
const JSON_WAIT_MS = 2000;
export const FOREGROUND_CMD = ["shell", "dumpsys activity activities 2>/dev/null | grep -m1 ResumedActivity"];
/** 前台 App 缓存多久：用户的模拟器上 adb 可能很慢甚至卡住，每次轮询都多跑一条 shell 太重。 */
const FOREGROUND_TTL_MS = 10_000;

/**
 * 创建 WebViews 管理器。
 * - list() 每次重新读 /proc/net/unix；新 socket 建立 adb forward，消失的移除。
 * - portOf() 返回当前映射端口。
 * - close() 移除本实例建立的全部转发。
 *
 * TODO: Phase 3 Task 1 — 在此处加口令和 Origin 校验，与 HTTP 代理层共用同一套机制。
 */
export function createWebViews(deps: WebViewsDeps) {
  const { exec, fetchJson, fetchVersion, freePort, releasePort, tabVisibility } = deps;
  const now = deps.now ?? Date.now;
  // 上次查到的前台 App；sig（socket 和各浏览器当前标签页）变了或过了 FOREGROUND_TTL_MS 再查
  let foreground: { pkg: string | null; at: number; sig: string } | null = null;
  // 浏览器 socket → 上次问出来正在显示的标签页 id：它停在断点上时不回话，还当它是当前标签
  const lastShown = new Map<string, string>();
  const BACKOFF_SCHEDULE = deps.backoffMs ?? [3000, 6000, 12000, 30000];

  // socket → 本机端口
  const socketToPort = new Map<string, number>();
  // socket → 包名缓存（pid 不变时无需再查）
  const socketToPkg = new Map<string, string>();
  // socket → 上一次 /json 的结果：socket 还在但这次没答上来（DevTools 连着、页面正在重载时会慢）就沿用，免得页面在列表里闪没
  const socketToItems = new Map<string, any[]>();
  // socket → 还没回来的 /json 请求。后台被冻结的 App 不再接收 DevTools 连接上的请求，每轮都新开连接、超时再丢下，
  // 会在手机的 adbd 上越积越多，叠加真机画面的负载时把整条 USB 连接堵死（2026-11-16 SM-G9910 / Android 12 复现）。
  // 所以同一个 socket 同一时间只留一个请求，它不回来就一直沿用上次的结果
  const pendingJson = new Map<string, Promise<any[]>>();
  const jsonWaitMs = deps.jsonWaitMs ?? JSON_WAIT_MS;

  // 连续失败退避：记录失败次数和下次允许调用的时间戳
  let consecutiveFailures = 0;
  let backoffUntil = 0;
  let lastError: Error | undefined;

  // 先忘掉映射再移除：移除失败时也不再把这个端口当成可用的转发
  async function removeForward(socket: string, port: number): Promise<void> {
    socketToPort.delete(socket);
    socketToPkg.delete(socket);
    socketToItems.delete(socket);
    pendingJson.delete(socket);
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

    // 转发可能被 adb 撤掉了（模拟器重启、adb 断开重连）。/json 看不出来：Node 的 fetch 复用 keep-alive 连接，
    // 旧连接照样能读到列表，DevTools 新开的连接却被拒（2026-11-16 实测）。所以每轮对一遍 forward --list，没了就重建
    // 读不到 forward --list 时这一轮不核对，不因为它让整个列表报错
    const live = socketToPort.size ? await exec(["forward", "--list"]).catch(() => null) : null;
    if (live !== null) {
      // 每行是「设备 本机端 设备端」；-s 不过滤，列的是所有设备的转发，靠本机端口唯一认出自己的
      const lines = new Set(live.split("\n").map((l) => l.trim().split(/\s+/).slice(1).join(" ")));
      for (const [socket, port] of socketToPort) {
        if (!lines.has(`tcp:${port} localabstract:${socket}`)) {
          socketToPort.delete(socket);
          // 模拟器重启后 pid 可能重复、同名 socket 换了 App：包名和旧页面也不能再用
          socketToPkg.delete(socket);
          socketToItems.delete(socket);
          releasePort?.(port);
        }
      }
    }

    // 新出现的 socket（和转发没了的）：建立转发；forward 失败时释放已分配的端口
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
    const fetched: Array<{ socket: string; pid: number | undefined; pkg: string | undefined; items: any[] }> = [];
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
      } else {
        if (!socketToPkg.has(socket)) {
          const v = await fetchVersion?.(port).catch(() => undefined);
          const name = typeof v?.["Android-Package"] === "string" ? v["Android-Package"] : browserPkgFromSocket(socket);
          if (name) socketToPkg.set(socket, name);
        }
        pkg = socketToPkg.get(socket);
      }

      let pending = pendingJson.get(socket);
      if (!pending) {
        const p = fetchJson(port).then((items) => {
          if (pendingJson.get(socket) === p) socketToItems.set(socket, items);
          return items;
        }).finally(() => {
          if (pendingJson.get(socket) === p) pendingJson.delete(socket);
        });
        p.catch(() => {});
        pendingJson.set(socket, p);
        pending = p;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const items = await Promise.race([
        pending.catch(() => null),
        new Promise<null>((r) => (timer = setTimeout(() => r(null), jsonWaitMs))),
      ]).finally(() => clearTimeout(timer)) ?? socketToItems.get(socket) ?? [];

      fetched.push({ socket, pid, pkg, items });
    }

    // 浏览器的 socket 在后台也一直在、标签页的 /json 里没有 visible，所以有 page 标签页时才查前台 App；
    // 浏览器在前台时再逐个问标签页（下面的 shown）。sig 里的第一个标签页只是让列表变了时早点重查前台 App
    const firstTab = (items: any[]) => items.find((i) => (i.type ?? "page") === "page");
    const browsers = fetched.filter((f) => f.pid === undefined && firstTab(f.items));
    let fgPkg: string | null = null;
    if (browsers.length) {
      const sig = [...current].sort().join(",") + "|" + browsers.map((b) => `${b.socket}:${firstTab(b.items).id}`).join(",");
      if (!foreground || foreground.sig !== sig || now() - foreground.at > FOREGROUND_TTL_MS) {
        foreground = { pkg: await exec(FOREGROUND_CMD).then(parseResumedPkg, () => null), at: now(), sig };
      }
      fgPkg = foreground.pkg;
    }

    // 在前台的浏览器：逐个标签页问显示没有。/json 的顺序不一定是最近用过的：Chrome 113 上实测第一个是很早打开的标签、
    // 正在看的排在最后（2026-11-22，标签多、Chrome 重启过之后）。值是 null 表示问清楚了、没有标签在显示（比如开着标签切换器）
    const shown = new Map<string, any | null>();
    if (tabVisibility) {
      await Promise.all(fetched.map(async ({ socket, pid, pkg, items }) => {
        const port = socketToPort.get(socket);
        if (pid !== undefined || pkg === undefined || pkg !== fgPkg || port === undefined) return;
        const tabs = items.filter((i) => (i.type ?? "page") === "page");
        const tab = await pickShownTab(tabs, (t) => tabVisibility(port, String(t.id ?? "")), lastShown.get(socket));
        if (tab === undefined) return;
        shown.set(socket, tab);
        if (tab) lastShown.set(socket, String(tab.id ?? ""));
      }));
    }

    const pages: WebViewPage[] = [];
    for (const { socket, pid, pkg, items } of fetched) {
      const isBrowser = pid === undefined;
      const activeTab = isBrowser && pkg !== undefined && pkg === fgPkg ? (shown.has(socket) ? shown.get(socket) ?? undefined : firstTab(items)) : undefined;
      for (const item of items) {
        pages.push({
          socket,
          pid,
          pkg,
          id: String(item.id ?? ""),
          title: String(item.title ?? ""),
          url: String(item.url ?? ""),
          visible: isBrowser ? item === activeTab : parseVisible(item.description),
          frontendUrl: item.devtoolsFrontendUrl || undefined,
          rect: isBrowser ? undefined : parseRect(item.description),
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

  /** adb server 已经把转发撤了（重连过这台设备）：只忘掉记录、放回端口，下次 list() 重新建。 */
  function forget(): void {
    for (const port of socketToPort.values()) releasePort?.(port);
    socketToPort.clear();
    socketToPkg.clear();
    socketToItems.clear();
  }

  return { list, portOf, close, forget };
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

/** 默认的 fetchJson：GET http://127.0.0.1:<port>/json，不设超时（见函数内注释）。 */
export async function defaultFetchJson(port: number): Promise<any[]> {
  // 不设超时、不中途丢下：等多久由 list() 决定，连接留着等 App 回来或转发被移除（见 createWebViews 的 pendingJson）
  const res = await fetch(`http://127.0.0.1:${port}/json`);
  return await res.json();
}

/**
 * 浏览器在前台时哪个标签页在显示：有一个回答 visible 就不等别的（被回收的标签要等满超时才算不回话）。
 * 返回 null：都回答了 hidden，没有标签在显示。undefined：一个都没回话，交给调用方按老办法猜。
 * 有的没回话、其余都是 hidden 时：上次在显示的那个没回话就还是它（停在断点上），否则取第一个没回话的
 */
export function pickShownTab<T extends { id?: unknown }>(tabs: T[], ask: (t: T) => Promise<"visible" | "hidden" | null>, last?: string): Promise<T | null | undefined> {
  return new Promise((resolve) => {
    if (!tabs.length) return resolve(undefined);
    const answers: Array<"visible" | "hidden" | null> = new Array(tabs.length);
    let left = tabs.length;
    let settled = false;
    tabs.forEach((t, i) => {
      void ask(t).catch(() => null).then((v) => {
        if (settled) return;
        answers[i] = v;
        if (v === "visible") {
          settled = true;
          return resolve(t);
        }
        if (--left) return;
        settled = true;
        const silent = tabs.filter((_, j) => answers[j] === null);
        if (!silent.length) return resolve(null);
        if (silent.length === tabs.length) return resolve(undefined);
        resolve(silent.find((x) => String(x.id ?? "") === last) ?? silent[0]);
      });
    });
  });
}

/** 问标签页可见性最多等多久：活着的标签几十毫秒就回，被回收的一直不回（2026-11-22 Chrome 113 实测）。 */
const TAB_VISIBILITY_WAIT_MS = 800;

/** 默认的 tabVisibility：连 ws://127.0.0.1:<port>/devtools/page/<id>，Runtime.evaluate document.visibilityState。 */
export function defaultTabVisibility(port: number, id: string): Promise<"visible" | "hidden" | null> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/devtools/page/${encodeURIComponent(id)}`);
    const done = (v: "visible" | "hidden" | null) => {
      clearTimeout(timer);
      ws.removeAllListeners();
      ws.on("error", () => {});
      ws.terminate();
      resolve(v);
    };
    const timer = setTimeout(() => done(null), TAB_VISIBILITY_WAIT_MS);
    ws.on("open", () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: "document.visibilityState", returnByValue: true } })));
    ws.on("message", (data) => {
      try {
        const m = JSON.parse(String(data)) as { id?: number; result?: { result?: { value?: unknown } } };
        if (m.id !== 1) return;
        const v = m.result?.result?.value;
        done(v === "visible" || v === "hidden" ? v : null);
      } catch {
        done(null);
      }
    });
    ws.on("error", () => done(null));
  });
}

/** 默认的 fetchVersion：GET http://127.0.0.1:<port>/json/version，超时 2 秒。 */
export async function defaultFetchVersion(port: number): Promise<any> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 2000);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: ctrl.signal });
    return await res.json();
  } finally {
    clearTimeout(tid);
  }
}

/** 生产用 exec：adb -s <设备 id> <args>，和网关里其他 adb 调用共用这台设备的队列。 */
export function makeAdbExec(id: string) {
  return adb.device(id);
}
