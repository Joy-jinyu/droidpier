import WebSocket, { type RawData } from "ws";
import type { WebViewPage } from "./webviews.ts";
import { inspectModeChange, type HighlightTarget } from "./inspect.ts";

/** WebSocket 关闭码：/devtools/<socket>/<pageId> 里的 socket 当前没有转发。 */
export const CLOSE_UNKNOWN_SOCKET = 4404;

const DEVTOOLS_PATH_RE = /^\/devtools\/([^/]+)\/([^/]+)(?:\/([^/]+))?$/;

/** 解析网关上的 DevTools 路径 /devtools/<socket>/<pageId>/<票据>，不是这个形状返回 null；没带票据时 ticket 为 undefined。 */
export function parseDevtoolsPath(pathname: string): { socket: string; pageId: string; ticket: string | undefined } | null {
  const m = pathname.match(DEVTOOLS_PATH_RE);
  if (!m) return null;
  try {
    return { socket: decodeURIComponent(m[1]), pageId: decodeURIComponent(m[2]), ticket: m[3] && decodeURIComponent(m[3]) };
  } catch {
    return null;
  }
}

/** 1005/1006 等保留码不能用 close() 发出去，换成 1000。 */
function sendableCode(code: number): number {
  const ok = (code >= 1000 && code <= 1014 && ![1004, 1005, 1006].includes(code)) || (code >= 3000 && code <= 4999);
  return ok ? code : 1000;
}

/** 网关自己插进调试会话的命令从这个编号开始，前端的编号从 1 往上数，碰不到；这些命令的回复不转给前端。 */
const OWN_ID_BASE = 1_000_000_000;
const OWN_ID_RE = /"id":\d{10}\b/;

/** proxyDevtools 返回的句柄：在前端的调试会话里替网关发命令。 */
export type DevtoolsSession = {
  /** 发一条 CDP 命令，回复只给网关；会话关了或页面报错时 reject。 */
  send(method: string, params?: object): Promise<any>;
};

/** 前端发给页面的一条消息里的高亮请求：highlightNode 给节点，hideHighlight 给 null，别的消息、坏 JSON 给 undefined。 */
export function highlightRequest(text: string): HighlightTarget | null | undefined {
  let m: any;
  try {
    m = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (m?.method === "Overlay.hideHighlight") return null;
  if (m?.method !== "Overlay.highlightNode") return undefined;
  const p = m.params ?? {};
  const req: HighlightTarget = {};
  if (typeof p.nodeId === "number") req.nodeId = p.nodeId;
  if (typeof p.backendNodeId === "number") req.backendNodeId = p.backendNodeId;
  if (typeof p.objectId === "string") req.objectId = p.objectId;
  if (p.highlightConfig && typeof p.highlightConfig === "object") req.config = p.highlightConfig;
  return req;
}

/**
 * 把客户端连接和 WebView 的 DevTools WebSocket 双向接起来，任一端关闭另一端跟着关闭。
 * 连上游时不带 Origin：WebView 的 DevTools 端点对带任何 Origin 的握手都回 403（2026-11-11 实测）。
 * onInspectMode：DevTools 的“选择元素”模式开关时调用（gateway/src/inspect.ts），连接关闭时按关处理。
 * onHighlight：前端要高亮一个节点（Overlay.highlightNode）时给节点和 highlightConfig，取消高亮（Overlay.hideHighlight）时给 null；
 * 网关据此在页面的设备画面上自己画（有的 WebView 收到这些命令不画，2026-11-17 三星 WebView 99 实测）。
 *
 * 安全：这条通道能完全控制 App 里的网页，调用前必须已在升级时核过 Origin 和票据（server.ts）。
 */
export function proxyDevtools(client: WebSocket, upstreamUrl: string, hooks: { onInspectMode?: (on: boolean) => void; onHighlight?: (req: HighlightTarget | null) => void } = {}): DevtoolsSession {
  const upstream = new WebSocket(upstreamUrl, { perMessageDeflate: false });
  // 上游握手完成前客户端就可能发消息，先排队
  const pending: Array<{ data: RawData | string; isBinary: boolean }> = [];
  let nextId = OWN_ID_BASE;
  const own = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  let inspecting = false;
  const setInspect = (on: boolean) => {
    if (on === inspecting) return;
    inspecting = on;
    hooks.onInspectMode?.(on);
  };
  const toUpstream = (data: RawData | string, isBinary: boolean) => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
    else if (upstream.readyState === WebSocket.CONNECTING) pending.push({ data, isBinary });
    else return false;
    return true;
  };

  upstream.on("open", () => {
    for (const m of pending) upstream.send(m.data, { binary: m.isBinary });
    pending.length = 0;
  });
  // 只解析可能相关的消息：DevTools 的流量很大（Network、Console），不能每条都 JSON.parse
  client.on("message", (data, isBinary) => {
    if (!isBinary) {
      const text = data.toString();
      if (text.includes('"Overlay.setInspectMode"')) {
        const on = inspectModeChange(true, text);
        if (on !== null) setInspect(on);
      } else if (hooks.onHighlight && (text.includes('"Overlay.highlightNode"') || text.includes('"Overlay.hideHighlight"'))) {
        const req = highlightRequest(text);
        if (req !== undefined) hooks.onHighlight(req);
      }
    }
    toUpstream(data, isBinary);
  });
  upstream.on("message", (data, isBinary) => {
    if (!isBinary) {
      const text = data.toString();
      // 只有网关自己的回复才解析编号：先粗筛，免得每条消息都 JSON.parse
      if (own.size && OWN_ID_RE.test(text.slice(0, 64))) {
        try {
          const m = JSON.parse(text);
          const p = own.get(m.id);
          if (p) {
            own.delete(m.id);
            if (m.error) p.reject(new Error(m.error.message ?? "CDP 出错"));
            else p.resolve(m.result);
            return;
          }
        } catch {}
      }
      if (text.includes('"Overlay.inspectModeCanceled"')) {
        const on = inspectModeChange(false, text);
        if (on !== null) setInspect(on);
      }
    }
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
  });

  const closeOther = (other: WebSocket, code: number, reason: Buffer) => {
    if (other.readyState === WebSocket.CONNECTING) other.terminate();
    else if (other.readyState === WebSocket.OPEN) other.close(sendableCode(code), reason);
  };
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    for (const p of own.values()) p.reject(new Error("DevTools 连接已关闭"));
    own.clear();
    setInspect(false);
  };
  client.on("close", (code, reason) => { closeOther(upstream, code, reason); end(); });
  upstream.on("close", (code, reason) => { closeOther(client, code, reason); end(); });
  client.on("error", () => client.terminate());
  upstream.on("error", () => {
    upstream.terminate();
    if (client.readyState === WebSocket.OPEN) client.close(1011, "devtools upstream error");
  });

  return {
    send(method, params = {}) {
      if (ended) return Promise.reject(new Error("DevTools 连接已关闭"));
      const id = nextId++;
      return new Promise((resolve, reject) => {
        own.set(id, { resolve, reject });
        if (!toUpstream(JSON.stringify({ id, method, params }), false)) {
          own.delete(id);
          reject(new Error("DevTools 连接已关闭"));
        }
      });
    },
  };
}

const FRONTEND_HOST = "chrome-devtools-frontend.appspot.com";
/** DevTools 前端（iframe）连网关时带的 Origin。 */
export const DEVTOOLS_FRONTEND_ORIGIN = `https://${FRONTEND_HOST}`;

/** 把 page.frontendUrl 里 ws= 的值换成经网关代理、带票据的地址，inspector.html 换成 devtools_app.html，其他部分不变。
 * frontendUrl 来自设备，任何 App 都能伪造：只有 https://chrome-devtools-frontend.appspot.com 上、查询串带 ws= 的才给地址，否则返回 undefined。 */
export function inspectUrl(page: WebViewPage, gatewayPort: number, ticket: string): string | undefined {
  if (!page.frontendUrl) return undefined;
  let u: URL;
  try {
    u = new URL(page.frontendUrl);
  } catch {
    return undefined;
  }
  if (u.protocol !== "https:" || u.hostname !== FRONTEND_HOST || !u.searchParams.has("ws")) return undefined;
  const target = `127.0.0.1:${gatewayPort}/devtools/${encodeURIComponent(page.socket)}/${encodeURIComponent(page.id)}/${ticket}`;
  u.search = u.search.replace(/([?&])ws=[^&]*/, (_m, sep: string) => `${sep}ws=${target}`);
  // inspector.html 左侧带设备画面镜像（screencast），页面自己已经显示了模拟器画面；同一版本的 devtools_app.html 没有这块
  u.pathname = u.pathname.replace(/\/inspector\.html$/, "/devtools_app.html");
  return u.toString();
}

/** 网关代理 DevTools 前端的路径前缀：/devtools-frontend/<appspot 上的路径>。 */
export const LOCAL_FRONTEND_PATH = "/devtools-frontend/";
/** 只代理 appspot 上带版本号的前端文件（serve_rev / serve_file / serve_internal_file 下的 @<版本>/…）。 */
const FRONTEND_FILE_RE = /^(serve_rev|serve_file|serve_internal_file)\/@[0-9a-f]{6,64}\/[A-Za-z0-9._\-/]+$/;

/**
 * 网关自己提供的页面（--local，http://127.0.0.1:<端口>/app/）里，appspot 的 iframe 连不上本机：顶层页面就是本机地址，
 * Chrome 不会为它弹「本地网络」授权，iframe 连 127.0.0.1 一律被拦（2026-11-22 实测，公网页面不受影响）。
 * 这时把前端换成经网关代理的同一份文件，iframe 和网关同源，就不算公网连本机了。
 */
export function localFrontendUrl(url: string, gatewayPort: number): string {
  const u = new URL(url);
  return `http://127.0.0.1:${gatewayPort}${LOCAL_FRONTEND_PATH}${u.pathname.replace(/^\//, "")}${u.search}`;
}

/** /devtools-frontend/ 下的相对路径 → appspot 上的地址；不是带版本号的前端文件时返回 null。 */
export function frontendFileUrl(rel: string): string | null {
  return FRONTEND_FILE_RE.test(rel) && !rel.split("/").includes("..") ? `${DEVTOOLS_FRONTEND_ORIGIN}/${rel}` : null;
}
