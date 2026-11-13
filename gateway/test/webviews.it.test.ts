/**
 * 集成测试：在真机（emulator-5554）上验证 WebView 页面列表。
 * 只在 EMU_IT=1 时运行。
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { createWebViews, defaultFetchJson, findFreePort, makeAdbExec } from "../src/webviews.ts";
import { adbBin } from "../src/platform.ts";
import { emulatorId } from "../src/adb.ts";

if (!process.env.EMU_IT) {
  process.exit(0);
}

const execFileP = promisify(execFileCb);

const SERIAL = 5554;
// 被测 App：一个开着 WebView 调试的 debug 包，界面上有一个按钮能打开 App 内的网页
const PKG = process.env.EMU_IT_PKG ?? "com.example.app.debug";
const OPEN_LABEL = process.env.EMU_IT_OPEN_LABEL ?? "Open Web Page";
const URL_PREFIX = process.env.EMU_IT_URL_PREFIX ?? "https://example.com";

async function adb(...args: string[]): Promise<string> {
  const { stdout } = await execFileP(adbBin(), ["-s", `emulator-${SERIAL}`, ...args], { timeout: 10_000 });
  return stdout;
}

/** 执行 uiautomator dump 并返回 XML 内容。 */
async function uiDump(): Promise<string> {
  await adb("shell", "uiautomator", "dump", "/sdcard/ui.xml");
  const { stdout } = await execFileP(adbBin(), ["-s", `emulator-${SERIAL}`, "shell", "cat", "/sdcard/ui.xml"], {
    timeout: 10_000,
  });
  return stdout;
}

/** 在 UI 层级 XML 里按 content-desc 或 text 查找节点，返回其中心坐标；找不到返回 null。 */
function findNode(xml: string, label: string): { x: number; y: number } | null {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // bounds 格式：[x0,y0][x1,y1]
  for (const attr of ["content-desc", "text"]) {
    const m = xml.match(new RegExp(`${attr}="${esc}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`));
    if (m) {
      return {
        x: Math.round((Number(m[1]) + Number(m[3])) / 2),
        y: Math.round((Number(m[2]) + Number(m[4])) / 2),
      };
    }
  }
  return null;
}

let wv: ReturnType<typeof createWebViews>;

before(async () => {
  // monkey 启动 App（不打开页面，只拉起主进程）
  await execFileP(adbBin(), ["-s", `emulator-${SERIAL}`, "shell", "monkey", "-p", PKG, "-c",
    "android.intent.category.LAUNCHER", "1"], { timeout: 15_000 });

  // 等 App 稳定
  await new Promise((r) => setTimeout(r, 3000));

  // 找到打开网页的按钮并点它
  const coord = findNode(await uiDump(), OPEN_LABEL);
  if (!coord) throw new Error(`未在 UI dump 里找到 "${OPEN_LABEL}"，用 EMU_IT_OPEN_LABEL 指定按钮文字`);
  await adb("shell", "input", "tap", String(coord.x), String(coord.y));
  // 等 H5 页面加载
  await new Promise((r) => setTimeout(r, 4000));

  wv = createWebViews({
    exec: makeAdbExec(emulatorId(SERIAL)),
    fetchJson: defaultFetchJson,
    freePort: findFreePort,
  });
});

after(async () => {
  // 关闭转发
  await wv?.close();
  // 返回键 + 主页键，回到桌面
  await adb("shell", "input", "keyevent", "KEYCODE_BACK");
  await new Promise((r) => setTimeout(r, 500));
  await adb("shell", "input", "keyevent", "KEYCODE_HOME");
});

test("列表里有一个 visible=true、url 以 URL_PREFIX 开头的页面", async () => {
  const pages = await wv.list();
  console.log("[info] 页面列表：", JSON.stringify(pages.map((p) => ({ title: p.title, url: p.url, visible: p.visible, pkg: p.pkg }))));

  const page = pages.find((p) => p.visible && p.url.startsWith(URL_PREFIX));
  assert.ok(page, `期望找到 visible=true 且 url 以 ${URL_PREFIX} 开头的页面，实际页面列表：${JSON.stringify(pages)}`);
});
