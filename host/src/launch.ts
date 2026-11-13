/** 网关默认端口，同 gateway/src/page-url.ts 的 DEFAULT_PORT。 */
export const DEFAULT_GATEWAY_PORT = 7300;

/** 连不上网关时页面该显示什么；retry 表示照常重连；old-gateway 是还要启动口令的旧网关（以 4001 拒绝 hello）。 */
export type Failure = "lna-denied" | "old-gateway" | "bad-origin" | "outdated" | "no-gateway" | "retry";

const LNA_ATTEMPTS = 3;

/** 读出 `#port=7306`（也接受不带 #）；没有端口或端口不合法返回 null。旧链接里的 token 不管。 */
export function parsePort(s: string): number | null {
  const raw = new URLSearchParams(s.replace(/^#/, "")).get("port");
  const port = Number(raw);
  if (!raw || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return port;
}

/** 只支持 Chrome 和 Edge；Safari、Firefox 没有 userAgentData，传 undefined。 */
export function isSupportedBrowser(brands: { brand: string }[] | undefined): boolean {
  return !!brands?.some((b) => b.brand === "Google Chrome" || b.brand === "Microsoft Edge");
}

/** 页面是不是本机地址打开的（网关自己托管的保底页面）。 */
export function isLoopbackHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

/** 网关端口：#port → 网关自己托管的本机页面用页面端口 → 7300。不记上次的端口：记了会在换回默认端口后一直连旧端口。 */
export function gatewayPort(input: { hashPort: number | null; loc: { protocol: string; hostname: string; port: string } }): number {
  const { hashPort, loc } = input;
  if (hashPort !== null) return hashPort;
  if (loc.protocol === "http:" && isLoopbackHost(loc.hostname) && loc.port) return Number(loc.port);
  return DEFAULT_GATEWAY_PORT;
}

/**
 * 一次连接关闭后判断原因。opened 是这一条连接连上过没有；attempts 是上次连上之后连续失败的次数（含这次）。
 * 公网页面连本机被 Chrome 的“访问本地网络”拒绝时，WebSocket 只报普通的 1006，跟网关没开分不开，只能按连续失败次数推断。
 */
export function classifyFailure(input: { opened: boolean; closeCode?: number; pageIsPublic: boolean; attempts: number }): Failure {
  if (input.closeCode === 4001) return "old-gateway";
  if (input.closeCode === 4002) return "outdated";
  if (input.closeCode === 4003) return "bad-origin";
  if (!input.opened && input.pageIsPublic && input.attempts >= LNA_ATTEMPTS) return "lna-denied";
  if (!input.opened && !input.pageIsPublic) return "no-gateway";
  return "retry";
}

/**
 * WebSocket 没连上时问一下网关的 /healthz：HTTP 有回应（no-cors 拿不到内容，但不会失败）说明网关在，只是没接受这条 WebSocket，
 * 比如浏览器不是 Chrome / Edge 的网络进程、经过了本机代理（gateway/src/peer.ts）。超时、连不上都算没回应；超时要短于重连间隔（1 秒）。
 */
export async function gatewayAnswers(fetchFn: typeof fetch, port: number, timeoutMs = 800): Promise<boolean> {
  try {
    await fetchFn(`http://127.0.0.1:${port}/healthz`, { mode: "no-cors", cache: "no-store", signal: AbortSignal.timeout(timeoutMs), targetAddressSpace: "loopback" } as RequestInit);
    return true;
  } catch {
    return false;
  }
}

/** 本地网络权限的状态；查不到（浏览器不认这个权限名）是 null。 */
export type LocalPermission = "denied" | "prompt" | "granted" | null;

/** lna-denied 只是“公网页面连不上本机”的推断，用权限状态细分：拒绝、权限框还没点、已允许或查不到（当成网关没开）。其他结果原样返回。 */
export function refineLocalFailure<F extends Failure>(kind: F, permission: LocalPermission): F | "lna-prompt" | "no-gateway" {
  if (kind !== "lna-denied") return kind;
  if (permission === "denied") return kind;
  if (permission === "prompt") return "lna-prompt";
  return "no-gateway";
}
