import { readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { avdHome as defaultAvdHome, emulatorBin, adbBin, discoveryDir as defaultDiscoveryDir } from "./platform.ts";
import { discoveryAvdName, pidAlive } from "./discovery.ts";
import type { AvdInfo } from "../../shared/protocol.ts";
import { displayNameError } from "../../shared/avd-spec.ts";

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
