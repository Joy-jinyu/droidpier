import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection } from "astro:content";

export const prerender = true;

export const getStaticPaths: GetStaticPaths = async () => {
  const entries = await getCollection("docs");
  return entries.map((entry) => ({
    params: { slug: entry.id },
    props: { entry },
  }));
};

export const GET: APIRoute = async ({ props }) => {
  const { entry } = props as { entry: Awaited<ReturnType<typeof getCollection<"docs">>>[number] };

  const title = entry.data.title;
  const description = entry.data.description;

  // 去掉 frontmatter（entry.body 已经是 frontmatter 之后的内容）
  let body = entry.body ?? "";

  // 去掉 MDX 注释（MDX 不支持 HTML 注释，审核标记写成 {/* <!-- … --> */}）
  body = body.replace(/^\{\/\*[\s\S]*?\*\/\}\n?/gm, "");

  // 去掉 HTML 注释（内部审核标记）
  body = body.replace(/<!--[\s\S]*?-->/g, "");

  // 去掉 MDX 开头的 import 块（只处理文件开头，代码块里的 import 不动）
  body = body.replace(/^(?:\s*import\s[^\n]*\n)+/, "");

  // 去掉 MDX 组件标签（< 开头的大写标签，如 <Card>, <Aside>, </Aside> 等）
  body = body.replace(/^<[A-Z][^>]*\/?>[\s\S]*?<\/[A-Z][^>]*>\n?/gm, "");
  body = body.replace(/^<\/[A-Z][^>]*>\n?/gm, "");
  body = body.replace(/^<[A-Z][^>]*\/?>\n?/gm, "");

  // 去掉翻译标题上的 {#id} 锚点标记（已被 heading-id 插件转为 HTML id，.md 输出里不需要）
  body = body.replace(/^(#{1,6} .*?)\s*\{#[^\s{}]+\}\s*$/gm, "$1");

  // 合并多余空行
  body = body.replace(/\n{3,}/g, "\n\n").trim();

  const segments: string[] = [`# ${title}`];
  if (description) segments.push(`> ${description}`);

  // 首页：正文在组件里，改为输出 hero 的标语、按钮链接和 frontmatter 里的纯 Markdown 摘要
  const hero = entry.data.hero;
  if (hero) {
    if (hero.tagline) segments.push(hero.tagline);
    const links = (hero.actions ?? []).map((a) => `- [${a.text}](${a.link})`);
    if (links.length > 0) segments.push(links.join("\n"));
  }
  if (entry.data.markdownSummary) segments.push(entry.data.markdownSummary.trim());

  segments.push(body);

  return new Response(segments.filter((x) => x.length > 0).join("\n\n"), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
};
