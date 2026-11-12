import { execFileSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { findRunning } from "../src/discovery.ts";
import { connectEmulator, type EmulatorSession } from "../src/emulator.ts";
import { loadController } from "../src/sdk.ts";
import { adbPath } from "../src/platform.ts";

const skip = process.env.EMU_IT !== "1" && "需要真模拟器，设置 EMU_IT=1 运行";
// 设备内复制会被网关广播给所有连着这台模拟器的页面（比如用户开着的 7300），页面有焦点时会写进电脑剪贴板，
// 所以单独再要一个开关，只在确认没有别的页面连着时手动打开
const skipDeviceCopy = skip || (process.env.EMU_IT_CLIP !== "1" && "设备内复制会写进连着同一模拟器的页面所在电脑的剪贴板，设置 EMU_IT_CLIP=1 运行");

let session: EmulatorSession;
test.before(async () => {
  if (skip) return;
  const running = await findRunning();
  assert.ok(running, "没有找到运行中的模拟器");
  session = await connectEmulator(running);
});
test.after(() => session?.close());

/** 先存设备剪贴板，测完写回去。 */
const keepDeviceClip = (t: import("node:test").TestContext) => {
  const saved = session.getClipboard();
  t.after(async () => session.setClipboard(await saved));
  return saved;
};

test("connectEmulator 读到 device 1080x2340", { skip }, () => {
  assert.deepEqual(session.device, { width: 1080, height: 2340 });
});

test("frames 在 sendKey GoHome 之后 2s 内至少回调 1 次，且 header 的宽高等于请求的尺寸", { skip }, async () => {
  const size = { width: 540, height: 1170 };
  let first: { width: number; height: number; len: number } | undefined;
  const got = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("2s 内没有收到帧")), 2000);
    const cancel = session.frames(size, (h, data) => {
      first ??= { width: h.width, height: h.height, len: data.length };
      clearTimeout(timer);
      cancel();
      resolve();
    });
  });
  await new Promise((r) => setTimeout(r, 200));
  await session.key("GoHome", "keypress");
  await got;
  assert.deepEqual(first, { width: 540, height: 1170, len: 540 * 1170 * 4 });
});

test("text('中文 ab') 之后用 getClipboard 读回的文本相同", { skip }, async (t) => {
  await keepDeviceClip(t);
  await session.text("中文 ab");
  const running = (await findRunning())!;
  const c = loadController(running.grpcPort, running.token);
  const clip = await new Promise<any>((res, rej) => c.getClipboard({}, (e: Error | null, r: any) => (e ? rej(e) : res(r))));
  c.close();
  assert.equal(clip.text, "中文 ab");
});

test("setClipboard 500KB 文本后 getClipboard 完整相同", { skip }, async (t) => {
  await keepDeviceClip(t);
  const text = "abc中文\n".repeat(Math.ceil(500 * 1024 / 12)).slice(0, 500 * 1024);
  await session.setClipboard(text);
  assert.equal(await session.getClipboard(), text);
});

test("emoji '👍🏻中文' 往返相同", { skip }, async (t) => {
  await keepDeviceClip(t);
  await session.setClipboard("👍🏻中文");
  assert.equal(await session.getClipboard(), "👍🏻中文");
});

test("setClipboard 写入的内容不会经 onClipboard 回来", { skip }, async (t) => {
  await keepDeviceClip(t);
  const got: string[] = [];
  session.onClipboard((t) => got.push(t));
  await new Promise((r) => setTimeout(r, 300));
  await session.setClipboard(`echo${Date.now()}`);
  await new Promise((r) => setTimeout(r, 1000));
  assert.deepEqual(got, []);
});

// 设备内复制：API 34 没有 `cmd clipboard`，改为打开短信编辑框，adb input text 输入，
// 再用 input keycombination 113 29（Ctrl+A）、113 31（Ctrl+C）复制；最后清空草稿并回到桌面
test("streamClipboard 在设备内复制后 1s 内收到新内容", { skip: skipDeviceCopy }, async (t) => {
  await keepDeviceClip(t);
  const adb = (...args: string[]) => execFileSync(adbPath(), ["-s", `emulator-${session.serial}`, "shell", ...args]);
  const want = `devcopy${Date.now() % 100000}`;
  const got: string[] = [];
  session.onClipboard((t) => got.push(t));
  adb("am", "start", "-a", "android.intent.action.SENDTO", "-d", "sms:10086");
  await new Promise((r) => setTimeout(r, 3000));
  try {
    adb("input", "text", want);
    adb("input", "keycombination", "113", "29");
    const t0 = Date.now();
    adb("input", "keycombination", "113", "31");
    while (!got.includes(want) && Date.now() - t0 < 1000) await new Promise((r) => setTimeout(r, 20));
    assert.ok(got.includes(want), `1s 内没收到，收到的是 ${JSON.stringify(got)}`);
  } finally {
    adb("input", "keycombination", "113", "29");
    adb("input", "keyevent", "67");
    adb("input", "keyevent", "4");
    adb("input", "keyevent", "4");
    adb("input", "keyevent", "3");
  }
});

test("连不上时 reject，错误消息包含端口号", { skip }, async () => {
  await assert.rejects(connectEmulator({ pid: process.pid, grpcPort: 1, serial: 1 }, 500), /:1\b/);
});
