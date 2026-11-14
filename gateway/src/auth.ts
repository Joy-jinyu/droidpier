import { randomBytes } from "node:crypto";
import { OFFICIAL_ORIGIN } from "../../shared/protocol.ts";

// scripts/build-binary.ts 打包时把 DROIDPIER_PUBLIC_ORIGIN 替换成构建用的 PUBLIC_ORIGIN；直接用源码跑时没有
declare const DROIDPIER_PUBLIC_ORIGIN: string | undefined;

/** 公网页面的 Origin：打包时定下，没定就是官方的。网关只信任这一个公网页面。 */
export const PUBLIC_ORIGIN = typeof DROIDPIER_PUBLIC_ORIGIN === "string" ? DROIDPIER_PUBLIC_ORIGIN : OFFICIAL_ORIGIN;

/** 允许连 WebSocket 的页面来源：公网入口（有的话）、127.0.0.1 和 localhost 上的网关端口，再加上启动参数临时给的来源。 */
export function allowedOrigins(publicOrigin: string | null, port: number, extra: string[] = []): string[] {
  return [...(publicOrigin ? [publicOrigin] : []), `http://127.0.0.1:${port}`, `http://localhost:${port}`, ...extra];
}

/** 是不是浏览器 Origin 头的写法：scheme://host[:port]，不带路径，默认端口不写。 */
export function isOrigin(s: string): boolean {
  try {
    const u = new URL(s);
    return (u.protocol === "http:" || u.protocol === "https:") && u.origin === s;
  } catch {
    return false;
  }
}

/**
 * 能不能当公网页面的来源（构建时的 PUBLIC_ORIGIN）：只认 https，明文页面谁都能在路上换掉；
 * 只在本机试的 http://127.0.0.1 和 http://*.localhost（浏览器直接解析到本机）例外。
 */
export function isPublicOrigin(s: string): boolean {
  if (!isOrigin(s)) return false;
  const u = new URL(s);
  return u.protocol === "https:" || u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname.endsWith(".localhost");
}

/** 升级请求的 Origin 是否在白名单里。浏览器一定会带 Origin，没带的一律拒绝。 */
export function checkUpgrade(origin: string | undefined, allowed: string[]): boolean {
  return origin !== undefined && allowed.includes(origin);
}

/** Host 头只认 127.0.0.1:<端口> 和 localhost:<端口>：别的域名解析到 127.0.0.1（DNS rebinding）时浏览器带的是那个域名，读不到网关的回复。 */
export function checkHost(host: string | undefined, port: number): boolean {
  const h = host?.toLowerCase();
  return h === `127.0.0.1:${port}` || h === `localhost:${port}`;
}

/** DevTools 票据：iframe 里的前端发不了 hello，靠 inspect 回复里签发的一次性票据鉴权。 */
export type Tickets = {
  issue(socket: string, pageId: string): string;
  /** 票据对、没过期、绑定的是这个页面才返回 true；不管结果如何，交上来的票据都作废。 */
  take(ticket: string, socket: string, pageId: string): boolean;
};

export function createTickets(opts: { ttlMs?: number; now?: () => number } = {}): Tickets {
  const ttlMs = opts.ttlMs ?? 60_000;
  const now = opts.now ?? Date.now;
  const live = new Map<string, { socket: string; pageId: string; expires: number }>();
  return {
    issue(socket, pageId) {
      const t = now();
      for (const [k, v] of live) if (v.expires <= t) live.delete(k);
      const ticket = randomBytes(16).toString("base64url");
      live.set(ticket, { socket, pageId, expires: t + ttlMs });
      return ticket;
    },
    take(ticket, socket, pageId) {
      const v = live.get(ticket);
      live.delete(ticket);
      return !!v && v.expires > now() && v.socket === socket && v.pageId === pageId;
    },
  };
}
