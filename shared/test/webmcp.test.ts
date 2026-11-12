import { test } from "node:test";
import assert from "node:assert/strict";
import { createTools, shotToDevice, swipeSteps, type ToolDeps } from "../../host/src/webmcp.ts";
import type { ClientMsg, Rotation } from "../protocol.ts";

const DEVICE = { width: 1080, height: 2400 };

function harness(o: { connected?: boolean; rotation?: Rotation; shot?: { width: number; height: number }; allow?: boolean } = {}) {
  const h = { sent: [] as ClientMsg[], controls: [] as ClientMsg[], asked: [] as string[], rotation: o.rotation ?? 0 as Rotation };
  const shot = o.shot ?? { width: 540, height: 1200 };
  const deps: ToolDeps = {
    connected: () => o.connected ?? true,
    device: () => DEVICE,
    rotation: () => h.rotation,
    snapshot: async () => ({ ...shot, jpeg: new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }) }),
    send: (m) => (h.sent.push(m), true),
    control: (m) => (h.controls.push(m), true),
    avds: async () => [{ name: "Pixel", running: "no" }, { name: "Busy", running: "no-grpc" }, { name: "On", running: "grpc" }],
    webviews: async () => ({ list: [] }),
    navigate: async () => ({ ok: true }),
    installApk: async () => ({ state: "done" }),
    confirm: (t) => (h.asked.push(t), o.allow ?? true),
  };
  const tools = new Map(createTools(deps).map((t) => [t.name, t]));
  const run = (name: string, input: Record<string, unknown> = {}, signal = new AbortController().signal) =>
    tools.get(name)!.execute(input, { signal }) as Promise<Record<string, unknown>>;
  return { h, tools, run };
}

test("工具名符合 WebMCP 规范：只有字母数字和 _-.，不超过 128，且不重复", () => {
  const { tools } = harness();
  for (const name of tools.keys()) assert.match(name, /^[A-Za-z0-9_.-]{1,128}$/);
  assert.equal(tools.size, 13);
});

test("shotToDevice：截图像素按方向换算到设备面板，超出截图返回 null", () => {
  assert.deepEqual(shotToDevice({ x: 270, y: 600 }, { width: 540, height: 1200, rotation: 0 }, DEVICE), { x: 540, y: 1200 });
  // 顺时针 90°：截图左上角是设备面板的左下角
  assert.deepEqual(shotToDevice({ x: 0, y: 0 }, { width: 1200, height: 540, rotation: 90 }, DEVICE), { x: 0, y: 2399 });
  assert.equal(shotToDevice({ x: 540, y: 0 }, { width: 540, height: 1200, rotation: 0 }, DEVICE), null);
  assert.equal(shotToDevice({ x: 541, y: 0 }, { width: 540, height: 1200, rotation: 0 }, DEVICE), null);
  assert.equal(shotToDevice({ x: -1, y: 0 }, { width: 540, height: 1200, rotation: 0 }, DEVICE), null);
});

test("swipeSteps：按下开头、抬起结尾、终点准确", () => {
  const pts = swipeSteps({ x: 0, y: 1000 }, { x: 0, y: 200 }, 300);
  assert.deepEqual(pts[0], { x: 0, y: 1000, down: true, delayMs: 0 });
  assert.deepEqual(pts.at(-1), { x: 0, y: 200, down: false, delayMs: 0 });
  assert.ok(pts.slice(0, -1).every((p) => p.down));
  assert.ok(Math.abs(pts.reduce((s, p) => s + p.delayMs, 0) - 300) < 1);
});

test("截图返回 base64 图片和尺寸", async () => {
  const { run } = harness();
  const r = await run("droidpier_screenshot");
  assert.deepEqual(r, { ok: true, width: 540, height: 1200, rotation: 0, mimeType: "image/jpeg", data: "AQID" });
});

test("截图编码失败时返回原因，不抛出", async () => {
  const { tools } = harness();
  const t = createTools({ ...({} as ToolDeps), connected: () => true, rotation: () => 0, snapshot: async () => { throw new Error("no 2d context"); } })
    .find((x) => x.name === "droidpier_screenshot")!;
  const r = (await t.execute({}, { signal: new AbortController().signal })) as Record<string, unknown>;
  assert.equal(r.ok, false);
  assert.match(String(r.error), /no 2d context/);
  assert.ok(tools.size > 0);
});

test("点击要先截图；截图后按截图坐标发按下和抬起", async () => {
  const { h, run } = harness();
  await assert.rejects(run("droidpier_tap", { x: 10, y: 10 }), /先调用 droidpier_screenshot/);
  await run("droidpier_screenshot");
  await run("droidpier_tap", { x: 270, y: 600, durationMs: 10 });
  assert.deepEqual(h.sent, [{ t: "touch", x: 540, y: 1200, down: true }, { t: "touch", x: 540, y: 1200, down: false }]);
});

test("截图后设备转了方向，点击要求重新截图", async () => {
  const { h, run } = harness();
  await run("droidpier_screenshot");
  h.rotation = 90;
  await assert.rejects(run("droidpier_tap", { x: 1, y: 1 }), /方向变了/);
  assert.equal(h.sent.length, 0);
});

test("滑动中途被取消也会抬起手指", async () => {
  const { h, run } = harness();
  await run("droidpier_screenshot");
  const ac = new AbortController();
  const p = run("droidpier_swipe", { x1: 100, y1: 1000, x2: 100, y2: 200, durationMs: 1000 }, ac.signal);
  setTimeout(() => ac.abort(), 40);
  await p;
  assert.equal(h.sent.at(-1)!.t === "touch" && (h.sent.at(-1) as { down: boolean }).down, false);
  assert.ok(h.sent.length < 60);
});

test("没有设备时操作类工具不发消息，返回原因", async () => {
  const { h, run } = harness({ connected: false });
  const r = await run("droidpier_press_key", { key: "GoBack" });
  assert.equal(r.ok, false);
  assert.match(String(r.error), /没有连接设备/);
  assert.equal(h.sent.length, 0);
});

test("按键只认列表里的键", async () => {
  const { h, run } = harness();
  await run("droidpier_press_key", { key: "GoHome" });
  assert.deepEqual(h.sent, [{ t: "key", key: "GoHome", eventType: "keypress" }]);
  await assert.rejects(run("droidpier_press_key", { key: "Shutdown" }), /不认识的键/);
});

test("重启、关闭设备先问用户：拒绝时什么都不发", async () => {
  const { h, run } = harness({ allow: false });
  for (const name of ["droidpier_reboot", "droidpier_stop_device"]) {
    const r = await run(name);
    assert.equal(r.ok, false);
  }
  assert.equal(h.asked.length, 2);
  assert.equal(h.controls.length, 0);
});

test("重启：用户允许后才发 reboot", async () => {
  const { h, run } = harness({ allow: true });
  assert.equal((await run("droidpier_reboot")).ok, true);
  assert.deepEqual(h.controls, [{ t: "reboot" }]);
});

test("安装 APK：用户拒绝时不下载", async () => {
  const { run } = harness({ allow: false });
  const realFetch = globalThis.fetch;
  let fetched = false;
  globalThis.fetch = (async () => { fetched = true; return new Response(""); }) as typeof fetch;
  (globalThis as { location?: unknown }).location = { href: "https://droid.devpier.dev/app/" };
  try {
    const r = await run("droidpier_install_apk", { url: "https://example.com/a.apk" });
    assert.equal(r.ok, false);
    assert.equal(fetched, false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("启动设备：没运行的启动，已接管的切换，无法接管的报错", async () => {
  const { h, run } = harness();
  await run("droidpier_start_device", { name: "Pixel" });
  await run("droidpier_start_device", { name: "On" });
  const r = await run("droidpier_start_device", { name: "Busy" });
  assert.equal(r.ok, false);
  assert.deepEqual(h.controls, [{ t: "start", name: "Pixel" }, { t: "use", name: "On" }]);
});
