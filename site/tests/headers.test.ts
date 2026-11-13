import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { headersFor, matchesPattern, parseHeaders } from "./serve-with-headers.ts";

const siteDir = join(fileURLToPath(import.meta.url), "..", "..");

/** 站点页的 CSP；为什么有 'unsafe-inline' 和 'wasm-unsafe-eval' 见 public/_headers 的注释 */
const SITE_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'";

/** 模拟器页面的 CSP：connect-src 的本机列表照抄 nsh 页面自己的 <meta>，其余是它在 Chrome 里实际需要的最小集合 */
const LOCAL = "http://127.0.0.1:* https://127.0.0.1:* ws://127.0.0.1:* wss://127.0.0.1:* http://localhost:* https://localhost:* ws://localhost:* wss://localhost:*";
const APP_CSP =
  `default-src 'self'; script-src 'self' 'unsafe-inline' blob: 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ${LOCAL}; frame-src https://chrome-devtools-frontend.appspot.com; frame-ancestors 'none'; base-uri 'self'; object-src 'none'`;

const rules = parseHeaders(readFileSync(join(siteDir, "public", "_headers"), "utf-8"));

describe("_headers 规则", () => {
  it("站点页带完整 CSP 和基础安全头", () => {
    for (const path of ["/", "/docs/getting-started/install/", "/ar/", "/index.md", "/pagefind/pagefind-worker.js", "/404.html"]) {
      const h = headersFor(rules, path);
      assert.equal(h["content-security-policy"], SITE_CSP, path);
      assert.equal(h["x-content-type-options"], "nosniff", path);
      assert.equal(h["referrer-policy"], "strict-origin-when-cross-origin", path);
    }
  });

  it("/app/ 用自己的 CSP（只有一份），保留其他安全头", () => {
    for (const path of ["/app/", "/app/index.html", "/app/host.6807d07ab5.js", "/app/nsh.405f7cb38a.wasm", "/app/browser.60069735e9/host.js"]) {
      const h = headersFor(rules, path);
      assert.equal(h["content-security-policy"], APP_CSP, path);
      assert.equal(h["x-content-type-options"], "nosniff", path);
      assert.equal(h["referrer-policy"], "strict-origin-when-cross-origin", path);
    }
  });

  it("不靠 splat 能否匹配空串：/app/ 有自己那一条规则", () => {
    const own = rules.filter((r) => r.pattern === "/app/");
    assert.equal(own.length, 1);
    const withoutSplat = rules.filter((r) => r.pattern !== "/app/*");
    assert.equal(headersFor(withoutSplat, "/app/")["content-security-policy"], APP_CSP);
  });

  it("/app/* 不覆盖名字相近的其他路径", () => {
    for (const path of ["/app", "/application/", "/apps/", "/docs/app/", "/zh-cn/app/", "/app.md"]) {
      assert.equal(headersFor(rules, path)["content-security-policy"], SITE_CSP, path);
    }
  });
});

describe("_headers 语义（按 Cloudflare Pages）", () => {
  it("splat 可跨段、可为空；:name 只匹配一段", () => {
    assert.ok(matchesPattern("/app/*", "/app/"));
    assert.ok(matchesPattern("/app/*", "/app/a/b.js"));
    assert.ok(!matchesPattern("/app/*", "/app"));
    assert.ok(matchesPattern("/:lang/docs", "/ar/docs"));
    assert.ok(!matchesPattern("/:lang/docs", "/a/b/docs"));
    assert.ok(!matchesPattern("/a.b", "/axb"));
  });

  it("按顺序处理：同名头用逗号追加，! 只删前面规则已加的头", () => {
    const r = parseHeaders("# c\n/*\n  A: 1\n  B: 2\n/x/*\n  ! B\n  A: 3\n/x/y\n  ! A\n  A: 4\n");
    assert.deepEqual(headersFor(r, "/q"), { a: "1", b: "2" });
    assert.deepEqual(headersFor(r, "/x/z"), { a: "1, 3" });
    assert.deepEqual(headersFor(r, "/x/y"), { a: "4" });
  });
});
