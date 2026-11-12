import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdbUnresponsive, createAdb, execAdb, killAdbChildren } from "../src/adb.ts";
import { ADB_UNRESPONSIVE } from "../../shared/protocol.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 假 exec：每次调用挂起，直到测试手动放行；记录同时在跑的个数。 */
function gatedExec() {
  const f = {
    calls: [] as string[],
    running: 0,
    maxRunning: 0,
    gates: [] as Array<{ args: string[]; ok: (s: string) => void; fail: (e: Error) => void }>,
    exec: (args: string[]) =>
      new Promise<string>((ok, fail) => {
        f.calls.push(args.join(" "));
        f.running++;
        f.maxRunning = Math.max(f.maxRunning, f.running);
        f.gates.push({
          args,
          ok: (s) => (f.running--, ok(s)),
          fail: (e) => (f.running--, fail(e)),
        });
      }),
  };
  return f;
}

test("同一台设备的 adb 命令一次只跑一个，按到达顺序", async () => {
  const f = gatedExec();
  const adb = createAdb({ exec: f.exec });
  const dev = adb.device(5554);
  const a = dev(["shell", "cat", "/proc/net/unix"]);
  const b = dev(["shell", "input", "keyevent", "279"]);
  await sleep(10);
  assert.deepEqual(f.calls, ["-s emulator-5554 shell cat /proc/net/unix"]);
  f.gates[0].ok("A");
  assert.equal(await a, "A");
  await sleep(10);
  assert.deepEqual(f.calls.at(-1), "-s emulator-5554 shell input keyevent 279");
  f.gates[1].ok("B");
  assert.equal(await b, "B");
  assert.equal(f.maxRunning, 1);
});

test("不同设备、不带 -s 的命令互不排队", async () => {
  const f = gatedExec();
  const adb = createAdb({ exec: f.exec });
  void adb.device(5554)(["shell", "true"]);
  void adb.device(5556)(["shell", "true"]);
  void adb.run(["forward", "--list"]);
  await sleep(10);
  assert.equal(f.running, 3);
  for (const g of f.gates) g.ok("");
});

test("前一个失败（包括超时）后队列继续往下走", async () => {
  const f = gatedExec();
  const adb = createAdb({ exec: f.exec });
  const dev = adb.device(5554);
  const a = dev(["shell", "a"]);
  const b = dev(["shell", "b"]);
  await sleep(10);
  f.gates[0].fail(new AdbUnresponsive());
  await assert.rejects(a, AdbUnresponsive);
  await sleep(10);
  f.gates[1].ok("ok");
  assert.equal(await b, "ok");
});

test("AdbUnresponsive 的文案是页面上显示的那句", () => {
  assert.equal(new AdbUnresponsive().message, ADB_UNRESPONSIVE);
});

test("真 adb 进程超时：用 SIGKILL 结束（不理 SIGTERM 的也杀得掉），归类为 adb 无响应并记日志", async () => {
  const dir = await mkdtemp(join(tmpdir(), "emu-adb-"));
  const bin = join(dir, "adb");
  // 忽略 SIGTERM 后 exec 成 sleep：只有 SIGKILL 能让它在超时后马上结束
  await writeFile(bin, "#!/bin/sh\ntrap '' TERM\nexec sleep 30\n");
  await chmod(bin, 0o755);
  const logs: string[] = [];
  const t0 = Date.now();
  await assert.rejects(execAdb(bin, ["-s", "emulator-5554", "shell", "cat", "/proc/net/unix"], 300, (s) => logs.push(s)), AdbUnresponsive);
  assert.ok(Date.now() - t0 < 3000, `用了 ${Date.now() - t0} ms`);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /SIGKILL/);
  assert.match(logs[0], /shell cat \/proc\/net\/unix/);
});

test("真 adb 进程正常退出码非 0：原样报错，不算无响应", async () => {
  const dir = await mkdtemp(join(tmpdir(), "emu-adb-"));
  const bin = join(dir, "adb");
  await writeFile(bin, "#!/bin/sh\necho \"error: device offline\" >&2\nexit 1\n");
  await chmod(bin, 0o755);
  const e = await execAdb(bin, ["devices"], 2000, () => {}).catch((e: Error) => e);
  assert.ok(e instanceof Error);
  assert.ok(!(e instanceof AdbUnresponsive));
});

test("网关退出时结束还在跑的 adb 进程，不留孤儿", async () => {
  const dir = await mkdtemp(join(tmpdir(), "emu-adb-"));
  const bin = join(dir, "adb");
  await writeFile(bin, "#!/bin/sh\nexec sleep 30\n");
  await chmod(bin, 0o755);
  const p = execAdb(bin, ["-s", "emulator-5554", "shell", "true"], 60_000, () => {});
  await sleep(100);
  const t0 = Date.now();
  killAdbChildren();
  await assert.rejects(p);
  assert.ok(Date.now() - t0 < 2000);
});
