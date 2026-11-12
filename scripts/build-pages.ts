// 拼出 Cloudflare Pages 的部署目录 dist/pages：官网 dist 在根目录，本仓库的 nsh 页面产物放 /app/，
// 下载文件放 /download/，install.sh 放根目录
// 用法：node scripts/build-pages.ts <官网 dist 目录>（先跑 build:bin，它会顺带生成页面产物和下载文件）
import { cp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { headersFor, parseHeaders } from "./serve-pages.ts";

export const DOWNLOAD_NAME = "droidpier-darwin-arm64";
const DEVTOOLS_ORIGIN = "https://chrome-devtools-frontend.appspot.com";
const GATEWAY_WS = "ws://127.0.0.1:*";
// Cloudflare Pages 单个文件上限 25 MiB
const PAGES_FILE_LIMIT = 25 * 2 ** 20;

export type PagesInput = { siteDist: string; appDir: string; downloadDir: string; installSh: string; out: string };

export async function buildPages(p: PagesInput): Promise<void> {
  await rm(p.out, { recursive: true, force: true });
  await mkdir(p.out, { recursive: true });
  // 官网 dist 里可能已经有旧的 /app/，换成本仓库刚打包的
  await cp(p.siteDist, p.out, { recursive: true, filter: (src) => relative(p.siteDist, src).split("/")[0] !== "app" });
  // .br / .gz 是给能发预压缩文件的服务器用的，Pages 自己压缩
  await cp(p.appDir, join(p.out, "app"), { recursive: true, filter: (src) => !/\.(br|gz)$/.test(src) });
  await mkdir(join(p.out, "download"));
  for (const f of [`${DOWNLOAD_NAME}.tar.xz`, `${DOWNLOAD_NAME}.tar.xz.sha256`]) await cp(join(p.downloadDir, f), join(p.out, "download", f));
  await cp(p.installSh, join(p.out, "install.sh"));
}

type Directives = Map<string, string[]>;
const parseCsp = (csp: string): Directives =>
  new Map(
    csp
      .split(";")
      .map((d) => d.trim().split(/\s+/))
      .filter((d) => d[0])
      .map(([name, ...v]) => [name.toLowerCase(), v]),
  );
const sourcesFor = (d: Directives, chain: string[]) => chain.map((n) => d.get(n)).find((v) => v !== undefined);

/** 页面在 /app/ 下要的东西，CSP 没放行的列出来；没有 CSP 就没有限制。 */
export function appCspProblems(csp: string): string[] {
  const d = parseCsp(csp);
  const problems: string[] = [];
  const connect = sourcesFor(d, ["connect-src", "default-src"]);
  if (connect && !connect.includes(GATEWAY_WS)) problems.push(`connect-src 没有 ${GATEWAY_WS}：页面连不上本机网关`);
  const frame = sourcesFor(d, ["frame-src", "child-src", "default-src"]);
  if (frame && !frame.includes(DEVTOOLS_ORIGIN)) problems.push(`frame-src 没有 ${DEVTOOLS_ORIGIN}：嵌入的 DevTools 打不开`);
  return problems;
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

/** 部署目录有问题就逐条返回，空数组表示可以部署。 */
export async function checkPages(out: string): Promise<string[]> {
  const problems: string[] = [];
  const xz = `download/${DOWNLOAD_NAME}.tar.xz`;
  for (const f of ["index.html", "_headers", "app/index.html", xz, `${xz}.sha256`, "install.sh"]) {
    if (!existsSync(join(out, f))) problems.push(`缺 ${f}`);
  }
  if (existsSync(join(out, xz)) && existsSync(join(out, `${xz}.sha256`))) {
    const want = (await readFile(join(out, `${xz}.sha256`), "utf8")).split(/\s+/)[0];
    const got = createHash("sha256").update(await readFile(join(out, xz))).digest("hex");
    if (want !== got) problems.push(`${xz} 的 sha256 是 ${got}，.sha256 文件里写的是 ${want}`);
  }
  for await (const f of walk(out)) {
    const rel = relative(out, f);
    if ((await stat(f)).size > PAGES_FILE_LIMIT) problems.push(`${rel} 超过 Cloudflare Pages 单文件上限 25 MiB`);
    if (rel.startsWith("app/") && /\.(br|gz)$/.test(rel)) problems.push(`${rel}：/app/ 不该带预压缩文件`);
  }
  if (existsSync(join(out, "_headers"))) {
    const rules = parseHeaders(await readFile(join(out, "_headers"), "utf8"));
    for (const path of ["/app/", "/app/index.html"]) {
      for (const p of appCspProblems(headersFor(rules, path)["content-security-policy"] ?? "")) problems.push(`_headers 里 ${path} 的 CSP ${p}`);
    }
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const siteDist = process.argv[2];
  if (!siteDist) {
    console.error("用法：node scripts/build-pages.ts <官网 dist 目录>");
    process.exit(1);
  }
  const root = fileURLToPath(new URL("..", import.meta.url));
  const input: PagesInput = {
    siteDist: resolve(siteDist),
    appDir: join(root, ".nsh/out/Droidpier"),
    downloadDir: join(root, "dist"),
    installSh: join(root, "scripts/install.sh"),
    out: join(root, "dist/pages"),
  };
  for (const f of [join(input.siteDist, "index.html"), join(input.appDir, "index.html"), join(input.downloadDir, `${DOWNLOAD_NAME}.tar.xz`)]) {
    if (!existsSync(f)) {
      console.error(`没有 ${f}：官网先 bun run build，本仓库先 bun run build:bin`);
      process.exit(1);
    }
  }
  await buildPages(input);
  const problems = await checkPages(input.out);
  for (const p of problems) console.error(`× ${p}`);
  if (problems.length) process.exit(1);
  console.log(`已生成 ${input.out}`);
}
