// MuMu 模拟器：用它自带的 mumutool 读设备列表、开关机；开机后它不会自己连到本机的 adb server，网关替它 adb connect，
// 这样它就出现在侧栏的「MuMu 模拟器」分组里
import { existsSync } from "node:fs";
import { connect as netConnect } from "node:net";
import type { MumuInfo } from "../../shared/protocol.ts";

/** MuMuPlayer（macOS）自带的命令行工具：info / open / close 都输出 JSON（2026-11-20 本机实测）。 */
export const MUMU_TOOL = "/Applications/MuMuPlayer.app/Contents/MacOS/mumutool";
/** 没装 mumutool（读不到列表）时按这些端口找 MuMu：第一个实例是 16384（2026-11-20 本机实测）。 */
export const MUMU_ADB_PORTS = [16384];
/** 多久看一次（我定的数值：开机后几秒内出现在侧栏；空转只是一次 mumutool info 和一次本机 TCP 探测）。 */
const INTERVAL_MS = 5000;
const PROBE_TIMEOUT_MS = 300;

// 见过的 MuMu adb 端口：真机列表靠它认出哪些是 MuMu（phones.ts 的 parseDevices）
const knownPorts = new Set(MUMU_ADB_PORTS);

/** 这个 adb 设备 id 是不是 MuMu 的地址（127.0.0.1:<MuMu 的 adb 端口>）。 */
export function isMumuAddr(id: string): boolean {
  const m = /^127\.0\.0\.1:(\d+)$/.exec(id);
  return !!m && knownPorts.has(Number(m[1]));
}

/** mumutool 是否装在默认位置。 */
export function mumuInstalled(): boolean {
  return existsSync(MUMU_TOOL);
}

/** 本机这个端口有没有在监听。 */
export function probePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = netConnect({ host: "127.0.0.1", port });
    const done = (ok: boolean) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(PROBE_TIMEOUT_MS, () => done(false));
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
  });
}

const STATES = new Set<MumuInfo["state"]>(["stopped", "starting", "running", "stopping"]);

type ToolReply = { errcode?: number; message?: string; return?: Record<string, unknown> };

/** 解析 mumutool 的 JSON；errcode 非 0 时抛出它的 message。 */
function toolReturn(json: string): Record<string, unknown> {
  const r = JSON.parse(json) as ToolReply;
  if (r.errcode !== 0) throw new Error(r.message || `mumutool errcode ${r.errcode}`);
  return r.return ?? {};
}

/** mumutool info 的输出 → 设备列表：info all 给 results 数组，只问一台时直接给那台。 */
export function parseMumuInfo(json: string): MumuInfo[] {
  const ret = toolReturn(json);
  const rows = Array.isArray(ret.results) ? (ret.results as Record<string, unknown>[]) : [ret];
  return rows
    .filter((r) => Number.isInteger(r.index))
    .map((r) => {
      const state = STATES.has(r.state as MumuInfo["state"]) ? (r.state as MumuInfo["state"]) : "stopped";
      const info: MumuInfo = { index: r.index as number, name: typeof r.name === "string" ? r.name : `MuMu ${r.index}`, state };
      if (state === "running" && Number.isInteger(r.adb_port)) info.adbId = `127.0.0.1:${r.adb_port}`;
      return info;
    });
}

export function createMumu(deps: {
  /** 运行 mumutool <args>，返回它的输出；没装 MuMu 时不传，只按 MUMU_ADB_PORTS 找已经开着的 MuMu。 */
  tool?: (args: string[]) => Promise<string>;
  probe: (port: number) => Promise<boolean>;
  /** adb connect <addr> 的输出；adb 连不上时也是正常返回，输出里写着 failed。 */
  connect: (addr: string) => Promise<string>;
  /** adb 里已经在线的设备 id。 */
  connected: () => string[];
  log: (s: string) => void;
}) {
  // 每件事上次记过的结果：同样的结果不重复记，免得 MuMu 没响应时每 5 秒刷一行
  const last = new Map<string, string>();
  const note = (key: string, s: string) => {
    if (last.get(key) === s) return;
    last.set(key, s);
    deps.log(s);
  };
  const listeners: Array<(list: MumuInfo[]) => void> = [];
  let current: MumuInfo[] | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = true;

  // 读列表排队：定时那次和开关机后那次同时跑时，先发起、晚返回的旧结果不能盖掉新结果
  let reading: Promise<void> = Promise.resolve();
  const refresh = (): Promise<void> => (reading = reading.then(readList));

  async function readList(): Promise<void> {
    if (!deps.tool) return;
    try {
      const next = parseMumuInfo(await deps.tool(["info", "all"]));
      last.delete("info");
      for (const m of next) if (m.adbId) knownPorts.add(Number(m.adbId.split(":")[1]));
      if (JSON.stringify(next) === JSON.stringify(current)) return;
      current = next;
      for (const cb of listeners) cb(current);
    } catch (e) {
      note("info", `读不到 MuMu 的设备列表：${(e as Error).message}`);
    }
  }

  async function tick(): Promise<void> {
    await refresh();
    const addrs = deps.tool
      ? (current ?? []).flatMap((m) => (m.adbId ? [m.adbId] : []))
      : MUMU_ADB_PORTS.map((p) => `127.0.0.1:${p}`);
    for (const addr of addrs) {
      if (deps.connected().includes(addr) || !(await deps.probe(Number(addr.split(":")[1])))) continue;
      const out = await deps.connect(addr).catch((e: Error) => `failed: ${e.message}`);
      note(addr, /connected to/.test(out) ? `已连上 MuMu 模拟器（${addr}）` : `连不上 MuMu 模拟器（${addr}）：${out.trim()}`);
    }
  }

  /** 对列表里的一台执行 mumutool open / close，成功后马上刷新列表（状态变化随 onChange 推出去）。 */
  async function act(verb: "open" | "close", index: number): Promise<void> {
    if (!deps.tool) throw new Error("本机没有安装 MuMu 模拟器");
    const m = (current ?? []).find((x) => x.index === index);
    if (!m) throw new Error(`MuMu 里没有编号 ${index} 的设备`);
    // 列表刷新前页面上的按钮可能被连点：已经在开、在关的不再发一次
    if (verb === "open" && m.state !== "stopped") throw new Error(`${m.name} 已经开着或正在开关机`);
    if (verb === "close" && m.state !== "running") throw new Error(`${m.name} 没有在运行`);
    toolReturn(await deps.tool([verb, String(index)]));
    await tick();
  }

  return {
    tick,
    /** 读到过的 MuMu 列表；没装 MuMu 或还没读到时是 null。 */
    list: () => current,
    onChange(cb: (list: MumuInfo[]) => void) {
      listeners.push(cb);
    },
    open: (index: number) => act("open", index),
    close: (index: number) => act("close", index),
    start() {
      if (!stopped) return;
      stopped = false;
      const loop = () => {
        if (!stopped) timer = setTimeout(() => void tick().finally(loop), INTERVAL_MS);
      };
      void tick().finally(loop);
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
