import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

/** `_headers` 里的一条规则：路径模式 + 要加的头 + 要摘掉的头 */
export interface HeaderRule {
  pattern: string;
  set: [name: string, value: string][];
  detach: string[];
}

/**
 * 按 Cloudflare Pages 的 `_headers` 语法解析：不缩进的行是路径模式，缩进行是 `Name: value`
 * 或 `! Name`（摘掉其他规则加上的同名头），`#` 开头是注释。
 */
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

/**
 * Cloudflare Pages 的路径模式（同 workers-sdk asset-worker/src/utils/rules-engine.ts 的 generateRuleRegExp）：
 * `*`（splat）匹配任意字符，可以跨 `/`、可以为空；
 * `:name` 匹配一个路径段（不含 `/`）；其余字符按字面匹配，整条路径都要匹配上。
 */
export function matchesPattern(pattern: string, path: string): boolean {
  const re = pattern
    .split(/(\*|:[A-Za-z]\w*)/)
    .map((part) => {
      if (part === "*") return ".*";
      if (part.startsWith(":") && part.length > 1) return "[^/]+";
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  return new RegExp(`^${re}$`).test(path);
}

/**
 * 算出某个路径最终的响应头，照 Cloudflare 的实现（workers-sdk pages-shared/asset-server/handler.ts 的
 * attachHeaders）：按文件顺序逐条处理匹配的规则，先删掉本条 `! Name` 列出的头（删的是前面规则已加上的），
 * 再加本条的头；同名头第二次出现时用 `, ` 追加。头名统一转小写返回。
 */
export function headersFor(rules: HeaderRule[], path: string): Record<string, string> {
  const out: Record<string, string> = {};
  const seen = new Set<string>();
  for (const rule of rules.filter((r) => matchesPattern(r.pattern, path))) {
    for (const name of rule.detach) delete out[name];
    for (const [name, value] of rule.set) {
      const key = name.toLowerCase();
      out[key] = seen.has(key) && key in out ? `${out[key]}, ${value}` : value;
      seen.add(key);
    }
  }
  return out;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
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
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".xml": "application/xml",
};

/**
 * 用 dist 目录起一个本地静态服务器，按 dist/_headers 给每个响应加头，模拟 Cloudflare Pages：
 * 目录返回 index.html，不带斜杠的目录 308 到带斜杠，找不到返回 404.html，`_headers` 本身不对外提供，
 * 支持 Range（视频要用）。
 */
export async function serveWithHeaders(rootDir: string, port = 0): Promise<{ url: string; close: () => Promise<void> }> {
  const root = resolve(rootDir);
  const headersFile = join(root, "_headers");
  const rules = existsSync(headersFile) ? parseHeaders(readFileSync(headersFile, "utf-8")) : [];

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    let path: string;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    const file = normalize(join(root, path));
    if (!file.startsWith(root + sep) && file !== root) {
      res.writeHead(403).end();
      return;
    }

    let target: string | null = null;
    let status = 200;
    if (path !== "/_headers" && existsSync(file)) {
      if (statSync(file).isDirectory()) {
        if (!path.endsWith("/")) {
          res.writeHead(308, { location: path + "/" + url.search, ...headersFor(rules, path) }).end();
          return;
        }
        if (existsSync(join(file, "index.html"))) target = join(file, "index.html");
      } else {
        target = file;
      }
    }
    if (!target) {
      status = 404;
      target = join(root, "404.html");
    }

    const size = statSync(target).size;
    const headers: Record<string, string | number> = {
      ...headersFor(rules, path),
      "content-type": TYPES[extname(target)] ?? "application/octet-stream",
      "accept-ranges": "bytes",
    };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    if (status === 200 && range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : size - Number(range[2]);
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start > end || start >= size) {
        res.writeHead(416, { ...headers, "content-range": `bytes */${size}` }).end();
        return;
      }
      res.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
      if (req.method === "HEAD") return void res.end();
      createReadStream(target, { start, end }).pipe(res);
      return;
    }
    res.writeHead(status, { ...headers, "content-length": size });
    if (req.method === "HEAD") return void res.end();
    createReadStream(target).pipe(res);
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const addr = server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : port;
  return {
    url: `http://127.0.0.1:${actualPort}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
