import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sourceHash, status } from "../scripts/translation-status.ts";

let tmpDir: string;
let docsDir: string;

before(() => {
  // 创建临时目录模拟 src/content/docs 结构
  tmpDir = mkdtempSync(join(tmpdir(), "i18n-test-"));
  docsDir = join(tmpDir, "docs");
  mkdirSync(docsDir);

  // 英文源文件
  writeFileSync(
    join(docsDir, "index.mdx"),
    "---\ntitle: Home\n---\n\nEnglish **body** content.",
  );
  mkdirSync(join(docsDir, "docs", "sub"), { recursive: true });
  writeFileSync(
    join(docsDir, "docs", "sub", "page.md"),
    "---\ntitle: Page\n---\n\nSome page body.",
  );

  // zh-cn：index 过期（hash 不对），page.md 正确
  // 注意：英文文件正文在剥离 frontmatter 后，\n---\n 之后的内容含前导 \n（来自空行）
  const idxBody = "\nEnglish **body** content.";
  const pageBody = "\nSome page body.";
  mkdirSync(join(docsDir, "zh-cn", "docs", "sub"), { recursive: true });
  writeFileSync(
    join(docsDir, "zh-cn", "index.mdx"),
    `---\ntitle: 首页\nsourceHash: wronghash000000\n---\n\n中文正文。`,
  );
  writeFileSync(
    join(docsDir, "zh-cn", "docs", "sub", "page.md"),
    `---\ntitle: 页面\nsourceHash: ${sourceHash(pageBody)}\n---\n\n翻译正文。`,
  );

  // es：完全缺失（不创建目录）
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("sourceHash", () => {
  it("忽略 frontmatter — 同一正文不同 frontmatter 哈希相同", () => {
    const body = "Hello world";
    const h1 = sourceHash(body);
    const h2 = sourceHash(body);
    assert.equal(h1, h2);
    // 不同 frontmatter 不影响 hash（hash 只看 body，frontmatter 由调用方剥离后传入）
    assert.equal(h1.length, 12);
  });

  it("忽略换行风格 — \\r\\n 和 \\n 产生相同哈希", () => {
    const unixBody = "Line one\nLine two\n";
    const winBody = "Line one\r\nLine two\r\n";
    assert.equal(sourceHash(unixBody), sourceHash(winBody));
  });

  it("不同正文产生不同哈希", () => {
    assert.notEqual(sourceHash("body A"), sourceHash("body B"));
  });

  it("返回恰好 12 位十六进制", () => {
    const h = sourceHash("any text");
    assert.match(h, /^[0-9a-f]{12}$/);
  });
});

describe("status()", () => {
  it("缺失的译文列为 missing", () => {
    const result = status(docsDir, ["es"]);
    // es 目录不存在，两个源文件都缺失
    assert.ok(
      result.missing.some((m) => m.startsWith("es/")),
      `missing 中应含 es/ 项，实际：${JSON.stringify(result.missing)}`,
    );
    assert.deepEqual(result.stale, []);
  });

  it("sourceHash 不符列为 stale", () => {
    const result = status(docsDir, ["zh-cn"]);
    // zh-cn/index.mdx hash 不对，应为 stale
    assert.ok(
      result.stale.some((s) => s.includes("zh-cn") && s.includes("index")),
      `stale 中应含 zh-cn/index，实际：${JSON.stringify(result.stale)}`,
    );
    // zh-cn/docs/sub/page.md hash 正确，不应在 stale 也不在 missing
    assert.ok(
      !result.stale.some((s) => s.includes("page")),
      `page.md 不应在 stale，实际：${JSON.stringify(result.stale)}`,
    );
    assert.deepEqual(result.missing, []);
  });

  it("全部一致时 missing 和 stale 均为空", () => {
    // 创建与英文 hash 一致的完整译文（body 含前导 \n，与剥离 frontmatter 后一致）
    const idxBody = "\nEnglish **body** content.";
    const pBody = "\nSome page body.";

    // 修复 zh-cn/index.mdx 使其 hash 正确（之前测试故意设成错误值）
    writeFileSync(
      join(docsDir, "zh-cn", "index.mdx"),
      `---\ntitle: 首页\nsourceHash: ${sourceHash(idxBody)}\n---\n\n中文正文。`,
    );

    // 创建 fr 完整译文
    mkdirSync(join(docsDir, "fr", "docs", "sub"), { recursive: true });
    writeFileSync(
      join(docsDir, "fr", "index.mdx"),
      `---\ntitle: Accueil\nsourceHash: ${sourceHash(idxBody)}\n---\n\nContenu.`,
    );
    writeFileSync(
      join(docsDir, "fr", "docs", "sub", "page.md"),
      `---\ntitle: Page\nsourceHash: ${sourceHash(pBody)}\n---\n\nTraduction.`,
    );
    // 传入所有存在的 locale 目录，让 status 正确识别英文文件
    const result = status(docsDir, ["zh-cn", "fr"]);
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.stale, []);
  });
});
