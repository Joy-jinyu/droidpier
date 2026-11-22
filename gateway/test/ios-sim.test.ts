import { test } from "node:test";
import assert from "node:assert/strict";
import { connectIosSim, createHelperParser, createIosSims, hasHomeButton, helperName, parseDeviceTypes, parseIosCatalog, parseLastUsedAt, parseSimctlList, IOS_SIM_CAPS, type HelperProcess } from "../src/ios-sim.ts";
import type { IosSimInfo } from "../../shared/protocol.ts";
import type { VideoPacket } from "../src/emulator.ts";

const A = "0A67FFC2-A5BD-43AB-9AA9-6E22B5511D40";
const B = "FBE4D72E-9BA0-4301-B75C-1AE5B19C3B6C";

const SIMCTL = JSON.stringify({
  devices: {
    "com.apple.CoreSimulator.SimRuntime.iOS-18-3": [{ udid: B, name: "iPhone 16 Pro", state: "Booted", isAvailable: true }],
    "com.apple.CoreSimulator.SimRuntime.iOS-27-0": [
      { udid: A, name: "iPhone 11", state: "Shutdown", isAvailable: true },
      { udid: "11111111-1111-1111-1111-111111111111", name: "iPad Air", state: "Shutting Down", isAvailable: true },
      { udid: "22222222-2222-2222-2222-222222222222", name: "Broken", state: "Shutdown", isAvailable: false },
    ],
    "com.apple.CoreSimulator.SimRuntime.watchOS-11-0": [{ udid: "33333333-3333-3333-3333-333333333333", name: "Watch", state: "Shutdown", isAvailable: true }],
  },
});

test("parseSimctlList：只要可用的 iOS 设备；开着的（含开关机中）在前，没开的按最近使用、从没用过的按系统版本新的在前", () => {
  assert.deepEqual(parseSimctlList(SIMCTL).map((s) => [s.name, s.runtime, s.state]), [
    ["iPad Air", "iOS 27.0", "shutting-down"],
    ["iPhone 16 Pro", "iOS 18.3", "booted"],
    ["iPhone 11", "iOS 27.0", "shutdown"],
  ]);
  const OLD = "44444444-4444-4444-4444-444444444444";
  const json = JSON.stringify({ devices: {
    "com.apple.CoreSimulator.SimRuntime.iOS-27-0": [{ udid: A, name: "iPhone 11", state: "Shutdown" }, { udid: OLD, name: "iPhone 17", state: "Shutdown" }],
    "com.apple.CoreSimulator.SimRuntime.iOS-18-3": [{ udid: B, name: "iPhone 16 Pro", state: "Shutdown" }],
  } });
  assert.deepEqual(parseSimctlList(json, new Map([[B, 2000], [A, 1000]])).map((s) => s.name), ["iPhone 16 Pro", "iPhone 11", "iPhone 17"]);
});

test("parseLastUsedAt：读 device.plist 里的 lastUsedAt，没有时为 undefined", () => {
  const plist = '<plist><dict><key>isDeleted</key>\n\t<false/>\n\t<key>lastUsedAt</key>\n\t<date>2026-11-21T16:29:39Z</date></dict></plist>';
  assert.equal(parseLastUsedAt(plist), Date.parse("2026-11-21T16:29:39Z"));
  assert.equal(parseLastUsedAt("<plist><dict><key>name</key><string>x</string></dict></plist>"), undefined);
});

test("createIosSims：按 device.plist 的 lastUsedAt 排序，读不到的当作没用过", async () => {
  const json = JSON.stringify({ devices: { "com.apple.CoreSimulator.SimRuntime.iOS-27-0": [{ udid: A, name: "iPhone 11", state: "Shutdown" }, { udid: B, name: "iPhone 16 Pro", state: "Shutdown" }] } });
  const sims = createIosSims({
    simctl: async () => json,
    devicePlist: async (u) => { if (u === A) throw new Error("ENOENT"); return "<key>lastUsedAt</key><date>2026-11-21T00:00:00Z</date>"; },
    log: () => {},
  });
  await sims.refresh();
  assert.deepEqual(sims.list()!.map((s) => s.name), ["iPhone 16 Pro", "iPhone 11"]);
});

function fakeSimctl(json = SIMCTL) {
  const calls: string[][] = [];
  let out = json;
  let fail: string | null = null;
  return {
    calls,
    set: (j: string) => void (out = j),
    failNext: (m: string) => void (fail = m),
    simctl: async (args: string[]) => {
      calls.push(args);
      if (args[0] === "list") return out;
      if (fail) {
        const m = fail;
        fail = null;
        throw new Error(m);
      }
      return "";
    },
  };
}

test("createIosSims：读到列表就通知；没装 Xcode（simctl 失败）时列表是 null，同样的错误只记一次", async () => {
  const logs: string[] = [];
  const bad = createIosSims({ simctl: async () => { throw new Error("xcrun: error: unable to find utility \"simctl\""); }, log: (s) => logs.push(s) });
  await bad.refresh();
  await bad.refresh();
  assert.equal(bad.list(), null);
  assert.equal(logs.length, 1);

  const f = fakeSimctl();
  const sims = createIosSims({ simctl: f.simctl, log: () => {} });
  const seen: IosSimInfo[][] = [];
  sims.onChange((l) => seen.push(l));
  await sims.refresh();
  await sims.refresh();
  assert.equal(seen.length, 1);
  assert.equal(sims.booted(B), true);
  assert.equal(sims.booted(A), false);
});

test("createIosSims：open 只开没开机的，先把状态报成启动中再执行 simctl boot；close 只关开着的", async () => {
  const f = fakeSimctl();
  const sims = createIosSims({ simctl: f.simctl, log: () => {} });
  const seen: IosSimInfo[][] = [];
  sims.onChange((l) => seen.push(l));
  await sims.refresh();
  await sims.open(A);
  assert.deepEqual(f.calls.filter((c) => c[0] !== "list"), [["boot", A]]);
  assert.equal(seen[1].find((s) => s.udid === A)?.state, "booting");
  await assert.rejects(sims.close(A), /没有在运行/);
  await assert.rejects(sims.open(B), /已经开着/);
  await assert.rejects(sims.open("44444444-4444-4444-4444-444444444444"), /找不到/);
  await sims.close(B);
  assert.deepEqual(f.calls.filter((c) => c[0] !== "list").at(-1), ["shutdown", B]);
});

test("createIosSims：simctl boot 失败时照样重读列表，不让行一直停在启动中", async () => {
  const f = fakeSimctl();
  const sims = createIosSims({ simctl: f.simctl, log: () => {} });
  await sims.refresh();
  f.failNext("Unable to boot");
  await assert.rejects(sims.open(A), /Unable to boot/);
  assert.equal(sims.list()!.find((s) => s.udid === A)?.state, "shutdown");
});

test("helperName：源码一变名字就变", () => {
  assert.notEqual(helperName("a"), helperName("b"));
  assert.match(helperName("a"), /^simhelper-[0-9a-f]{16}$/);
});

/** 按小程序的格式拼一个包。 */
function pkt(type: number, body: Buffer): Buffer {
  const h = Buffer.alloc(5);
  h.writeUInt32LE(body.length + 1, 0);
  h[4] = type;
  return Buffer.concat([h, body]);
}
function videoPkt(flags: number, w: number, h: number, data: number[]): Buffer {
  const b = Buffer.alloc(9);
  b[0] = flags;
  b.writeUInt32LE(w, 1);
  b.writeUInt32LE(h, 5);
  return pkt(1, Buffer.concat([b, Buffer.from(data)]));
}
const eventPkt = (e: object) => pkt(2, Buffer.from(JSON.stringify(e)));

test("createHelperParser：任意切块都能切出视频包和事件", () => {
  const got: string[] = [];
  const feed = createHelperParser({
    video: (p) => got.push(`v ${p.config ? "c" : p.key ? "k" : "d"} ${p.width}x${p.height} ${[...p.data].join(",")}`),
    event: (e) => got.push(`e ${e.t}`),
  });
  const all = Buffer.concat([eventPkt({ t: "ready", width: 828, height: 1792 }), videoPkt(1, 828, 1792, [0, 0, 0, 1, 7]), videoPkt(2, 828, 1792, [9]), videoPkt(0, 828, 1792, [])]);
  for (let i = 0; i < all.length; i += 3) feed(all.subarray(i, i + 3));
  assert.deepEqual(got, ["e ready", "v c 828x1792 0,0,0,1,7", "v k 828x1792 9", "v d 828x1792 "]);
});

function fakeHelper() {
  const writes: string[] = [];
  let data: (b: Buffer) => void = () => {};
  let exit: (c: number | null) => void = () => {};
  let killed = false;
  const p: HelperProcess = {
    onData: (cb) => void (data = cb),
    onExit: (cb) => void (exit = cb),
    write: (l) => void writes.push(l),
    kill: () => void (killed = true),
  };
  return { p, writes, push: (b: Buffer) => data(b), exit: (c: number | null) => exit(c), killed: () => killed };
}

const deps = (h: ReturnType<typeof fakeHelper>, more = {}) => ({
  spawnHelper: async () => h.p,
  screenshot: async () => Buffer.from("png"),
  setClipboard: async () => {},
  getClipboard: async () => "clip",
  log: () => {},
  ...more,
});

test("connectIosSim：等到第一个关键帧才连上，尺寸取自小程序；新订阅者先收到配置包；触摸和关键帧请求原样交给小程序", async () => {
  const h = fakeHelper();
  const pending = connectIosSim(A, "iPhone 11", deps(h));
  await new Promise((r) => setImmediate(r));
  h.push(Buffer.concat([eventPkt({ t: "ready", width: 828, height: 1792 }), videoPkt(1, 828, 1792, [1]), videoPkt(2, 828, 1792, [2])]));
  const s = await pending;
  assert.equal(s.kind, "phone");
  assert.deepEqual(s.caps, IOS_SIM_CAPS);
  assert.deepEqual(s.device, { width: 828, height: 1792 });
  assert.equal(s.avdName, "iPhone-11");
  const got: VideoPacket[] = [];
  s.video!((p) => got.push(p));
  assert.deepEqual(got.map((p) => p.config), [true]);
  await s.touch(10, 20, true);
  s.requestKeyFrame!();
  assert.deepEqual(h.writes.map((l) => JSON.parse(l)), [{ t: "touch", x: 10, y: 20, down: true }, { t: "keyframe" }]);
  h.writes.length = 0;
  await s.key("Enter", "keydown");
  assert.deepEqual(h.writes.map((l) => JSON.parse(l)), [{ t: "hidkey", usage: 0x28, down: true }]);
  await assert.rejects(s.key("AudioVolumeUp", "keydown"), /音量键/);
  assert.equal(await s.getClipboard(), "clip");
});

test("connectIosSim：小程序报错或退出时连接失败，带上原因；连上后退出则会话关闭", async () => {
  const h1 = fakeHelper();
  const p1 = connectIosSim(A, "iPhone 11", deps(h1));
  await new Promise((r) => setImmediate(r));
  h1.push(eventPkt({ t: "error", message: "模拟器没有屏幕（没开机？）" }));
  await assert.rejects(p1, /没有屏幕/);
  assert.equal(h1.killed(), true);

  const h2 = fakeHelper();
  const p2 = connectIosSim(A, "iPhone 11", deps(h2, { firstFrameMs: 30 }));
  await assert.rejects(p2, /等不到模拟器的画面/);

  const h3 = fakeHelper();
  const p3 = connectIosSim(A, "iPhone 11", deps(h3));
  await new Promise((r) => setImmediate(r));
  h3.push(Buffer.concat([eventPkt({ t: "ready", width: 828, height: 1792 }), videoPkt(2, 828, 1792, [2])]));
  const s = await p3;
  let closed = 0;
  s.onClosed(() => closed++);
  h3.exit(1);
  assert.equal(closed, 1);
  await s.touch(1, 1, true);
  assert.equal(h3.writes.length, 0);
});

test("hasHomeButton：iPhone SE / 8 及更早、第 9 代及更早的普通 iPad 有 Home 键，别的是全面屏", () => {
  const T = "com.apple.CoreSimulator.SimDeviceType.";
  for (const t of ["iPhone-SE-3rd-generation", "iPhone-8", "iPhone-8-Plus", "iPad-9th-generation"]) assert.equal(hasHomeButton(T + t), true, t);
  for (const t of ["iPhone-11", "iPhone-16-Pro-Max", "iPhone-Duo", "iPad-10th-generation", "iPad-Pro-11-inch-M5", "iPhone-Air"]) assert.equal(hasHomeButton(T + t), false, t);
  assert.equal(hasHomeButton(undefined), false);
});

test("parseDeviceTypes：UDID 到机型", () => {
  const json = JSON.stringify({ devices: { "com.apple.CoreSimulator.SimRuntime.iOS-27-0": [{ udid: A, name: "x", deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-11" }] } });
  assert.equal(parseDeviceTypes(json).get(A), "com.apple.CoreSimulator.SimDeviceType.iPhone-11");
});

test("parseIosCatalog：只要可用的 iOS 版本，新的在前；机型只要 iPhone、iPad，iPhone 在前", () => {
  const dt = (name: string, family: string) => ({ name, productFamily: family, identifier: `com.apple.CoreSimulator.SimDeviceType.${name.replace(/ /g, "-")}` });
  const json = JSON.stringify({ runtimes: [
    { identifier: "com.apple.CoreSimulator.SimRuntime.iOS-18-3", name: "iOS 18.3", version: "18.3.1", platform: "iOS", isAvailable: true, supportedDeviceTypes: [dt("iPad Air", "iPad"), dt("iPhone 16", "iPhone"), dt("Apple Watch", "Apple Watch")] },
    { identifier: "com.apple.CoreSimulator.SimRuntime.iOS-27-0", name: "iOS 27.0", version: "27.0", platform: "iOS", isAvailable: true, supportedDeviceTypes: [dt("iPhone 18 Pro", "iPhone")] },
    { identifier: "com.apple.CoreSimulator.SimRuntime.watchOS-12-0", name: "watchOS 12.0", version: "12.0", platform: "watchOS", isAvailable: true, supportedDeviceTypes: [] },
    { identifier: "com.apple.CoreSimulator.SimRuntime.iOS-26-0", name: "iOS 26.0", version: "26.0", platform: "iOS", isAvailable: false, supportedDeviceTypes: [] },
  ] });
  const c = parseIosCatalog(json);
  assert.deepEqual(c.runtimes.map((r) => r.name), ["iOS 27.0", "iOS 18.3"]);
  assert.deepEqual(c.runtimes[1].devices.map((d) => d.name), ["iPhone 16", "iPad Air"]);
  assert.equal(c.runtimes[1].devices[0].id, "com.apple.CoreSimulator.SimDeviceType.iPhone-16");
});

test("createIosSims.create：simctl create 名字、机型、版本，返回 udid 并马上刷新列表", async () => {
  const calls: string[][] = [];
  const sims = createIosSims({ simctl: async (args) => { calls.push(args); return args[0] === "create" ? "0A67FFC2-A5BD-43AB-9AA9-6E22B5511D40\n" : JSON.stringify({ devices: {} }); }, log: () => {} });
  const udid = await sims.create("我的 iPhone", "com.apple.CoreSimulator.SimDeviceType.iPhone-16", "com.apple.CoreSimulator.SimRuntime.iOS-18-3");
  assert.equal(udid, "0A67FFC2-A5BD-43AB-9AA9-6E22B5511D40");
  assert.deepEqual(calls[0], ["create", "我的 iPhone", "com.apple.CoreSimulator.SimDeviceType.iPhone-16", "com.apple.CoreSimulator.SimRuntime.iOS-18-3"]);
  assert.deepEqual(calls[1], ["list", "devices", "available", "-j"]);
});

test("createIosSims.create：simctl 输出的不是 UDID 时报错，不把它当成新模拟器", async () => {
  const sims = createIosSims({ simctl: async (args) => (args[0] === "create" ? "Usage: simctl create ...\n" : JSON.stringify({ devices: {} })), log: () => {} });
  await assert.rejects(sims.create("a", "com.apple.CoreSimulator.SimDeviceType.iPhone-16", "com.apple.CoreSimulator.SimRuntime.iOS-18-3"), /没有返回新模拟器的 UDID/);
});
