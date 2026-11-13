import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { avdHome as defaultAvdHome, emulatorBin, adbBin, discoveryDir as defaultDiscoveryDir } from "./platform.ts";
import { discoveryAvdName, pidAlive } from "./discovery.ts";
import type { AvdInfo } from "../../shared/protocol.ts";

const execFileP = promisify(execFile);

export type { AvdInfo };

/** 解析 AVD config.ini，提取屏幕尺寸、内存、API 级别、ABI。 */
export function parseAvdConfig(text: string): Pick<AvdInfo, "width" | "height" | "ramMb" | "apiLevel" | "abi"> {
  const kv = new Map<string, string>();
  for (const line of text.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) kv.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }

  const result: Pick<AvdInfo, "width" | "height" | "ramMb" | "apiLevel" | "abi"> = {};

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

/** 列出所有 AVD 及其运行状态。支持注入依赖方便测试。 */
export async function listAvds(deps?: Partial<Deps>): Promise<AvdInfo[]> {
  const execFn: ExecFn = deps?.exec ?? ((file, args) => execFileP(file, args));
  const discDir = deps?.discoveryDir ?? defaultDiscoveryDir();
  const home = deps?.avdHome ?? defaultAvdHome();

  // 1. 获取 AVD 名字列表，过滤掉 INFO 行和含空格的行
  const { stdout } = await execFn(emulatorBin(), ["-list-avds"]);
  const names = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("INFO") && !/\s/.test(l));

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
