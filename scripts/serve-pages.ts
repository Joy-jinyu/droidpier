// 本地按 Cloudflare Pages 的规则提供 dist/pages：读 _headers 加响应头，目录给 index.html，找不到给 404.html
// 用法：node scripts/serve-pages.ts [目录，默认 dist/pages] [--port 7351]
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export type HeaderRule = { pattern: string; set: [string, string][]; detach: string[] };

/** 解析 `_headers`：顶格行是路径模式，缩进行是 `Name: value` 或 `! Name`，`#` 开头是注释。 */
export function parseHeaders(text: string): HeaderRule[] {
  const rules: HeaderRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (!/^\s/.test(raw)) {
      rules.push({ pattern: line, set: [], detach: [] });
      continue;
    }
    const rule = rules.at(-1);
    if (!rule) throw new Error(`_headers：头部行之前没有路径模式：${line}`);
    if (line.startsWith("!")) {
      rule.detach.push(line.slice(1).trim().toLowerCase());
      continue;
    }
    const colon = line.indexOf(":");
    if (colon <= 0) throw new Error(`_headers：无法解析的行：${line}`);
    rule.set.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
  }
  return rules;
}

/** `*` 匹配任意字符（可跨 `/`、可为空），`:name` 匹配一段，其余按字面，整条路径都要匹配上。 */
function matches(pattern: string, path: string): boolean {
  const re = pattern
    .split(/(\*|:[A-Za-z]\w*)/)
    .map((p) => (p === "*" ? ".*" : p.startsWith(":") && p.length > 1 ? "[^/]+" : p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(`^${re}$`).test(path);
}

/**
 * 某个路径最终的响应头，头名小写。按文件顺序处理匹配的规则：先删本条 `! Name` 列的头，再加本条的头，
 * 同名头再次出现时用 `, ` 追加（同 workers-sdk pages-shared/asset-server/handler.ts 的 attachHeaders）。
 */
export function headersFor(rules: HeaderRule[], path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rule of rules.filter((r) => matches(r.pattern, path))) {
    for (const name of rule.detach) delete out[name];
    for (const [name, value] of rule.set) {
      const key = name.toLowerCase();
      out[key] = key in out ? `${out[key]}, ${value}` : value;
    }
  }
  return out;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".sh": "text/plain; charset=utf-8",
};

export async function servePages(dir: string, port: number): Promise<{ url: string; close(): Promise<void> }> {
  const root = resolve(dir);
  const rules = existsSync(join(root, "_headers")) ? parseHeaders(readFileSync(join(root, "_headers"), "utf8")) : [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    let path: string;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      return void res.writeHead(400).end();
    }
    const file = normalize(join(root, path));
    if (!file.startsWith(root + sep) && file !== root) return void res.writeHead(403).end();
    let target: string | null = null;
    if (path !== "/_headers" && existsSync(file)) {
      if (statSync(file).isDirectory()) {
        if (!path.endsWith("/")) return void res.writeHead(308, { location: `${path}/${url.search}`, ...headersFor(rules, path) }).end();
        if (existsSync(join(file, "index.html"))) target = join(file, "index.html");
      } else target = file;
    }
    const status = target ? 200 : 404;
    target ??= join(root, "404.html");
    if (!existsSync(target)) return void res.writeHead(404, headersFor(rules, path)).end();
    res.writeHead(status, { ...headersFor(rules, path), "content-type": TYPES[extname(target)] ?? "application/octet-stream", "content-length": statSync(target).size });
    if (req.method === "HEAD") return void res.end();
    createReadStream(target).pipe(res);
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  const actual = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${actual}`, close: () => new Promise((r) => server.close(() => r())) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const portAt = args.indexOf("--port");
  const port = portAt >= 0 ? Number(args[portAt + 1]) : 7351;
  const dir = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--port") ?? fileURLToPath(new URL("../dist/pages", import.meta.url));
  const s = await servePages(dir, port);
  console.log(`serve-pages: ${s.url}  (${dir})`);
}
