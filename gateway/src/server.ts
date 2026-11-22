import { createServer, type IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import type { Duplex } from "node:stream";
import { mkdtemp, open, readFile, rm, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { LatestFrame } from "./latest-frame.ts";
import { createVideoSender } from "./video-sender.ts";
import { CLOSE_UNKNOWN_SOCKET, DEVTOOLS_FRONTEND_ORIGIN, frontendFileUrl, inspectUrl, LOCAL_FRONTEND_PATH, localFrontendUrl, parseDevtoolsPath, proxyDevtools, type DevtoolsSession } from "./devtools-proxy.ts";
import { browserView, createInspectorSlot, liveValue, pickMapping, scaleRect, toPageCss, toPanel, type HighlightTarget, type InspectPointer } from "./inspect.ts";
import { checkHost, checkUpgrade, createTickets, type Tickets } from "./auth.ts";
import { createPeerCheck, type SocketsLookup } from "./peer.ts";
import { DEV_SERVER_DOWN, navigateAndCheck, type CdpClient } from "./cdp.ts";
import { normalizeTarget } from "../../shared/target-url.ts";
import type { EmulatorSession } from "./emulator.ts";
import type { IosInspector } from "./ios-inspector.ts";
import type { LogcatSub } from "./logcat.ts";
import type { LogFilter, LogLine } from "../../shared/logcat.ts";
import type { StartJob } from "./lifecycle.ts";
import type { InstallJob, Installer } from "./installer.ts";
import { AdbUnresponsive } from "./adb.ts";
import { gbText, spaceCheck } from "../../shared/disk-space.ts";
import { avdNameError, createItems, ramMbFor } from "../../shared/avd-spec.ts";
import { UPLOAD_DIR_PREFIX } from "./upload-temp.ts";
import { BIN_UPLOAD, checkChunk, decodeUploadChunk, fileKind, installFailure, PUSH_DIR, sanitizeFileName, UPLOAD_MAX_BYTES } from "../../shared/upload.ts";
import {
  BIN_SCREENSHOT,
  binKind,
  CLOSE_BAD_TOKEN,
  CLOSE_NO_HELLO,
  CLOSE_ORIGIN,
  CLOSE_VERSION,
  compatibility,
  encodeFrameHeader,
  GATEWAY_LEVEL,
  parseClientMsg,
  PROTOCOL_VERSION,
  type AvdCatalog,
  type AvdInfo,
  type EnvReport,
  type FrameHeader,
  type InstallProgress,
  type Licence,
  type IosCatalog,
  type IosSimInfo,
  type MumuInfo, type PhoneInfo,
  type ServerMsg,
  type UpdateState,
  type UploadState,
  type WebViewPage,
} from "../../shared/protocol.ts";
import { INSTALL_CMD } from "./page-url.ts";

/** 生成截图文件名：screenshot-<设备名>-<yyyyMMdd-HHmmss>.png，使用本地时间。 */
export function screenshotName(device: string, now: Date = new Date()): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `screenshot-${device}-${ts}.png`;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

type Frame = { h: FrameHeader; data: Buffer };
type Conn = {
  ws: WebSocket;
  helloSeen: boolean;
  session?: EmulatorSession;
  /** 换到这个会话：发 ready 并重新订阅画面。 */
  attach(s: EmulatorSession): void;
  /** 方向变了：按新方向的设备尺寸重新订阅画面。 */
  resubscribe(): void;
  detach(): void;
  stats: { recv: number; sent: number; bytes: number; lagMs: number; dropped: number };
  /** 这个页面的 DevTools 连上了：返回选择元素模式开关时要调的函数。 */
  devtoolsOpened(session: DevtoolsSession, socket: string, pageId: string, devtoolsWs: WebSocket): { mode(on: boolean): void; highlight(t: HighlightTarget | null): void };
  /** 设备转了方向。 */
  rotated(): void;
};

/** 设备管理操作，由 main.ts 接到 avd.ts / lifecycle.ts / session-cache.ts。 */
export type AvdOps = {
  list(): Promise<AvdInfo[]>;
  start(name: string): StartJob;
  stop(serial: number): Promise<void>;
  /** 切到这台运行中的 AVD，没在运行（或没开 gRPC）返回 null。 */
  use(name: string): Promise<EmulatorSession | null>;
  /** 改显示名（name 是 id）；名字不合规、没有这台 AVD、写不了文件时抛错，错误信息给用户看。 */
  rename(name: string, displayName: string): Promise<void>;
  /** 删掉这台 AVD（.ini 和数据目录）；没有这台、运行中、目录不归它时抛错，错误信息给用户看。 */
  delete(name: string): Promise<void>;
};

/** 环境检查和安装，由 main.ts 接到 setup.ts / installer.ts。只有收到页面的 install 才安装。 */
export type SetupOps = {
  check(): Promise<EnvReport>;
  installer: Installer;
  /** 创建设备对话框的目录（机型、系统版本、已有的 AVD 名字）。 */
  catalog(): Promise<AvdCatalog>;
};

/** 一台设备上的 WebView 调试工具，由 main.ts 接到 webviews.ts / reverse.ts。 */
export type DeviceDebug = {
  webviews: { list(): Promise<WebViewPage[]>; portOf(socket: string): number | undefined; close(): Promise<void> };
  reverses: { ensure(port: number): Promise<void>; removeAll(): Promise<void> };
  /** 包名为 pkg 的窗口去掉状态栏、导航栏后的区域（设备像素，按显示方向），选择元素模式给浏览器标签页定位用；不传或读不到时 null。 */
  appBounds?(pkg: string): Promise<WebViewPage["rect"] | null>;
  /** 屏幕的实际分辨率（wm size，自然方向）；真机的画面是缩小过的视频，换算位置要用它。读不到时 null。 */
  displaySize?(): Promise<{ width: number; height: number } | null>;
};

/** WebView 调试依赖。forDevice 每台设备只调一次，换设备或设备退出时网关关掉旧的。 */
export type DebugDeps = {
  forDevice(id: string): DeviceDebug;
  connectCdp(wsUrl: string): Promise<CdpClient>;
  /**
   * navigate 整体超时（毫秒）；超时后关 CDP 连接并回复"页面加载超时"。
   * 默认 12000；测试时注入短值。
   */
  navigateTimeoutMs?: number;
};

/** 页面拖进来的文件：先落到临时文件，再装到（或放进）设备里。 */
export type FileOps = {
  /** 在这台设备上跑一条长 adb 命令（install / push），返回 stdout；失败时 Error.message 带着 adb 的输出。 */
  adb(id: string, args: string[]): Promise<string>;
  /** 临时文件建在这下面，默认 os.tmpdir()。 */
  tmpRoot?: string;
  /** 收分片阶段多久没有新分片就中止，默认 30 秒。 */
  idleMs?: number;
};

/** 自动更新，由 main.ts 接到 updater.ts。autoUpdate 为 false（前台运行、关了自动更新）时页面的 update 一律回 off。 */
export type UpdateOps = {
  autoUpdate: boolean;
  /** 马上查一次（限频在 updater.ts）；restarting 表示新版本已换上，main.ts 接着重启。 */
  request(): Promise<{ state: UpdateState; message?: string }>;
  /** 上次检查的时间（毫秒）和结果，/healthz 报给 droidpier status。 */
  last(): { at: number; report: { state: UpdateState; message?: string } } | null;
};

/** 网页模拟器所在路径，staticDir 的内容在这下面提供。 */
const APP_PATH = "/app/";
/** iOS 模拟器的 H5 调试界面（系统的 WebInspectorUI）在这下面提供，调试消息走它下面的 ws/<应用>/<页面>/<票据>。 */
const WEBINSPECTOR_PATH = "/webinspector/";
const WEBINSPECTOR_WS_RE = /^\/webinspector\/ws\/([^/]+)\/([^/]+)\/([^/]+)$/;
/** 网关插进 Main.html 的替身（gateway/native/webinspector-host.js）对外的文件名。 */
const WEBINSPECTOR_SHIM = "droidpier-host.js";

/** iOS 页面的调试界面地址：网关自己提供的 WebInspectorUI，ws 连回网关，带命令表版本和系统版本（替身读这几个参数）。 */
export function webInspectorUrl(port: number, page: { socket: string; id: string }, ticket: string, ios: { version: string | null; ios: string }): string {
  const ws = `127.0.0.1:${port}${WEBINSPECTOR_PATH}ws/${encodeURIComponent(page.socket)}/${encodeURIComponent(page.id)}/${ticket}`;
  const q = new URLSearchParams({ ws, ios: ios.ios });
  if (ios.version) q.set("version", ios.version);
  return `http://127.0.0.1:${port}${WEBINSPECTOR_PATH}Main.html?${q}`;
}
/** 手机上 adb 超时的说法：ADB_UNRESPONSIVE 是给模拟器的，会叫人去重启模拟器。 */
const PHONE_ADB_UNRESPONSIVE = "手机的 adb 没有响应：重新插拔手机，或稍后再试";
const NO_ADB = "iOS 模拟器暂不支持这个功能";
/** 会话走不走 adb（H5 调试、日志、装 APK 都靠它）：只有 caps.adb 明确为 false 时不走（iOS 模拟器）。 */
const viaAdb = (s: EmulatorSession) => s.caps.adb !== false;
/** 有没有日志面板：走 adb 的设备都有，iOS 模拟器靠 caps.logs。 */
const hasLogs = (s: EmulatorSession) => viaAdb(s) || s.caps.logs === true;
/** 真机（走 adb 的 phone 会话）：断开后等它插回、自动重连。iOS 模拟器的 kind 也是 phone（同一条视频通路），但不算。 */
const isPhone = (s: EmulatorSession) => s.kind === "phone" && viaAdb(s);

/** 启动网关的 HTTP + WebSocket 服务，只监听 127.0.0.1。 */
/** 页面连接的发送缓冲超过这么多，日志批次就先不发、只计数（plans/2026-11-16-real-device-pr5-logcat.md 取舍 7）。 */
const LOG_BACKLOG_BYTES = 2 ** 20;
/** H5 控制台闲了这么久就不再挡自动更新（我定的：离开一会儿再回来，控制台会自己重新打开）。 */
const DEVTOOLS_IDLE_MS = 3 * 60_000;

export async function startServer(opts: {
  port: number;
  /** 允许连模拟器协议的页面 Origin；/devtools/ 另外允许 DevTools 前端的 Origin。 */
  allowedOrigins: string[];
  /** DevTools 票据；不传时网关自己建一个。测试注入后可以直接签发、控制过期。 */
  tickets?: Tickets;
  staticDir: string;
  getSession: () => Promise<EmulatorSession | null>;
  avd?: AvdOps;
  /** 真机列表（gateway/src/phones.ts）；测试里不需要真机时不传。 */
  phones?: { list(): PhoneInfo[]; onChange(cb: (list: PhoneInfo[]) => void): void };
  /** MuMu 模拟器（gateway/src/mumu.ts）：list() 为 null 表示没装 MuMu，不发列表。 */
  mumu?: { list(): MumuInfo[] | null; appClosed(): boolean; onChange(cb: (list: MumuInfo[]) => void): void; open(index: number): Promise<void>; close(index: number): Promise<void>; launch(): Promise<void> };
  /**
   * iOS 模拟器的 H5 调试（gateway/src/ios-inspector.ts）：inspector 按 UDID 给出调试连接、命令表版本和系统版本；
   * webInspectorDir 是系统 WebInspectorUI.framework 的 Resources，hostShim 是 gateway/native/webinspector-host.js。不传时 iOS 会话没有 H5 调试。
   */
  ios?: { inspector(udid: string): { inspector: IosInspector; version: string | null; ios: string } | null; webInspectorDir: string; hostShim: string };
  /** iOS 模拟器（gateway/src/ios-sim.ts）：list() 为 null 表示没装 Xcode，不发列表；booted 认 use 里的 UDID。 */
  iosSims?: { list(): IosSimInfo[] | null; onChange(cb: (list: IosSimInfo[]) => void): void; open(udid: string): Promise<void>; close(udid: string): Promise<void>; booted(udid: string): boolean; catalog?(): Promise<IosCatalog>; create?(name: string, deviceType: string, runtime: string): Promise<string> };
  debug?: DebugDeps;
  setup?: SetupOps;
  /** WebView 调试 socket → 本机转发端口；不传时用当前设备的 debug.webviews，都没有时 /devtools/ 连接一律 4404。 */
  portOf?: (socket: string) => number | undefined;
  /** 本地页面代理 DevTools 前端时取文件用；测试里换掉，不传时用全局 fetch。 */
  fetchFrontend?: typeof fetch;
  files?: FileOps;
  /** 发出重启指令后等开机完成；不传时不等，直接按 adb-down 结束。 */
  rebootWait?: (id: string) => Promise<"done" | "adb-down">;
  /** 开机进度广播和无会话时重新发现的间隔，默认 1000ms。 */
  pollMs?: number;
  /** 发出停止指令后最多等多久确认设备停了，默认 10000ms（页面的请求 15 秒超时）。 */
  stopWaitMs?: number;
  /** H5 控制台多久没有操作就不再挡着自动更新；默认 DEVTOOLS_IDLE_MS，测试注入短值。 */
  devtoolsIdleMs?: number;
  /** 当前时间（毫秒），算控制台闲了多久；测试注入。 */
  now?: () => number;
  log?: (s: string) => void;
  /** /healthz 报的网关版本；另一个 droidpier 启动时靠它判断谁更新（gateway/src/already-running.ts）。 */
  version?: string;
  /** 查连接的对端进程（gateway/src/peer.ts）；不传时 macOS 上用 lsof。都是测试时注入。 */
  peer?: { lookup?: SocketsLookup; platform?: string; maxPending?: number; allowAnyWsClient?: boolean };
  /** 由 launchd 拉起的后台服务；/healthz 报给前台再运行的 droidpier，让它说明怎么停（gateway/src/already-running.ts）。 */
  service?: boolean;
  update?: UpdateOps;
  /** 日志面板（gateway/src/logcat.ts）；不传时 logcatOpen 回「网关不支持日志」。 */
  logcat?: { subscribe(id: string, f: LogFilter, onBatch: (lines: LogLine[], reset: boolean) => void): LogcatSub };
  /** 日志面板的包名下拉：前台 App 和运行中的 App。 */
  apps?: (id: string) => Promise<{ foreground: string | null; apps: string[] }>;
  /** WebMCP 读日志：导出这台设备最近的 logcat，按条件取最后 limit 行。 */
  logcatRead?: (id: string, f: LogFilter, limit: number) => Promise<LogLine[]>;
}): Promise<{
  port: number;
  close(): Promise<void>;
  /** 有不能被重启打断的操作时返回原因，自动更新这时推迟。 */
  busy(): string | null;
  /** 给所有页面发一条更新状态（定时检查换上新版本、马上重启时）。 */
  notifyUpdate(r: { state: UpdateState; message?: string }): void;
}> {
  const log = opts.log ?? ((s: string) => console.log(s));
  const root = resolve(opts.staticDir);
  const conns = new Set<Conn>();
  const watched = new WeakSet<EmulatorSession>();
  const jobs = new Set<StartJob>();
  // 正在删除的 AVD：删完之前同名的启动、切换、改名、再删都拒绝
  const deleting = new Set<string>();
  const DELETING = "正在删除这台设备";
  // 收分片或正在 adb install / push 的传文件：重启会打断它们
  const transfers = new Set<object>();
  const now = opts.now ?? Date.now;
  // 控制台上次有操作（连上、前端发来消息）的时间：自动更新只在最近有操作时等它；停在断点上的控制台一直等
  let devtoolsInputAt = 0;
  const pausedDevtools = new Set<WebSocket>();
  const trackDevtools = (ws: WebSocket) => {
    devtoolsInputAt = now();
    ws.on("message", () => (devtoolsInputAt = now()));
    // 页面发给前端的消息里看断点：停住时用户在读代码，不发消息也不算闲着。iOS 的事件包在 Target.dispatchMessageFromTarget 里（转义过的 JSON），
    // 所以按文字找，不解析
    const send = ws.send.bind(ws) as (data: unknown, ...rest: unknown[]) => void;
    ws.send = ((data: unknown, ...rest: unknown[]) => {
      if (typeof data === "string" || Buffer.isBuffer(data)) {
        const text = String(data);
        if (text.includes("Debugger.paused")) pausedDevtools.add(ws);
        else if (text.includes("Debugger.resumed")) pausedDevtools.delete(ws);
      }
      send(data, ...rest);
    }) as typeof ws.send;
    ws.on("close", () => pausedDevtools.delete(ws));
  };
  let gatewayPort = opts.port;
  const tickets = opts.tickets ?? createTickets();
  // 票据是哪个页面要的：DevTools 连上后，选择元素模式的开关告诉那个页面
  const ticketOwners = new Map<string, Conn>();
  const peerCheck = createPeerCheck({ ...opts.peer, log });

  // 当前设备的调试工具：首次用到时创建，换设备、设备退出、网关关闭时收掉
  type Debug = { id: string; d: DeviceDebug; disposed: boolean; listing?: Promise<WebViewPage[]>; proxies: Set<WebSocket> };
  let debug: Debug | undefined;
  let disposals: Promise<void> = Promise.resolve();
  const dropDebug = (id?: string) => {
    const cur = debug;
    if (!cur || (id !== undefined && cur.id !== id)) return;
    debug = undefined;
    cur.disposed = true;
    // 这些 DevTools 窗口连的是旧设备的转发，不能让它们悄悄留着
    for (const ws of cur.proxies) ws.terminate();
    const done = (async () => {
      // list() 进行中会建转发，等它结束再移除，否则漏掉
      await cur.listing?.catch(() => {});
      await cur.d.webviews.close().catch((e: Error) => log(`移除 adb forward 失败：${e.message}`));
      await cur.d.reverses.removeAll().catch((e: Error) => log(`移除 adb reverse 失败：${e.message}`));
    })();
    disposals = disposals.then(() => done);
  };
  const debugFor = (id: string): Debug => {
    if (debug?.id === id) return debug;
    dropDebug();
    debug = { id, d: opts.debug!.forDevice(id), disposed: false, proxies: new Set() };
    return debug;
  };
  // 同一设备的并发 list 共用一次：两次同时跑会给同一个 socket 各建一个转发
  const listPages = (h: Debug) => (h.listing ??= h.d.webviews.list().finally(() => (h.listing = undefined)));
  // iOS 模拟器会话的调试连接（不走 adb）；没配 opts.ios 或不是 iOS 会话时为 null
  const iosFor = (s: EmulatorSession) => (!viaAdb(s) && opts.ios ? opts.ios.inspector(s.id) : null);
  // 开着的 iOS 调试界面连接，按模拟器记：换设备、会话关掉时断开
  const iosProxies = new Set<{ ws: WebSocket; udid: string }>();
  const dropIosProxies = (keep?: string) => {
    for (const p of [...iosProxies]) if (p.udid !== keep) p.ws.terminate();
  };
  // 可以嵌 iOS 调试界面的页面：Droidpier 的页面（公网页面和网关自己的页面），即 allowedOrigins
  const webInspectorParents = () => opts.allowedOrigins;

  /** 系统 WebInspectorUI 的文件：只在它的 Resources 目录里找；Main.html 里在 Main.js 前插入替身。 */
  const serveWebInspector = async (rel: string, res: import("node:http").ServerResponse) => {
    if (!opts.ios) return void res.writeHead(404).end();
    try {
      if (rel === WEBINSPECTOR_SHIM) {
        res.writeHead(200, { "content-type": MIME[".js"], "cache-control": "no-store" }).end(await readFile(opts.ios.hostShim));
        return;
      }
      const dir = resolve(opts.ios.webInspectorDir);
      const file = resolve(join(dir, rel || "Main.html"));
      if (!file.startsWith(dir + sep)) return void res.writeHead(404).end();
      let body = await readFile(file);
      if (file === join(dir, "Main.html")) {
        const html = body.toString("utf8");
        const anchor = '<script src="Main.js"></script>';
        // 换了 macOS 版本 Main.html 的写法可能变：插不进去时界面打开也连不上，记下来好查
        if (!html.includes(anchor)) log(`WebInspectorUI 的 Main.html 里没找到 ${anchor}，iOS 调试界面会连不上`);
        body = Buffer.from(html.replace(anchor, `<script src="${WEBINSPECTOR_SHIM}"></script>\n    ${anchor}`));
      }
      res.writeHead(200, {
        "content-type": MIME[extname(file)] ?? "application/octet-stream",
        // 界面跑在网关自己的源上：只许它连回网关、只许 Droidpier 的页面嵌它
        "content-security-policy": `connect-src 'self'; frame-ancestors ${webInspectorParents().join(" ")}`,
      }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  };

  /** 替本地页面取 DevTools 前端文件（gateway/src/devtools-proxy.ts 的 localFrontendUrl）：只取 appspot 上带版本号的文件，原样转回。 */
  const serveFrontend = async (rel: string, res: import("node:http").ServerResponse) => {
    const url = frontendFileUrl(rel);
    if (!url) {
      log(`DevTools 前端 ${rel}：不是带版本号的前端文件，不代理`);
      return void res.writeHead(404).end();
    }
    try {
      const r = await (opts.fetchFrontend ?? fetch)(url, { signal: AbortSignal.timeout(30_000) });
      if (!r.ok) {
        log(`DevTools 前端 ${rel}：appspot 回 ${r.status}`);
        return void res.writeHead(r.status === 404 ? 404 : 502).end();
      }
      const headers: Record<string, string> = {
        "content-type": r.headers.get("content-type") ?? "application/octet-stream",
        // 前端跑在网关自己的源上（和页面同源，能连控制页面的 WebSocket）：只许它连回网关，只许网关自己的页面嵌它。
        // 否则任何网站都能用 ?ws=<别处> 打开它，让别人的服务器给它喂数据
        "content-security-policy": `connect-src 'self'; frame-ancestors http://127.0.0.1:${gatewayPort} http://localhost:${gatewayPort}`,
      };
      // 带版本号的文件不会变，按 appspot 给的缓存策略缓存
      const cache = r.headers.get("cache-control");
      if (cache) headers["cache-control"] = cache;
      res.writeHead(200, headers).end(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      log(`取 DevTools 前端失败：${(e as Error).message}`);
      res.writeHead(502).end();
    }
  };

  const http = createServer(async (req, res) => {
    if (!checkHost(req.headers.host, gatewayPort)) {
      log(`拒绝 HTTP 请求：Host 是 ${req.headers.host ?? "<无>"}`);
      res.writeHead(421).end();
      return;
    }
    const peer = await peerCheck(req.socket, gatewayPort, "http");
    if (!peer.ok) {
      log(`拒绝 HTTP 请求：${peer.why}`);
      res.writeHead(peer.status).end();
      return;
    }
    let rel: string;
    try {
      rel = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (rel === "/healthz") {
      const last = opts.update?.last();
      const update = { auto: opts.update?.autoUpdate === true, ...(last ? { last: { at: new Date(last.at).toISOString(), ...last.report } } : {}) };
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ app: "droidpier", version: opts.version ?? "", service: opts.service === true, pid: process.pid, update }));
      return;
    }
    if (rel === "/" || rel === APP_PATH.slice(0, -1)) {
      res.writeHead(302, { location: APP_PATH }).end();
      return;
    }
    if (rel.startsWith(LOCAL_FRONTEND_PATH)) {
      await serveFrontend(rel.slice(LOCAL_FRONTEND_PATH.length), res);
      return;
    }
    if (rel.startsWith(WEBINSPECTOR_PATH)) {
      await serveWebInspector(rel.slice(WEBINSPECTOR_PATH.length), res);
      return;
    }
    if (!rel.startsWith(APP_PATH)) {
      res.writeHead(404).end();
      return;
    }
    rel = rel.slice(APP_PATH.length - 1);
    if (rel.endsWith("/")) rel += "index.html";
    const file = resolve(join(root, rel));
    if (!file.startsWith(root + sep)) {
      res.writeHead(404).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });

  // 单条消息上限：文件分片 256 KiB，其他都是小 JSON；粘贴超过 2 MiB 的文字会被断开（1009）
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
  const devtoolsWss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  // 按路径分流：/devtools/<socket>/<pageId>/<票据> 走 DevTools 代理，其余走模拟器协议
  // 两条路都先核 Origin（4003），模拟器协议只靠这一道；DevTools 前端还要核票据（4001）
  // 拒绝也要先完成握手：浏览器只有握手成功后才看得到关闭码
  // 升级前先核 Host（421）和对端进程（403 / 503），这两种直接回 HTTP 错误，不握手：正常的浏览器页面不会碰到
  const refuseUpgrade = (socket: Duplex, status: string) =>
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`, () => socket.destroy());
  http.on("upgrade", (req, socket, head) => {
    // 升级后 http 模块不再给这个 socket 挂 error 监听，交给 ws 之前对端重置连接会让进程崩掉
    const swallow = () => {};
    socket.on("error", swallow);
    if (!checkHost(req.headers.host, gatewayPort)) {
      log(`拒绝 WebSocket：Host 是 ${req.headers.host ?? "<无>"}`);
      refuseUpgrade(socket, "421 Misdirected Request");
      return;
    }
    // upgrade 事件给的就是 net.Socket，类型上写的是 Duplex
    void peerCheck(socket as Socket, gatewayPort, "ws").then((peer) => {
      if (socket.destroyed) return;
      if (!peer.ok) {
        log(`拒绝 WebSocket：${peer.why}`);
        refuseUpgrade(socket, peer.status === 403 ? "403 Forbidden" : "503 Service Unavailable");
        return;
      }
      socket.off("error", swallow);
      upgrade(req, socket, head);
    });
  });
  const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    let path: string;
    try {
      path = new URL(req.url ?? "/", "http://x").pathname;
    } catch {
      socket.destroy();
      return;
    }
    const iosTarget = WEBINSPECTOR_WS_RE.exec(path);
    if (iosTarget) return upgradeWebInspector(req, socket, head, iosTarget);
    const target = parseDevtoolsPath(path);
    const allowed = target ? [DEVTOOLS_FRONTEND_ORIGIN, ...opts.allowedOrigins] : opts.allowedOrigins;
    if (!checkUpgrade(req.headers.origin, allowed)) {
      log(`拒绝 Origin：${req.headers.origin ?? "<无>"}`);
      wss.handleUpgrade(req, socket, head, (ws) => ws.close(CLOSE_ORIGIN, "origin not allowed"));
      return;
    }
    if (!target) {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
      return;
    }
    devtoolsWss.handleUpgrade(req, socket, head, (ws) => {
      trackDevtools(ws);
      const owner = target.ticket ? ticketOwners.get(target.ticket) : undefined;
      if (target.ticket) ticketOwners.delete(target.ticket);
      if (!target.ticket || !tickets.take(target.ticket, target.socket, target.pageId)) {
        ws.close(CLOSE_BAD_TOKEN, "bad devtools ticket");
        return;
      }
      const h = opts.portOf ? undefined : debug;
      const port = opts.portOf ? opts.portOf(target.socket) : h?.d.webviews.portOf(target.socket);
      if (port === undefined) {
        ws.close(CLOSE_UNKNOWN_SOCKET, "unknown devtools socket");
        return;
      }
      if (h) {
        h.proxies.add(ws);
        ws.on("close", () => h.proxies.delete(ws));
      }
      let dt: ReturnType<Conn["devtoolsOpened"]> | undefined;
      const session = proxyDevtools(ws, `ws://127.0.0.1:${port}/devtools/page/${encodeURIComponent(target.pageId)}`, {
        onInspectMode: (on) => dt?.mode(on),
        onHighlight: (t) => dt?.highlight(t),
      });
      if (owner && conns.has(owner)) dt = owner.devtoolsOpened(session, target.socket, target.pageId, ws);
    });
  };
  // iOS 调试界面的消息通道：界面由网关自己提供，Origin 只能是网关本机地址；同样要一次性票据
  const upgradeWebInspector = (req: IncomingMessage, socket: Duplex, head: Buffer, m: RegExpExecArray) => {
    if (!checkUpgrade(req.headers.origin, [`http://127.0.0.1:${gatewayPort}`, `http://localhost:${gatewayPort}`])) {
      log(`拒绝 Origin：${req.headers.origin ?? "<无>"}`);
      wss.handleUpgrade(req, socket, head, (ws) => ws.close(CLOSE_ORIGIN, "origin not allowed"));
      return;
    }
    let appId: string, pageId: string, ticket: string;
    try {
      [appId, pageId, ticket] = [decodeURIComponent(m[1]), decodeURIComponent(m[2]), decodeURIComponent(m[3])];
    } catch {
      socket.destroy();
      return;
    }
    devtoolsWss.handleUpgrade(req, socket, head, (ws) => {
      trackDevtools(ws);
      const owner = ticketOwners.get(ticket);
      ticketOwners.delete(ticket);
      if (!tickets.take(ticket, appId, pageId)) return ws.close(CLOSE_BAD_TOKEN, "bad devtools ticket");
      const ios = owner?.session ? iosFor(owner.session) : null;
      if (!ios) return ws.close(CLOSE_UNKNOWN_SOCKET, "no ios simulator");
      const udid = owner!.session!.id;
      ios.inspector.open(appId, pageId).then((ch) => {
        if (ws.readyState !== ws.OPEN) return ch.close();
        // 换设备、模拟器会话关掉时断开（同 Android 的 dropDebug）
        iosProxies.add({ ws, udid });
        ws.on("close", () => {
          for (const p of iosProxies) if (p.ws === ws) iosProxies.delete(p);
        });
        ch.onMessage((msg) => {
          if (ws.readyState === ws.OPEN) ws.send(msg);
        });
        ch.onClose(() => ws.close());
        ws.on("message", (d) => ch.send(d.toString()));
        ws.on("close", () => ch.close());
      }, (e: Error) => {
        log(`打开 iOS 调试通道失败：${e.message}`);
        ws.close(CLOSE_UNKNOWN_SOCKET, "inspector unavailable");
      });
    });
  };
  // adb 无响应统一成一句话并带 code，页面据此给出“重启模拟器”；其他失败照旧加前缀
  const adbFail = (prefix: string, e: unknown): { error: string; code?: "adb-unresponsive" } =>
    e instanceof AdbUnresponsive ? { error: e.message, code: "adb-unresponsive" } : { error: `${prefix}${(e as Error).message}` };
  // 正在重启的设备：同时只有一台、一次
  let rebooting: { id: string } | null = null;
  const isRebooting = (s: EmulatorSession) => rebooting?.id === s.id;
  const REBOOTING = "设备正在重启，等它开机后再试";
  const send = (ws: WebSocket, m: ServerMsg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
  };
  const live = () => [...conns].filter((c) => c.helloSeen && c.ws.readyState === c.ws.OPEN);
  const broadcast = (m: ServerMsg, only: (c: Conn) => boolean = () => true) => {
    for (const c of live()) if (only(c)) send(c.ws, m);
  };
  // 用户点过的真机：掉线期间不把模拟器接给没会话的页面，插回后自动重连（docs/superpowers/specs/2026-11-13-real-device-design.md 6.2）。
  // 用户再点模拟器、或开一台 AVD 时清掉
  let pinned: string | null = null;
  const usablePhone = (name: string) => opts.phones?.list().some((p) => p.id === name && p.state === "device") ?? false;
  const usableIosSim = (name: string) => opts.iosSims?.booted(name) ?? false;
  const liveSession = (id: string) => [...conns].find((c) => c.session?.id === id)?.session;
  // 换设备一次只做一件：用户 use、开机后接管、真机插回自动重连都排在这条链上；pinned 也在链里改，
  // 否则自动重连可能在用户刚切到模拟器之后又连回真机，session-cache 会把用户的模拟器会话关掉
  let switching: Promise<unknown> = Promise.resolve();
  const serially = <T>(job: () => Promise<T>): Promise<T> => {
    const p = switching.then(job, job);
    switching = p.catch(() => {});
    return p;
  };
  /** 换到这台设备并更新 pinned（真机记下 id，模拟器清掉）。 */
  const useDevice = (name: string) => serially(async () => {
    const s = await opts.avd!.use(name);
    // iOS 模拟器关机后不会自己回来，不按真机那样等它插回
    if (s) pinned = isPhone(s) ? s.id : null;
    return s;
  });
  let reconnecting = false;
  /** 选过的真机插回来了、又有页面在等：重连并接给没会话的页面。轮到它时再确认一遍还是这台手机。 */
  const reconnectPinned = () => {
    // 重启中的手机由重启流程自己重连：开机动画阶段 adb 就上线了，那时 scrcpy 起不来，在这里重连只会失败一次就不再试
    if (!pinned || reconnecting || !opts.avd || rebooting?.id === pinned || !usablePhone(pinned) || liveSession(pinned)) return;
    if (!live().some((c) => !c.session)) return;
    const id = pinned;
    reconnecting = true;
    serially(async () => (pinned === id && usablePhone(id) && !liveSession(id) ? opts.avd!.use(id) : null)).then(
      (s) => { if (s && pinned === id) for (const c of live()) if (!c.session) c.attach(s); },
      (e: Error) => {
        log(`重新连接 ${id} 失败：${e.message}`);
        broadcast({ t: "error", message: `重新连接 ${id} 失败：${e.message}` }, (c) => !c.session);
      },
    ).finally(() => { reconnecting = false; });
  };
  opts.phones?.onChange((list) => {
    broadcast({ t: "phones", list });
    reconnectPinned();
  });
  const mumuMsg = (list: MumuInfo[]): ServerMsg => ({ t: "mumu", list, ...(opts.mumu?.appClosed() ? { appClosed: true as const } : {}) });
  opts.mumu?.onChange((list) => broadcast(mumuMsg(list)));
  opts.iosSims?.onChange((list) => broadcast({ t: "iosSims", list }));
  const booting = () => [...jobs].some((j) => j.progress === "spawning" || j.progress === "booting");
  const sendBoot = (j: StartJob) => broadcast({ t: "boot", name: j.name, progress: j.progress, ...(j.error ? { error: j.error } : {}) });
  const switchTo = (s: EmulatorSession) => {
    if (debug && debug.id !== s.id) dropDebug();
    dropIosProxies(s.id);
    for (const c of live()) c.attach(s);
  };
  // 会话退出：解绑它的连接并告知页面，连接保持打开，等下一台出现
  const watch = (s: EmulatorSession) => {
    if (watched.has(s)) return;
    watched.add(s);
    s.onRotation((rotation) => {
      for (const c of live()) {
        if (c.session !== s) continue;
        send(c.ws, { t: "orientation", rotation });
        c.resubscribe();
        c.rotated();
      }
    });
    s.onClipboard((text) => {
      for (const c of live()) if (c.session === s) send(c.ws, { t: "clip", text });
    });
    s.onClosed(() => {
      dropDebug(s.id);
      for (const p of [...iosProxies]) if (p.udid === s.id) p.ws.terminate();
      for (const c of conns) {
        if (c.session !== s) continue;
        c.detach();
        send(c.ws, { t: "status", state: isRebooting(s) ? "rebooting" : isPhone(s) ? "phone-closed" : "emulator-closed" });
      }
    });
  };

  // 按名字停一台设备（开机中的按开机任务的串口），等列表里看到它停了；返回给页面看的失败原因，成功返回 null。
  // announce：停完给所有页面发新列表；删除流程里不发，删完统一发一次
  const stopByName = async (name: string, announce = true): Promise<string | null> => {
    const avd = opts.avd!;
    // 模拟器退出前要存快速启动快照，几台一起跑时要十几二十秒（2026-11-22 实测超过 10 秒）；页面那边等 75 秒（host/src/main.ts 的 STOP_REPLY_MS）
    const deadline = Date.now() + (opts.stopWaitMs ?? 60_000);
    const wait = () => new Promise((r) => setTimeout(r, opts.pollMs ?? 1000));
    const jobOf = () => [...jobs].find((j) => j.name === name);
    const info = (await avd.list()).find((a) => a.name === name);
    if (!jobOf() && !info) return `没有这个设备：${name}`;
    if (!jobOf() && info!.running === "no") return "这台设备没有在运行";
    // 开机任务刚建时串口还是 0，要等模拟器写出发现文件（gateway/src/lifecycle.ts 的 startAvd）
    let serial = jobOf()?.serial || info?.serial;
    while (!serial && jobOf() && Date.now() <= deadline) {
      await wait();
      serial = jobOf()?.serial;
    }
    if (!serial) return jobOf() ? "设备还在启动，暂时停不了，稍后再试" : "找不到这台设备的串口，没法停止";
    try {
      await avd.stop(serial);
    } catch (e) {
      return `停止失败：${(e as Error).message}`;
    }
    for (;;) {
      const now = (await avd.list()).find((a) => a.name === name);
      if (!jobOf() && (!now || now.running === "no")) break;
      if (Date.now() > deadline) return "已经发出停止指令，但设备还在运行，稍后再试";
      await wait();
    }
    if (announce) avd.list().then((list) => broadcast({ t: "avds", list }), (e: Error) => log(`停止后读取 AVD 列表失败：${e.message}`));
    return null;
  };

  const startJob = (name: string) => {
    const job = opts.avd!.start(name);
    if (!jobs.has(job)) {
      jobs.add(job);
      job.done.then(
        async () => {
          jobs.delete(job);
          sendBoot(job);
          const s = await useDevice(job.name).catch((e: Error) => (log(`接管 ${job.name} 失败：${e.message}`), null));
          if (s) switchTo(s);
          else {
            broadcast({ t: "error", message: `${job.name} 已开机，但连不上它的 gRPC` });
            // 这些连接之前收到过 booting，要告诉它们开机这条路结束了
            broadcast({ t: "status", state: "no-emulator" }, (c) => !c.session);
          }
        },
        () => {
          jobs.delete(job);
          sendBoot(job);
          broadcast({ t: "status", state: "no-emulator" }, (c) => !c.session);
        },
      );
    }
    if (job.progress !== "ready") broadcast({ t: "status", state: "booting" }, (c) => !c.session);
    sendBoot(job);
  };

  // 安装状态只在这里：后连上的页面从这里补齐
  let installing = false;
  const installs = new Map<string, InstallProgress>();
  // 正在等页面回答的许可证；回答必须带着它的 id
  let license: Licence | null = null;
  const setLicense = (l: Licence | null) => {
    if (l?.id === license?.id) return;
    license = l;
    broadcast({ t: "licenses", licence: l });
  };
  const checkEnv = () => opts.setup!.check().catch((e: Error): EnvReport => {
    log(`环境检查失败：${e.message}`);
    return {
      ok: false, missing: [], error: `环境检查失败：${e.message}`, sdkRoot: "", avdHome: "",
      freeMb: 0, avdFreeMb: 0, sameDisk: true,
    };
  });
  const notAuto = (env: EnvReport, ids: string[]) => {
    const m = env.missing.find((x) => ids.includes(x.id) && !x.auto);
    return m ? `${m.detail}，不能自动安装` : null;
  };
  const spaceShort = (items: Parameters<typeof spaceCheck>[0], env: EnvReport) => {
    const { shortMb } = spaceCheck(items, env);
    return shortMb > 0 ? `磁盘空间不足：还需要约 ${gbText(shortMb)}` : null;
  };
  // 安装和建设备共用：先占住 installing，再按 check 给的理由拒绝或开始
  const runChecked = async (ws: WebSocket, what: string, check: () => Promise<{ reason: string } | { ids: string[]; job: InstallJob }>) => {
    const setup = opts.setup;
    if (!setup) return;
    if (installing) return send(ws, { t: "error", message: "正在安装，等这一轮结束再试" });
    installing = true;
    const r = await check().catch((e: Error) => ({ reason: e.message }));
    if ("reason" in r) {
      installing = false;
      log(`拒绝${what}：${r.reason}`);
      return send(ws, { t: "error", message: r.reason });
    }
    installs.clear();
    const spec = r.job.avd;
    log(`页面确认${what}：${r.ids.join(", ")}${spec ? `（${spec.name} · ${spec.device} · ${spec.image}）` : r.job.image ? `（${r.job.image}）` : ""}`);
    setup.installer.run(
      r.ids,
      (p) => {
        installs.set(p.id, p);
        if (p.phase !== "license") setLicense(null);
        broadcast({ t: "install", progress: p });
      },
      (l) => setLicense(l),
      r.job,
    ).catch((e: Error) => log(`安装出错：${e.message}`)).finally(async () => {
      installing = false;
      setLicense(null);
      broadcast({ t: "env", ...(await checkEnv()) });
    });
  };
  const install = (ws: WebSocket, ids: string[]) => {
    if (ids.length === 0) return;
    // 建设备要选机型和系统版本，只走 createAvd
    if (ids.includes("avd")) return send(ws, { t: "error", message: "创建设备请在“创建设备”对话框里选机型和系统版本" });
    return runChecked(ws, "安装", async () => {
      // 页面确认框已经拦过一次；这里按同一套算法再查，防止页面旧了或绕过页面
      const env = await checkEnv();
      if (env.error) return { reason: env.error };
      // 只装这次环境检查里缺的：已装好的包不重下、不替换（也就不会绕过磁盘检查）
      const want = ids.filter((id) => env.missing.some((m) => m.id === id));
      if (want.length === 0) return { reason: "要装的都不缺，没有安装" };
      const reason = notAuto(env, want) ?? spaceShort(env.missing.filter((m) => want.includes(m.id)), env);
      // 装哪个系统镜像由这次环境检查决定（比如设备缺的那个），不信页面
      const image = want.includes("system-image") ? env.missing.find((m) => m.id === "system-image")?.pkg : undefined;
      return reason ? { reason } : { ids: want, job: image ? { image } : {} };
    });
  };
  const createAvd = (ws: WebSocket, m: { name: string; device: string; image: string }) =>
    runChecked(ws, "创建设备", async () => {
      const [env, cat] = await Promise.all([checkEnv(), opts.setup!.catalog()]);
      const image = cat.images.find((i) => i.pkg === m.image);
      const ids = [...(image && !image.installed ? ["system-image"] : []), "avd"];
      const reason = env.error
        ?? (cat.devices.some((d) => d.id === m.device) ? null : `没有这个机型：${m.device}`)
        ?? (image ? null : `没有这个系统版本：${m.image}`)
        ?? avdNameError(m.name, cat.existing)
        ?? spaceShort(createItems(image!), env);
      if (reason) return { reason };
      return { ids, job: { avd: { name: m.name, device: m.device, image: image!.pkg, ramMb: ramMbFor(image!.apiLevel) } } };
    });

  // 每个周期：广播进行中的开机进度；没有在开机时，给没会话的连接重新发现模拟器（接管外部启动的）
  let polling = false;
  const ticker = setInterval(async () => {
    for (const j of jobs) sendBoot(j);
    if (polling || booting()) return;
    if (!live().some((c) => !c.session)) return;
    // 用户选的真机掉线了：等它插回（phones.onChange 重连），不拿模拟器顶上
    if (pinned) return;
    polling = true;
    try {
      const s = await opts.getSession().catch(() => null);
      if (s) for (const c of live()) if (!c.session) c.attach(s);
    } finally {
      polling = false;
    }
  }, opts.pollMs ?? 1000);

  wss.on("connection", (ws, req?: IncomingMessage) => {
    // 网关自己提供的页面（--local）：DevTools 前端要走网关代理（localFrontendUrl）
    const localPage = req?.headers.origin === `http://127.0.0.1:${gatewayPort}` || req?.headers.origin === `http://localhost:${gatewayPort}`;
    const conn: Conn = {
      ws,
      helloSeen: false,
      attach: (s) => attach(s),
      resubscribe: () => subscribe(),
      detach: () => detach(),
      stats: { recv: 0, sent: 0, bytes: 0, lagMs: 0, dropped: 0 },
      devtoolsOpened: (session, socket, pageId, dws) => devtoolsOpened(session, socket, pageId, dws),
      // 转屏后 App 重新排版要一会儿：马上作废旧位置，过 1.5 秒按新的 /json 再算一次
      rotated: () => {
        inspector.relocate();
        clearTimeout(relocateTimer);
        relocateTimer = setTimeout(() => inspector.relocate(), 1500);
      },
    };
    conns.add(conn);
    // 这个页面打开的 DevTools 和它的选择元素模式（gateway/src/inspect.ts）；同一时间只认最新的一个
    type Target = { send: DevtoolsSession["send"]; socket: string; pageId: string };
    const inspector = createInspectorSlot<Target>({
      notify: (on, mapped) => send(ws, { t: "inspectMode", on, mapped }),
      notifyHighlight: (box) => send(ws, { t: "highlight", box }),
      // 每次进入模式、转屏后重新算：位置和缩放用 Page.getLayoutMetrics（停在断点上也能答），
      // 显示方向问页面的 screen.orientation.angle（停在断点上答不了，pickMapping 按物理方向猜）
      locate: async (t) => {
        const s = conn.session;
        const h = s && opts.debug && debug?.id === s.id ? debug : undefined;
        if (!s || !h) return null;
        const page = (await listPages(h)).find((p) => p.socket === t.socket && p.id === t.pageId);
        if (!page) return null;
        const metrics = () => t.send("Page.getLayoutMetrics");
        // WebView 的位置来自 /json（没在屏幕上时没有，不映射）；浏览器标签页（没有 pid）只认前台那个，
        // 按窗口内容区和视口推，地址栏收起展开时会变（gateway/src/inspect.ts 的 browserView）
        const tab = page.pid === undefined && page.visible && page.pkg ? page.pkg : undefined;
        const app = tab ? ((await h.d.appBounds?.(tab)) ?? null) : null;
        // 真机的画面是缩小过的视频：屏幕像素的位置要缩到视频像素（gateway/src/inspect.ts 的 scaleRect）
        const display = s.kind === "phone" ? ((await h.d.displaySize?.().catch(() => null)) ?? null) : null;
        const read = (r: any) => {
          const v = page.rect ? { rect: page.rect, scale: page.rect.width / Number(r?.cssVisualViewport?.clientWidth ?? r?.cssLayoutViewport?.clientWidth) } : app ? browserView(app, r) : null;
          if (!v || !Number.isFinite(v.scale) || !(v.scale > 0)) return null;
          const rect = scaleRect(v.rect, s.device, display);
          return { rect, scale: v.scale * (rect.width / v.rect.width) };
        };
        const first = read(await metrics());
        if (!first) return null;
        const angle = await Promise.race([
          t.send("Runtime.evaluate", { expression: "screen.orientation.angle", returnByValue: true }).then((r) => r?.result?.value, () => undefined),
          new Promise<undefined>((r) => setTimeout(r, 1000)),
        ]);
        const m = pickMapping({ rect: first.rect, device: s.device, physical: s.rotation, angle: typeof angle === "number" ? angle : undefined, cssWidth: first.rect.width / first.scale });
        if (!m) return null;
        const view = liveValue(first, () => metrics().then(read));
        return {
          toCss: (p) => {
            if (conn.session !== s) return null;
            const v = view.get();
            return toPageCss(p, s.device, m.rotation, v.rect, v.scale);
          },
          toPanel: (p) => {
            const v = view.get();
            return toPanel(p, s.device, m.rotation, v.rect, v.scale);
          },
        };
      },
    });
    let relocateTimer: ReturnType<typeof setTimeout> | undefined;
    const devtoolsOpened = (session: DevtoolsSession, socket: string, pageId: string, dws: WebSocket) => {
      const dt = inspector.open({ send: (m, p) => session.send(m, p), socket, pageId });
      dws.on("close", () => dt.close());
      return { mode: (on: boolean) => dt.mode(on), highlight: (t: HighlightTarget | null) => dt.highlight(t) };
    };
    const slot = new LatestFrame<Frame>();
    let sending = false;
    let unsubscribe: (() => void) | undefined;
    let size = { width: 0, height: 0 };
    // 页面在后台：不订阅画面；resize / 旋转 / 换会话只记下来，resume 时按最新状态订阅
    let paused = false;
    // 记录最后一次 touch 的位置和状态，连接异常关闭时补发抬起
    let lastTouch: { x: number; y: number; down: boolean } | null = null;
    // 输入按到达顺序串行执行：text 是两步（剪贴板 + 粘贴），不能被后面的按键插队
    let inputChain = Promise.resolve();
    // 重启中的输入直接丢掉：落在正在复位的系统上没有意义，也不能排在重启后面突然生效
    const enqueue = (what: string, run: (s: EmulatorSession) => Promise<void>) => {
      const s = conn.session;
      if (!s || isRebooting(s)) return;
      inputChain = inputChain.then(() => run(s)).catch((e: Error) => {
        log(`${what} 失败：${e.message}`);
        if (e instanceof AdbUnresponsive) send(ws, { t: "error", code: "adb-unresponsive", message: e.message });
      });
    };

    ws.on("error", (e) => log(`连接出错：${e.message}`));

    // 背压：同一时间只有一帧在发，ws.send 回调里再取最新一帧
    const pump = () => {
      if (sending || ws.readyState !== ws.OPEN) return;
      const f = slot.take();
      if (!f) return;
      sending = true;
      conn.stats.sent++;
      conn.stats.bytes += f.data.length;
      ws.send(Buffer.concat([encodeFrameHeader(f.h), f.data]), () => {
        sending = false;
        pump();
      });
    };
    const subscribe = () => {
      unsubscribe?.();
      unsubscribe = undefined;
      if (paused || !conn.session) return;
      const ses = conn.session;
      if (ses.kind === "phone" && ses.video) {
        // 真机是 H.264：按顺序发、积压时丢到下一个关键帧；手机时钟和电脑不同，不算延迟
        const sender = createVideoSender({ send: (b) => ws.send(b), buffered: () => ws.bufferedAmount, requestKey: () => ses.requestKeyFrame?.() });
        unsubscribe = ses.video((p) => {
          conn.stats.recv++;
          conn.stats.sent++;
          conn.stats.bytes += p.data.length;
          sender.push(p);
        });
        ses.requestKeyFrame?.();
        return;
      }
      // CSS×DPR 常是小数（比如页面缩放 125%），mmap 文件大小必须是整数；也不超过设备分辨率
      const { width: dw, height: dh } = conn.session!.device;
      const dev = conn.session!.rotation % 180 ? { width: dh, height: dw } : { width: dw, height: dh };
      const clamp = (v: number, max: number) => Math.min(max, Math.max(1, Math.round(v)));
      const want = { width: clamp(size.width, dev.width), height: clamp(size.height, dev.height) };
      unsubscribe = conn.session!.frames(want, (h, data) => {
        conn.stats.recv++;
        conn.stats.lagMs += (((Date.now() - h.tsMs) % 2 ** 32) + 2 ** 32) % 2 ** 32;
        const before = slot.dropped;
        slot.put({ h, data });
        conn.stats.dropped += slot.dropped - before;
        pump();
      });
    };
    // 日志面板：过滤条件随连接，接到哪台设备就订阅哪台
    let logFilter: LogFilter | null = null;
    let logSub: LogcatSub | undefined;
    let logDropped = 0;
    const openLog = () => {
      logSub?.close();
      logSub = undefined;
      const s = conn.session;
      if (!logFilter || !s || !opts.logcat || !hasLogs(s)) return;
      logSub = opts.logcat.subscribe(s.id, logFilter, (lines, reset) => {
        // 页面跟不上时这批不发，下一批告诉它省略了多少行（plans/2026-11-16-real-device-pr5-logcat.md 取舍 7）
        if (!reset && ws.bufferedAmount > LOG_BACKLOG_BYTES) {
          logDropped += lines.length;
          return;
        }
        send(ws, { t: "logcat", lines, reset, ...(logDropped ? { dropped: logDropped } : {}) });
        logDropped = 0;
      });
    };
    const attach = (s: EmulatorSession) => {
      conn.session = s;
      // 按着的手指属于旧会话，新会话里没有按下
      lastTouch = null;
      watch(s);
      send(ws, { t: "ready", version: PROTOCOL_VERSION, device: s.device, serial: s.serial, deviceId: s.id, kind: s.kind, caps: s.caps });
      send(ws, { t: "orientation", rotation: s.rotation });
      if (isRebooting(s)) send(ws, { t: "status", state: "rebooting" });
      subscribe();
      if (logFilter) openLog();
    };
    const detach = () => {
      logSub?.close();
      logSub = undefined;
      unsubscribe?.();
      unsubscribe = undefined;
      conn.session = undefined;
      // 换了设备或断开：画着的高亮和算好的位置都作废
      inspector.relocate();
    };
    // 调试请求不进输入队列、不阻塞消息处理：navigate 最长要 10 秒
    const webviews = async (rid: number) => {
      const s = conn.session;
      // 没配 Android 的调试（debug）也可能有 iOS 的（ios）：先看会话是哪种
      if (!s) return send(ws, { t: "webviews", rid, list: [], ...(opts.debug || opts.ios ? { error: "没有连接设备" } : {}) });
      if (!viaAdb(s)) {
        const ios = iosFor(s);
        if (!ios) return send(ws, { t: "webviews", rid, list: [], error: NO_ADB });
        return ios.inspector.list().then(
          (list) => send(ws, { t: "webviews", rid, list }),
          (e: Error) => send(ws, { t: "webviews", rid, list: [], error: `读取 iOS 页面列表失败：${e.message}` }),
        );
      }
      if (!opts.debug) return send(ws, { t: "webviews", rid, list: [] });
      if (isRebooting(s)) return send(ws, { t: "webviews", rid, list: [], error: REBOOTING });
      try {
        send(ws, { t: "webviews", rid, list: await listPages(debugFor(s.id)) });
      } catch (e) {
        send(ws, { t: "webviews", rid, list: [], ...adbFail("读取 WebView 列表失败：", e) });
      }
    };
    const findPage = async (socket: string, id: string) => {
      const s = conn.session;
      if (!s) return null;
      const ios = iosFor(s);
      if (ios) {
        const page = (await ios.inspector.list()).find((p) => p.socket === socket && p.id === id);
        return page ? { h: null, page, ios } : null;
      }
      if (!opts.debug || !viaAdb(s)) return null;
      const h = debugFor(s.id);
      const page = (await listPages(h)).find((p) => p.socket === socket && p.id === id);
      return page ? { h, page } : null;
    };
    const inspect = async (rid: number, socket: string, id: string) => {
      if (!conn.session) return send(ws, { t: "inspect", rid, error: "没有连接设备" });
      if (isRebooting(conn.session)) return send(ws, { t: "inspect", rid, error: REBOOTING });
      let found: Awaited<ReturnType<typeof findPage>>;
      try {
        found = await findPage(socket, id);
      } catch (e) {
        return send(ws, { t: "inspect", rid, ...adbFail("读取 WebView 列表失败：", e) });
      }
      if (!found) return send(ws, { t: "inspect", rid, error: "页面已关闭" });
      const { page } = found;
      const ticket = tickets.issue(page.socket, page.id);
      // 没用掉的票据 60 秒后自己过期，这里只防表无限长
      if (ticketOwners.size > 32) ticketOwners.delete(ticketOwners.keys().next().value!);
      ticketOwners.set(ticket, conn);
      // iOS：网关自己提供的 WebKit 调试界面；Android：appspot 的前端，本地页面里换成网关代理的同一份
      const appspot = "ios" in found ? undefined : inspectUrl(page, gatewayPort, ticket);
      const url = "ios" in found ? webInspectorUrl(gatewayPort, page, ticket, found.ios) : appspot && localPage ? localFrontendUrl(appspot, gatewayPort) : appspot;
      if (url) send(ws, { t: "inspect", rid, url });
      else send(ws, { t: "inspect", rid, hint: `在 chrome://inspect 里找：${page.pkg ?? page.socket} / ${page.title}` });
    };
    const navigate = async (rid: number, socket: string, id: string, address: string) => {
      const target = normalizeTarget(address);
      if ("error" in target) return send(ws, { t: "navigate", rid, ok: false, error: target.error });
      if (!conn.session) return send(ws, { t: "navigate", rid, ok: false, error: "没有连接设备" });
      if (isRebooting(conn.session)) return send(ws, { t: "navigate", rid, ok: false, error: REBOOTING });

      const timeoutMs = opts.debug?.navigateTimeoutMs ?? 12000;
      let cdp: CdpClient | undefined;
      // 防止超时和正常路径双重回复
      let replied = false;
      const reply = (r: { ok: false; error: string; code?: "adb-unresponsive" } | { ok: true; href: string; title: string; bridge: boolean }) => {
        if (replied) return;
        replied = true;
        send(ws, { t: "navigate", rid, ...r });
      };
      const fail = (error: string, code?: "adb-unresponsive") => reply({ ok: false, error, ...(code ? { code } : {}) });
      const failAdb = (prefix: string, e: unknown) => {
        const f = adbFail(prefix, e);
        fail(f.error, f.code);
      };

      const tid = setTimeout(() => { cdp?.close(); fail("页面加载超时"); }, timeoutMs);
      try {
        let found: Awaited<ReturnType<typeof findPage>>;
        try {
          found = await findPage(socket, id);
        } catch (e) {
          return failAdb("读取 WebView 列表失败：", e);
        }
        if (!found) return fail("页面已关闭");
        const { h } = found;
        // 「指向本地开发服务器」靠 adb reverse 和 CDP，iOS 模拟器没有
        if (!h) return fail(NO_ADB);
        const port = h.d.webviews.portOf(socket);
        // 设备已切走：旧设备的 reverse 已收掉，不能再建
        if (h.disposed || port === undefined) return fail("页面已关闭");
        if (target.reversePort !== undefined) {
          try {
            await h.d.reverses.ensure(target.reversePort);
          } catch (e) {
            return failAdb("adb reverse 失败：", e);
          }
        }
        try {
          cdp = await opts.debug!.connectCdp(`ws://127.0.0.1:${port}/devtools/page/${encodeURIComponent(id)}`);
        } catch (e) {
          return fail(`连不上页面的调试端口：${(e as Error).message}`);
        }
        try {
          const r = await navigateAndCheck(cdp, target.url);
          // 经 adb reverse 的端口本机没人监听时，设备侧 adb 先接受连接再关掉，WebView 报 EMPTY_RESPONSE 而不是 REFUSED（实测）
          if (!r.ok && target.reversePort !== undefined && r.error === "net::ERR_EMPTY_RESPONSE") {
            return fail(DEV_SERVER_DOWN);
          }
          reply(r);
        } finally {
          cdp.close();
        }
      } finally {
        clearTimeout(tid);
      }
    };

    // 传文件：upload 是正在收分片的那个，同一连接同一时间只有一个；收齐后交给 adb（长任务队列里排队），位置马上让出
    // 写文件按到达顺序串在 chain 上，chain 自己不会失败
    type Upload = {
      id: number; name: string; kind: "apk" | "file"; size: number; session: EmulatorSession;
      arrived: number; written: number; dir: string | null; fh: FileHandle | null; chain: Promise<void>;
      /** 不再收分片：收完了、失败了或连接断了。 */
      ended: boolean;
      idle: ReturnType<typeof setTimeout> | null;
    };
    let upload: Upload | null = null;
    let wsClosed = false;
    const uploadMsg = (id: number, state: UploadState, extra: { received?: number; error?: string } = {}) =>
      send(ws, { t: "upload", id, state, ...extra });
    const dropTemp = async (u: Upload) => {
      try {
        await u.chain;
        await u.fh?.close().catch(() => {});
        u.fh = null;
        if (u.dir) await rm(u.dir, { recursive: true, force: true }).catch((e: Error) => log(`删除临时文件失败：${e.message}`));
      } finally {
        transfers.delete(u);
      }
    };
    // 收分片阶段结束：停掉空闲计时、让出位置
    const endReceiving = (u: Upload) => {
      u.ended = true;
      if (u.idle) clearTimeout(u.idle);
      u.idle = null;
      if (upload === u) upload = null;
    };
    const abortUpload = (u: Upload, why: string) => {
      if (u.ended) return;
      endReceiving(u);
      log(`传文件 ${u.name} 中止：${why}`);
      uploadMsg(u.id, "failed", { error: why });
      void dropTemp(u);
    };
    const touchIdle = (u: Upload) => {
      if (u.idle) clearTimeout(u.idle);
      u.idle = setTimeout(() => abortUpload(u, "太久没有收到数据，已中止"), opts.files?.idleMs ?? 30_000);
    };
    const startUpload = (m: { id: number; name: string; size: number }) => {
      const fail = (error: string) => uploadMsg(m.id, "failed", { error });
      const files = opts.files;
      if (!files) return fail("这个网关不支持传文件");
      const s = conn.session;
      if (!s) return fail("没有连接设备");
      if (!viaAdb(s)) return fail(NO_ADB);
      if (isRebooting(s)) return fail(REBOOTING);
      const name = sanitizeFileName(m.name);
      if (!name) return fail("文件名不合法");
      const k = fileKind(name);
      if (k.kind === "unsupported") return fail(`暂不支持 ${k.ext}，请提供 .apk`);
      if (m.size > UPLOAD_MAX_BYTES) return fail("文件太大：最大 2 GB");
      // 页面一次只传一个：还在收的旧传输是页面已经不要了的
      if (upload) abortUpload(upload, "页面开始传下一个文件，这个已作废");
      const u: Upload = {
        id: m.id, name, kind: k.kind, size: m.size, session: s,
        arrived: 0, written: 0, dir: null, fh: null, chain: Promise.resolve(), ended: false, idle: null,
      };
      upload = u;
      transfers.add(u);
      touchIdle(u);
      log(`页面传来 ${name}（${m.size} 字节），${k.kind === "apk" ? "安装到" : "放进"} ${s.id}`);
      u.chain = (async () => {
        try {
          u.dir = await mkdtemp(join(files.tmpRoot ?? tmpdir(), UPLOAD_DIR_PREFIX));
          u.fh = await open(join(u.dir, name), "wx");
        } catch (e) {
          return abortUpload(u, `建临时文件失败：${(e as Error).message}`);
        }
        if (u.ended) return;
        uploadMsg(u.id, "uploading", { received: 0 });
        if (u.size === 0) void finishUpload(u, files);
      })();
    };
    const cancelUpload = (id: number) => {
      // 已经在装的不打断：adb 结束后照常回报并删临时文件
      if (upload?.id === id) abortUpload(upload, "页面取消了");
    };
    const onChunk = (buf: Buffer) => {
      const u = upload;
      const c = decodeUploadChunk(buf);
      // 失败之后页面还在路上的分片：不理
      if (!u || u.ended || !c) return;
      const why = checkChunk(u, c.id, c.data.byteLength);
      if (why) return abortUpload(u, why);
      touchIdle(u);
      u.arrived += c.data.byteLength;
      const data = c.data;
      u.chain = u.chain.then(async () => {
        if (u.ended || !u.fh) return;
        try {
          for (let off = 0; off < data.byteLength;) off += (await u.fh.write(data, off)).bytesWritten;
        } catch (e) {
          return abortUpload(u, `写临时文件失败：${(e as Error).message}`);
        }
        u.written += data.byteLength;
        uploadMsg(u.id, "uploading", { received: u.written });
        if (u.written === u.size) void finishUpload(u, opts.files!);
      });
    };
    const finishUpload = async (u: Upload, files: FileOps) => {
      endReceiving(u);
      await u.fh?.close().catch(() => {});
      u.fh = null;
      const path = join(u.dir!, u.name);
      const id = u.session.id;
      try {
        const s = conn.session;
        if (wsClosed) return;
        if (!s) return uploadMsg(u.id, "failed", { error: "设备已断开" });
        // 同一个设备 id（emulator-<serial>）可能已换成另一台 AVD，按会话认人
        if (s !== u.session) return uploadMsg(u.id, "failed", { error: "设备已切换，没有安装" });
        if (isRebooting(s)) return uploadMsg(u.id, "failed", { error: REBOOTING });
        uploadMsg(u.id, u.kind === "apk" ? "installing" : "pushing");
        try {
          const out = u.kind === "apk"
            ? await files.adb(id, ["install", "-r", "-t", path])
            : await files.adb(id, ["push", path, `${PUSH_DIR}/${u.name}`]);
          // 有的 adb 版本装失败也退出 0，只在输出里写 Failure
          if (u.kind === "apk" && /Failure \[/.test(out)) throw new Error(out);
          log(`${u.name} ${u.kind === "apk" ? "已安装" : `已放到 ${PUSH_DIR}`}`);
          uploadMsg(u.id, "done");
        } catch (e) {
          const error = e instanceof AdbUnresponsive ? "等了太久还没完成，已停止" : installFailure((e as Error).message).text;
          log(`${u.name} ${u.kind === "apk" ? "安装" : "放进设备"}失败：${error}`);
          uploadMsg(u.id, "failed", { error });
        }
      } finally {
        await dropTemp(u);
      }
    };

    // 不进输入队列：卡住的输入（比如 adb 粘贴等满超时）不能拖住重启；重启中的输入由 enqueue 丢掉
    const reboot = async () => {
      const s = conn.session;
      if (!s) return send(ws, { t: "error", message: "重启失败：没有连接设备" });
      if (!s.caps.reboot) return send(ws, { t: "error", message: "这台设备不支持重启" });
      if (rebooting) return send(ws, { t: "error", message: "设备正在重启，等这一轮结束再试" });
      rebooting = { id: s.id };
      log(`页面确认重启 ${s.id}`);
      const onIt = (c: Conn) => c.session === s;
      // 手机重启时会话会关掉、连接被解绑（模拟器不会），先记下这些页面，开机后接回去
      const waiting = live().filter(onIt);
      broadcast({ t: "status", state: "rebooting" }, onIt);
      // 重启后设备里的 adb reverse 和 WebView socket 都没了，旧的转发不能再用
      dropDebug(s.id);
      let result: "done" | "adb-down" | "failed";
      let error: string | undefined;
      try {
        try {
          await s.reboot();
        } catch (e) {
          // 手机：adb reboot 报错或超时多半是 USB 连接先断了，手机已经在重启；照样等开机，真没重启的话等满两分钟是 adb-down
          if (s.kind !== "phone") throw e;
          log(`${s.id} 的 adb reboot 报错（${(e as Error).message}），按已在重启处理`);
        }
        result = await (opts.rebootWait?.(s.id) ?? Promise.resolve("adb-down" as const));
      } catch (e) {
        result = "failed";
        error = (e as Error).message;
      }
      rebooting = null;
      if (liveSession(s.id)) {
        // 按 id 找：会话对象可能已经换过（比如重启期间有人切回这台），旧对象上已经没有页面了
        const onDevice = (c: Conn) => c.session?.id === s.id;
        log(`${s.id} 重启结束：${result}${error ? `（${error}）` : ""}`);
        broadcast({ t: "status", state: "connected" }, onDevice);
        broadcast({ t: "reboot", result, ...(error ? { error } : {}) }, onDevice);
        return;
      }
      const back = waiting.filter((c) => c.ws.readyState === c.ws.OPEN && !c.session);
      if (result === "done" && opts.avd && live().some((c) => !c.session)) {
        try {
          // 和插回重连一样排在换设备的链上；用户这期间切到了别的设备就不再连回来。
          // 重启期间新开的页面也在等这台手机，一起接上
          const next = await serially(async () => (pinned === s.id ? opts.avd!.use(s.id) : null));
          if (next) for (const c of live()) if (!c.session) c.attach(next);
        } catch (e) {
          result = "failed";
          error = (e as Error).message;
        }
      }
      log(`${s.id} 重启结束：${result}${error ? `（${error}）` : ""}`);
      // 没接上的页面（包括重启期间新开的）都离开「重启中」；重启结果只发给点了重启时就在的页面
      for (const c of live()) if (!c.session) send(c.ws, { t: "status", state: isPhone(s) ? "phone-closed" : "emulator-closed" });
      for (const c of back) send(c.ws, { t: "reboot", result, ...(error ? { error } : {}) });
      // 没连回来的（失败、两分钟没开机完）交还给插回重连
      reconnectPinned();
    };

    ws.on("message", async (raw, isBinary) => {
      if (isBinary && conn.helloSeen) {
        const buf = raw as Buffer;
        if (buf.byteLength >= 4 && binKind(buf) === BIN_UPLOAD) return onChunk(buf);
      }
      const m = isBinary ? null : parseClientMsg(raw.toString());
      if (!conn.helloSeen) {
        if (m?.t !== "hello") {
          ws.close(CLOSE_NO_HELLO, "expected hello");
          return;
        }
        const compat = compatibility(m.version, PROTOCOL_VERSION);
        if (compat !== "ok") {
          send(ws, { t: "error", code: compat, gatewayVersion: PROTOCOL_VERSION, upgrade: INSTALL_CMD });
          ws.close(CLOSE_VERSION, "version mismatch");
          return;
        }
        conn.helloSeen = true;
        size = { width: m.width, height: m.height };
        send(ws, { t: "gateway", level: GATEWAY_LEVEL, version: opts.version ?? "", service: opts.service === true, autoUpdate: opts.update?.autoUpdate === true });
        if (opts.setup) {
          const env = await checkEnv();
          send(ws, { t: "env", ...env });
          for (const p of installs.values()) send(ws, { t: "install", progress: p });
          if (license !== null) send(ws, { t: "licenses", licence: license });
        }
        if (opts.phones) send(ws, { t: "phones", list: opts.phones.list() });
        const mumuList = opts.mumu?.list();
        if (mumuList) send(ws, mumuMsg(mumuList));
        const iosList = opts.iosSims?.list();
        if (iosList) send(ws, { t: "iosSims", list: iosList });
        if (pinned) {
          // 掉线期间新开的页面不能被 getSession() 接到模拟器上
          const s = liveSession(pinned);
          if (s) attach(s);
          else {
            send(ws, { t: "status", state: rebooting?.id === pinned ? "rebooting" : "phone-closed" });
            // 掉线期间没有页面在，插回时没人触发重连：这个页面来了就试一次
            reconnectPinned();
          }
          return;
        }
        let failure: string | null = null;
        const session = await opts.getSession().catch((e) => {
          failure = (e as Error).message;
          log(`获取模拟器会话失败：${failure}`);
          return null;
        });
        if (ws.readyState !== ws.OPEN || conn.session) return;
        if (session) attach(session);
        else {
          send(ws, { t: "status", state: booting() ? "booting" : "no-emulator" });
          // 模拟器在运行但连不上（例如 gRPC 认证失败）时，把原因告诉页面，不要只显示“没有模拟器”
          if (failure) send(ws, { t: "error", message: `连不上模拟器：${failure}` });
        }
        return;
      }
      if (!m) {
        log(`忽略非法消息：${isBinary ? "<binary>" : raw.toString().slice(0, 200)}`);
        return;
      }
      switch (m.t) {
        case "inspectPointer":
          inspector.pointer(m as InspectPointer);
          break;
        case "touch":
          lastTouch = { x: m.x, y: m.y, down: m.down };
          enqueue("touch", (s) => s.touch(m.x, m.y, m.down));
          break;
        case "key":
          // 不收键盘的设备（iOS 模拟器）：页面点过画面后每个键都会发来，逐个报错只会刷屏，直接丢掉
          if (conn.session?.caps.input === false) break;
          // 模拟器不接受按键时页面上看起来就是“点了没反应”：把原因告诉页面，日志照旧由 enqueue 写
          enqueue("key", (s) => s.key(m.key, m.eventType).catch((e: Error) => {
            send(ws, { t: "error", message: `按键没有发出：${e.message}` });
            throw e;
          }));
          break;
        case "text":
          if (conn.session?.caps.input === false) break;
          enqueue("text", (s) => s.text(m.text));
          break;
        case "clip":
          enqueue("clip", (s) => s.setClipboard(m.text));
          break;
        case "scroll": {
          // 只有 caps.scroll 的会话（真机）收原生滚动；模拟器的滚轮由页面模拟成滑动
          const { x, y, dx, dy } = m;
          if (conn.session?.caps.scroll && conn.session.scroll) enqueue("scroll", (s) => s.scroll?.(x, y, dx, dy) ?? Promise.resolve());
          break;
        }
        case "resize":
          log(`resize ${m.width}x${m.height}`);
          size = { width: m.width, height: m.height };
          if (conn.session) subscribe();
          break;
        case "rotate":
          if (conn.session && !conn.session.caps.rotate) {
            send(ws, { t: "error", message: "这台设备不支持旋转" });
            break;
          }
          // 排进输入队列：连点两次时第二次要读到第一次转完的方向
          // 新方向由 onRotation 广播
          enqueue("rotate", (s) => s.rotate(m.dir).then(
            () => {},
            (e: Error) => send(ws, { t: "error", message: `旋转失败：${e.message}` }),
          ));
          break;
        case "pause":
          paused = true;
          subscribe();
          break;
        case "resume":
          if (!paused) break;
          paused = false;
          subscribe();
          break;
        case "hello":
          log("忽略重复的 hello");
          break;
        case "avds":
          if (!opts.avd) break;
          opts.avd.list().then(
            (list) => send(ws, { t: "avds", list }),
            (e: Error) => send(ws, { t: "error", message: `读取 AVD 列表失败：${e.message}` }),
          );
          break;
        case "start": {
          if (!opts.avd) break;
          // 名字会拼进启动参数，不合 AVD 名规则的不启动
          const bad = avdNameError(m.name, []);
          if (bad) send(ws, { t: "error", message: `设备名不对：${bad}` });
          else if (deleting.has(m.name)) send(ws, { t: "error", message: DELETING });
          else startJob(m.name);
          break;
        }
        case "stop":
          if (!opts.avd) break;
          if (!conn.session) {
            send(ws, { t: "error", message: "没有连接设备" });
            break;
          }
          if (!conn.session.caps.stop) {
            send(ws, { t: "error", message: "这台设备不支持关机" });
            break;
          }
          opts.avd.stop(conn.session.serial).catch((e: Error) => send(ws, { t: "error", message: `关闭失败：${e.message}` }));
          break;
        case "use": {
          if (!opts.avd) break;
          // 真机 id 是 adb 序列号、iOS 模拟器是 UDID，不按 AVD 名的规则检查（main.ts 的 discover 认得它们）
          const bad = usablePhone(m.name) || usableIosSim(m.name) ? null : avdNameError(m.name, []);
          if (bad) {
            send(ws, { t: "error", message: `设备名不对：${bad}` });
            break;
          }
          if (deleting.has(m.name)) {
            send(ws, { t: "error", message: DELETING });
            break;
          }
          // 手机开机动画阶段就以 device 出现了，这时切过去会抢在重启流程前面接管（重启流程开机完成后自己会连回来）
          if (rebooting?.id === m.name) {
            send(ws, { t: "error", message: REBOOTING });
            break;
          }
          let failure: string | null = null;
          const s = await useDevice(m.name).catch((e: Error) => ((failure = e.message), log(`切换到 ${m.name} 失败：${e.message}`), null));
          if (s) switchTo(s);
          else send(ws, { t: "error", message: failure ? `${m.name} 连不上：${failure}` : `${m.name} 没有在运行或没开 gRPC` });
          break;
        }
        case "install":
          void install(ws, m.ids);
          break;
        case "catalog":
          if (!opts.setup) break;
          opts.setup.catalog().then(
            (catalog) => send(ws, { t: "catalog", catalog }),
            (e: Error) => send(ws, { t: "error", message: `读取机型和系统版本失败：${e.message}` }),
          );
          break;
        case "createAvd":
          if (opts.setup) void createAvd(ws, m);
          break;
        case "acceptLicenses":
        case "rejectLicenses":
          // 回答的不是正在显示的那份（晚到的、重复点的）：不理
          if (!opts.setup || license === null || m.id !== license.id) break;
          log(`页面上的用户${m.t === "acceptLicenses" ? "同意" : "没有同意"}了许可证 ${license.name}（#${m.id}）`);
          if (m.t === "acceptLicenses") opts.setup.installer.acceptLicenses(m.id);
          else opts.setup.installer.rejectLicenses(m.id);
          setLicense(null);
          break;
        case "webviews":
          void webviews(m.rid);
          break;
        case "renameAvd": {
          if (!opts.avd) {
            send(ws, { t: "renameAvd", rid: m.rid, ok: false, error: "网关没有管理设备" });
            break;
          }
          const avd = opts.avd;
          const done = deleting.has(m.name) ? DELETING : await avd.rename(m.name, m.displayName).then(() => null, (e: Error) => e.message);
          send(ws, { t: "renameAvd", rid: m.rid, ok: done === null, ...(done === null ? {} : { error: done }) });
          // 别的页面也要看到新名字
          if (done === null) avd.list().then((list) => broadcast({ t: "avds", list }), (e: Error) => log(`改名后读取 AVD 列表失败：${e.message}`));
          break;
        }
        case "logcatOpen":
          if (!opts.logcat) {
            send(ws, { t: "error", message: "网关不支持日志" });
            break;
          }
          logFilter = m.filter;
          openLog();
          break;
        case "logcatFilter":
          logFilter = m.filter;
          if (logSub) logSub.setFilter(m.filter);
          else openLog();
          break;
        case "logcatClose":
          logFilter = null;
          logSub?.close();
          logSub = undefined;
          break;
        case "logcatApps": {
          const s = conn.session;
          const r = s && hasLogs(s) && opts.apps ? await opts.apps(s.id).catch(() => null) : null;
          send(ws, { t: "logcatApps", rid: m.rid, foreground: r?.foreground ?? null, apps: r?.apps ?? [] });
          break;
        }
        case "logcatRead": {
          const s = conn.session;
          if (!opts.logcatRead) send(ws, { t: "logcatRead", rid: m.rid, lines: [], error: "网关不支持读日志" });
          else if (!s) send(ws, { t: "logcatRead", rid: m.rid, lines: [], error: "没有连接设备" });
          else if (!hasLogs(s)) send(ws, { t: "logcatRead", rid: m.rid, lines: [], error: NO_ADB });
          else {
            await opts.logcatRead(s.id, m.filter, m.limit).then(
              (lines) => send(ws, { t: "logcatRead", rid: m.rid, lines }),
              (e: Error) => send(ws, { t: "logcatRead", rid: m.rid, lines: [], error: e instanceof AdbUnresponsive && s.kind === "phone" ? PHONE_ADB_UNRESPONSIVE : e.message }),
            );
          }
          break;
        }
        case "mumuLaunch":
          if (!opts.mumu) break;
          await opts.mumu.launch().then(
            () => log("已打开 MuMuPlayer"),
            (e: Error) => {
              log(`打开 MuMuPlayer 失败：${e.message}`);
              send(ws, { t: "error", message: `打开 MuMu 失败：${e.message}` });
            },
          );
          break;
        case "iosCatalog":
          if (!opts.iosSims?.catalog) send(ws, { t: "iosCatalog", rid: m.rid, error: "网关不支持创建 iOS 模拟器" });
          else await opts.iosSims.catalog().then(
            (catalog) => send(ws, { t: "iosCatalog", rid: m.rid, catalog }),
            (e: Error) => send(ws, { t: "iosCatalog", rid: m.rid, error: `读不到 iOS 系统版本：${e.message.split("\n")[0]}` }),
          );
          break;
        case "createIosSim":
          if (!opts.iosSims?.create) send(ws, { t: "createIosSim", rid: m.rid, error: "网关不支持创建 iOS 模拟器" });
          else await opts.iosSims.create(m.name, m.deviceType, m.runtime).then(
            (udid) => send(ws, { t: "createIosSim", rid: m.rid, udid }),
            (e: Error) => send(ws, { t: "createIosSim", rid: m.rid, error: `创建失败：${e.message.split("\n")[0]}` }),
          );
          break;
        case "iosSimOpen":
        case "iosSimClose": {
          if (!opts.iosSims) break;
          const verb = m.t === "iosSimOpen" ? "开机" : "关机";
          await (m.t === "iosSimOpen" ? opts.iosSims.open(m.udid) : opts.iosSims.close(m.udid)).then(
            () => log(`iOS 模拟器 ${m.udid} 已${verb}`),
            (e: Error) => {
              log(`iOS 模拟器 ${m.udid} ${verb}失败：${e.message}`);
              send(ws, { t: "error", message: `iOS 模拟器${verb}失败：${e.message}` });
            },
          );
          break;
        }
        case "mumuOpen":
        case "mumuClose": {
          if (!opts.mumu) break;
          const verb = m.t === "mumuOpen" ? "开机" : "关机";
          await (m.t === "mumuOpen" ? opts.mumu.open(m.index) : opts.mumu.close(m.index)).then(
            () => log(`MuMu ${m.index} 已${verb === "开机" ? "开始开机" : "开始关机"}`),
            (e: Error) => {
              log(`MuMu ${m.index} ${verb}失败：${e.message}`);
              send(ws, { t: "error", message: `MuMu ${verb}失败：${e.message}` });
            },
          );
          break;
        }
        case "stopAvd": {
          if (!opts.avd) {
            send(ws, { t: "stopAvd", rid: m.rid, ok: false, error: "网关没有管理设备" });
            break;
          }
          if (deleting.has(m.name)) {
            send(ws, { t: "stopAvd", rid: m.rid, ok: false, error: DELETING });
            break;
          }
          const failed = await stopByName(m.name);
          log(failed === null ? `已停止设备 ${m.name}` : `停止设备 ${m.name} 失败：${failed}`);
          send(ws, { t: "stopAvd", rid: m.rid, ok: failed === null, ...(failed === null ? {} : { error: failed }) });
          break;
        }
        case "deleteAvd": {
          if (!opts.avd) {
            send(ws, { t: "deleteAvd", rid: m.rid, ok: false, error: "网关没有管理设备" });
            break;
          }
          const avd = opts.avd;
          const name = m.name;
          const stopFirst = m.stop === true;
          // 失败原因给页面看；cause 里带本机路径的细节只写日志（gateway/src/avd.ts 的 deleteAvd）
          let detail = "";
          const tryDelete = async (): Promise<string | null> => {
            if (deleting.has(name)) return DELETING;
            // 开机任务进行中时发现文件可能还没写出来，AvdOps 看不出它在运行
            const booting = [...jobs].some((j) => j.name === name);
            if (booting && !stopFirst) return "这台设备正在开机，等它开机后先关闭再删除";
            deleting.add(name);
            try {
              if (stopFirst) {
                const running = (await avd.list()).find((a) => a.name === name)?.running;
                if (booting || (running !== undefined && running !== "no")) {
                  const stopped = await stopByName(name, false);
                  if (stopped !== null) return stopped;
                }
              }
              // 最后再按列表看一次：它还认 adb 里看得到、没开 gRPC 的模拟器（no-grpc）
              const info = (await avd.list()).find((a) => a.name === name);
              if (info && info.running !== "no") return "先关闭这台设备再删除";
              await avd.delete(name);
              return null;
            } catch (e) {
              const cause = (e as Error).cause;
              if (cause instanceof Error) detail = `（${cause.message}）`;
              return (e as Error).message;
            } finally {
              deleting.delete(name);
            }
          };
          const done = await tryDelete();
          log(done === null ? `已删除设备 ${m.name}` : `删除设备 ${m.name} 失败：${done}${detail}`);
          send(ws, { t: "deleteAvd", rid: m.rid, ok: done === null, ...(done === null ? {} : { error: done }) });
          if (done === null) avd.list().then((list) => broadcast({ t: "avds", list }), (e: Error) => log(`删除后读取 AVD 列表失败：${e.message}`));
          break;
        }
        case "inspect":
          void inspect(m.rid, m.socket, m.id);
          break;
        case "navigate":
          navigate(m.rid, m.socket, m.id, m.address).catch((e: Error) =>
            send(ws, { t: "navigate", rid: m.rid, ok: false, error: e.message }),
          );
          break;
        case "reboot":
          void reboot();
          break;
        case "update": {
          const u = opts.update;
          if (!u?.autoUpdate) {
            send(ws, { t: "update", state: "off" });
            break;
          }
          send(ws, { t: "update", state: "checking" });
          const r = await u.request();
          if (r.state === "restarting") broadcast({ t: "update", ...r });
          else send(ws, { t: "update", ...r });
          break;
        }
        case "upload":
          startUpload(m);
          break;
        case "uploadCancel":
          cancelUpload(m.id);
          break;
        case "screenshot": {
          // 截图返回前会话可能已退出或换了一台：按发起时的会话命名
          const s = conn.session;
          if (!s) {
            send(ws, { t: "error", message: "截图失败：没有连接设备" });
            break;
          }
          s.screenshot().then(
            (png) => {
              const device = s.avdName ?? s.id;
              const name = screenshotName(device);
              send(ws, { t: "screenshot", name, size: png.byteLength });
              // 4 字节 kind + PNG 数据
              const header = Buffer.allocUnsafe(4);
              header.writeUInt32LE(BIN_SCREENSHOT, 0);
              if (ws.readyState === ws.OPEN) ws.send(Buffer.concat([header, png]));
            },
            (e: Error) => send(ws, { t: "error", message: `截图失败：${e.message}` }),
          );
          break;
        }
      }
    });

    ws.on("close", () => {
      wsClosed = true;
      // 还在收分片的传输：删掉临时文件；已经在装的等 adb 结束后由 finishUpload 删
      if (upload && !upload.ended) abortUpload(upload, "连接断开");
      // 连接异常断开时若手指还按着，补发抬起，避免 Android 侧卡住
      if (lastTouch?.down) {
        const { x, y } = lastTouch;
        const s = conn.session;
        if (s) inputChain = inputChain.then(() => s.touch(x, y, false)).catch(() => {});
      }
      unsubscribe?.();
      unsubscribe = undefined;
      logSub?.close();
      logSub = undefined;
      conns.delete(conn);
      clearTimeout(relocateTimer);
      for (const [t, c] of ticketOwners) if (c === conn) ticketOwners.delete(t);
    });
  });

  // 设计 6.7：DEBUG=1 时每秒打印每个连接的帧统计
  const debugTimer = process.env.DEBUG === "1"
    ? setInterval(() => {
        let i = 0;
        for (const { stats: s } of conns) {
          log(`[conn ${i++}] recv/s=${s.recv} sent/s=${s.sent} dropped=${s.dropped} avgBytes=${s.sent ? Math.round(s.bytes / s.sent) : 0} emu→gw=${s.recv ? (s.lagMs / s.recv).toFixed(1) : "-"}ms`);
          s.recv = s.sent = s.bytes = s.lagMs = s.dropped = 0;
        }
      }, 1000)
    : undefined;

  await new Promise<void>((res, rej) => {
    http.once("error", rej);
    http.listen(opts.port, "127.0.0.1", () => res());
  }).catch((e) => {
    // 端口被占等 listen 失败：停掉定时器，调用方才能干净地退出或换端口
    clearInterval(ticker);
    clearInterval(debugTimer);
    throw e;
  });
  const addr = http.address();
  gatewayPort = typeof addr === "object" && addr ? addr.port : opts.port;
  return {
    port: gatewayPort,
    busy: () =>
      installing ? "正在安装 SDK"
      : booting() ? "设备正在开机"
      : deleting.size ? "正在删除设备"
      : rebooting ? "设备正在重启"
      : transfers.size ? "正在传文件"
      // 重启会断开 DevTools，而 iframe 里的票据只能用一次，前端自带的重连连不上。只在最近有操作时等：
      // 页面上有网页时控制台会自己打开，一直开着页面的话光凭“连着”更新就永远等不到（2026-11-22 实测）
      : pausedDevtools.size || (devtoolsWss.clients.size && now() - devtoolsInputAt < (opts.devtoolsIdleMs ?? DEVTOOLS_IDLE_MS)) ? "正在调试 H5"
      : null,
    notifyUpdate: (r) => broadcast({ t: "update", ...r }),
    close: async () => {
      clearInterval(debugTimer);
      clearInterval(ticker);
      dropDebug();
      for (const c of conns) c.ws.terminate();
      // 已升级但还没登记进 conns 的连接也要断，否则 wss.close 一直等它
      for (const ws of wss.clients) ws.terminate();
      for (const ws of devtoolsWss.clients) ws.terminate();
      await new Promise<void>((res) => wss.close(() => res()));
      await new Promise<void>((res) => devtoolsWss.close(() => res()));
      await new Promise<void>((res) => http.close(() => res()));
      await disposals;
    },
  };
}
