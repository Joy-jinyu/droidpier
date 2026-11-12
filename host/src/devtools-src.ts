/** 嵌入 iframe 前再核一次：只认 https://chrome-devtools-frontend.appspot.com，且 ws 连回本网关的 /devtools/<socket>/<页面>/<票据>。网关的 inspectUrl 是第一道关。 */
export function isDevtoolsSrc(src: string, gatewayPort: string): boolean {
  let u: URL;
  try {
    u = new URL(src);
  } catch {
    return false;
  }
  const ws = u.searchParams.get("ws") ?? "";
  const prefix = `127.0.0.1:${gatewayPort}/devtools/`;
  return u.protocol === "https:"
    && u.hostname === "chrome-devtools-frontend.appspot.com"
    && ws.startsWith(prefix)
    && /^[^/]+\/[^/]+\/[^/]+$/.test(ws.slice(prefix.length));
}
