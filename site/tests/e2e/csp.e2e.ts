import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { serveWithHeaders } from "../serve-with-headers.ts";

const siteDir = join(fileURLToPath(import.meta.url), "..", "..", "..");
const distDir = join(siteDir, "dist");

let browser: Browser;
let base: string;
let close: () => Promise<void>;

/** 打开页面，同时收集 CSP 违规事件、相关控制台报错和页面异常 */
async function openWatched(path: string, setup?: (context: BrowserContext) => Promise<void>) {
  const context = await browser.newContext();
  await setup?.(context);
  const page = await context.newPage();
  const problems: string[] = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (/Content.Security.Policy|Pagefind web worker encountered an error/i.test(text)) {
      problems.push(`console.${msg.type()}: ${text}`);
    }
  });
  page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      console.error(`Content-Security-Policy violation: ${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  const response = await page.goto(base + path, { waitUntil: "load" });
  return { context, page, problems, response: response! };
}

/** 从上到下滚一遍，触发随滚动出现的内容和懒加载 */
async function scrollThrough(page: Page) {
  await page.evaluate(async () => {
    for (let y = 0; y <= document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 50));
    }
  });
}

describe("CSP e2e（按 _headers 加响应头）", () => {
  before(async () => {
    ({ url: base, close } = await serveWithHeaders(distDir));
    browser = await chromium.launch({ channel: "chrome" });
  });

  after(async () => {
    await browser?.close();
    await close?.();
  });

  it("站点页无 CSP 违规", async () => {
    for (const path of ["/", "/docs/getting-started/install/", "/ar/"]) {
      const { context, page, problems, response } = await openWatched(path);
      const csp = response.headers()["content-security-policy"] ?? "";
      assert.match(csp, /script-src 'self'/, `${path} 没有站点 CSP 响应头`);
      await scrollThrough(page);
      await page.waitForTimeout(500);
      const count = await page.evaluate(() => document.querySelectorAll("[data-copy-md], .emu-hero").length);
      assert.ok(count > 0, `${path} 没有复制按钮或 hero`);
      assert.deepEqual(problems, [], `${path} 有 CSP 问题：\n${problems.join("\n")}`);
      await context.close();
    }
  });

  it("CSP 下复制为 Markdown 成功", async () => {
    const { context, page, problems } = await openWatched("/docs/getting-started/install/", (c) =>
      c.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base }),
    );
    const btn = page.locator("[data-copy-md]");
    const copied = await btn.getAttribute("data-copied");
    await btn.click();
    await page.waitForFunction(
      (label) => document.querySelector("[data-copy-md]")?.textContent?.trim() === label,
      copied,
    );
    const text = await page.evaluate(() => navigator.clipboard.readText());
    assert.ok(text.trimStart().startsWith("# "), `剪贴板内容不是 Markdown：${text.slice(0, 60)}`);
    assert.deepEqual(problems, [], problems.join("\n"));
    await context.close();
  });

  it("剪贴板只认点击时同步调用的浏览器（Safari 规则）也能复制为 Markdown", async () => {
    const { context, page, problems } = await openWatched("/docs/getting-started/install/", async (c) => {
      await c.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
      await c.addInitScript(() => {
        // Safari 只在点击处理函数同步执行期间放行剪贴板写入；等 fetch 回来再写就会被拒
        let inGesture = false;
        document.addEventListener("click", () => (inGesture = true), true);
        window.addEventListener("click", () => (inGesture = false));
        const cb = navigator.clipboard;
        const guard = <T extends unknown[]>(fn: (...a: T) => Promise<void>) => (...a: T) =>
          inGesture ? fn(...a) : Promise.reject(new DOMException("not in a user gesture", "NotAllowedError"));
        cb.write = guard(cb.write.bind(cb));
        cb.writeText = guard(cb.writeText.bind(cb));
      });
    });
    const btn = page.locator("[data-copy-md]");
    const copied = await btn.getAttribute("data-copied");
    await btn.click();
    await page.waitForFunction(
      (labels) => labels.includes(document.querySelector("[data-copy-md]")?.textContent?.trim() ?? ""),
      [copied, await btn.getAttribute("data-failed")],
    );
    assert.equal((await btn.textContent())?.trim(), copied, "按钮没有显示复制成功");
    const text = await page.evaluate(() => navigator.clipboard.readText());
    assert.ok(text.trimStart().startsWith("# "), `剪贴板内容不是 Markdown：${text.slice(0, 60)}`);
    assert.deepEqual(problems, [], problems.join("\n"));
    await context.close();
  });

  it("没有 ClipboardItem 的浏览器也能复制为 Markdown", async () => {
    const { context, page, problems } = await openWatched("/docs/getting-started/install/", async (c) => {
      await c.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
      await c.addInitScript(() => {
        // @ts-expect-error 模拟不支持 ClipboardItem 的旧浏览器
        delete window.ClipboardItem;
      });
    });
    assert.equal(await page.evaluate(() => "ClipboardItem" in window), false, "前置条件：ClipboardItem 应已移除");
    const btn = page.locator("[data-copy-md]");
    const copied = await btn.getAttribute("data-copied");
    await btn.click();
    await page.waitForFunction(
      (label) => document.querySelector("[data-copy-md]")?.textContent?.trim() === label,
      copied,
    );
    const text = await page.evaluate(() => navigator.clipboard.readText());
    assert.ok(text.trimStart().startsWith("# "), `剪贴板内容不是 Markdown：${text.slice(0, 60)}`);
    assert.deepEqual(problems, [], problems.join("\n"));
    await context.close();
  });

  it("Markdown 取不到时按钮显示失败", async () => {
    const { context, page } = await openWatched("/docs/getting-started/install/", async (c) => {
      await c.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
      await c.route("**/*.md", (route) => route.fulfill({ status: 404, body: "" }));
    });
    const btn = page.locator("[data-copy-md]");
    const failed = await btn.getAttribute("data-failed");
    await btn.click();
    await page.waitForFunction(
      (label) => document.querySelector("[data-copy-md]")?.textContent?.trim() === label,
      failed,
    );
    await context.close();
  });

  it("CSP 下首页截图能加载", async () => {
    const { context, page, problems } = await openWatched("/");
    await page.waitForFunction(() => {
      const img = document.querySelector<HTMLImageElement>("[data-screen] img");
      return !!img && img.complete && img.naturalWidth === 828;
    }, undefined, { timeout: 10_000 });
    assert.deepEqual(problems, [], problems.join("\n"));
    await context.close();
  });

  it("CSP 下搜索能出结果", async () => {
    const { context, page, problems } = await openWatched("/docs/getting-started/install/");
    await page.locator("button[data-open-modal]:not([disabled])").click();
    const input = page.locator("dialog[open] input");
    await input.fill("install");
    await page.locator("dialog[open] .pagefind-ui__result").first().waitFor({ timeout: 10_000 });
    assert.deepEqual(problems, [], problems.join("\n"));
    await context.close();
  });

  // 设了 EMU_APP_DIR 就必须有 /app/；没设时，默认位置有产物被复制进来也照样测
  const hasApp = !!process.env.EMU_APP_DIR || existsSync(join(distDir, "app", "index.html"));
  it("/app/ 可加载", { skip: hasApp ? false : "没有设置 EMU_APP_DIR，dist 里也没有 /app/" }, async () => {
    assert.ok(existsSync(join(distDir, "app", "index.html")), "dist/app/index.html 不存在");
    const bad: string[] = [];
    const { context, page, problems, response } = await openWatched("/app/", async (c) => {
      c.on("response", (res) => {
        const u = new URL(res.url());
        if (u.origin === base && res.status() !== 200) bad.push(`${res.status()} ${u.pathname}`);
      });
      c.on("requestfailed", (req) => {
        const u = new URL(req.url());
        if (u.origin === base) bad.push(`failed ${u.pathname}: ${req.failure()?.errorText}`);
      });
    });
    const csp = response.headers()["content-security-policy"] ?? "";
    assert.match(csp, /frame-ancestors 'none'/, "/app/ 没有防嵌入");
    assert.doesNotMatch(csp, /, /, "/app/ 的 CSP 被拼了两份");
    await page.locator('[data-testid="screen"]').first().waitFor({ state: "attached", timeout: 15_000 });
    // 本地是 http://127.0.0.1，页面连的是同源网关；线上连的是 ws://127.0.0.1:7300。
    // 这里探测本机其他端口（没人监听，连接被拒不算违规），再探测一个外部地址确认违规确实能被收集到。
    // 不连 7300：那是开发机上真在跑的网关。
    await page.evaluate(() => {
      for (const u of ["ws://127.0.0.1:1/", "ws://localhost:1/", "http://127.0.0.1:1/", "ws://blocked.invalid/"]) {
        try {
          if (u.startsWith("ws")) new WebSocket(u);
          else fetch(u).catch(() => {});
        } catch {
          // 同步抛错也会触发 securitypolicyviolation
        }
      }
    });
    await page.waitForTimeout(1000);
    await page.waitForLoadState("networkidle");
    const control = problems.filter((p) => p.includes("blocked.invalid"));
    assert.ok(control.length > 0, "对照组没收集到违规，检测失效");
    const real = problems.filter((p) => !p.includes("blocked.invalid"));
    assert.deepEqual(real, [], `/app/ 有 CSP 问题：\n${real.join("\n")}`);
    assert.deepEqual(bad, [], `/app/ 有资源没返回 200：\n${bad.join("\n")}`);
    // /app/ 页面没声明图标，浏览器会去要根路径的 favicon.ico（Playwright 不上报这个请求）
    assert.equal((await fetch(base + "/favicon.ico")).status, 200, "根路径 favicon.ico 不存在");
    await context.close();
  });

  it("/app/ 不能被其他页面嵌入", { skip: hasApp ? false : "没有设置 EMU_APP_DIR，dist 里也没有 /app/" }, async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const refused: string[] = [];
    page.on("console", (m) => {
      if (/frame-ancestors/.test(m.text())) refused.push(m.text());
    });
    await page.setContent(`<iframe src="${base}/app/"></iframe>`);
    await page.waitForTimeout(1500);
    const framed = page.frames().find((f) => f.url().startsWith(base));
    assert.ok(refused.length > 0 || !framed, "/app/ 被成功嵌入了");
    await context.close();
  });
});
