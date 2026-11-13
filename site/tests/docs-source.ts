import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const docsRoot = join(fileURLToPath(import.meta.url), "..", "..", "src", "content", "docs", "docs");

/**
 * 从英文内容目录 src/content/docs/docs/ 现场列出全部文档页（slug + 标题）。
 * 测试拿它当期望值，故意不读侧边栏常量：新增一篇文档却忘了加进侧边栏或 llms.txt，测试才会失败。
 */
export function englishDocs(): { slug: string; title: string }[] {
  const result: { slug: string; title: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.mdx?$/.test(entry.name)) {
        const rel = relative(docsRoot, full).split(sep).join("/").replace(/\.mdx?$/, "");
        const title = readFileSync(full, "utf-8").match(/^title:\s*(.+)$/m)?.[1].trim().replace(/^["']|["']$/g, "");
        if (!title) throw new Error(`${full} 缺少 frontmatter title`);
        result.push({ slug: `docs/${rel}`, title });
      }
    }
  };
  walk(docsRoot);
  return result.sort((a, b) => a.slug.localeCompare(b.slug));
}
