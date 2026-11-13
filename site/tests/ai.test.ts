import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { distFile } from "./dist.ts";
import { englishDocs } from "./docs-source.ts";

const distDir = join(fileURLToPath(import.meta.url), "..", "..", "dist");
const siteDir = join(fileURLToPath(import.meta.url), "..", "..");

/** 英文文档，从内容目录现场列出 */
const DOCS = englishDocs();
const DOC_SLUGS = DOCS.map((d) => d.slug);

/** 12 种非英文语言前缀 */
const NON_EN_LOCALES = [
  "zh-cn", "zh-tw", "es", "pt-br", "ru", "de",
  "ja", "fr", "ko", "it", "ar", "hi",
];

describe("AI 友好输出", () => {
  it("llms.txt 以项目名开头", () => {
    const txt = distFile("llms.txt");
    assert.ok(
      txt.startsWith("# Droidpier\n"),
      `llms.txt 首行不是 "# Droidpier"，实际：${txt.split("\n")[0]}`
    );
  });

  // 注：llms.txt 由自定义端点 site/src/pages/llms.txt.ts 生成（覆盖了插件注入的同名路由），
  // 因为 starlight-llms-txt 的 llms.txt 只是索引页不直接列出每个文档的链接。
  // Astro 文件路由先于插件注入路由占位（first-claimed-wins），构建不会产生冲突警告。
  it("llms.txt 链接到每个英文文档页", () => {
    const txt = distFile("llms.txt");
    for (const slug of DOC_SLUGS) {
      assert.ok(
        txt.includes(`/${slug}.md`),
        `llms.txt 缺少 slug：${slug}`
      );
    }
  });

  it("llms-full.txt 包含每个英文文档页", () => {
    // 每个英文文档的内容以 "# <标题>" 一级标题出现在 llms-full.txt 中
    const full = distFile("llms-full.txt");
    for (const { slug, title } of DOCS) {
      assert.ok(
        full.includes(`# ${title}`),
        `llms-full.txt 缺少文档标题 "# ${title}"（slug: ${slug}）`
      );
    }
  });

  it("llms 文件只含英文（无非英文语言路径前缀）", () => {
    const full = distFile("llms-full.txt");
    const llms = distFile("llms.txt");
    for (const locale of NON_EN_LOCALES) {
      assert.ok(
        !full.includes(`/${locale}/`),
        `llms-full.txt 含有非英文路径前缀：/${locale}/`
      );
      assert.ok(
        !llms.includes(`/${locale}/`),
        `llms.txt 含有非英文路径前缀：/${locale}/`
      );
    }
  });

  it("每页 .md 可用（含译文）", () => {
    for (const locale of NON_EN_LOCALES) {
      for (const slug of ["", ...DOC_SLUGS]) {
        const path = slug ? `${locale}/${slug}.md` : `${locale}.md`;
        assert.ok(existsSync(join(distDir, path)), `缺少 ${path}`);
        const md = distFile(path);
        assert.ok(md.trimStart().startsWith("# "), `${path} 首行不以 # 开头：${md.split("\n")[0]}`);
        assert.ok(!/^<[A-Z]/m.test(md), `${path} 含 MDX 组件标签行`);
        assert.ok(!/^import\s/m.test(md), `${path} 含 import 语句`);
        assert.ok(!md.includes("<!--"), `${path} 含 HTML 注释`);
      }
    }
  });

  it("每页英文 .md 可用", () => {
    const installMd = distFile("docs/getting-started/install.md");
    // 第一行以 # 开头
    assert.ok(
      installMd.trimStart().startsWith("# "),
      `install.md 首行不以 # 开头：${installMd.split("\n")[0]}`
    );
    // 不含 MDX 组件标签（< 开头的行）
    const lines = installMd.split("\n");
    for (const line of lines) {
      assert.ok(
        !line.match(/^<[A-Z]/),
        `install.md 含 MDX 组件标签行：${line}`
      );
    }
    // 不含 HTML 注释
    assert.ok(
      !installMd.includes("<!--"),
      "install.md 含 HTML 注释"
    );
  });

  it("首页 .md 带标语、安装命令和安装文档链接", () => {
    const md = distFile("index.md");
    assert.ok(md.includes("One command to install. No Android Studio required."), "index.md 缺副标题");
    assert.ok(
      md.includes("curl -fsSL https://droid.devpier.dev/install.sh | sh"),
      "index.md 缺安装命令",
    );
    assert.ok(md.includes("/docs/getting-started/install/"), "index.md 缺安装文档链接");
    assert.ok(md.includes("Get started in two steps:"), "index.md 不是两步开始");
    assert.ok(
      md.includes("Run this in Terminal: `curl -fsSL https://droid.devpier.dev/install.sh | sh`. It installs droidpier, or updates it, and starts it in the background."),
      "index.md 缺第 1 步（在终端运行安装命令，在后台启动）",
    );
    assert.ok(!/^import\s/m.test(md), "index.md 含 import 语句");
  });

  it("首页 JSON-LD 正确", () => {
    const html = distFile("index.html");
    const scriptMatch = html.match(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/
    );
    assert.ok(scriptMatch, "index.html 中找不到 application/ld+json");
    const json = JSON.parse(scriptMatch[1]);
    // @type 必须是数组，同时包含 SoftwareApplication 和 SoftwareSourceCode
    const types: string[] = Array.isArray(json["@type"]) ? json["@type"] : [json["@type"]];
    assert.ok(
      types.includes("SoftwareApplication"),
      `JSON-LD @type 不含 SoftwareApplication，实际：${JSON.stringify(json["@type"])}`
    );
    assert.ok(
      types.includes("SoftwareSourceCode"),
      `JSON-LD @type 不含 SoftwareSourceCode，实际：${JSON.stringify(json["@type"])}`
    );
    assert.equal(json["name"], "Droidpier", `JSON-LD name 错误：${json["name"]}`);
    assert.ok(
      (json["license"] as string)?.includes("MIT"),
      `JSON-LD license 不含 MIT：${json["license"]}`
    );
    assert.equal(
      json["codeRepository"],
      "https://github.com/twosugar/droidpier",
      `JSON-LD codeRepository 错误：${json["codeRepository"]}`
    );
    assert.ok(
      (json["operatingSystem"] as string)?.includes("macOS"),
      `JSON-LD operatingSystem 不含 macOS：${json["operatingSystem"]}`
    );
  });

  it("复制按钮存在且指向正确的 .md 地址", () => {
    for (const slug of DOC_SLUGS) {
      const html = distFile(`${slug}/index.html`);
      const btnMatch = html.match(/data-copy-md=["']([^"']+)["']/);
      assert.ok(
        btnMatch,
        `${slug}/index.html 缺少 data-copy-md 按钮`
      );
      const mdUrl = btnMatch[1];
      assert.ok(
        mdUrl.endsWith(`/${slug}.md`) || mdUrl === `/${slug}.md`,
        `data-copy-md 地址不正确：${mdUrl}，期望包含 /${slug}.md`
      );
    }
  });

  it("复制按钮 i18n 字符串存在于 en.json", () => {
    const enJson = JSON.parse(
      readFileSync(
        join(siteDir, "src/content/i18n/en.json"),
        "utf-8"
      )
    );
    assert.ok(
      typeof enJson["page.copyMarkdown"] === "string" && enJson["page.copyMarkdown"].length > 0,
      "en.json 缺少 page.copyMarkdown"
    );
    assert.ok(
      typeof enJson["page.copyMarkdown.copied"] === "string" && enJson["page.copyMarkdown.copied"].length > 0,
      "en.json 缺少 page.copyMarkdown.copied"
    );
    assert.ok(
      typeof enJson["page.copyMarkdown.failed"] === "string" && enJson["page.copyMarkdown.failed"].length > 0,
      "en.json 缺少 page.copyMarkdown.failed"
    );
  });

  it("llms 插件版本锁定", () => {
    const pkg = JSON.parse(
      readFileSync(join(siteDir, "package.json"), "utf-8")
    );
    const spec = pkg.dependencies?.["starlight-llms-txt"] ?? pkg.devDependencies?.["starlight-llms-txt"];
    assert.equal(
      spec,
      "0.12.0",
      `starlight-llms-txt 版本说明符应精确锁定为 "0.12.0"，实际：${spec}`
    );
  });

  it("复制按钮携带所需 data 属性", () => {
    for (const slug of DOC_SLUGS) {
      const html = distFile(`${slug}/index.html`);
      // 按钮需有 data-copy-md（已有），还需携带成功/失败的文案（通过 data 属性或静态 label）
      assert.ok(
        html.includes("data-copy-md"),
        `${slug}/index.html 缺少 data-copy-md 属性`
      );
      // 确认按钮有反馈文案相关 data 属性
      assert.ok(
        html.includes("data-copied") || html.includes("data-failed"),
        `${slug}/index.html 按钮缺少 data-copied / data-failed 反馈 data 属性`
      );
    }
  });
});
