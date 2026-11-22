// iOS 模拟器的 H5 调试：连模拟器里的 webinspectord_sim（Safari「开发」菜单用的同一个接口），列出可调试的页面，
// 为 WebKit 自己的调试界面（系统里的 WebInspectorUI.framework，gateway/src/server.ts 在 /webinspector/ 下提供）转发消息。
// 接口是 4 字节大端长度 + 二进制 plist 的 RPC，选择子和键名照 ios_webkit_debug_proxy 的 rpc.c（2026-11-22 iOS 27 模拟器实测）
import { randomUUID } from "node:crypto";
import type { Duplex } from "node:stream";
import type { WebViewPage } from "../../shared/protocol.ts";
import { decode, encode, type Plist } from "./bplist.ts";

type Dict = { [k: string]: Plist };

/** 一个页面的调试通道：前端发来的协议消息原样交给页面，页面的回复和事件原样交给前端。 */
export type InspectorChannel = { send(message: string): void; onMessage(cb: (message: string) => void): void; onClose(cb: () => void): void; close(): void };

/** WebInspectorUI 里有 iOS 13.0–27.0 各版本的命令表（Protocol/Legacy/iOS/<版本>）：取不超过模拟器版本的最大一个。 */
export function legacyProtocolVersion(runtime: string, available: string[]): string | null {
  const num = (v: string) => v.split(".").map(Number);
  const cmp = (a: string, b: string) => {
    const [x, y] = [num(a), num(b)];
    return x[0] - y[0] || (x[1] ?? 0) - (y[1] ?? 0);
  };
  const want = /(\d+\.\d+)/.exec(runtime)?.[1];
  if (!want) return null;
  const ok = available.filter((v) => /^\d+\.\d+$/.test(v) && cmp(v, want) <= 0).sort(cmp);
  return ok.at(-1) ?? null;
}

/** 把字节流切成消息：4 字节大端长度 + bplist。 */
export function createWirParser(onMessage: (selector: string, arg: Dict) => void) {
  let buf: Buffer = Buffer.alloc(0);
  return (chunk: Buffer) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    while (buf.length >= 4) {
      const n = buf.readUInt32BE(0);
      if (buf.length < 4 + n) break;
      const body = buf.subarray(4, 4 + n);
      buf = buf.subarray(4 + n);
      let msg: Plist;
      try {
        msg = decode(body);
      } catch {
        continue;
      }
      if (msg && typeof msg === "object" && !Array.isArray(msg) && !Buffer.isBuffer(msg) && typeof msg.__selector === "string") {
        const arg = msg.__argument;
        onMessage(msg.__selector, arg && typeof arg === "object" && !Array.isArray(arg) && !Buffer.isBuffer(arg) ? arg : {});
      }
    }
  };
}

export function wirFrame(selector: string, arg: Dict): Buffer {
  const body = encode({ __selector: selector, __argument: arg });
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length);
  return Buffer.concat([head, body]);
}

const LIST_WAIT_MS = 1500;
const PROBE_WAIT_MS = 1200;
const str = (v: Plist | undefined) => (typeof v === "string" ? v : "");

/**
 * 应用在不在前台：WIRIsApplicationActiveKey 0 是后台（2026-11-22 实测：回到主屏的 App 是 0，前台的 Safari、App 是 2）。
 * 没这个键的旧系统当前台。
 */
export function appInForeground(app: Dict): boolean {
  return app.WIRIsApplicationActiveKey !== 0;
}

/**
 * 一台模拟器的调试连接。connect 给出到 webinspectord_sim 的 socket（测试里换成假的）。
 * 页面在列表里的 socket 字段是应用 id（PID:123 这种），id 是页面编号，和 Android 的「socket + 页面 id」对得上。
 */
export function createIosInspector(deps: { connect: () => Promise<Duplex>; log?: (s: string) => void }) {
  const log = deps.log ?? (() => {});
  const conn = randomUUID().toUpperCase();
  let sock: Duplex | null = null;
  let connecting: Promise<Duplex> | null = null;
  const handlers = new Set<(selector: string, arg: Dict) => void>();
  // 发送者 → 通道：页面的数据带着 WIRDestinationKey（就是建通道时的 WIRSenderKey）
  // probe：list 问可见性用的临时通道，前端要连同一页面时先关掉它
  const channels = new Map<string, { appId: string; pageId: string; probe: boolean; deliver(m: string): void; closed(): void; cancel(): void }>();

  const dispatch = (selector: string, arg: Dict) => {
    if (selector === "_rpc_applicationSentData:") {
      const ch = channels.get(str(arg.WIRDestinationKey));
      const data = arg.WIRMessageDataKey;
      if (ch && Buffer.isBuffer(data)) ch.deliver(data.toString("utf8"));
    } else if (selector === "_rpc_applicationDisconnected:") {
      // 应用退出：它的通道断了，页面那边会重新列表
      const gone = str(arg.WIRApplicationIdentifierKey);
      for (const ch of [...channels.values()]) if (ch.appId === gone) ch.closed();
    }
    for (const h of handlers) h(selector, arg);
  };

  const ensure = (): Promise<Duplex> => {
    if (sock) return Promise.resolve(sock);
    connecting ??= deps.connect().then((s) => {
      sock = s;
      connecting = null;
      s.on("data", createWirParser(dispatch));
      const gone = () => {
        if (sock !== s) return;
        sock = null;
        for (const ch of channels.values()) ch.closed();
        channels.clear();
      };
      s.on("close", gone);
      s.on("error", (e: Error) => {
        log(`iOS 调试接口出错：${e.message}`);
        gone();
      });
      s.write(wirFrame("_rpc_reportIdentifier:", { WIRConnectionIdentifierKey: conn }));
      return s;
    }, (e: Error) => {
      connecting = null;
      throw e;
    });
    return connecting;
  };
  const send = async (selector: string, arg: Dict) => (await ensure()).write(wirFrame(selector, { WIRConnectionIdentifierKey: conn, ...arg }));
  const waitFor = (selector: string, pred: (a: Dict) => boolean, ms: number) =>
    new Promise<Dict | null>((resolve) => {
      const h = (s: string, a: Dict) => {
        if (s !== selector || !pred(a)) return;
        clearTimeout(t);
        handlers.delete(h);
        resolve(a);
      };
      const t = setTimeout(() => {
        handlers.delete(h);
        resolve(null);
      }, ms);
      handlers.add(h);
    });

  /**
   * 页面现在显示没有：临时连上页面问 document.visibilityState。列表里没有可见性，不问的话 Safari 后台标签、
   * App 里藏着的 about:blank WebView 都当成前台，控制台会自动接到看不见的页面上，高亮也画在那儿（2026-11-22 实测）。
   * 页面正被调试着、探测中途被前端接走、没回话时返回 null：不知道
   */
  const probeVisible = async (appId: string, pageId: string): Promise<boolean | null> => {
    // 正调试着的页面不能再连：新连接会把前端那条顶掉，关的时候页面就没有调试连接了（2026-11-22 实测前端的命令从此不再有回话）
    if ([...channels.values()].some((c) => c.appId === appId && c.pageId === pageId && !c.probe)) return null;
    let ch: InspectorChannel;
    try {
      ch = await openChannel(appId, pageId, true);
    } catch {
      return null;
    }
    return new Promise<boolean | null>((resolve) => {
      let settled = false;
      // 先定结果再关通道：关通道会触发 onClose，再进来一次
      const done = (v: boolean | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        resolve(v);
        ch.close();
      };
      const t = setTimeout(() => done(null), PROBE_WAIT_MS);
      ch.onClose(() => done(null));
      ch.onMessage((m) => {
        let msg: { method?: string; params?: { targetInfo?: { targetId?: string; type?: string }; message?: string } };
        try {
          msg = JSON.parse(m);
        } catch {
          return;
        }
        const info = msg.params?.targetInfo;
        if (msg.method === "Target.targetCreated" && info?.targetId && info.type === "page") {
          const inner = { id: 1, method: "Runtime.evaluate", params: { expression: "document.visibilityState", returnByValue: true } };
          ch.send(JSON.stringify({ id: 1, method: "Target.sendMessageToTarget", params: { targetId: info.targetId, message: JSON.stringify(inner) } }));
        } else if (msg.method === "Target.dispatchMessageFromTarget" && msg.params?.message) {
          try {
            const r = JSON.parse(msg.params.message) as { id?: number; result?: { result?: { value?: unknown } } };
            if (r.id === 1) done(r.result?.result?.value === "visible" ? true : r.result?.result?.value === "hidden" ? false : null);
          } catch {
            // 不是这条回话
          }
        }
      });
    });
  };

  const openChannel = async (appId: string, pageId: string, probe: boolean): Promise<InspectorChannel> => {
    // 前端要连的页面上还有探测通道：先关掉（DidClose 先于下面的 Setup 发出），免得探测关的时候把前端这条一起断了
    if (!probe) for (const c of [...channels.values()]) if (c.probe && c.appId === appId && c.pageId === pageId) c.cancel();
    const sender = randomUUID().toUpperCase();
    const base = { WIRApplicationIdentifierKey: appId, WIRPageIdentifierKey: Number(pageId), WIRSenderKey: sender };
    const msgCbs: Array<(m: string) => void> = [];
    const closeCbs: Array<() => void> = [];
    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      channels.delete(sender);
      for (const cb of closeCbs) cb();
    };
    // 前端连上之前到的消息（Target.targetCreated 等）先存着，onMessage 挂上时一次交出去
    const early: string[] = [];
    const close = () => {
      if (closed) return;
      void send("_rpc_forwardDidClose:", base).catch(() => {});
      finish();
    };
    channels.set(sender, {
      appId,
      pageId,
      probe,
      deliver: (m) => (msgCbs.length ? msgCbs.forEach((cb) => cb(m)) : early.push(m)),
      closed: finish,
      cancel: close,
    });
    try {
      await send("_rpc_forwardSocketSetup:", { ...base, WIRAutomaticallyPause: false });
    } catch (e) {
      // 连不上调试接口：不留表项
      channels.delete(sender);
      throw e;
    }
    return {
      send: (message) => {
        if (!closed) void send("_rpc_forwardSocketData:", { ...base, WIRSocketDataKey: Buffer.from(message, "utf8") }).catch(() => finish());
      },
      onMessage: (cb) => {
        msgCbs.push(cb);
        for (const m of early.splice(0)) cb(m);
      },
      onClose: (cb) => void closeCbs.push(cb),
      close,
    };
  };

  /** 给这个页面建调试通道。 */
  const open = (appId: string, pageId: string) => openChannel(appId, pageId, false);

  const listOnce = async (): Promise<WebViewPage[]> => {
    const apps = waitFor("_rpc_reportConnectedApplicationList:", () => true, LIST_WAIT_MS);
    await send("_rpc_getConnectedApplications:", {});
    const dict = (await apps)?.WIRApplicationDictionaryKey;
    const appList = dict && typeof dict === "object" && !Array.isArray(dict) && !Buffer.isBuffer(dict) ? Object.values(dict) : [];
    const pages: WebViewPage[] = [];
    // 别人（Mac 上的 Safari 调试器等）正连着的页面：列表里带着对方的 WIRConnectionIdentifierKey，不去探测，免得把它顶掉
    const taken = new Set<WebViewPage>();
    await Promise.all(appList.map(async (app) => {
      if (!app || typeof app !== "object" || Array.isArray(app) || Buffer.isBuffer(app)) return;
      const appId = str(app.WIRApplicationIdentifierKey);
      if (!appId) return;
      const listing = waitFor("_rpc_applicationSentListing:", (a) => a.WIRApplicationIdentifierKey === appId, LIST_WAIT_MS);
      await send("_rpc_forwardGetListing:", { WIRApplicationIdentifierKey: appId });
      const l = (await listing)?.WIRListingKey;
      if (!l || typeof l !== "object" || Array.isArray(l) || Buffer.isBuffer(l)) return;
      for (const p of Object.values(l)) {
        if (!p || typeof p !== "object" || Array.isArray(p) || Buffer.isBuffer(p)) continue;
        // 只要网页：WIRTypeJavaScript（JSContext）这类前端用不了 web-page 模式
        if (str(p.WIRTypeKey) && str(p.WIRTypeKey) !== "WIRTypeWebPage" && str(p.WIRTypeKey) !== "WIRTypeWeb") continue;
        const id = p.WIRPageIdentifierKey;
        if (typeof id !== "number") continue;
        const page: WebViewPage = {
          socket: appId,
          id: String(id),
          title: str(p.WIRTitleKey),
          url: str(p.WIRURLKey),
          pkg: str(app.WIRApplicationBundleIdentifierKey) || str(app.WIRApplicationNameKey) || undefined,
          visible: appInForeground(app),
        };
        const owner = str(p.WIRConnectionIdentifierKey);
        if (owner && owner !== conn) taken.add(page);
        pages.push(page);
      }
    }));
    // 前台应用里的页面再逐个问一遍：问不出来（正被调试着、没回话）就当可见
    await Promise.all(pages.map(async (p) => {
      if (p.visible && !taken.has(p)) p.visible = (await probeVisible(p.socket, p.id)) ?? true;
    }));
    return pages;
  };
  // 同时来的几次 list 共用一次：并发探测时后一次会把前一次的探测通道当成「正调试着」，把后台页面报成可见
  let listing: Promise<WebViewPage[]> | null = null;

  return {
    /** 所有应用里可调试的网页（Safari 标签、App 里开了 isInspectable 的 WKWebView）。 */
    list(): Promise<WebViewPage[]> {
      listing ??= listOnce().finally(() => (listing = null));
      return listing;
    },
    open,
    /** 断开到模拟器的连接（会话关掉时）。 */
    close() {
      for (const ch of channels.values()) ch.closed();
      channels.clear();
      sock?.destroy();
      sock = null;
    },
  };
}

export type IosInspector = ReturnType<typeof createIosInspector>;
