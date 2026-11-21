/** 嵌入 iframe 前再核一次：只认 https://chrome-devtools-frontend.appspot.com（或网关代理的同一份，http://127.0.0.1:<端口>/devtools-frontend/），且 ws 连回本网关的 /devtools/<socket>/<页面>/<票据>。网关的 inspectUrl 是第一道关。 */
export function isDevtoolsSrc(src: string, gatewayPort: string): boolean {
  let u: URL;
  try {
    u = new URL(src);
  } catch {
    return false;
  }
  const ws = u.searchParams.get("ws") ?? "";
  const prefix = `127.0.0.1:${gatewayPort}/devtools/`;
  // 网关自己提供的页面里，前端经网关代理（gateway/src/devtools-proxy.ts 的 localFrontendUrl）
  const local = u.protocol === "http:" && u.host === `127.0.0.1:${gatewayPort}` && u.pathname.startsWith("/devtools-frontend/");
  return (local || (u.protocol === "https:" && u.hostname === "chrome-devtools-frontend.appspot.com"))
    && ws.startsWith(prefix)
    && /^[^/]+\/[^/]+\/[^/]+$/.test(ws.slice(prefix.length));
}
