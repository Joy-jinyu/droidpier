import { spawn as spawnCp, type ChildProcess } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { open } from "node:fs/promises";
import net from "node:net";
import { dirname } from "node:path";
import { listAvds, repairAvdTarget } from "./avd.ts";
import { findOwnRunning, pidAlive, type Running } from "./discovery.ts";
import { emulatorBin, emulatorEnv, emulatorLogPath } from "./platform.ts";
import { bootLogHint, bootLogReason, bootStuckDetail } from "./boot-log.ts";
import { adb, ADB_TIMEOUT_MS } from "./adb.ts";
import type { AvdInfo } from "../../shared/protocol.ts";

const GRPC_BASE_PORT = 8554;
const BOOT_TIMEOUT_MS = 180_000;
const POLL_MS = 1000;
const LOG_TAIL_BYTES = 64 * 1024;

/** 启动出来的子进程里，生命周期模块用到的部分。 */
export type Child = { kill(): void; unref(): void; onExit(cb: (code: number | null) => void): void };

/** 可注入的外部依赖，测试里换成假的。 */
export type LifecycleDeps = {
  /** 子进程的 stdout / stderr 写进 logPath（从头覆盖）。 */
  spawn: (cmd: string, args: string[], logPath: string) => Child;
  logPath: (avd: string) => string;
  /** 日志文件末尾一段；读不到为 null。 */
  readLog: (path: string) => Promise<string | null>;
  /** 跑 adb，返回 stdout。 */
  adb: (args: string[]) => Promise<string>;
  listAvds: () => Promise<AvdInfo[]>;
  /** 拉起模拟器前修正 AVD 写坏的 target（见 repairAvdTarget）。 */
  repairTarget: (name: string) => Promise<unknown>;
  findRunning: (name: string) => Promise<Running | null>;
  alive: (pid: number) => boolean;
  portFree: (port: number) => Promise<boolean>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

/** 一次启动任务。serial / grpcPort 在分配和发现之前为 0。 */
export type StartJob = {
  name: string;
  serial: number;
  grpcPort: number;
  progress: "spawning" | "booting" | "ready" | "failed";
  error?: string;
  done: Promise<Running>;
};

/** 端口上有没有人在监听：连得上就是被占用。 */
function portFree(port: number): Promise<boolean> {
  return new Promise((res) => {
    const s = net.connect(port, "127.0.0.1");
    s.setTimeout(500);
    s.once("connect", () => (s.destroy(), res(false)));
    s.once("timeout", () => (s.destroy(), res(false)));
    s.once("error", () => res(true));
  });
}

/** 打开（截断）日志文件给子进程用；打不开就不记日志，不能因此启动失败。 */
function openLog(path: string): number | "ignore" {
  try {
    mkdirSync(dirname(path), { recursive: true });
    return openSync(path, "w");
  } catch {
    return "ignore";
  }
}

async function readTail(path: string): Promise<string | null> {
  try {
    const f = await open(path, "r");
    try {
      const { size } = await f.stat();
      const len = Math.min(size, LOG_TAIL_BYTES);
      const buf = Buffer.alloc(len);
      await f.read(buf, 0, len, size - len);
      return buf.toString("utf8");
    } finally {
      await f.close();
    }
  } catch {
    return null;
  }
}

const defaults: LifecycleDeps = {
  spawn: (cmd, args, logPath) => {
    // detached：模拟器在自己的进程组里，网关退出后它还在；emulator 会再拉起 qemu，结束时要杀整个进程组。
    // 输出直接写文件描述符而不是管道：网关退出后模拟器还要接着写
    const log = openLog(logPath);
    let c: ChildProcess;
    try {
      c = spawnCp(cmd, args, { detached: true, stdio: ["ignore", log, log], env: emulatorEnv() });
    } finally {
      if (log !== "ignore") closeSync(log);
    }
    return {
      kill: () => {
        try {
          if (c.pid) process.kill(-c.pid, "SIGKILL");
        } catch {}
      },
      unref: () => c.unref(),
      onExit: (cb) => c.once("exit", cb),
    };
  },
  adb: (args) => adb.run(args),
  logPath: emulatorLogPath,
  readLog: readTail,
  listAvds: () => listAvds(),
  repairTarget: (name) => repairAvdTarget(name),
  findRunning: (name) => findOwnRunning(name),
  alive: pidAlive,
  portFree,
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

const jobs = new Map<string, StartJob>();
// 进行中任务预留的 gRPC 端口：模拟器还没监听时，探测不出它被占用
const reserved = new Set<number>();

/** 启动 AVD 并等它开机完成。同名任务进行中时返回那个任务；已经开着 gRPC 在运行的直接 ready。 */
export function startAvd(name: string, deps?: Partial<LifecycleDeps>): StartJob {
  const existing = jobs.get(name);
  if (existing) return existing;
  const d = { ...defaults, ...deps };
  let resolve!: (r: Running) => void;
  let reject!: (e: Error) => void;
  const job: StartJob = {
    name,
    serial: 0,
    grpcPort: 0,
    progress: "spawning",
    done: new Promise((res, rej) => ((resolve = res), (reject = rej))),
  };
  // 没人 await 时失败也不能变成未处理的 rejection
  job.done.catch(() => {});
  jobs.set(name, job);

  let child: Child | undefined;
  let exited: { code: number | null } | undefined;
  let myPort = 0;
  const logPath = d.logPath(name);
  // 开机中退出时把日志里的原因带上，用户不用自己去翻日志
  const exitError = async (what: string): Promise<Error> => {
    const log = await d.readLog(logPath);
    if (log === null) return new Error(`模拟器进程在开机中退出（${what}）`);
    const reason = bootLogReason(log);
    const hint = bootLogHint(log);
    const detail = [reason, hint].filter(Boolean).join("。");
    return new Error(`模拟器进程在开机中退出（${what}）${detail ? `：${detail}` : ""}。完整日志：${logPath}`);
  };
  // 开机超时也说明卡在哪，不然用户只看到“超时”，不知道是模拟器没起来还是 adb 读不到
  const timeoutError = async (): Promise<Error> => {
    const what = `开机超时（${BOOT_TIMEOUT_MS / 1000} 秒）`;
    const log = await d.readLog(logPath);
    if (log === null) return new Error(what);
    // serial 为 0：没找到发现文件，还没问过 adb，不能怪 adb
    const detail = bootStuckDetail(log, job.serial > 0);
    return new Error(`${what}${detail ? `：${detail}` : ""}。完整日志：${logPath}`);
  };
  const run = async (): Promise<Running> => {
    const info = (await d.listAvds()).find((a) => a.name === name);
    if (!info) throw new Error(`没有这个 AVD：${name}`);
    if (info.running === "no-grpc") throw new Error(`${name} 已在运行但没开 gRPC，无法接管`);
    if (info.running === "grpc") {
      const r = await d.findRunning(name);
      if (r) return r;
    }

    // 修不了也照样启动：最坏是开得慢，不该因此起不来
    await d.repairTarget(name).catch((e) => console.warn(`修正 ${name} 的 target 失败：${e instanceof Error ? e.message : String(e)}`));

    let port = GRPC_BASE_PORT;
    for (;; port += 2) {
      if (reserved.has(port)) continue;
      // 先占位再探测，两个任务交错时也不会拿到同一个端口
      reserved.add(port);
      myPort = port;
      if (await d.portFree(port)) break;
      reserved.delete(port);
      myPort = 0;
    }
    job.grpcPort = port;
    child = d.spawn(emulatorBin(), ["-avd", name, "-no-window", "-grpc", String(port), "-no-boot-anim", "-gpu", "host"], logPath);
    child.unref();
    // 实测 macOS 上 emulator 直接 exec 成 qemu，所以开机中它退出（含 emu kill 的 code 0、被信号杀的 null）就是失败
    child.onExit((code) => (exited = { code }));
    job.progress = "booting";

    const start = d.now();
    let running: Running | null = null;
    while (d.now() - start < BOOT_TIMEOUT_MS) {
      if (exited) throw await exitError(`code ${exited.code}`);
      running ??= await d.findRunning(name);
      if (running) {
        if (!d.alive(running.pid)) throw await exitError(`pid ${running.pid} 已不在`);
        job.serial = running.serial;
        // adb 卡住时按“还没开机”处理，不能拖过开机期限
        const out = await Promise.race([
          d.adb(["-s", `emulator-${running.serial}`, "shell", "getprop", "sys.boot_completed"]).catch(() => ""),
          d.sleep(ADB_TIMEOUT_MS).then(() => ""),
        ]);
        if (out.trim() === "1") return running;
      }
      await d.sleep(POLL_MS);
    }
    // 先读日志再关：关机时模拟器还会往日志里写
    const timeout = await timeoutError();
    if (job.serial) await stopAvd(job.serial, d).catch(() => {});
    child.kill();
    throw timeout;
  };

  const settle = () => {
    jobs.delete(name);
    if (myPort) reserved.delete(myPort);
  };
  run().then(
    (r) => {
      job.serial = r.serial;
      job.grpcPort = r.grpcPort;
      settle();
      job.progress = "ready";
      resolve(r);
    },
    (e: Error) => {
      job.progress = "failed";
      job.error = e.message;
      settle();
      reject(e);
    },
  );
  return job;
}

/** 关闭指定串口的模拟器（adb emu kill）。 */
export async function stopAvd(serial: number, deps?: Partial<LifecycleDeps>): Promise<void> {
  const d = { ...defaults, ...deps };
  await d.adb(["-s", `emulator-${serial}`, "emu", "kill"]);
}
