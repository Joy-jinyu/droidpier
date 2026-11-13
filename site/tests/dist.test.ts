import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { distFile } from "./dist.ts";

const siteDir = join(fileURLToPath(import.meta.url), "..", "..");
const distDir = join(siteDir, "dist");

/** 12 种非英文语言的 locale 键 */
const NON_ROOT_LOCALES = [
  "zh-cn", "zh-tw", "es", "pt-br", "ru", "de",
  "ja", "fr", "ko", "it", "ar", "hi",
];

describe("dist 构建产物检查", () => {
  it("13 种语言首页都已生成", () => {
    // 英文根首页
    assert.ok(existsSync(join(distDir, "index.html")), "缺少 index.html");
    // 其余 12 种语言
    for (const locale of NON_ROOT_LOCALES) {
      assert.ok(
        existsSync(join(distDir, locale, "index.html")),
        `缺少 ${locale}/index.html`,
      );
    }
  });

  it("各语言界面文字文件都生效（页脚和复制按钮是译文）", () => {
    // Starlight 按 locale 的 lang 值（如 zh-CN）找 i18n 文件，文件名大小写不对会被静默忽略
    const i18nDir = join(siteDir, "src", "content", "i18n");
    for (const file of readdirSync(i18nDir)) {
      if (file === "en.json") continue;
      const strings = JSON.parse(readFileSync(join(i18nDir, file), "utf8"));
      const license = strings["site.footer.license"];
      if (!license) continue;
      const linkText = /<a [^>]*>([^<]+)<\/a>/.exec(license)?.[1];
      assert.ok(linkText, `${file} 的 site.footer.license 缺少链接文字`);
      const locale = file.replace(/\.json$/, "").toLowerCase();
      // 用文档页而不是首页：首页正文里本身就写了许可证名，会让检查误判通过
      const page = `${locale}/docs/reference/cli/index.html`;
      const html = distFile(page);
      assert.ok(html.includes(linkText), `${page} 页脚没有用上 ${file} 里的译文「${linkText}」`);
      const copied = strings["page.copyMarkdown.copied"];
      if (copied) assert.ok(html.includes(copied), `${page} 复制按钮没有用上 ${file} 里的译文「${copied}」`);
    }
  });

  it("ar 首页为 rtl", () => {
    const html = distFile("ar/index.html");
    assert.ok(html.includes('dir="rtl"'), "ar/index.html 不含 dir=\"rtl\"");
  });

  it("sitemap 存在且含有站点域名", () => {
    assert.ok(existsSync(join(distDir, "sitemap-index.xml")), "缺少 sitemap-index.xml");
    const xml = distFile("sitemap-index.xml");
    assert.ok(
      xml.includes("https://droid.devpier.dev"),
      "sitemap-index.xml 不含 https://droid.devpier.dev",
    );
  });

  it("robots 不屏蔽且含 sitemap", () => {
    const txt = distFile("robots.txt");
    assert.ok(!txt.includes("Disallow: /\n") && !txt.includes("Disallow: /\r"), "robots.txt 含 Disallow: /");
    assert.ok(
      txt.includes("Sitemap: https://droid.devpier.dev/sitemap-index.xml"),
      "robots.txt 缺 sitemap 地址",
    );
  });

  it("页脚注明 MIT 和仓库", () => {
    for (const file of ["index.html", "zh-cn/index.html"]) {
      const html = distFile(file);
      // 找 footer 区域（取 <footer 到第一个 </footer>）
      const footerMatch = html.match(/<footer[\s\S]*?<\/footer>/i);
      assert.ok(footerMatch, `${file} 缺少 <footer>`);
      const footer = footerMatch[0];
      assert.ok(footer.includes("MIT"), `${file} 页脚不含 MIT`);
      // 英文页脚去掉标签后 “MIT License” 前面必须是空白或开头，防止渲染成 “theMIT”；译文页脚的措辞各语言不同
      if (file === "index.html") {
        const footerText = footer.replace(/<[^>]+>/g, "");
        assert.match(footerText, /(^|\s)MIT License/, `${file} 页脚 “MIT License” 前缺空格`);
      }
      assert.ok(
        footer.includes("https://github.com/twosugar/droidpier"),
        `${file} 页脚不含 GitHub 仓库链接`,
      );
    }
  });

  it("产品名已改为 Droidpier：除 GitHub 仓库地址外不再出现旧名，也不再出现已删除的 --public", () => {
    // dist/app/ 是产品自己的构建产物（copy-app.ts 复制进来），不归官网文案管
    const files = collectFiles(distDir, [".html", ".md", ".txt"]).filter(
      (f) => !f.slice(distDir.length + 1).startsWith("app/"),
    );
    assert.ok(files.length > 0, "dist 中没有可检查的文件");
    const hits: string[] = [];
    for (const file of files) {
      const rel = file.slice(distDir.length + 1);
      const content = readFileSync(file, "utf-8").replaceAll("github.com/twosugar/droidpier", "");
      if (/android[- ]emu[- ]web/i.test(content)) hits.push(`${rel}: 旧产品名`);
      if (/--public\b/.test(content)) hits.push(`${rel}: --public`);
    }
    assert.deepEqual(hits, [], `仍有旧名或 --public：\n${hits.join("\n")}`);
    // 首页第 2 步链接到 first-run 的这个锚点，各语言都得有
    for (const locale of ["", ...NON_ROOT_LOCALES]) {
      const file = `${locale ? `${locale}/` : ""}docs/getting-started/first-run/index.html`;
      assert.ok(distFile(file).includes('id="4-allow-local-network-access"'), `${file} 缺锚点 4-allow-local-network-access`);
    }
    for (const file of ["index.html", ...NON_ROOT_LOCALES.map((l) => `${l}/index.html`)]) {
      const title = distFile(file).match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
      assert.ok(title.includes("Droidpier"), `${file} <title> 不含 Droidpier：${title}`);
    }
  });

  it("启动口令已移除：13 种语言的页面、.md 和 llms*.txt 都不再提口令", () => {
    // 2026-11-12 网关改为只按 Origin 放行，页面自己探测网关；dist/app/ 是产品构建产物，不归官网文案管
    const files = collectFiles(distDir, [".html", ".md", ".txt"]).filter(
      (f) => !f.slice(distDir.length + 1).startsWith("app/"),
    );
    assert.ok(files.length > 0, "dist 中没有可检查的文件");
    // 各语言译文里“口令”的说法；token 这个词在官网文案里只指已删除的启动口令；阿拉伯语 رمز 太常见，用“رمز مميز / الرمز المميز”
    const tokenWords = /token|令牌|口令|权杖|權杖|トークン|토큰|jeton|токен|टोकन|رمز مميز|الرمز المميز/i;
    const hits: string[] = [];
    for (const file of files) {
      const rel = file.slice(distDir.length + 1);
      const text = readFileSync(file, "utf-8")
        .replace(/<script\b[\s\S]*?<\/script>/gi, "")
        .replace(/<style\b[\s\S]*?<\/style>/gi, "");
      if (/token=/.test(text)) hits.push(`${rel}: token=`);
      const m = tokenWords.exec(text);
      if (m) hits.push(`${rel}: ${text.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, " ")}`);
    }
    assert.deepEqual(hits, [], `仍提到启动口令：\n${hits.join("\n")}`);
  });

  it("dist 中无第三方来源", () => {
    // 递归收集所有 .html 和 .css 文件
    const files = collectFiles(distDir, [".html", ".css"]);
    const allowed = "droid.devpier.dev";
    const violations: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      const rel = file.slice(distDir.length + 1);

      // 检查 src="https?://..." —— 不允许外部资源
      checkAttr("src", content, rel, allowed, violations);

      // 检查 href="https?://..." —— 但跳过 <a href 和允许的 rel
      checkHrefNonAnchor(content, rel, allowed, violations);

      // 检查 url(https?://...)
      checkCssUrl(content, rel, allowed, violations);
    }

    assert.equal(
      violations.length,
      0,
      `发现外部资源引用：\n${violations.join("\n")}`,
    );
  });

  it("所有站内锚点链接可解析", () => {
    // 递归收集所有 HTML 文件
    const htmlFiles = collectFiles(distDir, [".html"]);

    // 预建 id 集：path → Set<id>
    // 路径格式为 dist 下相对路径（不含 dist/），如 "docs/getting-started/install/index.html"
    const idsByPath = new Map<string, Set<string>>();
    for (const file of htmlFiles) {
      const rel = file.slice(distDir.length + 1);
      const content = readFileSync(file, "utf-8");
      const ids = new Set<string>();
      const re = /\bid="([^"]+)"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        ids.add(m[1]);
      }
      idsByPath.set(rel, ids);
    }

    // 将 URL 路径解析为 dist 文件 rel 路径（总是指向 index.html）
    function pathToRel(urlPath: string): string {
      // 去掉前导 /，确保以 / 结尾的 → index.html
      const p = urlPath.replace(/^\//, "");
      if (p === "" || p.endsWith("/")) return p + "index.html";
      // 若无扩展名，视为目录
      if (!p.match(/\.[^/]+$/)) return p + "/index.html";
      return p;
    }

    const broken: string[] = [];

    for (const file of htmlFiles) {
      const rel = file.slice(distDir.length + 1);
      const content = readFileSync(file, "utf-8");

      // 本文件对应的 URL 路径（以 / 开头，去掉尾部 index.html）
      const thisUrlPath = "/" + rel.replace(/index\.html$/, "");

      // [^"]* 允许路径部分为空，从而覆盖同页锚点 href="#frag"
      const hrefRe = /href="([^"]*#[^"]+)"/g;
      let m: RegExpExecArray | null;
      while ((m = hrefRe.exec(content)) !== null) {
        const href = m[1];

        // 只处理站内链接：以 / 开头（绝对路径）或以 # 开头（同页）
        let urlPath: string;
        let fragment: string;

        if (href.startsWith("#")) {
          urlPath = thisUrlPath;
          fragment = decodeURIComponent(href.slice(1));
        } else if (href.startsWith("/")) {
          const hashIdx = href.indexOf("#");
          urlPath = decodeURIComponent(href.slice(0, hashIdx));
          fragment = decodeURIComponent(href.slice(hashIdx + 1));
        } else {
          // 相对链接或外部链接，跳过
          continue;
        }

        // 跳过 Starlight 注入的 UI 锚点（以 _ 开头）
        if (fragment.startsWith("_")) continue;

        const targetRel = pathToRel(urlPath);
        const ids = idsByPath.get(targetRel);
        if (!ids) {
          broken.push(`[${rel}] href="${href}" → 目标页面 ${targetRel} 不存在`);
          continue;
        }
        if (!ids.has(fragment)) {
          broken.push(`[${rel}] href="${href}" → 目标页面 ${targetRel} 中无 id="${fragment}"`);
        }
      }
    }

    assert.equal(
      broken.length,
      0,
      `发现 ${broken.length} 条断链锚点：\n${broken.join("\n")}`,
    );
  });

  it("演示素材体积", () => {
    const mediaDir = join(siteDir, "public", "media");
    const files = readdirSync(mediaDir);
    const size = (f: string) => statSync(join(mediaDir, f)).size;
    const total = files.reduce((sum, f) => sum + size(f), 0);
    assert.ok(total <= 1.5 * 1024 * 1024, `public/media 合计 ${total} 字节，超过 1.5MB`);
    assert.deepEqual(files.filter((f) => /\.(mp4|webm)$/.test(f)), [], "public/media 下还有视频");
    for (const n of [1, 2, 3]) assert.ok(files.includes(`screen-${n}.webp`), `缺 screen-${n}.webp`);
    for (const f of files.filter((f) => f.endsWith(".webp"))) {
      assert.ok(size(f) <= 400 * 1024, `${f} 是 ${size(f)} 字节，超过 400KB`);
    }
  });

  it("dist HTML 不含 {# 标记", () => {
    // {# 是 Markdown 源文件中写的锚点标记，不应出现在最终 HTML 里
    const htmlFiles = collectFiles(distDir, [".html"]);
    const violations: string[] = [];
    for (const file of htmlFiles) {
      const content = readFileSync(file, "utf-8");
      if (content.includes("{#")) {
        violations.push(file.slice(distDir.length + 1));
      }
    }
    assert.equal(violations.length, 0, `以下 HTML 文件含 {# 标记：\n${violations.join("\n")}`);
  });

  it("dist .md 文件不含 {# 标记", () => {
    // 翻译标题上的 {#id} 应在 md 路由里剥离后再输出
    const mdFiles = collectFiles(distDir, [".md"]);
    const violations: string[] = [];
    for (const file of mdFiles) {
      const content = readFileSync(file, "utf-8");
      if (content.includes("{#")) {
        violations.push(file.slice(distDir.length + 1));
      }
    }
    assert.equal(violations.length, 0, `以下 .md 文件含 {# 标记：\n${violations.join("\n")}`);
  });

  it("页面主内容无重复 id", () => {
    // 重复 id 会导致锚点跳转到错误位置；只检查 <main> 内（Starlight UI id 在 <aside> 里）
    const htmlFiles = collectFiles(distDir, [".html"]);
    const violations: string[] = [];
    for (const file of htmlFiles) {
      const content = readFileSync(file, "utf-8");
      const rel = file.slice(distDir.length + 1);
      // 提取 <main> 段落（每页只有一个 main）
      const mainStart = content.indexOf("<main");
      const mainEnd = content.lastIndexOf("</main>");
      if (mainStart < 0 || mainEnd <= mainStart) continue;
      const mainContent = content.slice(mainStart, mainEnd + 7);
      const ids: string[] = [];
      const re = /\bid="([^"]+)"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(mainContent)) !== null) {
        ids.push(m[1]);
      }
      const seen = new Set<string>();
      for (const id of ids) {
        if (seen.has(id)) {
          violations.push(`[${rel}] 重复 id="${id}"`);
        }
        seen.add(id);
      }
    }
    assert.equal(violations.length, 0, `发现重复 id：\n${violations.join("\n")}`);
  });
});

// ---- 辅助函数 ----

function collectFiles(dir: string, exts: string[]): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...collectFiles(full, exts));
    } else if (exts.some(e => entry.name.endsWith(e))) {
      result.push(full);
    }
  }
  return result;
}

function isExternal(url: string, allowed: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname !== allowed;
  } catch {
    return false;
  }
}

function checkAttr(
  attr: string,
  content: string,
  file: string,
  allowed: string,
  out: string[],
): void {
  // 匹配 attr="https://..." 或 attr='https://...'
  const re = new RegExp(`${attr}=["'](https?://[^"']+)["']`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (isExternal(m[1], allowed)) {
      out.push(`[${file}] ${attr}="${m[1]}"`);
    }
  }
}

function checkHrefNonAnchor(
  content: string,
  file: string,
  allowed: string,
  out: string[],
): void {
  // <link ... href="..."> —— 但允许 rel="alternate|canonical" 以及 og: meta（不加载资源）
  const tagRe = /<link\b([^>]*)>/gi;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagRe.exec(content)) !== null) {
    const attrs = tagMatch[1];
    // 允许的 rel 值（不加载资源，只是地址引用）
    const relMatch = attrs.match(/rel=["']([^"']+)["']/i);
    const rel = relMatch ? relMatch[1].toLowerCase() : "";
    if (rel === "alternate" || rel === "canonical" || rel === "sitemap") continue;

    const hrefMatch = attrs.match(/href=["'](https?:\/\/[^"']+)["']/i);
    if (hrefMatch && isExternal(hrefMatch[1], allowed)) {
      out.push(`[${file}] <link> href="${hrefMatch[1]}"`);
    }
  }
}

function checkCssUrl(
  content: string,
  file: string,
  allowed: string,
  out: string[],
): void {
  const re = /url\(\s*["']?(https?:\/\/[^"')]+)["']?\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (isExternal(m[1], allowed)) {
      out.push(`[${file}] url(${m[1]})`);
    }
  }
}
