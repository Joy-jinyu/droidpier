// iOS 模拟器：用 xcrun simctl 读设备列表、开关机；画面和触摸交给 gateway/native/simhelper.m（每台连上的模拟器一个进程）。
// 只靠本机装好的 Xcode，不开 Xcode 也不开 Simulator.app
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DeviceCaps, IosCatalog, IosSimInfo } from "../../shared/protocol.ts";
import type { DeviceSession, VideoPacket } from "./emulator.ts";
import { iosKey, PASTE, type IosInput } from "./ios-keys.ts";

/** 多久读一次列表（我定的数值，和 MuMu 一样：开关机后几秒内侧栏跟上；空转只是一次 simctl list）。 */
const INTERVAL_MS = 5000;
/** 小程序起来到出第一帧的上限：验证时 0.3–1 秒（2026-11-21 实测，整机负载很高时），给足余量。 */
const FIRST_FRAME_MS = 15_000;

/** 画面、触摸、按键和文字（gateway/src/ios-keys.ts）；没有旋转、重启、滚轮，也不走 adb（H5 调试、日志、装 APK）。 */
export const IOS_SIM_CAPS: DeviceCaps = { rotate: false, reboot: false, stop: false, clipboard: true, input: true, scroll: false, adb: false, logs: true };

const STATES: Record<string, IosSimInfo["state"]> = { Shutdown: "shutdown", Booting: "booting", Booted: "booted", "Shutting Down": "shutting-down" };

/**
 * simctl list devices available -j → iOS 模拟器列表（只要 iOS 系统的）。顺序：开着的（含开关机中）在前，
 * 然后按最近使用时间从近到远（lastUsed：UDID → 毫秒），从没用过的排最后、按系统版本从新到旧、同版本按名字。
 */
export function parseSimctlList(json: string, lastUsed: ReadonlyMap<string, number> = new Map()): IosSimInfo[] {
  const devices = (JSON.parse(json) as { devices?: Record<string, Array<Record<string, unknown>>> }).devices ?? {};
  const out: Array<IosSimInfo & { order: number[] }> = [];
  for (const [runtimeId, list] of Object.entries(devices)) {
    // com.apple.CoreSimulator.SimRuntime.iOS-27-0 → iOS 27.0
    const m = /\.iOS-(\d+)-(\d+)$/.exec(runtimeId);
    if (!m) continue;
    for (const d of list) {
      if (d.isAvailable === false || typeof d.udid !== "string" || typeof d.name !== "string") continue;
      out.push({ udid: d.udid, name: d.name, runtime: `iOS ${m[1]}.${m[2]}`, state: STATES[d.state as string] ?? "shutdown", order: [Number(m[1]), Number(m[2])] });
    }
  }
  const on = (s: IosSimInfo) => (s.state === "shutdown" ? 0 : 1);
  const used = (s: IosSimInfo) => lastUsed.get(s.udid) ?? 0;
  out.sort((a, b) => on(b) - on(a) || used(b) - used(a) || b.order[0] - a.order[0] || b.order[1] - a.order[1] || a.name.localeCompare(b.name));
  return out.map(({ order: _, ...s }) => s);
}

/** 设备目录里 device.plist（XML）的 lastUsedAt：开机时 CoreSimulator 写入，从没开过的没有（2026-11-22 Xcode 27.1 实测）。 */
export function parseLastUsedAt(plist: string): number | undefined {
  const m = /<key>lastUsedAt<\/key>\s*<date>([^<]+)<\/date>/.exec(plist);
  const t = m ? Date.parse(m[1]) : NaN;
  return Number.isFinite(t) ? t : undefined;
}

/** simctl list runtimes available -j → 创建对话框的目录：只要 iOS（不要 watchOS、tvOS），版本新的在前，iPhone 排在 iPad 前面。 */
export function parseIosCatalog(json: string): IosCatalog {
  type Rt = { identifier?: string; name?: string; version?: string; platform?: string; isAvailable?: boolean; supportedDeviceTypes?: Array<{ identifier?: string; name?: string; productFamily?: string }> };
  const list = (JSON.parse(json) as { runtimes?: Rt[] }).runtimes ?? [];
  const ver = (v: string | undefined) => (v ?? "").split(".").map(Number);
  const newer = (a: Rt, b: Rt) => {
    const [x, y] = [ver(a.version), ver(b.version)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
    return 0;
  };
  const family = (f: string | undefined) => (f === "iPhone" ? 0 : f === "iPad" ? 1 : 2);
  return {
    runtimes: list
      .filter((r) => r.isAvailable !== false && r.platform === "iOS" && r.identifier && r.name)
      .sort(newer)
      .map((r) => ({
        id: r.identifier!,
        name: r.name!,
        devices: (r.supportedDeviceTypes ?? [])
          .filter((d) => d.identifier && d.name && family(d.productFamily) < 2)
          .map((d, i) => ({ d, i }))
          .sort((a, b) => family(a.d.productFamily) - family(b.d.productFamily) || a.i - b.i)
          .map(({ d }) => ({ id: d.identifier!, name: d.name! })),
      })),
  };
}

/** simctl list devices -j → UDID 到机型（deviceTypeIdentifier）。 */
export function parseDeviceTypes(json: string): Map<string, string> {
  const out = new Map<string, string>();
  const devices = (JSON.parse(json) as { devices?: Record<string, Array<Record<string, unknown>>> }).devices ?? {};
  for (const list of Object.values(devices)) for (const d of list) if (typeof d.udid === "string" && typeof d.deviceTypeIdentifier === "string") out.set(d.udid, d.deviceTypeIdentifier);
  return out;
}

/** 这个机型有没有实体 Home 键：iPhone SE 和 iPhone 8 及更早、iPad 第 9 代及更早的普通款；别的都是全面屏。 */
export function hasHomeButton(deviceType: string | undefined): boolean {
  const t = deviceType?.replace(/^com\.apple\.CoreSimulator\.SimDeviceType\./, "") ?? "";
  return /^iPhone-(SE|[4-8])/.test(t) || /^iPad-(\d)th-generation$/.test(t) && Number(/\d+/.exec(t)![0]) <= 9;
}

export function createIosSims(deps: {
  /** 运行 xcrun simctl <args>，返回输出；没装 Xcode 时 reject。 */
  simctl: (args: string[]) => Promise<string>;
  /** 读这台模拟器的 device.plist；读不到时 reject（排序时当作从没用过）。 */
  devicePlist?: (udid: string) => Promise<string>;
  log: (s: string) => void;
}) {
  let lastNote = "";
  const note = (s: string) => {
    if (s !== lastNote) deps.log(s);
    lastNote = s;
  };
  const listeners: Array<(list: IosSimInfo[]) => void> = [];
  let current: IosSimInfo[] | null = null;
  let types = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = true;
  // 读列表排队：定时那次和开关机后那次同时跑时，先发起、晚返回的旧结果不能盖掉新结果
  let reading: Promise<void> = Promise.resolve();
  const refresh = (): Promise<void> => (reading = reading.then(readList));

  async function readList(): Promise<void> {
    try {
      const json = await deps.simctl(["list", "devices", "available", "-j"]);
      types = parseDeviceTypes(json);
      const lastUsed = new Map<string, number>();
      if (deps.devicePlist) {
        // 几十个小文件，每 5 秒读一遍；只为排序，读不到的跳过
        await Promise.all(parseSimctlList(json).map(async (s) => {
          const t = parseLastUsedAt(await deps.devicePlist!(s.udid).catch(() => ""));
          if (t !== undefined) lastUsed.set(s.udid, t);
        }));
      }
      const next = parseSimctlList(json, lastUsed);
      lastNote = "";
      if (JSON.stringify(next) === JSON.stringify(current)) return;
      current = next;
      for (const cb of listeners) cb(current);
    } catch (e) {
      // 没装 Xcode 时 current 一直是 null，页面就不显示这一组
      note(`读不到 iOS 模拟器列表：${(e as Error).message.split("\n")[0]}`);
    }
  }

  /** 对列表里的一台执行 simctl boot / shutdown，然后马上刷新列表（状态变化随 onChange 推出去）。 */
  async function act(verb: "boot" | "shutdown", udid: string): Promise<void> {
    const s = (current ?? []).find((x) => x.udid === udid);
    if (!s) throw new Error("找不到这台 iOS 模拟器");
    // 列表刷新前按钮可能被连点：已经在开、在关的不再发一次
    if (verb === "boot" && s.state !== "shutdown") throw new Error(`${s.name} 已经开着或正在开关机`);
    if (verb === "shutdown" && s.state !== "booted") throw new Error(`${s.name} 没有在运行`);
    // boot 立刻返回、模拟器在后台开机；先把状态报成开机中，免得下一次读列表前按钮还能再点
    current = current!.map((x) => (x.udid === udid ? { ...x, state: verb === "boot" ? "booting" : "shutting-down" } : x));
    for (const cb of listeners) cb(current);
    try {
      await deps.simctl([verb, udid]);
    } finally {
      await refresh();
    }
  }

  return {
    refresh,
    /** 读到过的列表；没装 Xcode 或还没读到时是 null。 */
    list: () => current,
    onChange(cb: (list: IosSimInfo[]) => void) {
      listeners.push(cb);
    },
    open: (udid: string) => act("boot", udid),
    /** 创建对话框的目录（装了哪些 iOS 版本、各能用哪些机型）。 */
    catalog: async () => parseIosCatalog(await deps.simctl(["list", "runtimes", "available", "-j"])),
    /** simctl create，返回新模拟器的 udid；列表马上刷新，新的一台随 onChange 推出去。 */
    async create(name: string, deviceType: string, runtime: string): Promise<string> {
      const udid = (await deps.simctl(["create", name, deviceType, runtime])).trim();
      await refresh();
      // simctl 只该输出新模拟器的 UDID；别的内容不往下传（页面会拿它去开机）
      if (!/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(udid)) throw new Error(`simctl 没有返回新模拟器的 UDID：${udid.slice(0, 80)}`);
      return udid;
    },
    close: (udid: string) => act("shutdown", udid),
    /** 这台的机型（com.apple.CoreSimulator.SimDeviceType.*）；不知道时 undefined。 */
    deviceType: (udid: string) => types.get(udid),
    /** 这台是不是开着的 iOS 模拟器（use 消息、discover 用它认设备）。 */
    booted: (udid: string) => (current ?? []).some((s) => s.udid === udid && s.state === "booted"),
    start() {
      if (!stopped) return;
      stopped = false;
      const loop = () => {
        if (!stopped) timer = setTimeout(() => void refresh().finally(loop), INTERVAL_MS);
      };
      void refresh().finally(loop);
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

/** 小程序可执行文件按源码哈希命名：源码一变就重新编译，旧的留着不碍事。 */
export function helperName(source: string): string {
  return `simhelper-${createHash("sha256").update(source).digest("hex").slice(0, 16)}`;
}

/** 编译小程序要的参数（xcrun clang）。 */
export function helperCompileArgs(src: string, out: string): string[] {
  return ["clang", "-fobjc-arc", "-O2", "-framework", "Foundation", "-framework", "IOSurface", "-framework", "VideoToolbox",
    "-framework", "CoreMedia", "-framework", "CoreVideo", "-framework", "CoreGraphics", src, "-o", out];
}

/** 小程序的一个进程：stdout 出包，stdin 收命令（格式见 gateway/native/simhelper.m 开头）。 */
export type HelperProcess = {
  onData(cb: (chunk: Buffer) => void): void;
  onExit(cb: (code: number | null) => void): void;
  write(line: string): void;
  kill(): void;
};

export type IosSimDeps = {
  /** 起一个小程序进程盯这台模拟器（编译、找 Xcode 都在这里面）。 */
  spawnHelper(udid: string): Promise<HelperProcess>;
  /** simctl io <udid> screenshot 的 PNG。 */
  screenshot(): Promise<Buffer>;
  setClipboard(text: string): Promise<void>;
  getClipboard(): Promise<string>;
  firstFrameMs?: number;
  /** 机型有实体 Home 键（hasHomeButton）：主页、多任务按 Home 键，否则用底边上滑手势。 */
  homeButton?: boolean;
  log?(s: string): void;
};

type HelperEvent = { t: "ready"; width: number; height: number } | { t: "error"; message: string };

/** 把小程序 stdout 的字节流切成包：[u32 小端 长度][u8 类型][内容]。任意切块喂入都行。 */
export function createHelperParser(on: { video(p: Omit<VideoPacket, "data"> & { data: Buffer }): void; event(e: HelperEvent): void }) {
  let buf: Buffer = Buffer.alloc(0);
  return (chunk: Buffer) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    while (buf.length >= 4) {
      const n = buf.readUInt32LE(0);
      if (buf.length < 4 + n) break;
      const type = buf[4];
      const body = buf.subarray(5, 4 + n);
      buf = buf.subarray(4 + n);
      if (type === 1 && body.length >= 9) {
        const flags = body[0];
        on.video({ config: (flags & 1) !== 0, key: (flags & 2) !== 0, width: body.readUInt32LE(1), height: body.readUInt32LE(5), data: Buffer.from(body.subarray(9)) });
      } else if (type === 2) {
        try {
          on.event(JSON.parse(body.toString("utf8")) as HelperEvent);
        } catch {
          // 坏的事件包丢掉，不影响画面
        }
      }
    }
  };
}

const unsupported = () => Promise.reject(new Error("iOS 模拟器暂不支持这个操作"));

export async function connectIosSim(udid: string, name: string, deps: IosSimDeps): Promise<DeviceSession> {
  const log = deps.log ?? ((s: string) => console.log(s));
  const subs = new Set<(p: VideoPacket) => void>();
  const closedCbs: Array<() => void> = [];
  let lastConfig: VideoPacket | null = null;
  let closed = false;
  let firstKey: (() => void) | null = null;
  let failStart: ((e: Error) => void) | null = null;

  const helper = await deps.spawnHelper(udid);
  const close = (why: string) => {
    if (closed) return;
    closed = true;
    log(`${name} 的画面连接结束：${why}`);
    helper.kill();
    for (const cb of closedCbs) cb();
  };
  const cmd = (m: object) => {
    if (!closed) helper.write(`${JSON.stringify(m)}\n`);
  };
  // server.ts 按连接把输入排成队、一条完成再发下一条，所以这里按序列里的停顿等着
  const run = async (seq: IosInput[]) => {
    for (const step of seq) {
      if ("wait" in step) await new Promise((r) => setTimeout(r, step.wait));
      else cmd(step);
    }
  };

  const session: DeviceSession = {
    // 画面和真机走同一条 H.264 通路；旧页面只认 emulator / phone 两种（host 收到别的会关掉视频解码器）
    kind: "phone",
    caps: IOS_SIM_CAPS,
    id: udid,
    serial: 0,
    // 只有截图文件名用到（server.ts 的 screenshot）：用模拟器名字，比 UDID 好认；空格、括号换成 -
    avdName: name.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || undefined,
    device: { width: 0, height: 0 },
    rotation: 0,
    frames: () => () => {},
    video(onPacket) {
      subs.add(onPacket);
      if (lastConfig) onPacket(lastConfig);
      return () => void subs.delete(onPacket);
    },
    requestKeyFrame: () => cmd({ t: "keyframe" }),
    // 页面给的是竖屏面板像素，就是帧缓冲像素（device 取自帧缓冲尺寸），小程序直接用
    async touch(x, y, down) {
      cmd({ t: "touch", x, y, down });
    },
    async key(key, eventType) {
      const seq = iosKey(key, eventType, session.device, deps.homeButton === true);
      if (!seq) throw new Error(key.startsWith("AudioVolume") ? "iOS 模拟器暂不支持音量键" : `不认识的按键：${key}`);
      await run(seq);
    },
    // 中文、粘贴：写进模拟器剪贴板再按 ⌘V（同 Android 的写剪贴板再粘贴，会覆盖模拟器剪贴板）
    async text(text) {
      await deps.setClipboard(text);
      await run(PASTE);
    },
    setClipboard: (text) => deps.setClipboard(text),
    getClipboard: () => deps.getClipboard(),
    onClipboard: () => {},
    rotate: unsupported,
    reboot: unsupported,
    screenshot: () => deps.screenshot(),
    onRotation: () => {},
    onClosed: (cb) => void closedCbs.push(cb),
    close: () => close("网关关闭了会话"),
  };

  helper.onData(createHelperParser({
    video(p) {
      if (p.config) lastConfig = p;
      for (const cb of subs) cb(p);
      if (p.key && firstKey) firstKey();
    },
    event(e) {
      if (e.t === "ready") session.device = { width: e.width, height: e.height };
      else if (e.t === "error") {
        log(`${name}：${e.message}`);
        failStart?.(new Error(e.message));
      }
    },
  }));
  helper.onExit((code) => {
    failStart?.(new Error(`画面程序退出了（${code ?? "信号"}）`));
    close(`画面程序退出（${code ?? "信号"}）`);
  });

  // 等到第一个关键帧（小程序启动时先出一帧）才算连上，这时 device 尺寸也有了
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => done(new Error("等不到模拟器的画面")), deps.firstFrameMs ?? FIRST_FRAME_MS);
    const done = (e?: Error) => {
      clearTimeout(timer);
      firstKey = null;
      failStart = null;
      if (e) {
        close(e.message);
        reject(e);
      } else resolve();
    };
    firstKey = () => done();
    failStart = (e) => done(e);
  });
  return session;
}

/** gateway/native 下文件的位置：单文件网关里 scripts/build-binary.ts 把这个目录嵌在 import.meta.dirname/native 下。 */
export function nativeAssetPath(standalone: boolean, name: string): string {
  return standalone ? join(import.meta.dirname, "native", name) : fileURLToPath(new URL(`../native/${name}`, import.meta.url));
}

/** 小程序源码的位置。 */
export function helperSourcePath(standalone: boolean): string {
  return nativeAssetPath(standalone, "simhelper.m");
}

// simctl pbcopy / pbpaste 按语言环境的编码读写：后台网关（LaunchAgent）没有 LANG，中文直接报
// 「The file couldn't be opened using the specified text encoding」（2026-11-22 实测）。统一给 UTF-8
const UTF8_ENV = { ...process.env, LANG: "en_US.UTF-8" };

const run = (cmd: string, args: string[], timeout: number) =>
  new Promise<string>((resolve, reject) =>
    execFile(cmd, args, { timeout, maxBuffer: 64 * 2 ** 20, env: UTF8_ENV }, (e, out, err) => (e ? reject(new Error(String(err || e.message).trim())) : resolve(out))));

/** xcrun simctl <args>。 */
export const simctl = (args: string[]) => run("/usr/bin/xcrun", ["simctl", ...args], 60_000);

/** 一台模拟器的截图、剪贴板（simctl io screenshot / pbcopy / pbpaste）。 */
export function simctlDeviceOps(udid: string): Pick<IosSimDeps, "screenshot" | "setClipboard" | "getClipboard"> {
  return {
    // 文件名不能写「-」：simctl 帮助里说「-」是标准输出，Xcode 27.1 实际照样写出一个叫「-」的文件，标准输出是空的
    // （2026-11-22 实测，页面下载到 0 字节的图）。写临时文件再读回来
    screenshot: async () => {
      const dir = await mkdtemp(join(tmpdir(), "droidpier-ios-shot-"));
      const file = join(dir, "screen.png");
      try {
        await run("/usr/bin/xcrun", ["simctl", "io", udid, "screenshot", "--type=png", file], 15_000);
        return await readFile(file);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    setClipboard: (text) => new Promise((resolve, reject) => {
      const p = execFile("/usr/bin/xcrun", ["simctl", "pbcopy", udid], { timeout: 10_000, env: UTF8_ENV }, (e) => (e ? reject(e) : resolve()));
      p.stdin?.end(text);
    }),
    getClipboard: () => run("/usr/bin/xcrun", ["simctl", "pbpaste", udid], 10_000),
  };
}

/**
 * 小程序随网关发源码，第一次用时拿本机 Xcode 的 clang 编译：用 iOS 模拟器本来就要装 Xcode，
 * 这样不用在发布流程里编 Objective-C、也不用另外签名。编译一次几秒，结果按源码哈希缓存。
 */
export function createHelperSpawner(o: { source: string; cacheDir: string; log: (s: string) => void }) {
  let building: Promise<{ bin: string; developerDir: string }> | null = null;
  const build = async () => {
    const source = await readFile(o.source, "utf8");
    const bin = join(o.cacheDir, helperName(source));
    const developerDir = (await run("/usr/bin/xcode-select", ["-p"], 10_000)).trim();
    if (!existsSync(bin)) {
      await mkdir(o.cacheDir, { recursive: true });
      // 嵌在单文件网关里的源码是虚拟路径，clang 读不了：先落盘
      const src = `${bin}.m`;
      await writeFile(src, source);
      const part = `${bin}.${process.pid}.part`;
      o.log("第一次用 iOS 模拟器：用本机 Xcode 编译画面程序");
      await run("/usr/bin/xcrun", helperCompileArgs(src, part), 120_000);
      await rename(part, bin);
    }
    return { bin, developerDir };
  };
  return async (udid: string): Promise<HelperProcess> => {
    building ??= build().catch((e: Error) => {
      building = null;
      throw new Error(`编译 iOS 模拟器画面程序失败：${e.message}`);
    });
    let { bin, developerDir } = await building;
    // 网关运行期间缓存目录可能被清理工具删掉：没了就重新编译
    if (!existsSync(bin)) {
      building = null;
      ({ bin, developerDir } = await (building = build()));
    }
    const p = spawn(bin, [developerDir, udid], { stdio: ["pipe", "pipe", "pipe"] });
    // 起不来（ENOENT 等）时没人接 error 事件会让整个网关退出：转成退出，会话按连不上处理
    p.on("error", (e) => {
      o.log(`iOS 模拟器画面程序起不来：${e.message}`);
      p.emit("exit", null);
    });
    p.stderr.on("data", (b: Buffer) => o.log(`simhelper：${b.toString().trim()}`));
    // 进程已经退出时写 stdin 会报 EPIPE，会话那边随 exit 关掉
    p.stdin.on("error", () => {});
    return {
      onData: (cb) => void p.stdout.on("data", cb),
      onExit: (cb) => void p.on("exit", (code) => cb(code)),
      write: (line) => void p.stdin.write(line),
      kill: () => void p.kill(),
    };
  };
}
