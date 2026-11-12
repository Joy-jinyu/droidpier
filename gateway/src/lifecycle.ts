import { spawn as spawnCp } from "node:child_process";
import net from "node:net";
import { listAvds } from "./avd.ts";
import { findOwnRunning, pidAlive, type Running } from "./discovery.ts";
import { emulatorBin } from "./platform.ts";
import { adb, ADB_TIMEOUT_MS } from "./adb.ts";
import type { AvdInfo } from "../../shared/protocol.ts";

const GRPC_BASE_PORT = 8554;
const BOOT_TIMEOUT_MS = 180_000;
const POLL_MS = 1000;

/** 启动出来的子进程里，生命周期模块用到的部分。 */
export type Child = { kill(): void; unref(): void; onExit(cb: (code: number | null) => void): void };

/** 可注入的外部依赖，测试里换成假的。 */
export type LifecycleDeps = {
  spawn: (cmd: string, args: string[]) => Child;
  /** 跑 adb，返回 stdout。 */
  adb: (args: string[]) => Promise<string>;
  listAvds: () => Promise<AvdInfo[]>;
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

const defaults: LifecycleDeps = {
  spawn: (cmd, args) => {
    // detached：模拟器在自己的进程组里，网关退出后它还在；emulator 会再拉起 qemu，结束时要杀整个进程组
    const c = spawnCp(cmd, args, { detached: true, stdio: "ignore" });
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
  listAvds: () => listAvds(),
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
  const run = async (): Promise<Running> => {
    const info = (await d.listAvds()).find((a) => a.name === name);
    if (!info) throw new Error(`没有这个 AVD：${name}`);
    if (info.running === "no-grpc") throw new Error(`${name} 已在运行但没开 gRPC，无法接管`);
    if (info.running === "grpc") {
      const r = await d.findRunning(name);
      if (r) return r;
    }

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
    child = d.spawn(emulatorBin(), ["-avd", name, "-no-window", "-grpc", String(port), "-no-boot-anim", "-gpu", "host"]);
    child.unref();
    // 实测 macOS 上 emulator 直接 exec 成 qemu，所以开机中它退出（含 emu kill 的 code 0、被信号杀的 null）就是失败
    child.onExit((code) => (exited = { code }));
    job.progress = "booting";

    const start = d.now();
    let running: Running | null = null;
    while (d.now() - start < BOOT_TIMEOUT_MS) {
      if (exited) throw new Error(`模拟器进程在开机中退出（code ${exited.code}）`);
      running ??= await d.findRunning(name);
      if (running) {
        if (!d.alive(running.pid)) throw new Error(`模拟器进程在开机中退出（pid ${running.pid} 已不在）`);
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
    if (job.serial) await stopAvd(job.serial, d).catch(() => {});
    child.kill();
    throw new Error(`开机超时（${BOOT_TIMEOUT_MS / 1000} 秒）`);
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
