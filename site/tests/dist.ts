import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { distStaleReason } from "./dist-fresh.ts";

const siteDir = join(fileURLToPath(import.meta.url), "..", "..");
const distDir = join(siteDir, "dist");

// 读 dist 的测试一加载就检查：缺失或过期直接失败，不拿旧构建冒充当前源码
const stale = distStaleReason(siteDir);
if (stale) throw new Error(stale);

/** 读取 site/dist 下的文件内容，供各测试使用 */
export function distFile(path: string): string {
  return readFileSync(join(distDir, path), "utf-8");
}
