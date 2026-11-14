// 把网关打成单个 darwin-arm64 可执行文件，nsh 页面产物整个目录嵌进去；再打一份 .tar.xz 给下载用
// 用法：bun scripts/build-binary.ts（先跑 build:ui 生成 .nsh/out/Droidpier）
import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { scrubDir } from "./scrub-paths.ts";
import { isPublicOrigin } from "../gateway/src/auth.ts";
import { OFFICIAL_ORIGIN } from "../shared/protocol.ts";

const root = join(import.meta.dir, "..");
const ui = join(root, ".nsh/out/Droidpier");
const dist = join(root, "dist");
const stage = join(dist, "stage", basename(ui));
const name = "droidpier-darwin-arm64";
const out = join(dist, name);
// Cloudflare Pages 单个文件上限 25 MiB
const PAGES_LIMIT = 25 * 2 ** 20;

// 网关信任的公网页面：部署自己的一套时用 PUBLIC_ORIGIN 换掉官方的（docs/deploy.md）
const origin = process.env.PUBLIC_ORIGIN || OFFICIAL_ORIGIN;
if (!isPublicOrigin(origin)) throw new Error(`PUBLIC_ORIGIN 不合法：${origin}（要写成 https://主机，不带路径和结尾的 /；只有本机试用可以是 http://127.0.0.1 或 http://*.localhost）`);

await stat(join(ui, "index.html")).catch(() => {
  throw new Error(`没有页面产物：${ui}，先跑 build:ui`);
});
// .br / .gz 是给带压缩协商的静态服务器用的，网关只发原文件，不嵌进去
await rm(join(dist, "stage"), { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await cp(ui, stage, { recursive: true, filter: (src) => !/\.(br|gz)$/.test(src) });
// 页面产物（nsh 的 wasm）里编译进了本机 home 路径；先抹掉再嵌入，build-pages 也会对 /app/ 做同样处理
for (const f of await scrubDir(stage, homedir())) console.log(`抹掉本机路径：${f}`);

// --asset 嵌入的目录在运行时位于 import.meta.dir/<目录名>，main.ts 按这个路径找页面
const r = await Bun.build({
  entrypoints: [join(root, "gateway/src/main.ts")],
  compile: { target: "bun-darwin-arm64", outfile: out, assets: [stage] },
  minify: true,
  // 网关版本 = 构建时间，/healthz 报出去，另一个 droidpier 启动时按它比新旧（gateway/src/already-running.ts）
  // 公网页面的来源见 gateway/src/auth.ts 的 PUBLIC_ORIGIN
  define: { DROIDPIER_VERSION: JSON.stringify(new Date().toISOString()), DROIDPIER_PUBLIC_ORIGIN: JSON.stringify(origin) },
});
if (!r.success) {
  for (const l of r.logs) console.error(l);
  process.exit(1);
}
await rm(join(dist, "stage"), { recursive: true, force: true });

// 可执行文件约 65 MiB，超过 Pages 上限。gzip -9 压完仍超 25 MiB；xz -9 约 18 MiB，
// 且 macOS 自带的 /usr/bin/tar（libarchive + liblzma）能直接解，install.sh 不用额外装工具（2026-11-12 实测）
const xz = `${out}.tar.xz`;
execFileSync("/usr/bin/tar", ["-cJf", xz, "--options", "xz:compression-level=9", "-C", dist, name]);
const bin = await stat(out);
const packed = await Bun.file(xz).bytes();
const sha = createHash("sha256").update(packed).digest("hex");
await writeFile(`${xz}.sha256`, `${sha}  ${name}.tar.xz\n`);

const mib = (n: number) => `${(n / 2 ** 20).toFixed(1)} MiB`;
console.log(`${out}：${mib(bin.size)}  信任的公网页面 ${origin}`);
console.log(`${xz}：${mib(packed.length)}  sha256 ${sha}`);
if (packed.length > PAGES_LIMIT) {
  console.error(`压缩后仍超过 Cloudflare Pages 单文件上限 ${mib(PAGES_LIMIT)}`);
  process.exit(1);
}
