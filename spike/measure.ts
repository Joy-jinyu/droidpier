// 试验：统一口径测量（审查后重做）。
// - 滑动：同一组 gRPC 触摸序列（连续 16 次上下滑动、每步 16ms、不停顿）；页面模式经页面→网关发出，scrcpy 模式由本脚本直接发
// - 帧率：显示端每秒帧数的中位数（页面：绘制次数分桶；scrcpy：--print-fps）
// - CPU：只算滑动窗口内的累计 CPU 时间增量 / 墙钟时间；包含 qemu、网关、显示端（本脚本起的 Chrome 全部进程或 scrcpy）
// - 每个目标之间冷却 20s；点击延迟只测页面模式，30 次，p50 / p90
// 用法：node spike/measure.ts <qemuPid> <gatewayPid> <target...>，target 为 app 或 scrcpy
// 第 1 阶段：页面目标改为正式页面（pnpm start 的 http://127.0.0.1:7300/）。滑动改由 CDP 真实鼠标事件在画布上发出，
// 序列不变；帧率取宿主模块每秒一行的 console.debug（fps=绘制次数）。正式页面没有点击延迟钩子，不测点击。
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { findRunning } from "../gateway/src/discovery.ts";
import { loadController } from "../gateway/src/sdk.ts";

const [qemu, gw, ...targets] = process.argv.slice(2);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

/** 累计 CPU 秒数（ps 的 TIME 列，格式 [h:]m:ss.ss）。 */
function cpuSeconds(pids: string[]): number {
  if (!pids.length) return 0;
  const out = execFileSync("ps", ["-o", "time=", "-p", pids.join(",")]).toString().trim().split("\n");
  return out.reduce((s, t) => s + t.trim().split(":").reduce((acc, x) => acc * 60 + Number(x), 0), 0);
}
const pidsOf = (pattern: string) => { try { return execFileSync("pgrep", ["-f", pattern]).toString().trim().split("\n").filter(Boolean); } catch { return []; } };

async function window_<T>(display: () => string[], body: () => Promise<T>) {
  const groups = { qemu: [qemu], gw: [gw], display: display() };
  const c0 = Object.fromEntries(Object.entries(groups).map(([k, p]) => [k, cpuSeconds(p)]));
  const t0 = performance.now();
  const r = await body();
  const secs = (performance.now() - t0) / 1000;
  const cpu = Object.fromEntries(Object.entries(groups).map(([k, p]) => [k, Math.round(((cpuSeconds(p) - c0[k]) / secs) * 100)]));
  return { r, cpu };
}

// ---- 页面目标：独立 Chrome + CDP ----
let chrome: ChildProcess | undefined, cdpWs: WebSocket | undefined, cdpId = 0;
const PROFILE_TAG = "emu-measure-chrome-";
const PAGE = "http://127.0.0.1:7300/";
async function ensureChrome() {
  if (cdpWs) return;
  const port = 9452;
  chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
    `--user-data-dir=${mkdtempSync(join(tmpdir(), PROFILE_TAG))}`, `--remote-debugging-port=${port}`,
    "--no-first-run", "--no-default-browser-check", "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--window-size=760,1420", PAGE,
  ], { stdio: "ignore" });
  let target: any;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try { target = ((await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as any[]).find((t) => t.type === "page" && t.url.startsWith(PAGE)); } catch {}
  }
  cdpWs = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => cdpWs!.once("open", r));
  cdpWs.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    const fps = m.method === "Runtime.consoleAPICalled" && /fps=(\d+)/.exec(String(m.params.args[0]?.value));
    if (fps) fpsLog.push({ t: performance.now(), fps: Number(fps[1]) });
  });
  await cdp("Runtime.enable");
  // 窗口高度受屏幕限制，用视口覆盖保证整块画布可见；DPR 固定 2，取帧 1080×2340，与第 0 阶段一致
  await cdp("Emulation.setDeviceMetricsOverride", { width: 760, height: 1260, deviceScaleFactor: 2, mobile: false });
  await sleep(4000);
}
const fpsLog: { t: number; fps: number }[] = [];
const cdp = (method: string, params: object = {}) => new Promise<any>((res) => {
  const my = ++cdpId;
  const on = (raw: any) => { const m = JSON.parse(raw.toString()); if (m.id === my) { cdpWs!.off("message", on); res(m.result); } };
  cdpWs!.on("message", on);
  cdpWs!.send(JSON.stringify({ id: my, method, params }));
});
const mouse = (type: string, x: number, y: number) =>
  cdp("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
/** 与 grpcDrags 同一序列，经页面画布发出（设备坐标按画布位置换算成页面坐标）。 */
async function pageDrags() {
  const r = await evalPage(`(() => { const b = document.querySelector('[data-testid="screen"] canvas').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; })()`);
  const at = (y: number) => [r.x + r.w / 2, r.y + (y / 2340) * r.h] as const;
  const t0 = performance.now();
  for (let k = 0; k < 16; k++) {
    const [a, b] = k % 2 ? [500, 1900] : [1900, 500];
    await mouse("mousePressed", ...at(a));
    for (let i = 1; i <= 20; i++) { await sleep(16); await mouse("mouseMoved", ...at(a + ((b - a) * i) / 20)); }
    await mouse("mouseReleased", ...at(b));
  }
  await sleep(600);
  const t1 = performance.now();
  await sleep(1100); // 等最后一秒的统计行
  // 只取整段落在滑动窗口内的秒
  return { perSec: fpsLog.filter((e) => e.t - 1000 >= t0 && e.t <= t1).map((e) => e.fps) };
}
const evalPage = (expr: string) => new Promise<any>((res) => {
  const my = ++cdpId;
  const on = (raw: any) => { const m = JSON.parse(raw.toString()); if (m.id === my) { cdpWs!.off("message", on); res(m.result.result.value); } };
  cdpWs!.on("message", on);
  cdpWs!.send(JSON.stringify({ id: my, method: "Runtime.evaluate", params: { expression: expr, awaitPromise: true, returnByValue: true } }));
});

// ---- scrcpy 目标：本脚本直接发同一组 gRPC 触摸 ----
const emu = (await findRunning())!;
const ctl = loadController(emu.grpcPort, emu.token);
const touch = (x: number, y: number, down: boolean) =>
  new Promise((r) => ctl.sendTouch({ touches: [{ x, y, identifier: 0, pressure: down ? 1 : 0 }] }, () => r(0)));
async function grpcDrags() {
  for (let k = 0; k < 16; k++) {
    const [a, b] = k % 2 ? [500, 1900] : [1900, 500];
    await touch(540, a, true);
    for (let i = 1; i <= 20; i++) { await sleep(16); await touch(540, a + ((b - a) * i) / 20, true); }
    await touch(540, b, false);
  }
  await sleep(600);
}
const home = () => new Promise((r) => ctl.sendKey({ eventType: "keypress", key: "GoHome" }, () => r(0)));

const results: any[] = [];
for (const t of targets) {
  await home();
  await sleep(20000); // 冷却
  if (t === "app") {
    await ensureChrome();
    const { r, cpu } = await window_(() => pidsOf(PROFILE_TAG), pageDrags);
    results.push({ target: t, fpsMedian: median(r.perSec), perSec: r.perSec, cpu });
  } else if (t === "scrcpy") {
    const log = join(tmpdir(), `scrcpy-measure-${Date.now()}.log`);
    const sc = spawn("sh", ["-c", `exec scrcpy -s emulator-${emu.serial} --no-audio --print-fps --window-title measure > '${log}' 2>&1`]);
    await sleep(5000);
    const before = readFileSync(log, "utf8").split("\n").length;
    const { cpu } = await window_(() => [String(sc.pid)], grpcDrags);
    await sleep(1100);
    const lines = readFileSync(log, "utf8").split("\n").slice(before);
    const perSec = lines.map((l) => /^INFO: (\d+) fps/.exec(l)).filter((m) => m).map((m) => Number(m![1]));
    sc.kill();
    results.push({ target: t, fpsMedian: median(perSec.filter((n) => n > 0)), perSec, cpu });
  }
  console.log(JSON.stringify(results.at(-1)));
}
cdpWs?.close();
chrome?.kill();
ctl.close();
