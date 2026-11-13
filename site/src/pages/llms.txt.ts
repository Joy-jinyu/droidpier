/**
 * 自定义 llms.txt 端点，覆盖 starlight-llms-txt 插件注入的同名路由。
 *
 * 原因：插件生成的 llms.txt 是 llmstxt.org 规范的索引页，只链接到聚合文件
 * （llms-full.txt / llms-small.txt），不直接列出每个文档页面的链接。
 * 本端点在此基础上增加一个 "## Docs" 区块，每行指向单个英文文档的 .md 端点。
 *
 * Astro 文件路由（src/pages/）在路由清单中先于插件注入路由占位，构建时
 * 采用"first-claimed-wins"机制，本路由优先写入 dist/llms.txt，插件路由被跳过，
 * 不会产生冲突警告（Astro 对预渲染路由不检查冲突）。
 */
import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { DOC_SLUGS } from "../site-config.mjs";

export const prerender = true;

export const GET: APIRoute = async (context) => {
  const site = context.site!.href.replace(/\/$/, "");

  // 加载英文文档，建立 id → entry 映射
  const allDocs = await getCollection("docs");
  const docMap = new Map(allDocs.map((e) => [e.id, e]));

  // 按侧边栏顺序，每行：- [title](https://droid.devpier.dev/<slug>.md): description
  const docLines = DOC_SLUGS.map((slug) => {
    const entry = docMap.get(slug);
    if (!entry) return null;
    const title = entry.data.title;
    const desc = entry.data.description ?? "";
    return `- [${title}](${site}/${slug}.md)${desc ? `: ${desc}` : ""}`;
  }).filter(Boolean);

  const llmsFullUrl = `${site}/llms-full.txt`;
  const llmsSmallUrl = `${site}/llms-small.txt`;

  const segments = [
    `# Droidpier`,
    `> One command to install. No Android Studio required.`,
    `## Documentation Sets\n\n- [Abridged documentation](${llmsSmallUrl}): a compact version of the documentation for Droidpier, with non-essential content removed\n- [Complete documentation](${llmsFullUrl}): the full documentation for Droidpier`,
    `## Docs\n\n${docLines.join("\n")}`,
    `## Notes\n\n- The complete documentation includes all content from the official documentation\n- The content is automatically generated from the same source as the official documentation`,
  ];

  return new Response(segments.join("\n\n") + "\n", {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
