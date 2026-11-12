import { test } from "node:test";
import assert from "node:assert/strict";
import { startAvd, stopAvd, type LifecycleDeps } from "../src/lifecycle.ts";
import type { AvdInfo } from "../../shared/protocol.ts";
import type { Running } from "../src/discovery.ts";

type Spawned = { cmd: string; args: string[]; killed: boolean; unref: boolean; exit: (code: number | null) => void };

/** 假的 spawn / adb / 时钟：sleep 只推进假时间，不真等。 */
function fakes(
  opts: {
    busy?: number[];
    bootAfterMs?: number;
    avds?: AvdInfo[];
    preRunning?: Running;
    /** getprop 永远不返回 */
    getpropHangs?: boolean;
    /** 到这个假时间时子进程退出（code 0） */
    exitAtMs?: number;
    /** 到这个假时间后模拟器 pid 不在了 */
    deadAtMs?: number;
    /** 子进程退出时的 code，默认 0 */
    exitCode?: number;
    /** 子进程写进日志文件的内容 */
    log?: string;
    /** 日志读不到（比如没能打开日志文件） */
    noLog?: boolean;
  } = {},
) {
  let now = 0;
  const spawned: Spawned[] = [];
  const execs: string[] = [];
  const booted = new Map<string, Running>();
  const logs = new Map<string, string>();
  const deps: LifecycleDeps = {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
      for (const s of spawned) if (opts.exitAtMs !== undefined && now >= opts.exitAtMs) s.exit(opts.exitCode ?? 0);
    },
    logPath: (name) => `/logs/${name}.log`,
    readLog: async (path) => (opts.noLog ? null : (logs.get(path) ?? null)),
    portFree: async (p) => !(opts.busy ?? []).includes(p),
    listAvds: async () => opts.avds ?? [{ name: "A", running: "no" }, { name: "B", running: "no" }],
    findRunning: async (name) => (opts.preRunning?.avdName === name ? opts.preRunning : (booted.get(name) ?? null)),
    alive: () => opts.deadAtMs === undefined || now < opts.deadAtMs,
    spawn: (cmd, args, logPath) => {
      logs.set(logPath, opts.log ?? "");
      const cbs: Array<(code: number | null) => void> = [];
      const s: Spawned = { cmd, args, killed: false, unref: false, exit: (code) => cbs.splice(0).forEach((cb) => cb(code)) };
      spawned.push(s);
      const port = Number(args[args.indexOf("-grpc") + 1]);
      const name = args[args.indexOf("-avd") + 1];
      booted.set(name, { pid: 4242 + booted.size, serial: 5556 + 2 * booted.size, grpcPort: port, avdName: name });
      return { kill: () => void (s.killed = true), unref: () => void (s.unref = true), onExit: (cb) => void cbs.push(cb) };
    },
    adb: (args) => {
      const cmd = args.join(" ");
      execs.push(cmd);
      if (cmd.includes("getprop sys.boot_completed")) {
        if (opts.getpropHangs) return new Promise(() => {});
        return Promise.resolve(now >= (opts.bootAfterMs ?? 3000) ? "1\n" : "\n");
      }
      return Promise.resolve("");
    },
  };
  return { deps, spawned, execs, now: () => now };
}

test("重复 start 返回同一个进行中的任务", async () => {
  const f = fakes();
  const a = startAvd("A", f.deps);
  const b = startAvd("A", f.deps);
  assert.equal(a, b);
  await a.done;
  assert.equal(f.spawned.length, 1);
});

test("getprop 返回 1 后 progress 变为 ready，done resolve 的 grpcPort 等于分配的端口", async () => {
  const f = fakes({ bootAfterMs: 5000 });
  const job = startAvd("A", f.deps);
  const r = await job.done;
  assert.equal(job.progress, "ready");
  assert.equal(job.grpcPort, 8554);
  assert.equal(r.grpcPort, job.grpcPort);
  assert.equal(job.serial, 5556);
  const s = f.spawned[0];
  assert.deepEqual(s.args, ["-avd", "A", "-no-window", "-grpc", "8554", "-no-boot-anim", "-gpu", "host"]);
  assert.equal(s.unref, true);
  assert.ok(f.execs.includes("-s emulator-5556 shell getprop sys.boot_completed"));
});

test("超过 180s 未就绪 → failed，error 包含 '超时'，并结束子进程", async () => {
  const f = fakes({ bootAfterMs: Infinity });
  const job = startAvd("A", f.deps);
  await assert.rejects(job.done, /超时/);
  assert.equal(job.progress, "failed");
  assert.match(job.error ?? "", /超时/);
  assert.equal(f.spawned[0].killed, true);
  assert.ok(f.now() >= 180_000);
});

test("已在运行（grpc）的 AVD → 立即 ready，不调用 spawn", async () => {
  const pre: Running = { pid: 7, serial: 5554, grpcPort: 8554, avdName: "A" };
  const f = fakes({ avds: [{ name: "A", running: "grpc", serial: 5554, grpcPort: 8554 }], preRunning: pre });
  const job = startAvd("A", f.deps);
  assert.deepEqual(await job.done, pre);
  assert.equal(job.progress, "ready");
  assert.equal(job.serial, 5554);
  assert.equal(f.spawned.length, 0);
});

test("已在运行但没开 gRPC 的 AVD → failed，不调用 spawn", async () => {
  const f = fakes({ avds: [{ name: "A", running: "no-grpc", serial: 5554 }] });
  const job = startAvd("A", f.deps);
  await assert.rejects(job.done, /gRPC/);
  assert.equal(job.progress, "failed");
  assert.equal(f.spawned.length, 0);
});

test("端口分配跳过被占用的 8554，得到 8556", async () => {
  const f = fakes({ busy: [8554] });
  const job = startAvd("A", f.deps);
  const r = await job.done;
  assert.equal(job.grpcPort, 8556);
  assert.equal(r.grpcPort, 8556);
});

test("任务结束后再 start 同名 AVD 会新开任务", async () => {
  const f = fakes({ bootAfterMs: Infinity });
  const a = startAvd("A", f.deps);
  await a.done.catch(() => {});
  const b = startAvd("A", f.deps);
  assert.notEqual(a, b);
  await b.done.catch(() => {});
});

test("stopAvd 发 adb emu kill", async () => {
  const f = fakes();
  await stopAvd(5556, f.deps);
  assert.deepEqual(f.execs, ["-s emulator-5556 emu kill"]);
});

test("没有这个 AVD → failed，不调用 spawn", async () => {
  const f = fakes();
  const job = startAvd("-wipe-data", f.deps);
  await assert.rejects(job.done, /没有这个 AVD/);
  assert.equal(f.spawned.length, 0);
});

test("开机中途子进程退出（code 0）→ 很快 failed", async () => {
  const f = fakes({ bootAfterMs: Infinity, exitAtMs: 2000 });
  const job = startAvd("A", f.deps);
  await assert.rejects(job.done, /退出/);
  assert.equal(job.progress, "failed");
  assert.ok(f.now() < 10_000, `假时间 ${f.now()}`);
});

test("开机中途退出（code 1）→ error 带上日志里的原因、提示和日志路径", async () => {
  const log = "WARNING | x is not a valid directory.\nPANIC: Cannot find AVD system path. Please define ANDROID_SDK_ROOT\nINFO    | version\n";
  const f = fakes({ bootAfterMs: Infinity, exitAtMs: 2000, exitCode: 1, log });
  const job = startAvd("A", f.deps);
  await assert.rejects(job.done);
  const err = job.error ?? "";
  assert.ok(err.startsWith("模拟器进程在开机中退出（code 1）：PANIC: Cannot find AVD system path. Please define ANDROID_SDK_ROOT"), err);
  assert.match(err, /系统镜像/);
  assert.ok(err.endsWith("完整日志：/logs/A.log"), err);
});

test("开机中途 pid 不在了 → error 也带上日志里的原因", async () => {
  const f = fakes({ bootAfterMs: Infinity, deadAtMs: 2000, log: "FATAL | boom\n" });
  const job = startAvd("A", f.deps);
  await assert.rejects(job.done);
  assert.match(job.error ?? "", /^模拟器进程在开机中退出（pid \d+ 已不在）：FATAL \| boom。完整日志：\/logs\/A\.log$/);
});

test("开机中途退出但日志为空 → 只给日志路径", async () => {
  const f = fakes({ bootAfterMs: Infinity, exitAtMs: 2000, exitCode: 1, log: "" });
  const job = startAvd("A", f.deps);
  await assert.rejects(job.done);
  assert.equal(job.error, "模拟器进程在开机中退出（code 1）。完整日志：/logs/A.log");
});

test("开机中途退出且日志读不到 → 保持原来的错误", async () => {
  const f = fakes({ bootAfterMs: Infinity, exitAtMs: 2000, exitCode: 1, noLog: true });
  const job = startAvd("A", f.deps);
  await assert.rejects(job.done);
  assert.equal(job.error, "模拟器进程在开机中退出（code 1）");
});

test("spawn 收到这个 AVD 的日志路径", async () => {
  const paths: string[] = [];
  const f = fakes();
  const spawn = f.deps.spawn;
  await startAvd("A", { ...f.deps, spawn: (c, a, p) => (paths.push(p), spawn(c, a, p)) }).done;
  assert.deepEqual(paths, ["/logs/A.log"]);
});

test("开机中途模拟器 pid 不在了 → 很快 failed", async () => {
  const f = fakes({ bootAfterMs: Infinity, deadAtMs: 2000 });
  const job = startAvd("A", f.deps);
  await assert.rejects(job.done, /退出/);
  assert.ok(f.now() < 10_000, `假时间 ${f.now()}`);
});

test("两个不同名任务同时启动 → 分别得到 8554 和 8556", async () => {
  const f = fakes();
  const a = startAvd("A", f.deps);
  const b = startAvd("B", f.deps);
  await Promise.all([a.done, b.done]);
  assert.deepEqual([a.grpcPort, b.grpcPort], [8554, 8556]);
});

test("任务结束后释放预留端口：下一个任务又能用 8554", async () => {
  const f = fakes();
  await startAvd("A", f.deps).done;
  const b = startAvd("B", f.deps);
  await b.done;
  assert.equal(b.grpcPort, 8554);
});

test("getprop 一直不返回也不会卡住任务：到期 failed", { timeout: 5000 }, async () => {
  const f = fakes({ getpropHangs: true });
  const job = startAvd("A", f.deps);
  await assert.rejects(job.done, /超时/);
});
