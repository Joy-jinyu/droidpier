// 试验：Task 5 第 5 步真机核对剪贴板互通。独立 Chrome + CDP 真实输入
// 系统剪贴板和用户共用，这里不读也不写它：粘贴用合成的 paste 事件，writeText 换成只记录的替身
// 1. 电脑 → 设备：在隐藏 textarea 上派发带中文的 paste 事件，看短信输入框里出现这段中文
// 2. 设备 → 电脑：设备里 Ctrl+A / Ctrl+C 复制，看页面用同样内容调了 writeText
// 3. 自动写失败：第一次 writeText 失败，提示条出现，真点「点击复制」后 writeText 收到设备内容、提示条消失
// 用法：node spike/check-clip.ts [url] [截图目录]
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

const url = process.argv[2] ?? "http://127.0.0.1:7302/";
const shots = process.argv[3] ?? ".superpowers/sdd/2026-11-11-phase2-handy/shots";
mkdirSync(shots, { recursive: true });
const port = 9456;
const adb = (...args: string[]) => execFileSync("adb", ["-s", "emulator-5554", "shell", ...args]).toString();
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "emu-clip-chrome-"))}`, `--remote-debugging-port=${port}`,
  "--no-first-run", "--no-default-browser-check", "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--window-size=900,1400", url,
], { stdio: "ignore" });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let target: any;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = ((await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as any[]).find((t) => t.type === "page" && t.url.startsWith(url)); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.once("open", r));
let id = 0;
const cdp = (method: string, params: object = {}) => new Promise<any>((res) => {
  const my = ++id;
  const on = (raw: any) => { const m = JSON.parse(raw.toString()); if (m.id === my) { ws.off("message", on); res(m.result ?? m.error); } };
  ws.on("message", on); ws.send(JSON.stringify({ id: my, method, params }));
});
const ev = async (expr: string) => (await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: false })).result?.value;
const click = async (x: number, y: number) => {
  for (const type of ["mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
};
const center = async (sel: string) => ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
const shot = async (name: string) => {
  const { data } = await cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(shots, name), Buffer.from(data, "base64"));
};
const fieldText = () => {
  adb("uiautomator", "dump", "/sdcard/clip-ui.xml");
  return adb("cat", "/sdcard/clip-ui.xml").match(/<node[^>]*EditText[^>]*>/)?.[0]?.match(/ text="([^"]*)"/)?.[1] ?? "";
};

const out: Record<string, unknown> = {};
await cdp("Page.bringToFront");
// 屏幕不够高时窗口会被压矮，固定视口让整块画面都在可点范围内
await cdp("Emulation.setDeviceMetricsOverride", { width: 900, height: 1300, deviceScaleFactor: 2, mobile: false });
await sleep(4000);
adb("am", "start", "-a", "android.intent.action.SENDTO", "-d", "sms:10086");
await sleep(3000);
try {
  // 1. 电脑 → 设备
  const zh = `电脑复制的中文${Date.now() % 1000}`;
  // 点画面上的短信输入框（设备竖屏坐标约 530,1497），焦点进隐藏 textarea，设备输入框也保持焦点
  const [fx, fy] = await ev(`(() => { const r = document.querySelector('[data-testid="screen"] canvas').getBoundingClientRect(); return [r.x + r.width * 530 / 1080, r.y + r.height * 1497 / 2340]; })()`);
  out.hit = await ev(`[${fx}, ${fy}, innerWidth, innerHeight, document.elementFromPoint(${fx}, ${fy})?.tagName]`);
  await click(fx, fy);
  await sleep(300);
  out.activeIsIme = await ev(`document.activeElement?.tagName`);
  out.pasteDefaultPrevented = await ev(`(() => { const dt = new DataTransfer(); dt.setData("text/plain", ${JSON.stringify(zh)});
    const e = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
    document.activeElement.dispatchEvent(e); return e.defaultPrevented; })()`);
  await sleep(1500);
  out.pasteWant = zh;
  out.pasteField = fieldText();
  out.pasteOk = String(out.pasteField).includes(zh);
  await shot("task5-paste.png");
  // 纯 ASCII 走逐字按键
  adb("input", "keycombination", "113", "29");
  adb("input", "keyevent", "67");
  await sleep(300);
  await ev(`(() => { const dt = new DataTransfer(); dt.setData("text/plain", "Hi 42");
    document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
  await sleep(1500);
  out.asciiField = fieldText();
  out.asciiOk = out.asciiField === "Hi 42";

  await ev(`(() => { window.__writes = []; window.__failNext = false;
    navigator.clipboard.writeText = (t) => { if (window.__failNext) { window.__failNext = false; return Promise.reject(new Error("模拟失败")); } window.__writes.push(t); return Promise.resolve(); }; })()`);
  // 2. 设备 → 电脑：清空输入框，输入 ASCII 后全选复制
  adb("input", "keycombination", "113", "29");
  adb("input", "keyevent", "67");
  const dev = `devcopy${Date.now() % 100000}`;
  adb("input", "text", dev);
  adb("input", "keycombination", "113", "29");
  adb("input", "keycombination", "113", "31");
  await sleep(1500);
  out.copyWant = dev;
  out.copyGot = await ev(`window.__writes.at(-1)`);
  out.copyOk = out.copyGot === dev;

  // 3. 自动写失败 → 提示条 → 真点「点击复制」
  await ev(`window.__failNext = true`);
  const dev2 = `devbar${Date.now() % 100000}`;
  adb("input", "keycombination", "113", "29");
  adb("input", "keyevent", "67");
  adb("input", "text", dev2);
  adb("input", "keycombination", "113", "29");
  adb("input", "keycombination", "113", "31");
  await sleep(1500);
  out.barShown = await ev(`!!document.querySelector('[aria-label="点击复制"]')`);
  out.writesBeforeClick = await ev(`window.__writes.length`);
  await shot("task5-clip-bar.png");
  const [bx, by] = await center('[aria-label="点击复制"]');
  await click(bx, by);
  await sleep(800);
  out.barWant = dev2;
  out.barGot = await ev(`window.__writes.at(-1)`);
  out.writesAfterClick = await ev(`window.__writes.length`);
  out.barOk = out.barGot === dev2;
  out.barHidden = !(await ev(`!!document.querySelector('[aria-label="点击复制"]')`));
} finally {
  adb("input", "keycombination", "113", "29");
  adb("input", "keyevent", "67");
  adb("input", "keyevent", "4");
  adb("input", "keyevent", "4");
  adb("input", "keyevent", "3");
  adb("rm", "-f", "/sdcard/clip-ui.xml");
  console.log(JSON.stringify(out, null, 2));
  ws.close(); chrome.kill();
}
