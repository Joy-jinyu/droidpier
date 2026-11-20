// 真机列表：adb track-devices -l 一有变化就输出整张设备表，这里解析出真机（排除模拟器），并给可用的手机补上厂商、型号和版本
import type { PhoneInfo } from "../../shared/protocol.ts";
import type { AdbStream, AdbStreamHandlers } from "./adb.ts";
import { isMumuAddr } from "./mumu.ts";

type TrackedDevice = { id: string; state: PhoneInfo["state"]; trackModel?: string; emulator?: "mumu" };

/** track-devices 的输出是一帧帧的：4 位 16 进制长度 + 设备表。不够一帧的部分原样留到下次。 */
export function takeFrames(buf: string): { frames: string[]; rest: string } {
  const frames: string[] = [];
  let rest = buf;
  while (rest.length >= 4) {
    const len = parseInt(rest.slice(0, 4), 16);
    if (Number.isNaN(len) || rest.length < 4 + len) break;
    frames.push(rest.slice(4, 4 + len));
    rest = rest.slice(4 + len);
  }
  return { frames, rest };
}

/** 解析一帧设备表；模拟器归 AVD 列表管，这里跳过。 */
export function parseDevices(payload: string): TrackedDevice[] {
  const out: TrackedDevice[] = [];
  for (const line of payload.split("\n")) {
    const [id, state, ...rest] = line.trim().split(/\s+/);
    if (!id || !state || id.startsWith("emulator-")) continue;
    const d: TrackedDevice = { id, state: state === "device" || state === "unauthorized" ? state : "offline" };
    // track 行里型号的 - 被换成了 _（SM-G9910 → SM_G9910）
    const model = rest.find((f) => f.startsWith("model:"))?.slice("model:".length);
    if (model) d.trackModel = model.replace(/_/g, "-");
    if (isMumuAddr(id)) d.emulator = "mumu";
    out.push(d);
  }
  return out;
}

/** 一条 adb shell 取三项，省两次往返。 */
const GETPROP = "getprop ro.product.manufacturer; getprop ro.product.model; getprop ro.build.version.release";

/** adb server 重启（比如用户跑了 adb kill-server）时 track-devices 会退出；按这个间隔重连，用完后一直用最后一个（我定的数值）。 */
const BACKOFF_MS = [1000, 2000, 5000];

export function createPhones(deps: {
  stream: (args: string[], h: AdbStreamHandlers) => AdbStream;
  exec: (id: string) => (args: string[]) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  log?: (s: string) => void;
}) {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = deps.log ?? ((s: string) => console.log(s));
  // 按设备 id 缓存查到的厂商、型号、版本；查成功过就不再查
  const props = new Map<string, Pick<PhoneInfo, "manufacturer" | "model" | "android">>();
  const querying = new Set<string>();
  const listeners: Array<(list: PhoneInfo[]) => void> = [];
  let tracked: TrackedDevice[] = [];
  let current: PhoneInfo[] = [];
  let stream: AdbStream | null = null;
  let stopped = true;
  let failures = 0;

  const emit = () => {
    const next = tracked.map((d): PhoneInfo => {
      const p: PhoneInfo = { id: d.id, state: d.state, ...(d.emulator ? { emulator: d.emulator } : {}) };
      const got = props.get(d.id);
      if (got) Object.assign(p, got);
      else if (d.trackModel) p.model = d.trackModel;
      return p;
    });
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    current = next;
    for (const cb of listeners) cb(current);
  };

  const lookup = (d: TrackedDevice) => {
    if (d.state !== "device" || props.has(d.id) || querying.has(d.id)) return;
    querying.add(d.id);
    deps.exec(d.id)(["shell", GETPROP]).then(
      (out) => {
        const [manufacturer, model, android] = out.split("\n").map((s) => s.trim());
        props.set(d.id, { ...(manufacturer ? { manufacturer } : {}), ...(model ? { model } : d.trackModel ? { model: d.trackModel } : {}), ...(android ? { android } : {}) });
      },
      // 失败不缓存：刚点「允许」时 adb shell 可能还没准备好，重新插拔或下次状态变化时再查
      (e: Error) => log(`读取 ${d.id} 的型号失败：${e.message}`),
    ).finally(() => {
      querying.delete(d.id);
      emit();
    });
  };

  const run = () => {
    let buf = "";
    stream = deps.stream(["track-devices", "-l"], {
      onData: (chunk) => {
        const r = takeFrames(buf + chunk);
        buf = r.rest;
        if (!r.frames.length) return;
        failures = 0;
        tracked = parseDevices(r.frames[r.frames.length - 1]);
        // 先发不带型号的，慢查询不卡住列表
        emit();
        for (const d of tracked) lookup(d);
      },
      onExit: (code) => {
        stream = null;
        if (stopped) return;
        tracked = [];
        emit();
        const wait = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)];
        // 没装 adb 时每次都立刻失败：只记一轮连续失败的第一次，收到设备表（failures 清零）后再失败才重新记
        if (failures === 0) log(`adb track-devices 退出（${code ?? "信号"}），之后每隔几秒重试，恢复前不再提示`);
        failures++;
        void sleep(wait).then(() => { if (!stopped) run(); });
      },
    });
  };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      run();
    },
    stop() {
      stopped = true;
      stream?.stop();
    },
    list: () => current,
    onChange(cb: (list: PhoneInfo[]) => void) {
      listeners.push(cb);
    },
  };
}
