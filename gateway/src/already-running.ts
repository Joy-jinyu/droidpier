// 端口已被占用时：看看占着的是不是另一个 droidpier，给出该怎么做
import { createServer } from "node:net";
import { INSTALL_CMD } from "../../shared/protocol.ts";

/** 占着端口的程序。version 为 null 表示认得出是 droidpier 但它没报版本（加 /healthz 之前的版本）；service 表示它是后台服务；pid 是旧版没有的。 */
export type PortHolder = { kind: "droidpier"; version: string | null; service?: boolean; pid?: number } | { kind: "other" };

/** 端口被占时要打印的话和退出码；code 0 表示另一个 droidpier 已在运行，照常打开页面即可。 */
export function busyPortReport(o: { port: number; pageUrl: string; ownVersion: string; running: PortHolder }): { code: 0 | 1; lines: string[] } {
  if (o.running.kind === "other") {
    const alt = o.port + 1;
    return {
      code: 1,
      lines: [
        `端口 ${o.port} 被别的程序占用了，droidpier 没有启动。换一个端口：`,
        `  droidpier --port ${alt}`,
        `  或者：${INSTALL_CMD} -s -- --port ${alt}`,
      ],
    };
  }
  const service = o.running.service === true;
  const lines = service
    ? [`droidpier 已经在后台运行（端口 ${o.port}）`, o.pageUrl, "停止后台运行：droidpier stop"]
    : [`droidpier 已经在运行（端口 ${o.port}）`, o.pageUrl];
  // 版本是构建时间（ISO 字符串，scripts/build-binary.ts 写入），可以直接按字符串比；开发时自己没有版本，不判断
  const v = o.running.version;
  if (o.ownVersion && (v === null || v < o.ownVersion)) {
    lines.push(service ? "新版本已装好，运行 droidpier start 重启后台服务即可更新" : "新版本已装好，停掉正在运行的 droidpier 后再运行一次即可更新");
  }
  return { code: 0, lines };
}

async function get(url: string, timeoutMs: number): Promise<Response | null> {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return null;
  }
}

/** 问一下占着端口的程序：先看 /healthz，没有的话看 /app/ 的标题（旧版网关只有页面）。 */
export async function probePort(port: number, timeoutMs = 1500): Promise<PortHolder> {
  const base = `http://127.0.0.1:${port}`;
  const h = await get(`${base}/healthz`, timeoutMs);
  if (h?.ok) {
    const body = (await h.json().catch(() => null)) as { app?: unknown; version?: unknown; service?: unknown; pid?: unknown } | null;
    if (body?.app === "droidpier") {
      const holder: PortHolder = { kind: "droidpier", version: typeof body.version === "string" && body.version ? body.version : null, service: body.service === true };
      if (typeof body.pid === "number") holder.pid = body.pid;
      return holder;
    }
  }
  const page = await get(`${base}/app/`, timeoutMs);
  const html = page?.ok ? await page.text().catch(() => "") : "";
  return html.includes("<title>Droidpier</title>") ? { kind: "droidpier", version: null } : { kind: "other" };
}

/** listen 报 EADDRINUSE 后调用：探测占用者，返回要打印的话和退出码。 */
export async function explainBusyPort(o: { port: number; pageUrl: string; ownVersion: string; timeoutMs?: number }) {
  return busyPortReport({ ...o, running: await probePort(o.port, o.timeoutMs) });
}

/** 试着绑一下端口（和网关一样只绑 127.0.0.1），绑得上就马上放掉。 */
function portFree(port: number): Promise<boolean> {
  return new Promise((res) => {
    const s = createServer();
    s.once("error", () => res(false));
    s.listen(port, "127.0.0.1", () => s.close(() => res(true)));
  });
}

/** 端口空着返回 null，被占就探测是谁占着。 */
export async function portHolder(port: number, timeoutMs?: number): Promise<PortHolder | null> {
  return (await portFree(port)) ? null : probePort(port, timeoutMs);
}

/** 网关启动前先看端口：空着返回 null；被占就探测占用者，返回要打印的话和退出码。 */
export async function checkPortFirst(o: { port: number; pageUrl: string; ownVersion: string; timeoutMs?: number }) {
  const running = await portHolder(o.port, o.timeoutMs);
  return running ? busyPortReport({ ...o, running }) : null;
}
