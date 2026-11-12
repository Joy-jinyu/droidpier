// 试验：Task 5 修复轮的浏览器核对，不碰系统剪贴板，也不往模拟器发输入
// 页面里把 WebSocket.send 换成只放行 hello/resize 的记录器、把 navigator.clipboard 换成只记录的替身，
// 服务端的 clip 消息直接喂给页面的 onmessage
// 用法：node spike/check-clip-host.ts <url> [截图目录] [CDP 端口]
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

const url = process.argv[2] ?? "http://127.0.0.1:7302/";
const shots = process.argv[3] ?? ".superpowers/sdd/2026-11-11-phase2-handy/shots";
mkdirSync(shots, { recursive: true });
const port = Number(process.argv[4] ?? 9457);
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

const out: Record<string, unknown> = {};
// 页面脚本运行前装好替身：记录发出的消息，只放行 hello / resize（不碰模拟器）；writeText 只记录，不写系统剪贴板
await cdp("Page.enable");
out.inject = await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `
  window.__sent = []; window.__writes = []; window.__failNext = false;
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (d) {
    window.__ws = this;
    if (typeof d === "string") { const m = JSON.parse(d); if (m.t === "hello" || m.t === "resize") return send.call(this, d); window.__sent.push(m); return; }
    return send.call(this, d);
  };
  Object.defineProperty(navigator, "clipboard", { value: { writeText: (t) => {
    if (window.__failNext) { window.__failNext = false; return Promise.reject(new Error("模拟失败")); }
    window.__writes.push(t); return Promise.resolve();
  } } });
` });
await cdp("Emulation.setDeviceMetricsOverride", { width: 900, height: 1300, deviceScaleFactor: 2, mobile: false });
await cdp("Page.reload");
await sleep(4000);
const clipFromServer = (text: string) => ev(`window.__ws.onmessage({ data: JSON.stringify({ t: "clip", text: ${JSON.stringify(text)} }) })`);
const barText = () => ev(`document.querySelector('[aria-label="点击复制"]') ? "shown" : "hidden"`);
try {
  const [cx, cy] = await center('[data-testid="screen"] canvas');
  await click(cx, cy);
  await sleep(200);
  out.active = await ev(`document.activeElement?.tagName`);

  // 1. 长 ASCII 粘贴只发一条 text
  const url = "https://example.com/path?q=" + "x".repeat(3000);
  await ev(`window.__sent = []`);
  await ev(`(() => { const dt = new DataTransfer(); dt.setData("text/plain", ${JSON.stringify(url)});
    document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
  const pasted = await ev(`window.__sent.filter((m) => m.t !== "touch")`);
  out.pasteMsgs = pasted.length;
  out.pasteOk = pasted.length === 1 && pasted[0].t === "text" && pasted[0].text === url;

  // 4. 不经组字的直接插入（Option 字符 / 表情面板走的是这条路）发出去；普通 ASCII 按键只发一次
  await ev(`window.__sent = []`);
  await cdp("Input.insertText", { text: "©" });
  await sleep(100);
  out.insertTextMsgs = await ev(`window.__sent`);
  await ev(`window.__sent = []`);
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, text: "a" });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
  await sleep(100);
  out.asciiKeyMsgs = await ev(`window.__sent`);
  out.imeValue = await ev(`document.querySelector("textarea").value`);

  // 2. 提示条只反映最新一条
  await ev(`window.__failNext = true`);
  await clipFromServer("A");
  await sleep(300);
  out.barAfterAFail = await barText();
  await shot("task5-fix-bar-A.png");
  await clipFromServer("B");
  await sleep(300);
  out.barAfterBOk = await barText();
  out.writesAfterB = await ev(`window.__writes`);
  await ev(`window.__failNext = true`);
  await clipFromServer("C");
  await sleep(300);
  out.barAfterCFail = await barText();
  const [bx, by] = await center('[aria-label="点击复制"]');
  await click(bx, by);
  await sleep(500);
  out.writesAfterClick = await ev(`window.__writes`);
  out.barAfterClick = await barText();
} finally {
  console.log(JSON.stringify(out, null, 2));
  ws.close(); chrome.kill();
}
