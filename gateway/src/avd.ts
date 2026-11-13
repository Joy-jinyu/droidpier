import { access, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { avdHome as defaultAvdHome, avdmanagerBin, emulatorBin, adbBin, discoveryDir as defaultDiscoveryDir, findJavaHome, sdkRoot } from "./platform.ts";
import { discoveryAvdName, pidAlive } from "./discovery.ts";
import type { AvdInfo } from "../../shared/protocol.ts";
import { avdNameError, displayNameError } from "../../shared/avd-spec.ts";

const execFileP = promisify(execFile);

export type { AvdInfo };

/** 解析 AVD config.ini，提取显示名、屏幕尺寸、内存、API 级别、ABI。 */
export function parseAvdConfig(text: string): Pick<AvdInfo, "displayName" | "width" | "height" | "ramMb" | "apiLevel" | "abi"> {
  const kv = new Map<string, string>();
  for (const line of text.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) kv.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }

  const result: Pick<AvdInfo, "displayName" | "width" | "height" | "ramMb" | "apiLevel" | "abi"> = {};

  const displayName = kv.get("avd.ini.displayname");
  if (displayName) result.displayName = displayName;

  const w = kv.get("hw.lcd.width");
  if (w) result.width = Number(w);

  const h = kv.get("hw.lcd.height");
  if (h) result.height = Number(h);

  const ram = kv.get("hw.ramSize");
  if (ram) {
    // hw.ramSize 单位默认 MB；支持 M/G 后缀
    const m = /^(\d+)\s*([MmGg]?)$/.exec(ram.trim());
    if (m) {
      const n = Number(m[1]);
      result.ramMb = m[2].toLowerCase() === "g" ? n * 1024 : n;
    }
  }

  const abi = kv.get("abi.type");
  if (abi) result.abi = abi;

  const sysdir = kv.get("image.sysdir.1");
  if (sysdir) {
    const match = /android-(\d+)/.exec(sysdir);
    if (match) result.apiLevel = Number(match[1]);
  }

  return result;
}

/** 不经过 shell 跑命令：SDK 路径可能带空格（比如装在名字带空格的外置盘上）。 */
type ExecFn = (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

type Deps = {
  exec: ExecFn;
  discoveryDir: string;
  avdHome: string;
};

type RunningEntry = { grpcPort: number; serial: number } | { grpcPort: undefined; serial: number };

/** 扫描所有存活的发现文件，返回 avdName → 运行信息的映射。 */
async function scanAllRunning(dir: string): Promise<Map<string, RunningEntry>> {
  const result = new Map<string, RunningEntry>();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return result;
  }
  const pids = names
    .map((n) => /^pid_(\d+)\.ini$/.exec(n))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);

  for (const pid of pids) {
    if (!pidAlive(pid)) continue;
    try {
      const text = await readFile(join(dir, `pid_${pid}.ini`), "utf8");
      const kv = new Map<string, string>();
      for (const line of text.split("\n")) {
        const i = line.indexOf("=");
        if (i > 0) kv.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
      }
      const avdName = discoveryAvdName(kv);
      if (!avdName) continue;
      const serial = Number(kv.get("port.serial"));
      const grpcPort = Number(kv.get("grpc.port")) || undefined;
      result.set(avdName, { grpcPort, serial } as RunningEntry);
    } catch {
      continue;
    }
  }
  return result;
}

/** 读取 AVD 的 config.ini 路径：先从 <avdHome>/<name>.ini 的 path= 行解析，fallback 到 <avdHome>/<name>.avd/。 */
async function resolveConfigIni(home: string, name: string): Promise<string | undefined> {
  try {
    const iniText = await readFile(join(home, `${name}.ini`), "utf8");
    const pathLine = iniText.split("\n").find((l) => l.startsWith("path="));
    const avdDir = pathLine ? pathLine.slice(5).trim() : join(home, `${name}.avd`);
    return join(avdDir, "config.ini");
  } catch {
    // fallback
    return join(home, `${name}.avd`, "config.ini");
  }
}

/** emulator -list-avds 列出的 AVD id，去掉 INFO 行和含空格的行。 */
async function avdIds(execFn: ExecFn): Promise<string[]> {
  const { stdout } = await execFn(emulatorBin(), ["-list-avds"]);
  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("INFO") && !/\s/.test(l));
}

/** 列出所有 AVD 及其运行状态。支持注入依赖方便测试。 */
export async function listAvds(deps?: Partial<Deps>): Promise<AvdInfo[]> {
  const execFn: ExecFn = deps?.exec ?? ((file, args) => execFileP(file, args));
  const discDir = deps?.discoveryDir ?? defaultDiscoveryDir();
  const home = deps?.avdHome ?? defaultAvdHome();

  // 1. 获取 AVD 名字列表
  const names = await avdIds(execFn);

  // 2. 扫描所有存活发现文件
  const runningMap = await scanAllRunning(discDir);

  // 3. adb devices 里的串口集合（用于 no-grpc 检测）
  const adbSerialSet = new Set<number>();
  try {
    const { stdout: adbOut } = await execFn(adbBin(), ["devices"]);
    for (const line of adbOut.split("\n")) {
      const m = /^emulator-(\d+)\s+device/.exec(line.trim());
      if (m) adbSerialSet.add(Number(m[1]));
    }
  } catch {
    // adb 不可用时忽略
  }

  // 4. 组合结果
  const avds: AvdInfo[] = [];
  for (const name of names) {
    const info: AvdInfo = { name, running: "no" };

    // 读 config.ini
    const configPath = await resolveConfigIni(home, name);
    if (configPath) {
      try {
        const configText = await readFile(configPath, "utf8");
        Object.assign(info, parseAvdConfig(configText));
      } catch {
        // 读不到时跳过
      }
    }

    // 判断运行状态
    const entry = runningMap.get(name);
    if (entry) {
      if (entry.grpcPort !== undefined) {
        info.running = "grpc";
        info.grpcPort = entry.grpcPort;
        info.serial = entry.serial;
      } else if (adbSerialSet.has(entry.serial)) {
        info.running = "no-grpc";
        info.serial = entry.serial;
      }
    }

    avds.push(info);
  }

  return avds;
}

/**
 * 修正 <avdHome>/<name>.ini 里写坏的 target=android-0，返回改成的值；不用改或改不了时返回 null。
 * 命令行工具 19.0 给 android-36.1 这种带小版本的镜像建 AVD 时会写 android-0，模拟器读到它就不开 hvf，
 * 退回软件模拟，开机超时（2026-11-13 实测 emulator 37.1.11、macOS 27.0.1）。正确的值从 config.ini 的镜像目录取。
 */
export async function repairAvdTarget(name: string, deps?: Partial<Pick<Deps, "avdHome">>): Promise<string | null> {
  const home = deps?.avdHome ?? defaultAvdHome();
  const iniPath = join(home, `${name}.ini`);
  const ini = await readFile(iniPath, "utf8").catch(() => null);
  // 允许 = 两边有空格、CRLF 换行；\r 原样留着，不改动文件的换行风格
  const broken = /^target[ \t]*=[ \t]*android-0[ \t]*(\r?)$/m;
  if (ini === null || !broken.test(ini)) return null;
  const configPath = await resolveConfigIni(home, name);
  const config = configPath ? await readFile(configPath, "utf8").catch(() => "") : "";
  const sysdir = config.split("\n").find((l) => l.slice(0, l.indexOf("=")).trim() === "image.sysdir.1");
  const target = sysdir && /(?:^|[\\/])(android-\d+(?:\.\d+)?)[\\/]/.exec(sysdir.slice(sysdir.indexOf("=") + 1).trim())?.[1];
  if (!target) return null;
  // 和 renameAvd 一样先写临时文件再换过去：写到一半出错不会留下半个 .ini，让设备从列表里消失
  const path = await realpath(iniPath);
  const { mode } = await stat(path);
  const tmp = `${path}.droidpier-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    await writeFile(tmp, ini.replace(broken, `target=${target}$1`), { mode });
    await rename(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
  return target;
}

/** 把 text（ini）里 key 的每一行都换成 key=value（重复的行也换，读的一方取哪行都对）；没有这一行就加在末尾。 */
function setIniValue(text: string, key: string, value: string): string {
  const isKey = (l: string) => l.includes("=") && l.slice(0, l.indexOf("=")).trim() === key;
  const lines = text.split("\n");
  if (lines.some(isKey)) return lines.map((l) => (isKey(l) ? `${key}=${value}` : l)).join("\n");
  const body = text === "" || text.endsWith("\n") ? text : `${text}\n`;
  return `${body}${key}=${value}\n`;
}

/**
 * 改 AVD 的显示名：写它 config.ini 里的 avd.ini.displayname，id、目录和 .ini 都不动，运行中也能改。
 * name 必须是 emulator -list-avds 列出的 id，不认识的不碰，免得拼出别处的文件路径。
 */
export async function renameAvd(name: string, displayName: string, deps?: Partial<Deps>): Promise<void> {
  const error = displayNameError(displayName);
  if (error) throw new Error(error);
  // 只跑 -list-avds，不跑 listAvds：它还要问 adb，adb 卡住时改名不能跟着卡
  if (!(await avdIds(deps?.exec ?? ((file, args) => execFileP(file, args)))).includes(name)) throw new Error(`没有这个设备：${name}`);
  const found = await resolveConfigIni(deps?.avdHome ?? defaultAvdHome(), name);
  if (!found) throw new Error(`找不到 ${name} 的 config.ini`);
  // config.ini 是符号链接时改它指向的文件，换过去也不能把链接换成普通文件
  const path = await realpath(found);
  const [text, { mode }] = await Promise.all([readFile(path, "utf8"), stat(path)]);
  // 先写临时文件再换过去：写到一半出错也不会留下半个 config.ini；同时改名的两个请求各用各的临时文件
  const tmp = `${path}.droidpier-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    await writeFile(tmp, setIniValue(text, "avd.ini.displayname", displayName.trim()), { mode });
    await rename(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

/** deleteAvd 的依赖。avdmanager：能跑 avdmanager 时返回跑它的函数（失败时抛错），没装命令行工具或没有 Java 时 null。 */
type DeleteDeps = Deps & {
  alive: (pid: number) => boolean;
  avdmanager: () => Promise<((args: string[]) => Promise<unknown>) | null>;
};

const STOP_FIRST = "先关闭这台设备再删除";

/** avdmanager delete avd 一般几秒；60 秒还没完就算卡住（Java 起不来、等输入）。 */
const AVDMANAGER_TIMEOUT_MS = 60_000;

function realAvdmanager(home: string): DeleteDeps["avdmanager"] {
  return async () => {
    const bin = avdmanagerBin();
    if (!(await access(bin).then(() => true, () => false))) return null;
    const java = await findJavaHome();
    if (!java) return null;
    const env = { ...process.env, JAVA_HOME: java, ANDROID_HOME: sdkRoot(), ANDROID_SDK_ROOT: sdkRoot(), ANDROID_AVD_HOME: home };
    return (args) => new Promise<void>((res, rej) =>
      execFile(bin, args, { env, timeout: AVDMANAGER_TIMEOUT_MS }, (e, out, err) =>
        e ? rej(new Error(`avdmanager 删除失败：${`${err}\n${out}`.trim().split("\n").at(-1) || e.message}`)) : res()));
  };
}

/** 进程还在的模拟器发现文件里的 AVD 名和数据目录（不要求开了 gRPC）。 */
async function runningAvds(dir: string, alive: (pid: number) => boolean): Promise<Array<{ name?: string; dir?: string }>> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const out: Array<{ name?: string; dir?: string }> = [];
  for (const n of names) {
    const m = /^pid_(\d+)\.ini$/.exec(n);
    if (!m || !alive(Number(m[1]))) continue;
    const text = await readFile(join(dir, n), "utf8").catch(() => "");
    const kv = new Map<string, string>();
    for (const line of text.split("\n")) {
      const i = line.indexOf("=");
      if (i > 0) kv.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
    }
    out.push({ name: discoveryAvdName(kv), dir: kv.get("avd.dir") });
  }
  return out;
}

const iniPath = (ini: string) => /^path=(.*)$/m.exec(ini)?.[1]?.trim() || undefined;
const real = (p: string) => realpath(p).catch(() => null);

/**
 * 删一台 AVD：它的 <avdHome>/<name>.ini 和数据目录（已装的 App、文件、快照），系统镜像不动。
 * 只删确实属于它的东西：数据目录必须在 avdHome 里、以 .avd 结尾、不是别的 AVD 的目录，否则拒绝（让用户自己处理）；
 * 运行中的拒绝（按发现文件的名字和 avd.dir 都对一遍，显示名和 id 不同的旧模拟器也认得出）。
 * 能跑 avdmanager 时让它删（它还会清掉自己记的东西），删完核对文件确实没了；否则直接删目录再删 .ini：
 * 目录删到一半失败时 .ini 还在，设备留在列表里可以再删一次。
 */
export async function deleteAvd(name: string, deps?: Partial<DeleteDeps>): Promise<void> {
  const nameError = avdNameError(name, []);
  if (nameError) throw new Error(nameError);
  const home = deps?.avdHome ?? defaultAvdHome();
  if (!(await avdIds(deps?.exec ?? ((file, args) => execFileP(file, args)))).includes(name)) throw new Error(`没有这个设备：${name}`);
  const iniFile = join(home, `${name}.ini`);
  const ini = await readFile(iniFile, "utf8").catch(() => null);
  if (ini === null) throw new Error(`找不到 ${iniFile}`);
  const dir = iniPath(ini) ?? join(home, `${name}.avd`);

  // 相对路径会按网关的工作目录解析，指到哪里说不准：一律不碰
  if (!isAbsolute(dir)) throw new Error(`${name} 的数据目录 ${dir} 不是绝对路径；请在 Android Studio 里删除它`);
  const realHome = (await real(home)) ?? home;
  const realDir = await real(dir);
  if (realDir !== null) {
    const rel = relative(realHome, realDir);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel) || !realDir.endsWith(".avd")) {
      throw new Error(`${name} 的数据目录 ${dir} 不在 ${home} 里或不是 .avd 目录；请在 Android Studio 里删除它`);
    }
    for (const other of await readdir(home).catch(() => [] as string[])) {
      if (!other.endsWith(".ini") || other === `${name}.ini`) continue;
      const p = iniPath(await readFile(join(home, other), "utf8").catch(() => ""));
      if (p && (await real(p)) === realDir) throw new Error(`${name} 的数据目录 ${dir} 也是 ${other.slice(0, -4)} 的`);
    }
  }

  for (const r of await runningAvds(deps?.discoveryDir ?? defaultDiscoveryDir(), deps?.alive ?? pidAlive)) {
    if (r.name === name || (realDir !== null && r.dir !== undefined && (await real(r.dir)) === realDir)) throw new Error(STOP_FIRST);
  }

  const run = await (deps?.avdmanager ?? realAvdmanager(home))();
  if (run) {
    await run(["delete", "avd", "-n", name]);
    const left = [iniFile, ...(realDir ? [dir] : [])];
    for (const p of left) if (await access(p).then(() => true, () => false)) throw new Error(`avdmanager 跑完了但没有删干净：${p} 还在`);
    return;
  }
  if (realDir !== null) {
    // dir 是符号链接时先删它指向的（已核对过在 avdHome 里）目录，再删链接
    await rm(realDir, { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
  }
  await rm(iniFile, { force: true });
}
