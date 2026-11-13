import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContextOptions } from "playwright-core";

const siteDir = join(fileURLToPath(import.meta.url), "..", "..", "..");

const HEADLINE = "The Android emulator, smooth in your browser.";
const SUBTITLE = "One command to install. No Android Studio required.";
const INSTALL = "curl -fsSL https://droid.devpier.dev/install.sh | sh";

/** 找一个空闲端口给 astro preview 用 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForServer(url: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // 还没起来
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`preview 没在 ${timeoutMs}ms 内响应：${url}`);
}

let server: ChildProcess;
let browser: Browser;
let base: string;

async function openPage(path: string, opts: BrowserContextOptions = {}) {
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  await page.goto(base + path, { waitUntil: "load" });
  return { context, page };
}

describe("首页 e2e", () => {
  before(async () => {
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    // --ignore-lock：astro 7 默认只允许一个 preview 实例，别和其他会话抢锁
    server = spawn(
      process.execPath,
      [
        join(siteDir, "node_modules", "astro", "bin", "astro.mjs"),
        "preview", "--host", "127.0.0.1", "--port", String(port), "--ignore-lock",
      ],
      { cwd: siteDir, stdio: "ignore" },
    );
    await waitForServer(base + "/");
    browser = await chromium.launch({ channel: "chrome" });
  });

  after(async () => {
    await browser?.close();
    server?.kill();
  });

  it("首页标语逐字", async () => {
    const { context, page } = await openPage("/");
    const h1s = await page.locator("h1").allTextContents();
    assert.deepEqual(h1s.map((t) => t.trim()), [HEADLINE]);
    const subtitle = await page.locator("[data-hero-tagline]").textContent();
    assert.equal(subtitle?.trim(), SUBTITLE);
    await context.close();
  });

  /** 从上到下滚一遍，让随滚动出现和视口内动画都被触发 */
  async function scrollThrough(page: import("playwright-core").Page) {
    await page.evaluate(async () => {
      for (let y = 0; y <= document.body.scrollHeight; y += 400) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 50));
      }
    });
  }

  it("正常模式下有运行中的动画（reduced-motion 测试的对照）", async () => {
    const { context, page } = await openPage("/");
    await scrollThrough(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1500);
    const running = await page.evaluate(
      () => document.getAnimations().filter((a) => a.playState === "running").length,
    );
    assert.ok(running > 0, "正常模式下没有任何运行中的动画");
    await context.close();
  });

  it("暂停动画按钮停掉循环动画，并记住选择", async () => {
    const { context, page } = await openPage("/");
    const toggle = page.locator("[data-motion-toggle]");
    assert.ok(await toggle.isVisible(), "暂停按钮不可见");
    assert.equal(await toggle.getAttribute("aria-pressed"), "false");
    await toggle.click();
    assert.equal(await toggle.getAttribute("aria-pressed"), "true");
    await scrollThrough(page);
    await page.waitForTimeout(1500);
    const running = await page.evaluate(
      () => document.getAnimations().filter((a) => a.playState === "running").length,
    );
    assert.equal(running, 0, "暂停后仍有运行中的动画");
    await page.reload({ waitUntil: "load" });
    assert.equal(
      await page.locator("[data-motion-toggle]").getAttribute("aria-pressed"),
      "true",
      "刷新后没有记住暂停",
    );
    await context.close();
  });

  it("中途开启减少动态效果：无运行中动画", async () => {
    const { context, page } = await openPage("/");
    await page.locator("[data-live]").first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);
    const running = () =>
      page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
    assert.ok((await running()) > 0, "前置条件：正常模式下视口内的循环动画应在运行");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForTimeout(500);
    assert.equal(await running(), 0, "切换后仍有运行中的动画");
    await context.close();
  });

  it("375px 下安装命令不在单词中间折行", async () => {
    const { context, page } = await openPage("/", {
      viewport: { width: 375, height: 812 },
      reducedMotion: "reduce",
    });
    const code = page.locator(".emu-steps__term [data-type]");
    await code.scrollIntoViewIfNeeded();
    const lines = await code.evaluate((el) => el.getClientRects().length);
    assert.equal(lines, 1, `安装命令被折成 ${lines} 行`);
    const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
    assert.ok(r.sw <= r.iw, `375px 下横向溢出：${r.sw} > ${r.iw}`);
    await context.close();
  });

  it("reduced-motion 无运行中动画", async () => {
    const { context, page } = await openPage("/", { reducedMotion: "reduce" });
    await page.evaluate(async () => {
      for (let y = 0; y <= document.body.scrollHeight; y += 400) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 50));
      }
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(500);
    const running = await page.evaluate(
      () => document.getAnimations().filter((a) => a.playState === "running").length,
    );
    assert.equal(running, 0, "reduced-motion 下仍有运行中的动画");
    await context.close();
  });

  it("手机里是静态截图：片段列表和左右滑动都能切换截图，屏幕上没有热点框", async () => {
    const { context, page } = await openPage("/");
    const shot = page.locator("[data-screen] img");
    const showing = () =>
      shot.evaluate((img) => {
        const el = img as HTMLImageElement;
        return { path: new URL(el.src).pathname, alt: el.alt, loaded: el.complete && el.naturalWidth > 0 };
      });
    assert.equal(await page.locator("video").count(), 0, "首页还有 video");
    assert.equal(await page.locator("[data-screen] button").count(), 0, "手机屏幕上还有按钮（热点框）");
    assert.deepEqual(await showing(), { path: "/media/screen-1.webp", alt: "Home screen", loaded: true });

    const second = page.locator("[data-clip]").nth(1);
    await second.click();
    assert.equal((await showing()).path, "/media/screen-2.webp", "点片段列表第 2 项没有切到第 2 张");
    assert.equal((await showing()).alt, "Open Settings");
    await page.waitForFunction(() => {
      const img = document.querySelector<HTMLImageElement>("[data-screen] img");
      return !!img && img.complete && img.naturalWidth > 0;
    });
    assert.equal(await second.getAttribute("aria-pressed"), "true");

    // 在屏幕范围内从一侧拖到另一侧（松手点必须还在屏幕上）
    const swipe = async (from: number, to: number) => {
      const b = (await page.locator("[data-screen]").boundingBox())!;
      const y = b.y + b.height / 2;
      await page.mouse.move(b.x + b.width * from, y);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width * to, y, { steps: 5 });
      await page.mouse.up();
    };
    await swipe(0.8, 0.2);
    assert.equal((await showing()).path, "/media/screen-3.webp", "向左滑没有切到下一张");
    assert.equal((await showing()).alt, "Scroll a list");
    assert.equal(await page.locator("[data-clip]").nth(2).getAttribute("aria-pressed"), "true");
    await page.waitForFunction(() => {
      const img = document.querySelector<HTMLImageElement>("[data-screen] img");
      return !!img && img.complete && img.naturalWidth > 0;
    });
    await swipe(0.2, 0.8);
    assert.equal((await showing()).path, "/media/screen-2.webp", "向右滑没有切回上一张");
    await context.close();
  });

  it("安装命令可复制", async () => {
    const { context, page } = await openPage("/");
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
    await page.locator("[data-copy-command]").click();
    const text = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(text, INSTALL);
    await context.close();
  });

  it("ar 首页为 rtl 且无横向溢出", async () => {
    const { context, page } = await openPage("/ar/");
    const r = await page.evaluate(() => ({
      dir: getComputedStyle(document.documentElement).direction,
      sw: document.documentElement.scrollWidth,
      iw: innerWidth,
    }));
    assert.equal(r.dir, "rtl");
    assert.ok(r.sw <= r.iw, `ar 首页横向溢出：${r.sw} > ${r.iw}`);
    await context.close();
  });

  it("375px 宽无横向滚动", async () => {
    for (const path of ["/", "/docs/guides/troubleshooting/"]) {
      const { context, page } = await openPage(path, { viewport: { width: 375, height: 812 } });
      const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
      assert.ok(r.sw <= r.iw, `${path} 在 375px 下横向溢出：${r.sw} > ${r.iw}`);
      await context.close();
    }
  });

  it("禁用 JS 时核心内容可见", async () => {
    const { context, page } = await openPage("/", { javaScriptEnabled: false });
    assert.ok(await page.locator("h1").isVisible(), "h1 不可见");
    assert.ok(await page.getByText(INSTALL, { exact: true }).first().isVisible(), "安装命令不可见");
    assert.ok(
      await page.locator('a[href="/docs/getting-started/install/"]').first().isVisible(),
      "没有可见的安装文档链接",
    );
    await context.close();
  });

  /** 页面里所有有直接文字、背景是纯色的元素中，对比度低于 4.5 的那些（WCAG AA） */
  function lowContrastText(page: import("playwright-core").Page) {
    return page.evaluate(() => {
      const rgba = (s: string) => {
        const m = s.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0];
        return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 };
      };
      const lum = (c: { r: number; g: number; b: number }) => {
        const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
      };
      // 往上找第一个不透明背景；遇到渐变、背景图或半透明背景就跳过这个元素（算不准）
      const bgOf = (el: Element) => {
        for (let e: Element | null = el; e; e = e.parentElement) {
          const cs = getComputedStyle(e);
          if (cs.backgroundImage !== "none" && e !== document.body && e !== document.documentElement) return null;
          const c = rgba(cs.backgroundColor);
          if (c.a > 0.95) return c;
          if (c.a > 0) return null;
        }
        return rgba(getComputedStyle(document.body).backgroundColor);
      };
      const bad: string[] = [];
      for (const el of document.querySelectorAll("body *")) {
        if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim())) continue;
        const box = el.getBoundingClientRect();
        if (!box.width || !box.height || el.closest("[aria-hidden=true]")) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
        const bg = bgOf(el);
        if (!bg) continue;
        const [hi, lo] = [lum(rgba(cs.color)), lum(bg)].sort((a, b) => b - a);
        const ratio = (hi + 0.05) / (lo + 0.05);
        if (ratio < 4.5) bad.push(`${ratio.toFixed(2)} <${el.tagName.toLowerCase()}> "${el.textContent?.trim().slice(0, 40)}"`);
      }
      return bad;
    });
  }

  it("亮色主题下文档页和首页文字对比度达到 4.5:1", async () => {
    for (const path of ["/docs/getting-started/first-run/", "/"]) {
      const { context, page } = await openPage(path, { colorScheme: "light", reducedMotion: "reduce" });
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
      if (path !== "/") {
        assert.ok(await page.locator(".sl-markdown-content h2").count() > 0, "前置条件：文档页要有 h2");
      }
      assert.deepEqual(await lowContrastText(page), [], `${path} 亮色下有对比度不足的文字`);
      await context.close();
    }
  });

  it("页脚许可证链接用主题色，暗色和亮色下对比度都达到 4.5:1（含悬停）", async () => {
    for (const colorScheme of ["dark", "light"] as const) {
      for (const path of ["/docs/getting-started/install/", "/"]) {
        const { context, page } = await openPage(path, { colorScheme, reducedMotion: "reduce" });
        assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), colorScheme);
        const link = page.locator(".emu-license a");
        await link.scrollIntoViewIfNeeded();
        const measure = () =>
          link.evaluate((a) => {
            const rgba = (s: string) => {
              const m = s.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0];
              return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 };
            };
            const lum = (c: { r: number; g: number; b: number }) => {
              const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
              return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
            };
            let bg = rgba(getComputedStyle(document.body).backgroundColor);
            for (let e: Element | null = a; e; e = e.parentElement) {
              const c = rgba(getComputedStyle(e).backgroundColor);
              if (c.a > 0) {
                bg = c;
                break;
              }
            }
            const color = getComputedStyle(a).color;
            const [hi, lo] = [lum(rgba(color)), lum(bg)].sort((x, y) => y - x);
            return { color, ratio: (hi + 0.05) / (lo + 0.05) };
          });
        const tag = `${colorScheme} ${path}`;
        const idle = await measure();
        assert.notEqual(idle.color, "rgb(0, 0, 238)", `${tag} 页脚链接是浏览器默认蓝色`);
        assert.ok(idle.ratio >= 4.5, `${tag} 页脚链接 ${idle.color} 对比度 ${idle.ratio.toFixed(2)} < 4.5`);
        await link.hover();
        const hover = await measure();
        assert.ok(hover.ratio >= 4.5, `${tag} 悬停时页脚链接 ${hover.color} 对比度 ${hover.ratio.toFixed(2)} < 4.5`);
        await context.close();
      }
    }
  });

  it("ar 文档页 375px 下代码块从命令开头显示", async () => {
    const { context, page } = await openPage("/ar/docs/getting-started/install/", {
      viewport: { width: 375, height: 812 },
    });
    const r = await page.evaluate(() => {
      const pre = document.querySelector(".sl-markdown-content pre")!;
      const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
      let t: Node | null;
      while ((t = walker.nextNode()) && !t.textContent?.trim());
      const i = t!.textContent!.search(/\S/);
      const range = document.createRange();
      range.setStart(t!, i);
      range.setEnd(t!, i + 1);
      const ch = range.getBoundingClientRect();
      const box = pre.getBoundingClientRect();
      return { ch: t!.textContent![i], left: ch.left, right: ch.right, boxL: box.left, boxR: box.right };
    });
    assert.ok(
      r.left >= r.boxL - 1 && r.right <= r.boxR + 1,
      `第一个字符 "${r.ch}" 在 ${r.left}..${r.right}，代码块可见区 ${r.boxL}..${r.boxR}`,
    );
    await context.close();
  });

  it("ar 首页副标题是相连的阿拉伯字形", async () => {
    const { context, page } = await openPage("/ar/", { viewport: { width: 375, height: 812 }, reducedMotion: "reduce" });
    // 相连字形和强制断开（每个字母之间插 ZWNJ）的字形宽度不同；用了没有阿拉伯字形的等宽回退字体或字距时两者一样宽
    const r = await page.evaluate(() => {
      const t = document.querySelector("[data-hero-tagline]") as HTMLElement;
      const word = "للتثبيت";
      const measure = (s: string) => {
        const span = document.createElement("span");
        span.textContent = s;
        span.style.whiteSpace = "nowrap";
        t.append(span);
        const w = span.getBoundingClientRect().width;
        span.remove();
        return w;
      };
      return { joined: measure(word), isolated: measure([...word].join("\u200C")) };
    });
    assert.ok(Math.abs(r.joined - r.isolated) > 1, `相连 ${r.joined}px 与断开 ${r.isolated}px 一样宽，字母没有连写`);
    await context.close();
  });

  it("ar / hi 首页文字没有字距", async () => {
    for (const loc of ["ar", "hi"]) {
      const { context, page } = await openPage(`/${loc}/`, { reducedMotion: "reduce" });
      const spaced = await page.evaluate(() =>
        [...document.querySelectorAll("main *")]
          .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim()))
          .filter((el) => !["normal", "0px"].includes(getComputedStyle(el).letterSpacing))
          .map((el) => `${el.tagName.toLowerCase()} "${el.textContent?.trim().slice(0, 20)}" ${getComputedStyle(el).letterSpacing}`),
      );
      assert.deepEqual(spaced, [], `${loc} 首页有带字距的文字`);
      await context.close();
    }
  });

  it("ar 首页副标题的提示符在行首并指向文字", async () => {
    const { context, page } = await openPage("/ar/", { viewport: { width: 375, height: 812 }, reducedMotion: "reduce" });
    // 提示符在 RTL 的行首（右端）。截下那一小块，看强调色（青色）笔画：指向左边的「<」左端收成一个点、右端张开
    const clip = await page.evaluate(() => {
      const r = document.querySelector("[data-hero-tagline]")!.getBoundingClientRect();
      const em = parseFloat(getComputedStyle(document.querySelector("[data-hero-tagline]")!).fontSize);
      return { x: r.right - 1.5 * em, y: r.top, width: 1.5 * em, height: 1.6 * em };
    });
    const png = (await page.screenshot({ clip })).toString("base64");
    const spread = await page.evaluate(async (src) => {
      const img = new Image();
      img.src = "data:image/png;base64," + src;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d")!;
      g.drawImage(img, 0, 0);
      const { data } = g.getImageData(0, 0, c.width, c.height);
      // 强调色是青色（绿、蓝两个通道都明显高于红色），这样的像素算作提示符的笔画
      const ink = (x: number, y: number) => {
        const i = (y * c.width + x) * 4;
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
        return g > 80 && b > 80 && g > r + 40 && b > r + 40;
      };
      const cols: number[][] = [];
      for (let x = 0; x < c.width; x++) {
        const ys = [];
        for (let y = 0; y < c.height; y++) if (ink(x, y)) ys.push(y);
        if (ys.length) cols.push(ys);
      }
      const extent = (ys: number[]) => ys[ys.length - 1] - ys[0];
      return { n: cols.length, left: cols.length ? extent(cols[0]) : 0, right: cols.length ? extent(cols[cols.length - 1]) : 0 };
    }, png);
    assert.ok(spread.n > 0, "提示符区域里没有找到强调色笔画");
    assert.ok(spread.right > spread.left, `提示符左端张开 ${spread.left}px、右端 ${spread.right}px，它朝右，背离文字`);
    await context.close();
  });

  it("375px 下各语言副标题不超出视口", async () => {
    for (const loc of ["", "ar", "hi", "de", "ru"]) {
      const { context, page } = await openPage(`/${loc ? loc + "/" : ""}`, {
        viewport: { width: 375, height: 812 },
        reducedMotion: "reduce",
      });
      const r = await page.evaluate(() => {
        const t = document.querySelector("[data-hero-tagline]")!;
        const range = document.createRange();
        range.selectNodeContents(t);
        const box = range.getBoundingClientRect();
        return { l: box.left, r: box.right, iw: innerWidth };
      });
      assert.ok(r.l >= 0 && r.r <= r.iw, `${loc || "en"} 副标题 ${r.l}..${r.r} 超出 0..${r.iw}`);
      await context.close();
    }
  });

  it("首页不连接本机", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const hosts = new Set<string>();
    const sockets: string[] = [];
    page.on("request", (req) => {
      const u = new URL(req.url());
      if (u.protocol !== "data:" && u.protocol !== "blob:") hosts.add(u.hostname);
    });
    page.on("websocket", (ws) => sockets.push(ws.url()));
    await page.goto(base + "/", { waitUntil: "networkidle" });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    const bad = [...hosts].filter((h) => h !== "127.0.0.1" && h !== "localhost");
    assert.deepEqual(bad, [], `首页请求了其他主机：${bad.join(", ")}`);
    assert.deepEqual(sockets, [], `首页打开了 WebSocket：${sockets.join(", ")}`);
    await context.close();
  });
});
