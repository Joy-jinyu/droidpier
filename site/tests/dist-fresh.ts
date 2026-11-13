import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * 构建输入：这些路径里任何文件比 dist 新，dist 就算过期。
 * dist/app/ 来自仓库外的 EMU_APP_DIR，查不到它是否过期。
 */
const INPUTS = ["src", "public", "astro.config.mjs", "scripts", "package.json", "bun.lock"];

function newestFile(path: string): { path: string; mtimeMs: number } | null {
  const st = statSync(path);
  if (!st.isDirectory()) return { path, mtimeMs: st.mtimeMs };
  let best: { path: string; mtimeMs: number } | null = null;
  for (const name of readdirSync(path)) {
    // .DS_Store 这类隐藏文件被 Finder 改动不代表源码变了
    if (name.startsWith(".")) continue;
    const hit = newestFile(join(path, name));
    if (hit && (!best || hit.mtimeMs > best.mtimeMs)) best = hit;
  }
  return best;
}

/**
 * dist 能不能拿来测：缺失或比构建输入旧时返回原因，否则返回 null。
 * 以 dist/index.html 的修改时间代表这次构建的时间。
 */
export function distStaleReason(siteDir: string): string | null {
  const marker = join(siteDir, "dist", "index.html");
  if (!existsSync(marker)) return `dist/ 不存在（找不到 ${marker}），先运行 bun run build`;
  const builtAt = statSync(marker).mtimeMs;
  let newest: { path: string; mtimeMs: number } | null = null;
  for (const input of INPUTS) {
    const p = join(siteDir, input);
    if (!existsSync(p)) continue;
    const hit = newestFile(p);
    if (hit && (!newest || hit.mtimeMs > newest.mtimeMs)) newest = hit;
  }
  if (newest && newest.mtimeMs > builtAt) {
    return `dist/ 已过期：${relative(siteDir, newest.path)} 比上次构建新，先运行 bun run build`;
  }
  return null;
}
