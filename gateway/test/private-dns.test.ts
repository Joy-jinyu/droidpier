import { test } from "node:test";
import assert from "node:assert/strict";
import { turnOffAutoPrivateDns } from "../src/private-dns.ts";
import { AdbUnresponsive } from "../src/adb.ts";

/** 假设备：settings 里存着 mode（undefined 表示没设过），booted(t) 决定 sys.boot_completed；sleep 只推进假时钟。 */
function device(opts: { mode?: string; booted?: (t: number) => boolean; failPut?: boolean } = {}) {
  let now = 0;
  let mode = opts.mode;
  const logs: string[] = [];
  const exec = async (args: string[]) => {
    const cmd = args.slice(1).join(" ");
    if (cmd === "getprop sys.boot_completed") {
      if (opts.booted && !opts.booted(now)) throw new AdbUnresponsive();
      return "1\n";
    }
    if (cmd === "settings get global private_dns_mode") return `${mode ?? "null"}\n`;
    if (cmd === "settings put global private_dns_mode off") {
      if (opts.failPut) throw new Error("device offline");
      mode = "off";
      return "";
    }
    throw new Error(`没想到的命令：${cmd}`);
  };
  return {
    mode: () => mode,
    logs,
    deps: { exec, now: () => now, sleep: async (ms: number) => void (now += ms), log: (s: string) => logs.push(s) },
  };
}

test("默认的自动 Private DNS（没设过）：改成 off，并记一行日志", async () => {
  const d = device();
  assert.equal(await turnOffAutoPrivateDns(d.deps), "off");
  assert.equal(d.mode(), "off");
  assert.equal(d.logs.length, 1);
});

test("显式的 opportunistic 也算自动：改成 off", async () => {
  const d = device({ mode: "opportunistic" });
  assert.equal(await turnOffAutoPrivateDns(d.deps), "off");
  assert.equal(d.mode(), "off");
});

test("用户指定了 DoT 服务器（hostname）或已经是 off：不动，也不记日志", async () => {
  for (const mode of ["hostname", "off"]) {
    const d = device({ mode });
    assert.equal(await turnOffAutoPrivateDns(d.deps), "kept");
    assert.equal(d.mode(), mode);
    assert.deepEqual(d.logs, []);
  }
});

test("刚连上时还在开机：等开机完成再改", async () => {
  const d = device({ booted: (t) => t >= 30_000 });
  assert.equal(await turnOffAutoPrivateDns(d.deps), "off");
  assert.equal(d.mode(), "off");
});

test("一直没开机完成：等满时限后放弃，不改设置", async () => {
  const d = device({ booted: () => false });
  assert.equal(await turnOffAutoPrivateDns(d.deps), "failed");
  assert.equal(d.mode(), undefined);
  assert.equal(d.logs.length, 1);
});

test("写设置时 adb 出错：返回 failed 并记下原因，不抛", async () => {
  const d = device({ failPut: true });
  assert.equal(await turnOffAutoPrivateDns(d.deps), "failed");
  assert.match(d.logs[0], /device offline/);
});
