import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { readFileSync, realpathSync } from "node:fs";
import { discoveryDir, explicitAvdHome } from "./platform.ts";

/** avdName：AVD 的 id（见 discoveryAvdName）；avdDir：发现文件里的 avd.dir，AVD 数据目录的绝对路径；目录名可能和 avdName 不同。 */
export type Discovery = { grpcPort: number; serial: number; token?: string; avdName?: string; avdDir?: string };
export type Running = Discovery & { pid: number };

/**
 * 发现文件里这台模拟器的 AVD 名，和 emulator -list-avds、<avdHome>/<名>.ini 用的是同一个。
 * avd.name 是显示名，可能和 id 不同（实测 avd.id=Resizable_Experimental、avd.name=Resizable (Experimental)），
 * 所以先取 avd.id；旧版模拟器没写 avd.id 时才退回 avd.name。
 */
export function discoveryAvdName(kv: Map<string, string>): string | undefined {
  return kv.get("avd.id") || kv.get("avd.name") || undefined;
}

/** 解析模拟器发现文件（key=value 每行一条）。 */
export function parseDiscovery(text: string): Discovery {
  const kv = new Map<string, string>();
  for (const line of text.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) kv.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  const grpcPort = Number(kv.get("grpc.port"));
  if (!grpcPort) throw new Error("发现文件里没有 grpc.port（模拟器没有开启 gRPC）");
  const serial = Number(kv.get("port.serial"));
  if (!serial) throw new Error("发现文件里没有 port.serial");
  const out: Discovery = { grpcPort, serial };
  const token = kv.get("grpc.token");
  if (token) out.token = token;
  const avdName = discoveryAvdName(kv);
  if (avdName) out.avdName = avdName;
  const avdDir = kv.get("avd.dir");
  if (avdDir) out.avdDir = avdDir;
  return out;
}

/** 进程是否存在；EPERM 表示存在但无权发信号。 */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** 找一个进程仍存活且开了 gRPC 的模拟器；给了 avdName 时只找这个 AVD。找不到返回 null。 */
export async function findRunning(
  dir: string = discoveryDir(),
  isAlive: (pid: number) => boolean = pidAlive,
  avdName?: string,
  /** 只接受它认的模拟器（见 ownFilter）。 */
  accept?: (d: Discovery) => boolean,
): Promise<Running | null> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  // 按 pid 数字升序，结果不依赖目录顺序
  const pids = names.map((n) => /^pid_(\d+)\.ini$/.exec(n)).filter((m) => m !== null).map((m) => Number(m[1])).sort((a, b) => a - b);
  for (const pid of pids) {
    const name = `pid_${pid}.ini`;
    if (!isAlive(pid)) continue;
    try {
      const d = parseDiscovery(await readFile(join(dir, name), "utf8"));
      if (avdName !== undefined && d.avdName !== avdName) continue;
      if (accept && !accept(d)) continue;
      return { pid, ...d };
    } catch {
      continue;
    }
  }
  return null;
}

/** ownFilter 读文件用到的部分；读不到返回 null。 */
export type OwnIo = { readFile(path: string): string | null; realpath(path: string): string | null };

const realOwnIo: OwnIo = {
  readFile: (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } },
  realpath: (p) => { try { return realpathSync(p); } catch { return null; } },
};

/**
 * 网关接管哪些运行中的模拟器（discover、use、startAvd 都用这条规则）：
 * 显式设了 ANDROID_AVD_HOME 时，只接管数据目录确实是这个 AVD 目录里那台的模拟器——发现目录是全机共享的，别处的同名 AVD 不能连。
 * 比对：<avdHome>/<avd.name>.ini 的 path= 和发现文件的 avd.dir 取 realpath 后相同；.ini 没有 path= 时 avd.dir 必须在 avdHome 里；
 * 发现文件没有 avd.dir 的一律不接管。跳过的每台只记一次日志；没设时全部接管，返回 undefined。
 */
export function ownFilter(avdHome: string | undefined, io: OwnIo, log: (s: string) => void): ((d: Discovery) => boolean) | undefined {
  if (avdHome === undefined) return undefined;
  const skipped = new Set<number>();
  const mine = (d: Discovery) => {
    if (!d.avdName || !d.avdDir) return false;
    const ini = io.readFile(join(avdHome, `${d.avdName}.ini`));
    if (ini === null) return false;
    const path = /^path=(.*)$/m.exec(ini)?.[1]?.trim();
    if (path) {
      const want = io.realpath(path);
      return want !== null && want === io.realpath(d.avdDir);
    }
    const rel = relative(io.realpath(avdHome) ?? avdHome, io.realpath(d.avdDir) ?? d.avdDir);
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  };
  return (d) => {
    if (mine(d)) return true;
    if (!skipped.has(d.serial)) {
      skipped.add(d.serial);
      log(`发现 emulator-${d.serial}（AVD ${d.avdName ?? "未知"}${d.avdDir ? `，${d.avdDir}` : ""}）不在 ${avdHome}，没有接管`);
    }
    return false;
  };
}

let own: ((d: Discovery) => boolean) | undefined | null = null;
/** 按 ownFilter 的规则找运行中的模拟器；给了 avdName 时只找这个 AVD。 */
export function findOwnRunning(avdName?: string): Promise<Running | null> {
  if (own === null) own = ownFilter(explicitAvdHome(), realOwnIo, (s) => console.log(s));
  return findRunning(undefined, undefined, avdName, own);
}
