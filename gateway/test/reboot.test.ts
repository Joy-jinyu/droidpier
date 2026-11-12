import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForReboot } from "../src/reboot.ts";
import { AdbUnresponsive } from "../src/adb.ts";

/** 假时钟：sleep 只推进时间；check 按时间返回结果。 */
function clock(answer: (t: number) => Promise<string>) {
  let now = 0;
  const checks: number[] = [];
  return {
    checks,
    deps: {
      now: () => now,
      sleep: async (ms: number) => void (now += ms),
      check: () => (checks.push(now), answer(now)),
    },
  };
}

test("先看到没开机（或 adb 不通），之后读到 1：开机完成", async () => {
  const c = clock(async (t) => (t < 3000 ? Promise.reject(new AdbUnresponsive()) : t < 8000 ? "\n" : "1\n"));
  assert.equal(await waitForReboot({ ...c.deps, maxMs: 120_000, pollMs: 1000 }), "done");
  assert.ok(c.checks.at(-1)! >= 8000);
});

test("重启指令刚发出时读到的 1 是上一次开机的，不算", async () => {
  const c = clock(async (t) => (t < 2000 ? "1\n" : t < 5000 ? Promise.reject(new Error("device offline")) : "1\n"));
  assert.equal(await waitForReboot({ ...c.deps, maxMs: 120_000, pollMs: 1000 }), "done");
  assert.ok(c.checks.at(-1)! >= 5000);
});

test("adb 一直不通：最长等 maxMs，结果是 adb-down", async () => {
  const c = clock(async () => Promise.reject(new AdbUnresponsive()));
  assert.equal(await waitForReboot({ ...c.deps, maxMs: 120_000, pollMs: 1000 }), "adb-down");
  assert.ok(c.checks.at(-1)! < 120_000);
});

test("一直读到 1（重启没生效）：同样等满 maxMs 后 adb-down，不误报完成", async () => {
  const c = clock(async () => "1\n");
  assert.equal(await waitForReboot({ ...c.deps, maxMs: 30_000, pollMs: 1000 }), "adb-down");
});
