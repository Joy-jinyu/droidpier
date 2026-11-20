import { test } from "node:test";
import assert from "node:assert/strict";
import { createPhones, parseDevices, takeFrames } from "../src/phones.ts";
import type { AdbStreamHandlers } from "../src/adb.ts";
import type { PhoneInfo } from "../../shared/protocol.ts";

// 2026-11-13 本机 adb track-devices -l / adb devices -l 实测
const LINE_EMU = "emulator-5554          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:3";
const LINE_PHONE = "R5CR10WN52H            device 1-1.3 product:o1qzcx model:SM_G9910 device:o1q transport_id:6";
const frame = (s: string) => s.length.toString(16).padStart(4, "0") + s;
const tick = () => new Promise((r) => setImmediate(r));

test("takeFrames：一帧分两次到达时先留着，凑齐再切", () => {
  const f = frame(`${LINE_PHONE}\n`);
  const a = takeFrames(f.slice(0, 10));
  assert.deepEqual(a.frames, []);
  const b = takeFrames(a.rest + f.slice(10));
  assert.deepEqual(b, { frames: [`${LINE_PHONE}\n`], rest: "" });
});

test("takeFrames：两帧粘在一起时切成两帧", () => {
  assert.deepEqual(takeFrames(frame("a\n") + frame("")), { frames: ["a\n", ""], rest: "" });
});

test("parseDevices：跳过模拟器，真机取 id、状态和 model（下划线换成 -）", () => {
  assert.deepEqual(parseDevices(`${LINE_EMU}\n${LINE_PHONE}\n`), [{ id: "R5CR10WN52H", state: "device", trackModel: "SM-G9910" }]);
});

test("parseDevices：unauthorized 保留，recovery / offline 归为 offline", () => {
  const out = parseDevices("A\tunauthorized usb:1-1 transport_id:7\nB\toffline transport_id:8\nC\trecovery transport_id:9\n");
  assert.deepEqual(out, [{ id: "A", state: "unauthorized" }, { id: "B", state: "offline" }, { id: "C", state: "offline" }]);
});

/** 假 adb：stream 记下回调供测试推数据，exec 按设备 id 返回 getprop 输出。 */
function fakes(props: Record<string, string | Error> = {}) {
  const f = {
    streams: [] as AdbStreamHandlers[],
    stopped: 0,
    execCalls: [] as Array<{ id: string; args: string[] }>,
    sleeps: [] as number[],
    wake: () => {},
    changes: [] as PhoneInfo[][],
    deps: undefined as unknown as Parameters<typeof createPhones>[0],
  };
  f.deps = {
    stream: (_args, h) => {
      f.streams.push(h);
      return { stop: () => void f.stopped++ };
    },
    exec: (id) => async (args) => {
      f.execCalls.push({ id, args });
      const v = props[id];
      if (v instanceof Error) throw v;
      return v ?? "";
    },
    sleep: (ms) => new Promise<void>((r) => { f.sleeps.push(ms); f.wake = r; }),
    log: () => {},
  };
  return f;
}

const GETPROP = ["shell", "getprop ro.product.manufacturer; getprop ro.product.model; getprop ro.build.version.release"];

test("createPhones：可用的手机补查厂商、型号、版本；未授权的不查", async () => {
  const f = fakes({ R5CR10WN52H: "samsung\nSM-G9910\n12\n" });
  const p = createPhones(f.deps);
  p.onChange((l) => f.changes.push(l));
  p.start();
  f.streams[0].onData(frame(`${LINE_PHONE}\nX\tunauthorized usb:1-2 transport_id:9\n`));
  await tick();
  assert.deepEqual(p.list(), [
    { id: "R5CR10WN52H", state: "device", manufacturer: "samsung", model: "SM-G9910", android: "12" },
    { id: "X", state: "unauthorized" },
  ]);
  assert.deepEqual(f.execCalls, [{ id: "R5CR10WN52H", args: GETPROP }]);
});

test("createPhones：未授权变成可用时补查，查询失败时用 track 行里的型号", async () => {
  const f = fakes({ R5CR10WN52H: new Error("device offline") });
  const p = createPhones(f.deps);
  p.start();
  f.streams[0].onData(frame("R5CR10WN52H\tunauthorized usb:1-1 transport_id:5\n"));
  await tick();
  assert.deepEqual(f.execCalls, []);
  f.streams[0].onData(frame(`${LINE_PHONE}\n`));
  await tick();
  assert.equal(f.execCalls.length, 1);
  assert.deepEqual(p.list(), [{ id: "R5CR10WN52H", state: "device", model: "SM-G9910" }]);
});

test("createPhones：同一台手机再次出现不重复查询（按 id 缓存）", async () => {
  const f = fakes({ R5CR10WN52H: "samsung\nSM-G9910\n12\n" });
  const p = createPhones(f.deps);
  p.start();
  f.streams[0].onData(frame(`${LINE_PHONE}\n`));
  await tick();
  f.streams[0].onData(frame(""));
  f.streams[0].onData(frame(`${LINE_PHONE}\n`));
  await tick();
  assert.equal(f.execCalls.length, 1);
  assert.equal(p.list()[0].android, "12");
});

test("createPhones：流结束后列表清空并通知，按退避重启", async () => {
  const f = fakes({ R5CR10WN52H: "samsung\nSM-G9910\n12\n" });
  const p = createPhones(f.deps);
  p.onChange((l) => f.changes.push(l));
  p.start();
  f.streams[0].onData(frame(`${LINE_PHONE}\n`));
  await tick();
  f.streams[0].onExit(1);
  await tick();
  assert.deepEqual(f.changes.at(-1), []);
  assert.deepEqual(f.sleeps, [1000]);
  f.wake();
  await tick();
  assert.equal(f.streams.length, 2);
  f.streams[1].onExit(1);
  await tick();
  assert.deepEqual(f.sleeps, [1000, 2000]);
});

test("createPhones：stop 之后流结束不再重启", async () => {
  const f = fakes();
  const p = createPhones(f.deps);
  p.start();
  p.stop();
  assert.equal(f.stopped, 1);
  f.streams[0].onExit(null);
  await tick();
  assert.deepEqual(f.sleeps, []);
  assert.equal(f.streams.length, 1);
});

test("createPhones：查询失败不缓存，重新插拔后会再查", async () => {
  const props: Record<string, string | Error> = { R5CR10WN52H: new Error("adb: device still authorizing") };
  const f = fakes(props);
  const p = createPhones(f.deps);
  p.start();
  f.streams[0].onData(frame(`${LINE_PHONE}\n`));
  await tick();
  assert.deepEqual(p.list(), [{ id: "R5CR10WN52H", state: "device", model: "SM-G9910" }]);
  props.R5CR10WN52H = "samsung\nSM-G9910\n12\n";
  f.streams[0].onData(frame(""));
  f.streams[0].onData(frame(`${LINE_PHONE}\n`));
  await tick();
  assert.equal(f.execCalls.length, 2);
  assert.equal(p.list()[0].android, "12");
});

test("createPhones：adb 一直起不来时只记第一次，收到设备表后再失败会重新记", async () => {
  const f = fakes();
  const logs: string[] = [];
  const p = createPhones({ ...f.deps, log: (s) => logs.push(s) });
  p.start();
  for (let i = 0; i < 3; i++) {
    f.streams[i].onExit(-2);
    await tick();
    f.wake();
    await tick();
  }
  assert.equal(logs.filter((l) => l.includes("track-devices")).length, 1);
  f.streams[3].onData(frame(""));
  f.streams[3].onExit(1);
  await tick();
  assert.equal(logs.filter((l) => l.includes("track-devices")).length, 2);
});

test("parseDevices：MuMu 的 adb 地址标成 emulator: mumu，别的网络设备照旧算真机", () => {
  const list = parseDevices("127.0.0.1:16384\tdevice product:REA-AN00 model:REA_AN00 device:REA-AN00\n192.168.1.5:5555\tdevice model:Pixel_7\n");
  assert.deepEqual(list, [
    { id: "127.0.0.1:16384", state: "device", trackModel: "REA-AN00", emulator: "mumu" },
    { id: "192.168.1.5:5555", state: "device", trackModel: "Pixel-7" },
  ]);
});
