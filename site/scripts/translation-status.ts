/**
 * translation-status.ts
 *
 * 检查各语言译文是否存在且与英文源文件同步。
 *
 * 导出：
 *   sourceHash(body)  — sha256 前 12 位，body 为去掉 frontmatter 后的正文
 *   status(docsDir, locales) — 返回 { missing, stale }，每项格式 "<locale>/<slug>"
 *
 * CLI：node scripts/translation-status.ts
 *   有缺失或过期打印清单并以退出码 1 结束；否则打印 "all translations current"。
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** sha256 前 12 位十六进制。body 为去掉 frontmatter 后的正文，\r\n 统一为 \n。 */
export function sourceHash(body: string): string {
  const normalized = body.replace(/\r\n/g, "\n");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 12);
}

/** 从文件内容中剥离 YAML frontmatter，返回正文（已统一换行符）。 */
function stripFrontmatter(content: string): string {
  const s = content.replace(/\r\n/g, "\n");
  if (!s.startsWith("---\n")) return s;
  const end = s.indexOf("\n---\n", 4);
  if (end === -1) return s;
  return s.slice(end + 5); // skip \n---\n
}

/** 从 frontmatter 中读取 sourceHash 字段值。 */
function readSourceHash(content: string): string | undefined {
  const s = content.replace(/\r\n/g, "\n");
  if (!s.startsWith("---\n")) return undefined;
  const end = s.indexOf("\n---\n", 4);
  if (end === -1) return undefined;
  const fm = s.slice(4, end);
  const m = fm.match(/^sourceHash:\s*(\S+)/m);
  return m?.[1];
}

/** 递归收集目录下所有文件（相对于 base 的路径），跳过 base 顶层的指定目录。 */
function collectFiles(dir: string, skip: Set<string>, base: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (dir === base && skip.has(entry.name)) continue;
      result.push(...collectFiles(full, skip, base));
    } else {
      result.push(relative(base, full));
    }
  }
  return result;
}

/**
 * 检查各 locale 的译文状态。
 * @param docsDir  Starlight 内容目录，如 src/content/docs
 * @param locales  非英文 locale 键列表，如 ["zh-cn", "es", ...]
 */
export function status(
  docsDir: string,
  locales: string[],
): { missing: string[]; stale: string[] } {
  // 检测顶层所有 locale 风格目录（2 字母代码，可选 -子代码），统一排除
  const localePattern = /^[a-z]{2}(-[a-z]+)?$/;
  const allLocaleDirs = new Set([
    ...locales,
    ...readdirSync(docsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && localePattern.test(e.name))
      .map((e) => e.name),
  ]);

  // 枚举英文源文件（排除所有 locale 子目录）
  const englishFiles = collectFiles(docsDir, allLocaleDirs, docsDir);

  const missing: string[] = [];
  const stale: string[] = [];

  for (const locale of locales) {
    for (const file of englishFiles) {
      const enPath = join(docsDir, file);
      const localePath = join(docsDir, locale, file);

      // 计算英文正文的 hash
      const enContent = readFileSync(enPath, "utf-8");
      const enBody = stripFrontmatter(enContent);
      const hash = sourceHash(enBody);

      // slug：去掉扩展名，作为报告条目的可读路径
      const slug = file.replace(/\.(md|mdx)$/, "");

      if (!existsSync(localePath)) {
        missing.push(`${locale}/${slug}`);
      } else {
        const localeContent = readFileSync(localePath, "utf-8");
        const localeHash = readSourceHash(localeContent);
        if (localeHash !== hash) {
          stale.push(`${locale}/${slug}`);
        }
      }
    }
  }

  return { missing, stale };
}

// CLI 入口
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] === thisFile) {
  const siteDir = join(thisFile, "..", "..");
  const docsDir = join(siteDir, "src", "content", "docs");
  const locales = [
    "zh-cn", "zh-tw", "es", "pt-br", "ru", "de",
    "ja", "fr", "ko", "it", "ar", "hi",
  ];

  const result = status(docsDir, locales);

  if (result.missing.length === 0 && result.stale.length === 0) {
    console.log("all translations current");
    process.exit(0);
  } else {
    if (result.missing.length > 0) {
      console.log("missing:");
      for (const item of result.missing) console.log(`  ${item}`);
    }
    if (result.stale.length > 0) {
      console.log("stale:");
      for (const item of result.stale) console.log(`  ${item}`);
    }
    process.exit(1);
  }
}
