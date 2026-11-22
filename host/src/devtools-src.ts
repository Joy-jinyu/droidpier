/**
 * 嵌入 iframe 前再核一次，网关的 inspectUrl / webInspectorUrl 是第一道关。只认三种：
 * Chrome 官方前端 https://chrome-devtools-frontend.appspot.com，或网关代理的同一份（http://127.0.0.1:<端口>/devtools-frontend/），
 * ws 连回本网关的 /devtools/<socket>/<页面>/<票据>；
 * iOS 模拟器用的 WebKit 前端 http://127.0.0.1:<端口>/webinspector/Main.html，ws 连回 /webinspector/ws/<应用>/<页面>/<票据>。
 */
export function isDevtoolsSrc(src: string, gatewayPort: string): boolean {
  let u: URL;
  try {
    u = new URL(src);
  } catch {
    return false;
  }
  const ws = u.searchParams.get("ws") ?? "";
  const gateway = u.protocol === "http:" && u.host === `127.0.0.1:${gatewayPort}`;
  if (gateway && u.pathname.startsWith("/webinspector/")) {
    const iosPrefix = `127.0.0.1:${gatewayPort}/webinspector/ws/`;
    return u.pathname === "/webinspector/Main.html" && ws.startsWith(iosPrefix) && /^[^/]+\/[^/]+\/[^/]+$/.test(ws.slice(iosPrefix.length));
  }
  const prefix = `127.0.0.1:${gatewayPort}/devtools/`;
  // 网关自己提供的页面里，前端经网关代理（gateway/src/devtools-proxy.ts 的 localFrontendUrl）
  const local = gateway && u.pathname.startsWith("/devtools-frontend/");
  return (local || (u.protocol === "https:" && u.hostname === "chrome-devtools-frontend.appspot.com"))
    && ws.startsWith(prefix)
    && /^[^/]+\/[^/]+\/[^/]+$/.test(ws.slice(prefix.length));
}
