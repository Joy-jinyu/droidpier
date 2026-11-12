// 试验：Task 3 第 5 步真机核对。独立 Chrome + CDP 真实输入：在设置首页按「旋转」，再点「网络和互联网」，四个方向各一次
// 点的位置：uiautomator 给出 Android 显示坐标 → 按 Android 当前 rotation 换回竖屏面板坐标 → 按画面方向换成画布坐标
// 用法：node spike/check-rotate.ts [url] [截图目录]
import { spawn, execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

const url = process.argv[2] ?? "http://127.0.0.1:7300/";
const shots = process.argv[3] ?? ".superpowers/sdd/2026-11-11-phase2-handy/shots";
mkdirSync(shots, { recursive: true });
const port = 9451;
const adb = (cmd: string) => execSync(`adb -s emulator-5554 ${cmd}`).toString();
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "emu-rot-chrome-"))}`, `--remote-debugging-port=${port}`,
  "--no-first-run", "--no-default-browser-check", "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--window-size=1500,1400", url,
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
  const on = (raw: any) => { const m = JSON.parse(raw.toString()); if (m.id === my) { ws.off("message", on); res(m.result); } };
  ws.on("message", on); ws.send(JSON.stringify({ id: my, method, params }));
});
const ev = async (expr: string) => (await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const click = async (x: number, y: number) => {
  for (const type of ["mousePressed", "mouseReleased"]) { await cdp("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); await sleep(80); }
};
const shot = async (name: string) => {
  const { data } = await cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(shots, name), Buffer.from(data, "base64"));
};
const canvasRect = () => ev(`(() => { const c = document.querySelector('[data-testid="screen"] canvas'); const r = c.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height, pw: c.width, ph: c.height }; })()`);
const slotRect = () => ev(`(() => { const r = document.querySelector('[data-testid="screen"]').getBoundingClientRect(); return [r.width, r.height]; })()`);
const androidRotation = () => Number(/mCurrentRotation=ROTATION_(\d+)/.exec(adb("shell dumpsys window"))![1]);
// 在 uiautomator dump 里找文字，返回中心点的 Android 显示坐标
const findText = (text: string): [number, number] | null => {
  adb("shell uiautomator dump /sdcard/ui.xml");
  const xml = adb("shell cat /sdcard/ui.xml");
  const m = new RegExp(`text="${text}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`).exec(xml);
  return m ? [(+m[1] + +m[3]) / 2, (+m[2] + +m[4]) / 2] : null;
};
const W = 1080, H = 2340;
const displayToPanel = (dx: number, dy: number, ra: number): [number, number] =>
  ra === 90 ? [W - dy, dx] : ra === 180 ? [W - dx, H - dy] : ra === 270 ? [dy, H - dx] : [dx, dy];
// toDevice 的反函数，r 是画面（设备顺时针）方向
const panelToUV = (px: number, py: number, r: number): [number, number] =>
  r === 90 ? [1 - py / H, px / W] : r === 180 ? [1 - px / W, 1 - py / H] : r === 270 ? [py / H, 1 - px / W] : [px / W, py / H];

await cdp("Page.enable");
await cdp("Runtime.enable");
await sleep(4000);
const [bx, by] = await ev(`(() => { const r = document.querySelector('[aria-label="旋转"]').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
const results: any[] = [];
for (const expect of [90, 180, 270, 0]) {
  adb("shell am start -S -n com.android.settings/.Settings");
  await sleep(1500);
  await click(bx, by);
  await sleep(3000);
  const rect = await canvasRect();
  const slot = await slotRect();
  const ra = androidRotation();
  await shot(`rot-${expect}-before.png`);
  const d = findText("Network &amp; internet");
  const row: any = { expect, slot, canvasCss: [rect.width, rect.height], canvasPx: [rect.pw, rect.ph], androidRotation: ra };
  if (d) {
    const [px, py] = displayToPanel(d[0], d[1], ra);
    const [u, v] = panelToUV(px, py, expect);
    const cx = rect.left + u * rect.width, cy = rect.top + v * rect.height;
    row.target = { display: d, panel: [px, py], canvas: [Math.round(cx), Math.round(cy)] };
    await click(cx, cy);
    await sleep(1500);
    await shot(`rot-${expect}-after.png`);
    row.opened = findText("Internet") !== null && findText("Search settings") === null;
    row.focus = /mCurrentFocus=.*/.exec(adb("shell dumpsys window"))?.[0];
  }
  results.push(row);
  console.log(JSON.stringify(row));
}
adb("shell input keyevent KEYCODE_HOME");
ws.close(); chrome.kill();
writeFileSync(join(shots, "rot-results.json"), JSON.stringify(results, null, 2));
process.exit(0);
