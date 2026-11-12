// 试验：在独立 Chrome 里打开 nsh web 应用，用 CDP 的真实输入逐项验证 Task 5 的 (a)-(d)
// 用法：node spike/check-nsh.ts <url>
import { spawn, execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

const url = process.argv[2] ?? "http://127.0.0.1:8796/";
const port = 9448;
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "emu-nsh-chrome-"))}`, `--remote-debugging-port=${port}`,
  "--no-first-run", "--no-default-browser-check", "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--window-size=900,1350", url,
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
const logs: string[] = [];
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.method === "Runtime.consoleAPICalled") logs.push(`${m.params.type}: ${m.params.args.map((a: any) => a.value ?? a.description).join(" ")}`);
  if (m.method === "Log.entryAdded") logs.push(`${m.params.entry.level}: ${m.params.entry.text}`);
  if (m.method === "Runtime.exceptionThrown") logs.push(`exception: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
});
const cdp = (method: string, params: object = {}) => new Promise<any>((res) => {
  const my = ++id;
  const on = (raw: any) => { const m = JSON.parse(raw.toString()); if (m.id === my) { ws.off("message", on); res(m.result); } };
  ws.on("message", on); ws.send(JSON.stringify({ id: my, method, params }));
});
const ev = async (expr: string) => (await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const click = async (x: number, y: number) => {
  for (const type of ["mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
};
const center = async (sel: string) => ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
const focus = () => execSync("adb -s emulator-5554 shell dumpsys window | grep mCurrentFocus | tail -1").toString().trim();

await cdp("Runtime.enable"); await cdp("Log.enable");
await sleep(4000);
const out: Record<string, unknown> = {};

// (a) 开发模式下 web.host 生效：canvas 在占位元素里、有画面帧、主页按钮经 host.call 生效
out.a_canvasInSlot = await ev(`!!document.querySelector('[data-testid="screen"] canvas')`);
out.a_frames = await ev(`window.__emu?.frames`);
execSync("adb -s emulator-5554 shell am start -n com.android.settings/.Settings");
await sleep(1500);
out.a_focusBefore = focus();
const [hx, hy] = await center('[aria-label="主页"]');
await click(hx, hy);
await sleep(1500);
out.a_focusAfter = focus();

// (b) 连续切换 20 次，canvas 始终在占位元素里且画面持续更新
let lost = 0;
const [tx, ty] = await center('[aria-label="切换"]');
for (let i = 0; i < 20; i++) {
  await click(tx, ty); await sleep(150);
  if (!(await ev(`!!document.querySelector('[data-testid="screen"] canvas')`))) lost++;
}
out.b_lostCount = lost;
out.b_reattach = await ev(`window.__emu.reattach`);
out.b_flipsShown = await ev(`document.body.innerText.match(/切换次数 (\\d+)/)?.[1]`);
const f0 = await ev(`window.__emu.frames`);
execSync("adb -s emulator-5554 shell input swipe 540 1900 540 600 300");
await sleep(1200);
out.b_framesAfterToggle = (await ev(`window.__emu.frames`)) - f0;
execSync("adb -s emulator-5554 shell input keyevent KEYCODE_HOME");

// (c) 点画布后按 a / Enter / Backspace，canvas 收到 keydown；Cmd+R 的默认行为没被拦
const [cx, cy] = await center('[data-testid="screen"] canvas');
await click(cx, cy - 400);
await ev(`window.__emu.keys = []`);
for (const [key, code, vk] of [["a", "KeyA", 65], ["Enter", "Enter", 13], ["Backspace", "Backspace", 8]] as const) {
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, text: key === "a" ? "a" : undefined });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk });
}
await sleep(300);
out.c_keys = await ev(`window.__emu.keys`);
out.c_activeIsCanvas = await ev(`document.activeElement === window.__emu.cv`);
out.c_cmdRPrevented = await ev(`(() => { const e = new KeyboardEvent("keydown", { key: "r", code: "KeyR", metaKey: true, bubbles: true, cancelable: true }); window.__emu.cv.dispatchEvent(e); return e.defaultPrevented; })()`);

// (d) 没有 CSP 拦截 WebSocket
out.d_cspErrors = logs.filter((l) => /Content Security Policy|Refused to connect/i.test(l));
out.logsTail = logs.slice(-15);
console.log(JSON.stringify(out, null, 2));
ws.close(); chrome.kill();
