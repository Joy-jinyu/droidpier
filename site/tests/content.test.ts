import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { distFile } from "./dist.ts";
import { englishDocs } from "./docs-source.ts";

const siteDir = join(fileURLToPath(import.meta.url), "..", "..");
const distDir = join(siteDir, "dist");

/** 英文文档页的 slug，从内容目录现场列出 */
const DOC_SLUGS = englishDocs().map((d) => d.slug);

/** 12 种非英文语言前缀 */
const NON_EN_LOCALES = ["zh-cn", "zh-tw", "es", "pt-br", "ru", "de", "ja", "fr", "ko", "it", "ar", "hi"];

const FORBIDDEN =
  /no (need to install|(software|install(ation)?) (is )?(needed|required))|without install(ing)? any|nothing to install|zero[- ]latency/i;

const page = (slug: string) => distFile(`${slug}/index.html`);

/** 取 <main> 里的可见文字（去掉标签） */
function mainText(html: string): string {
  const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? "";
  return main.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

describe("禁用说法的正则", () => {
  const mustMatch = [
    "no need to install any software",
    "No installation is required",
    "zero-latency",
    "nothing to install",
    "without installing any software",
  ];
  const mustNotMatch = ["install the gateway", "low latency"];

  it("命中这些说法", () => {
    for (const p of mustMatch) assert.match(p, FORBIDDEN, `应命中：${p}`);
  });

  it("不误伤正常说法", () => {
    for (const p of mustNotMatch) assert.doesNotMatch(p, FORBIDDEN, `不应命中：${p}`);
  });
});

describe("英文文档内容", () => {
  it("每个英文文档页都已生成", () => {
    for (const slug of DOC_SLUGS) {
      assert.ok(existsSync(join(distDir, slug, "index.html")), `缺少 ${slug}/index.html`);
    }
  });

  it("每页恰好一个 h1", () => {
    for (const slug of DOC_SLUGS) {
      const count = page(slug).match(/<h1[\s>]/gi)?.length ?? 0;
      assert.equal(count, 1, `${slug} 有 ${count} 个 h1`);
    }
  });

  it("每页有 meta description", () => {
    for (const slug of DOC_SLUGS) {
      const m = page(slug).match(/<meta name="description" content="([^"]*)"/);
      assert.ok(m && m[1].trim().length > 0, `${slug} 缺少 meta description`);
      assert.ok(m[1].length <= 160, `${slug} 的 description 超过 160 个字符`);
    }
  });

  it("不含禁用说法", () => {
    for (const slug of DOC_SLUGS) {
      const text = mainText(page(slug));
      assert.ok(text.length > 0, `${slug} 没有 <main> 正文`);
      const hit = text.match(FORBIDDEN);
      assert.equal(hit, null, `${slug} 正文含禁用说法：${hit?.[0]}`);
      const desc = page(slug).match(/<meta name="description" content="([^"]*)"/)?.[1] ?? "";
      const descHit = desc.match(FORBIDDEN);
      assert.equal(descHit, null, `${slug} 的 description 含禁用说法：${descHit?.[0]}`);
    }
  });
});

describe("侧边栏", () => {
  it("列出内容目录里的每个英文文档", () => {
    const html = page("docs/getting-started/requirements");
    const start = html.indexOf('id="starlight__sidebar"');
    assert.ok(start >= 0, "找不到侧边栏");
    const sidebar = html.slice(start, html.indexOf("<main", start));
    for (const slug of DOC_SLUGS) {
      assert.ok(sidebar.includes(`href="/${slug}/"`), `侧边栏缺少 ${slug}`);
    }
  });
});

/** 首页 ArchFlow 区块的 HTML */
function archSection(html: string): string {
  return html.match(/<section class="emu-section emu-arch[\s\S]*?<\/section>/)?.[0] ?? "";
}

describe("首页", () => {
  const homes = [["", "index.html"], ...NON_EN_LOCALES.map((l) => [l, `${l}/index.html`])];

  it("英文首页源文件和构建结果都不含禁用说法", () => {
    const source = readFileSync(join(siteDir, "src", "content", "docs", "index.mdx"), "utf-8");
    assert.equal(source.match(FORBIDDEN), null, `index.mdx 含禁用说法：${source.match(FORBIDDEN)?.[0]}`);
    const text = mainText(distFile("index.html"));
    assert.ok(text.length > 0, "首页没有 <main> 正文");
    assert.equal(text.match(FORBIDDEN), null, `首页正文含禁用说法：${text.match(FORBIDDEN)?.[0]}`);
  });

  it("实测数字旁有指向测量条件的链接（13 种语言）", () => {
    for (const [locale, file] of homes) {
      const href = `${locale ? `/${locale}` : ""}/docs/getting-started/requirements/#measured-performance`;
      const arch = archSection(distFile(file));
      assert.ok(arch, `${file} 找不到 ArchFlow 区块`);
      const link = arch.match(new RegExp(`<a [^>]*href="${href}"[^>]*>([^<]+)</a>`));
      assert.ok(link, `${file} 的 ArchFlow 缺少链接 ${href}`);
      assert.ok(link[1].trim().length > 0, `${file} 的 ArchFlow 链接没有文字`);
    }
  });

  it("译文首页的实测数字与英文一致", () => {
    const metrics = (html: string) =>
      [...archSection(html).matchAll(/class="value[ "][^>]*>([^<]+)</g)].map((m) => m[1].trim());
    const en = distFile("index.html");
    const enMetrics = metrics(en);
    assert.ok(enMetrics.length > 0, "英文首页没有实测数字");
    // 正文里出现的其它数字事实：英文有的，译文也要有
    const facts = ["1.24", "257", "208", "1080×2340", "127.0.0.1", "Chrome 157", "API 34"];
    const enText = mainText(en);
    for (const f of facts) assert.ok(enText.includes(f), `英文首页不再包含 ${f}，请同步更新本测试`);
    for (const [locale, file] of homes.slice(1)) {
      const html = distFile(file);
      assert.deepEqual(metrics(html), enMetrics, `${locale} 首页的实测数字与英文不同`);
      const text = mainText(html);
      for (const f of facts) assert.ok(text.includes(f), `${locale} 首页缺少数字事实 ${f}`);
    }
  });
});
