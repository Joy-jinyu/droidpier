import WebSocket, { type RawData } from "ws";
import type { WebViewPage } from "./webviews.ts";

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

/**
 * 把客户端连接和 WebView 的 DevTools WebSocket 双向接起来，任一端关闭另一端跟着关闭。
 * 连上游时不带 Origin：WebView 的 DevTools 端点对带任何 Origin 的握手都回 403（2026-11-11 实测）。
 *
 * 安全：这条通道能完全控制 App 里的网页，调用前必须已在升级时核过 Origin 和票据（server.ts）。
 */
export function proxyDevtools(client: WebSocket, upstreamUrl: string): void {
  const upstream = new WebSocket(upstreamUrl, { perMessageDeflate: false });
  // 上游握手完成前客户端就可能发消息，先排队
  const pending: Array<{ data: RawData; isBinary: boolean }> = [];

  upstream.on("open", () => {
    for (const m of pending) upstream.send(m.data, { binary: m.isBinary });
    pending.length = 0;
  });
  client.on("message", (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
    else if (upstream.readyState === WebSocket.CONNECTING) pending.push({ data, isBinary });
  });
  upstream.on("message", (data, isBinary) => {
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
  });

  const closeOther = (other: WebSocket, code: number, reason: Buffer) => {
    if (other.readyState === WebSocket.CONNECTING) other.terminate();
    else if (other.readyState === WebSocket.OPEN) other.close(sendableCode(code), reason);
  };
  client.on("close", (code, reason) => closeOther(upstream, code, reason));
  upstream.on("close", (code, reason) => closeOther(client, code, reason));
  client.on("error", () => client.terminate());
  upstream.on("error", () => {
    upstream.terminate();
    if (client.readyState === WebSocket.OPEN) client.close(1011, "devtools upstream error");
  });
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
