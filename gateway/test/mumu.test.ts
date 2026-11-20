import { test } from "node:test";
import assert from "node:assert/strict";
import { createMumu, isMumuAddr, MUMU_ADB_PORTS, parseMumuInfo } from "../src/mumu.ts";

function harness(o: { open?: number[]; connected?: string[]; connect?: (addr: string) => Promise<string> } = {}) {
  const h = { connects: [] as string[], logs: [] as string[], open: o.open ?? [], connected: o.connected ?? [] };
  const c = createMumu({
    probe: async (port) => h.open.includes(port),
    connect: async (addr) => {
      h.connects.push(addr);
      return o.connect ? o.connect(addr) : `connected to ${addr}`;
    },
    connected: () => h.connected,
    log: (s) => h.logs.push(s),
  });
  return { h, c };
}

test("MuMu 的 adb 端口开着、adb 里还没有这台：替它 adb connect", async () => {
  const { h, c } = harness({ open: [16384] });
  await c.tick();
  assert.deepEqual(h.connects, ["127.0.0.1:16384"]);
  assert.ok(MUMU_ADB_PORTS.includes(16384));
});

test("已经连上的不再 connect", async () => {
  const { h, c } = harness({ open: [16384], connected: ["127.0.0.1:16384"] });
  await c.tick();
  assert.deepEqual(h.connects, []);
});

test("端口没开（MuMu 没开机）就什么都不做", async () => {
  const { h, c } = harness();
  await c.tick();
  assert.deepEqual(h.connects, []);
  assert.deepEqual(h.logs, []);
});

test("连上时记一条日志；连不上时同样的错误只记一次，下次连上后再失败照样记", async () => {
  let fail = true;
  const { h, c } = harness({ open: [16384], connect: async (addr) => (fail ? `failed to connect to ${addr}` : `connected to ${addr}`) });
  await c.tick();
  await c.tick();
  assert.equal(h.connects.length, 2);
  assert.equal(h.logs.length, 1);
  assert.match(h.logs[0], /连不上 MuMu/);
  fail = false;
  await c.tick();
  assert.match(h.logs.at(-1)!, /已连上 MuMu/);
  fail = true;
  await c.tick();
  assert.match(h.logs.at(-1)!, /连不上 MuMu/);
});

test("adb connect 本身报错（超时等）也只记一次，不抛出", async () => {
  const { h, c } = harness({ open: [16384], connect: async () => { throw new Error("timeout"); } });
  await c.tick();
  await c.tick();
  assert.equal(h.logs.length, 1);
  assert.match(h.logs[0], /timeout/);
});

test("start 调两次也只跑一条循环：同一时刻只 connect 一次", async () => {
  const { h, c } = harness({ open: [16384] });
  c.start();
  c.start();
  await new Promise((r) => setTimeout(r, 20));
  c.stop();
  assert.equal(h.connects.length, 1);
});

// mumutool info all 的真实输出（2026-11-20 本机 MuMuPlayer：一台运行中，一台关机）
const INFO_ALL = JSON.stringify({ errcode: 0, message: "", return: { count: 2, results: [
  { index: 0, name: "我的安卓", state: "running", adb_port: 16384, pid: 26411, state_detail: { enableScreen: false } },
  { index: 1, name: "第二台", state: "stopped" },
] } });

test("parseMumuInfo：读出编号、名字、状态，运行中带 adb 端口的给出 adbId", () => {
  assert.deepEqual(parseMumuInfo(INFO_ALL), [
    { index: 0, name: "我的安卓", state: "running", adbId: "127.0.0.1:16384" },
    { index: 1, name: "第二台", state: "stopped" },
  ]);
});

test("parseMumuInfo：只有一台时 info 0 返回单个对象也认；不认识的状态当关机；errcode 非 0 抛出 message", () => {
  assert.deepEqual(parseMumuInfo(JSON.stringify({ errcode: 0, return: { index: 3, name: "x", state: "starting" } })), [{ index: 3, name: "x", state: "starting" }]);
  assert.deepEqual(parseMumuInfo(JSON.stringify({ errcode: 0, return: { results: [{ index: 0, name: "x", state: "weird" }] } })), [{ index: 0, name: "x", state: "stopped" }]);
  assert.throws(() => parseMumuInfo(JSON.stringify({ errcode: 3, message: "device not found" })), /device not found/);
});

function withTool(info: () => string, o: { open?: number[] } = {}) {
  const h = { tool: [] as string[][], connects: [] as string[], lists: [] as unknown[], logs: [] as string[], open: o.open ?? [] };
  const c = createMumu({
    tool: async (args) => { h.tool.push(args); return args[0] === "info" ? info() : JSON.stringify({ errcode: 0, return: {} }); },
    probe: async (port) => h.open.includes(port),
    connect: async (addr) => { h.connects.push(addr); return `connected to ${addr}`; },
    connected: () => [],
    log: (s) => h.logs.push(s),
  });
  c.onChange((list) => h.lists.push(list));
  return { h, c };
}

test("装了 MuMu：列表有变化才通知；按运行中设备的 adb 端口自动连接（不写死 16384）", async () => {
  const info = JSON.stringify({ errcode: 0, return: { results: [{ index: 2, name: "多开", state: "running", adb_port: 16416 }] } });
  const { h, c } = withTool(() => info, { open: [16416] });
  assert.equal(c.list(), null);
  await c.tick();
  await c.tick();
  assert.deepEqual(h.lists, [[{ index: 2, name: "多开", state: "running", adbId: "127.0.0.1:16416" }]]);
  assert.deepEqual(h.connects, ["127.0.0.1:16416", "127.0.0.1:16416"]);
  assert.equal(isMumuAddr("127.0.0.1:16416"), true);
});

test("装了 MuMu 但都没开机：不探测、不连接", async () => {
  const { h, c } = withTool(() => JSON.stringify({ errcode: 0, return: { results: [{ index: 0, name: "a", state: "stopped" }] } }), { open: [16384] });
  await c.tick();
  assert.deepEqual(h.connects, []);
  assert.deepEqual(c.list(), [{ index: 0, name: "a", state: "stopped" }]);
});

test("open / close：对列表里的设备执行 mumutool，然后马上刷新列表；不在列表里的编号拒绝，不执行", async () => {
  let state = "stopped";
  const { h, c } = withTool(() => JSON.stringify({ errcode: 0, return: { results: [{ index: 0, name: "a", state }] } }));
  await c.tick();
  state = "starting";
  await c.open(0);
  assert.deepEqual(h.tool.filter((a) => a[0] !== "info"), [["open", "0"]]);
  assert.equal(c.list()![0].state, "starting");
  await assert.rejects(c.open(5), /没有编号 5/);
  state = "running";
  await c.tick();
  await c.close(0);
  assert.deepEqual(h.tool.filter((a) => a[0] !== "info"), [["open", "0"], ["close", "0"]]);
});

test("open 时 mumutool 报错：把它的 message 抛给调用方", async () => {
  const c = createMumu({
    tool: async (args) => (args[0] === "info" ? INFO_ALL : JSON.stringify({ errcode: 1, message: "license expired" })),
    probe: async () => false, connect: async () => "", connected: () => [], log: () => {},
  });
  await c.tick();
  await assert.rejects(c.open(1), /license expired/);
});

test("info 读失败：记一次日志，保留上一次的列表", async () => {
  let fail = false;
  const { h, c } = withTool(() => { if (fail) throw new Error("timeout"); return INFO_ALL; });
  await c.tick();
  fail = true;
  await c.tick();
  await c.tick();
  assert.equal(c.list()!.length, 2);
  assert.equal(h.logs.filter((l) => /读不到 MuMu/.test(l)).length, 1);
});

test("同时有两次读列表（定时读和开机后的读）时排队执行，后读到的新状态不会被先发起、晚返回的旧状态盖掉", async () => {
  let n = 0;
  const c = createMumu({
    tool: async (args) => {
      if (args[0] !== "info") return JSON.stringify({ errcode: 0, return: {} });
      const call = ++n;
      // 第一次（定时那次）慢、读到的是旧状态；第二次（开机后那次）快、读到新状态
      if (call === 1) await new Promise((r) => setTimeout(r, 30));
      return JSON.stringify({ errcode: 0, return: { results: [{ index: 0, name: "a", state: call === 1 ? "stopped" : "starting" }] } });
    },
    probe: async () => false, connect: async () => "", connected: () => [], log: () => {},
  });
  await Promise.all([c.tick(), c.tick()]);
  assert.equal(c.list()![0].state, "starting");
});

test("open 只对未运行的设备、close 只对运行中的设备执行；状态不对时拒绝，不执行 mumutool", async () => {
  let state = "running";
  const { h, c } = withTool(() => JSON.stringify({ errcode: 0, return: { results: [{ index: 0, name: "a", state }] } }));
  await c.tick();
  await assert.rejects(c.open(0), /已经开着/);
  state = "starting";
  await c.tick();
  await assert.rejects(c.open(0), /已经开着/);
  await assert.rejects(c.close(0), /没有在运行/);
  assert.deepEqual(h.tool.filter((a) => a[0] !== "info"), []);
});

test("adb 里已经在线的 MuMu 不再重复 adb connect", async () => {
  const info = JSON.stringify({ errcode: 0, return: { results: [{ index: 0, name: "a", state: "running", adb_port: 16384 }] } });
  const connects: string[] = [];
  const c = createMumu({
    tool: async () => info, probe: async () => true,
    connect: async (addr) => { connects.push(addr); return `connected to ${addr}`; },
    connected: () => ["127.0.0.1:16384"], log: () => {},
  });
  await c.tick();
  assert.deepEqual(connects, []);
});
