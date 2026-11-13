import { createServer } from "node:http";
import { mkdtemp, open, readFile, rm, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { LatestFrame } from "./latest-frame.ts";
import { CLOSE_UNKNOWN_SOCKET, DEVTOOLS_FRONTEND_ORIGIN, inspectUrl, parseDevtoolsPath, proxyDevtools } from "./devtools-proxy.ts";
import { checkUpgrade, createTickets, type Tickets } from "./auth.ts";
import { DEV_SERVER_DOWN, navigateAndCheck, type CdpClient } from "./cdp.ts";
import { normalizeTarget } from "../../shared/target-url.ts";
import type { EmulatorSession } from "./emulator.ts";
import type { StartJob } from "./lifecycle.ts";
import type { Installer } from "./installer.ts";
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
  INSTALL_CMD,
  parseClientMsg,
  PROTOCOL_VERSION,
  type AvdCatalog,
  type AvdInfo,
  type AvdSpec,
  type EnvReport,
  type FrameHeader,
  type InstallProgress,
  type Licence,
  NEEDS_JAVA,
  type ServerMsg,
  type UploadState,
  type WebViewPage,
} from "../../shared/protocol.ts";

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
};

/** WebView 调试依赖。forDevice 每台设备只调一次，换设备或设备退出时网关关掉旧的。 */
export type DebugDeps = {
  forDevice(serial: number): DeviceDebug;
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
  adb(serial: number, args: string[]): Promise<string>;
  /** 临时文件建在这下面，默认 os.tmpdir()。 */
  tmpRoot?: string;
  /** 收分片阶段多久没有新分片就中止，默认 30 秒。 */
  idleMs?: number;
};

/** 网页模拟器所在路径，staticDir 的内容在这下面提供。 */
const APP_PATH = "/app/";

/** 启动网关的 HTTP + WebSocket 服务，只监听 127.0.0.1。 */
export async function startServer(opts: {
  port: number;
  /** 允许连模拟器协议的页面 Origin；/devtools/ 另外允许 DevTools 前端的 Origin。 */
  allowedOrigins: string[];
  /** DevTools 票据；不传时网关自己建一个。测试注入后可以直接签发、控制过期。 */
  tickets?: Tickets;
  staticDir: string;
  getSession: () => Promise<EmulatorSession | null>;
  avd?: AvdOps;
  debug?: DebugDeps;
  setup?: SetupOps;
  /** WebView 调试 socket → 本机转发端口；不传时用当前设备的 debug.webviews，都没有时 /devtools/ 连接一律 4404。 */
  portOf?: (socket: string) => number | undefined;
  files?: FileOps;
  /** 发出重启指令后等开机完成；不传时不等，直接按 adb-down 结束。 */
  rebootWait?: (serial: number) => Promise<"done" | "adb-down">;
  /** 开机进度广播和无会话时重新发现的间隔，默认 1000ms。 */
  pollMs?: number;
  log?: (s: string) => void;
  /** /healthz 报的网关版本；另一个 droidpier 启动时靠它判断谁更新（gateway/src/already-running.ts）。 */
  version?: string;
  /** 由 launchd 拉起的后台服务；/healthz 报给前台再运行的 droidpier，让它说明怎么停（gateway/src/already-running.ts）。 */
  service?: boolean;
}): Promise<{ port: number; close(): Promise<void> }> {
  const log = opts.log ?? ((s: string) => console.log(s));
  const root = resolve(opts.staticDir);
  const conns = new Set<Conn>();
  const watched = new WeakSet<EmulatorSession>();
  const jobs = new Set<StartJob>();
  // 正在删除的 AVD：删完之前同名的启动、切换、改名、再删都拒绝
  const deleting = new Set<string>();
  const DELETING = "正在删除这台设备";
  let gatewayPort = opts.port;
  const tickets = opts.tickets ?? createTickets();

  // 当前设备的调试工具：首次用到时创建，换设备、设备退出、网关关闭时收掉
  type Debug = { serial: number; d: DeviceDebug; disposed: boolean; listing?: Promise<WebViewPage[]>; proxies: Set<WebSocket> };
  let debug: Debug | undefined;
  let disposals: Promise<void> = Promise.resolve();
  const dropDebug = (serial?: number) => {
    const cur = debug;
    if (!cur || (serial !== undefined && cur.serial !== serial)) return;
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
  const debugFor = (serial: number): Debug => {
    if (debug?.serial === serial) return debug;
    dropDebug();
    debug = { serial, d: opts.debug!.forDevice(serial), disposed: false, proxies: new Set() };
    return debug;
  };
  // 同一设备的并发 list 共用一次：两次同时跑会给同一个 socket 各建一个转发
  const listPages = (h: Debug) => (h.listing ??= h.d.webviews.list().finally(() => (h.listing = undefined)));

  const http = createServer(async (req, res) => {
    let rel: string;
    try {
      rel = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (rel === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ app: "droidpier", version: opts.version ?? "", service: opts.service === true, pid: process.pid }));
      return;
    }
    if (rel === "/" || rel === APP_PATH.slice(0, -1)) {
      res.writeHead(302, { location: APP_PATH }).end();
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
  http.on("upgrade", (req, socket, head) => {
    let path: string;
    try {
      path = new URL(req.url ?? "/", "http://x").pathname;
    } catch {
      socket.destroy();
      return;
    }
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
      proxyDevtools(ws, `ws://127.0.0.1:${port}/devtools/page/${encodeURIComponent(target.pageId)}`);
    });
  });
  // adb 无响应统一成一句话并带 code，页面据此给出“重启模拟器”；其他失败照旧加前缀
  const adbFail = (prefix: string, e: unknown): { error: string; code?: "adb-unresponsive" } =>
    e instanceof AdbUnresponsive ? { error: e.message, code: "adb-unresponsive" } : { error: `${prefix}${(e as Error).message}` };
  // 正在重启的设备：同时只有一台、一次
  let rebooting: { serial: number } | null = null;
  const isRebooting = (s: EmulatorSession) => rebooting?.serial === s.serial;
  const REBOOTING = "模拟器正在重启，等它开机后再试";
  const send = (ws: WebSocket, m: ServerMsg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
  };
  const live = () => [...conns].filter((c) => c.helloSeen && c.ws.readyState === c.ws.OPEN);
  const broadcast = (m: ServerMsg, only: (c: Conn) => boolean = () => true) => {
    for (const c of live()) if (only(c)) send(c.ws, m);
  };
  const booting = () => [...jobs].some((j) => j.progress === "spawning" || j.progress === "booting");
  const sendBoot = (j: StartJob) => broadcast({ t: "boot", name: j.name, progress: j.progress, ...(j.error ? { error: j.error } : {}) });
  const switchTo = (s: EmulatorSession) => {
    if (debug && debug.serial !== s.serial) dropDebug();
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
      }
    });
    s.onClipboard((text) => {
      for (const c of live()) if (c.session === s) send(c.ws, { t: "clip", text });
    });
    s.onClosed(() => {
      dropDebug(s.serial);
      for (const c of conns) {
        if (c.session !== s) continue;
        c.detach();
        send(c.ws, { t: "status", state: "emulator-closed" });
      }
    });
  };

  const startJob = (name: string) => {
    const job = opts.avd!.start(name);
    if (!jobs.has(job)) {
      jobs.add(job);
      job.done.then(
        async () => {
          jobs.delete(job);
          sendBoot(job);
          const s = await opts.avd!.use(job.name).catch((e: Error) => (log(`接管 ${job.name} 失败：${e.message}`), null));
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
      androidCli: false, javaHome: null, freeMb: 0, avdFreeMb: 0, sameDisk: true,
    };
  });
  const javaMissing = (env: EnvReport, ids: string[]) =>
    env.missing.some((m) => m.id === "java") && ids.some((id) => (NEEDS_JAVA as readonly string[]).includes(id))
      ? env.missing.find((m) => m.id === "java")!.detail
      : null;
  const spaceShort = (items: Parameters<typeof spaceCheck>[0], env: EnvReport) => {
    const { shortMb } = spaceCheck(items, env);
    return shortMb > 0 ? `磁盘空间不足：还需要约 ${gbText(shortMb)}` : null;
  };
  // 安装和建设备共用：先占住 installing，再按 check 给的理由拒绝或开始
  const runChecked = async (ws: WebSocket, what: string, check: () => Promise<{ reason: string } | { ids: string[]; spec?: AvdSpec }>) => {
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
    log(`页面确认${what}：${r.ids.join(", ")}${r.spec ? `（${r.spec.name} · ${r.spec.device} · ${r.spec.image}）` : ""}`);
    setup.installer.run(
      r.ids,
      (p) => {
        installs.set(p.id, p);
        if (p.phase !== "license") setLicense(null);
        broadcast({ t: "install", progress: p });
      },
      (l) => setLicense(l),
      r.spec,
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
      const reason = env.error ?? javaMissing(env, ids) ?? spaceShort(env.missing.filter((m) => ids.includes(m.id)), env);
      return reason ? { reason } : { ids };
    });
  };
  const createAvd = (ws: WebSocket, m: { name: string; device: string; image: string }) =>
    runChecked(ws, "创建设备", async () => {
      const [env, cat] = await Promise.all([checkEnv(), opts.setup!.catalog()]);
      const image = cat.images.find((i) => i.pkg === m.image);
      const ids = [...(image && !image.installed ? ["system-image"] : []), "avd"];
      const reason = env.error
        ?? (cat.needTools ? "需要先安装命令行工具（cmdline-tools）才能创建设备" : null)
        ?? javaMissing(env, ids)
        ?? (cat.devices.some((d) => d.id === m.device) ? null : `没有这个机型：${m.device}`)
        ?? (image ? null : `没有这个系统版本：${m.image}`)
        ?? avdNameError(m.name, cat.existing)
        ?? spaceShort(createItems(image!), env);
      if (reason) return { reason };
      return { ids, spec: { name: m.name, device: m.device, image: image!.pkg, ramMb: ramMbFor(image!.apiLevel) } };
    });

  // 每个周期：广播进行中的开机进度；没有在开机时，给没会话的连接重新发现模拟器（接管外部启动的）
  let polling = false;
  const ticker = setInterval(async () => {
    for (const j of jobs) sendBoot(j);
    if (polling || booting()) return;
    if (!live().some((c) => !c.session)) return;
    polling = true;
    try {
      const s = await opts.getSession().catch(() => null);
      if (s) for (const c of live()) if (!c.session) c.attach(s);
    } finally {
      polling = false;
    }
  }, opts.pollMs ?? 1000);

  wss.on("connection", (ws) => {
    const conn: Conn = {
      ws,
      helloSeen: false,
      attach: (s) => attach(s),
      resubscribe: () => subscribe(),
      detach: () => detach(),
      stats: { recv: 0, sent: 0, bytes: 0, lagMs: 0, dropped: 0 },
    };
    conns.add(conn);
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
    const attach = (s: EmulatorSession) => {
      conn.session = s;
      // 按着的手指属于旧会话，新会话里没有按下
      lastTouch = null;
      watch(s);
      send(ws, { t: "ready", version: PROTOCOL_VERSION, device: s.device, serial: s.serial });
      send(ws, { t: "orientation", rotation: s.rotation });
      if (isRebooting(s)) send(ws, { t: "status", state: "rebooting" });
      subscribe();
    };
    const detach = () => {
      unsubscribe?.();
      unsubscribe = undefined;
      conn.session = undefined;
    };
    // 调试请求不进输入队列、不阻塞消息处理：navigate 最长要 10 秒
    const webviews = async (rid: number) => {
      const s = conn.session;
      if (!opts.debug) return send(ws, { t: "webviews", rid, list: [] });
      if (!s) return send(ws, { t: "webviews", rid, list: [], error: "没有连接设备" });
      if (isRebooting(s)) return send(ws, { t: "webviews", rid, list: [], error: REBOOTING });
      try {
        send(ws, { t: "webviews", rid, list: await listPages(debugFor(s.serial)) });
      } catch (e) {
        send(ws, { t: "webviews", rid, list: [], ...adbFail("读取 WebView 列表失败：", e) });
      }
    };
    const findPage = async (socket: string, id: string) => {
      const s = conn.session;
      if (!opts.debug || !s) return null;
      const h = debugFor(s.serial);
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
      const url = inspectUrl(page, gatewayPort, tickets.issue(page.socket, page.id));
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
      await u.chain;
      await u.fh?.close().catch(() => {});
      u.fh = null;
      if (u.dir) await rm(u.dir, { recursive: true, force: true }).catch((e: Error) => log(`删除临时文件失败：${e.message}`));
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
      touchIdle(u);
      log(`页面传来 ${name}（${m.size} 字节），${k.kind === "apk" ? "安装到" : "放进"} emulator-${s.serial}`);
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
      const serial = u.session.serial;
      try {
        const s = conn.session;
        if (wsClosed) return;
        if (!s) return uploadMsg(u.id, "failed", { error: "设备已断开" });
        // 同一个 emulator-<serial> 可能已换成另一台 AVD，按会话认人
        if (s !== u.session) return uploadMsg(u.id, "failed", { error: "设备已切换，没有安装" });
        if (isRebooting(s)) return uploadMsg(u.id, "failed", { error: REBOOTING });
        uploadMsg(u.id, u.kind === "apk" ? "installing" : "pushing");
        try {
          const out = u.kind === "apk"
            ? await files.adb(serial, ["install", "-r", "-t", path])
            : await files.adb(serial, ["push", path, `${PUSH_DIR}/${u.name}`]);
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
      if (rebooting) return send(ws, { t: "error", message: "模拟器正在重启，等这一轮结束再试" });
      rebooting = { serial: s.serial };
      log(`页面确认重启 emulator-${s.serial}`);
      const onIt = (c: Conn) => c.session === s;
      broadcast({ t: "status", state: "rebooting" }, onIt);
      // 重启后设备里的 adb reverse 和 WebView socket 都没了，旧的转发不能再用
      dropDebug(s.serial);
      let result: "done" | "adb-down" | "failed";
      let error: string | undefined;
      try {
        await s.reboot();
        result = await (opts.rebootWait?.(s.serial) ?? Promise.resolve("adb-down" as const));
      } catch (e) {
        result = "failed";
        error = (e as Error).message;
      }
      rebooting = null;
      log(`emulator-${s.serial} 重启结束：${result}${error ? `（${error}）` : ""}`);
      broadcast({ t: "status", state: "connected" }, onIt);
      broadcast({ t: "reboot", result, ...(error ? { error } : {}) }, onIt);
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
        if (opts.setup) {
          const env = await checkEnv();
          send(ws, { t: "env", ...env });
          for (const p of installs.values()) send(ws, { t: "install", progress: p });
          if (license !== null) send(ws, { t: "licenses", licence: license });
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
        case "touch":
          lastTouch = { x: m.x, y: m.y, down: m.down };
          enqueue("touch", (s) => s.touch(m.x, m.y, m.down));
          break;
        case "key":
          enqueue("key", (s) => s.key(m.key, m.eventType));
          break;
        case "text":
          enqueue("text", (s) => s.text(m.text));
          break;
        case "clip":
          enqueue("clip", (s) => s.setClipboard(m.text));
          break;
        case "resize":
          log(`resize ${m.width}x${m.height}`);
          size = { width: m.width, height: m.height };
          if (conn.session) subscribe();
          break;
        case "rotate":
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
        case "start":
          if (!opts.avd) break;
          if (deleting.has(m.name)) send(ws, { t: "error", message: DELETING });
          else startJob(m.name);
          break;
        case "stop":
          if (!opts.avd) break;
          if (!conn.session) {
            send(ws, { t: "error", message: "没有连接设备" });
            break;
          }
          opts.avd.stop(conn.session.serial).catch((e: Error) => send(ws, { t: "error", message: `关闭失败：${e.message}` }));
          break;
        case "use": {
          if (!opts.avd) break;
          if (deleting.has(m.name)) {
            send(ws, { t: "error", message: DELETING });
            break;
          }
          let failure: string | null = null;
          const s = await opts.avd.use(m.name).catch((e: Error) => ((failure = e.message), log(`切换到 ${m.name} 失败：${e.message}`), null));
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
        case "deleteAvd": {
          if (!opts.avd) {
            send(ws, { t: "deleteAvd", rid: m.rid, ok: false, error: "网关没有管理设备" });
            break;
          }
          const avd = opts.avd;
          const name = m.name;
          const tryDelete = async (): Promise<string | null> => {
            if (deleting.has(name)) return DELETING;
            // 开机任务进行中时发现文件可能还没写出来，AvdOps 看不出它在运行
            if ([...jobs].some((j) => j.name === name)) return "这台设备正在开机，等它开机后先关闭再删除";
            deleting.add(name);
            try {
              // 最后再按列表看一次：它还认 adb 里看得到、没开 gRPC 的模拟器（no-grpc）
              const info = (await avd.list()).find((a) => a.name === name);
              if (info && info.running !== "no") return "先关闭这台设备再删除";
              await avd.delete(name);
              return null;
            } catch (e) {
              return (e as Error).message;
            } finally {
              deleting.delete(name);
            }
          };
          const done = await tryDelete();
          log(done === null ? `已删除设备 ${m.name}` : `删除设备 ${m.name} 失败：${done}`);
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
        case "upload":
          startUpload(m);
          break;
        case "uploadCancel":
          cancelUpload(m.id);
          break;
        case "screenshot": {
          if (!conn.session) {
            send(ws, { t: "error", message: "截图失败：没有连接设备" });
            break;
          }
          conn.session.screenshot().then(
            (png) => {
              const device = conn.session!.avdName ?? `emulator-${conn.session!.serial}`;
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
      conns.delete(conn);
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
