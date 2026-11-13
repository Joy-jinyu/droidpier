import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { avdHome, emulatorEnv } from "../src/platform.ts";
import { listAvds } from "../src/avd.ts";
import { startAvd } from "../src/lifecycle.ts";

const KEYS = ["ANDROID_HOME", "ANDROID_AVD_HOME", "ANDROID_USER_HOME"] as const;

/** 临时目录 + 改环境变量，测试结束还原。 */
async function sandbox(t: import("node:test").TestContext, env: Partial<Record<(typeof KEYS)[number], string>>) {
  const root = await mkdtemp(join(tmpdir(), "emu-avd-home-"));
  const old = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  t.after(async () => {
    for (const k of KEYS) old[k] === undefined ? delete process.env[k] : (process.env[k] = old[k]);
    await rm(root, { recursive: true, force: true });
  });
  for (const k of KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(env)) process.env[k] = v.replace("$ROOT", root);
  return root;
}

test("avdHome：ANDROID_USER_HOME/avd 里有 .ini 才用它", async (t) => {
  const root = await sandbox(t, { ANDROID_USER_HOME: "$ROOT/user" });
  await mkdir(join(root, "user/avd"), { recursive: true });
  await writeFile(join(root, "user/avd/P.ini"), "path=/x\n");
  assert.equal(avdHome(), join(root, "user/avd"));
});

test("avdHome：ANDROID_USER_HOME/avd 不存在或没有 .ini（AVD 还在老地方）：回到 ~/.android/avd", async (t) => {
  const root = await sandbox(t, { ANDROID_USER_HOME: "$ROOT/user" });
  assert.equal(avdHome(), join(homedir(), ".android/avd"));
  await mkdir(join(root, "user/avd"), { recursive: true });
  await writeFile(join(root, "user/avd/readme.txt"), "");
  assert.equal(avdHome(), join(homedir(), ".android/avd"));
});

test("avdHome：显式的 ANDROID_AVD_HOME 优先", async (t) => {
  const root = await sandbox(t, { ANDROID_AVD_HOME: "$ROOT/avd", ANDROID_USER_HOME: "$ROOT/user" });
  await mkdir(join(root, "user/avd"), { recursive: true });
  await writeFile(join(root, "user/avd/P.ini"), "");
  assert.equal(avdHome(), join(root, "avd"));
});

test("emulatorEnv：带上 ANDROID_AVD_HOME=avdHome()，其他环境变量照旧", async (t) => {
  await sandbox(t, { ANDROID_USER_HOME: "$ROOT/user" });
  const env = emulatorEnv();
  assert.equal(env.ANDROID_AVD_HOME, join(homedir(), ".android/avd"));
  assert.equal(env.PATH, process.env.PATH);
});

/** 假 SDK：emulator 把收到的 ANDROID_AVD_HOME 打出来（-list-avds 时当 AVD 名）。 */
async function fakeEmulator(root: string) {
  await mkdir(join(root, "sdk/emulator"), { recursive: true });
  const bin = join(root, "sdk/emulator/emulator");
  await writeFile(bin, '#!/bin/sh\necho "AVDHOME=$ANDROID_AVD_HOME"\n');
  await chmod(bin, 0o755);
}

test("emulator -list-avds 带着网关算出的 ANDROID_AVD_HOME 跑（老版本模拟器不认 ANDROID_USER_HOME）", async (t) => {
  const root = await sandbox(t, { ANDROID_HOME: "$ROOT/sdk", ANDROID_USER_HOME: "$ROOT/user" });
  await fakeEmulator(root);
  await mkdir(join(root, "user/avd"), { recursive: true });
  await writeFile(join(root, "user/avd/P.ini"), "");
  const list = await listAvds({ discoveryDir: join(root, "running"), avdHome: join(root, "user/avd") });
  assert.deepEqual(list.map((a) => a.name), [`AVDHOME=${join(root, "user/avd")}`]);
});

test("emulator -avd 带着网关算出的 ANDROID_AVD_HOME 启动", async (t) => {
  const root = await sandbox(t, { ANDROID_HOME: "$ROOT/sdk", ANDROID_USER_HOME: "$ROOT/user" });
  await fakeEmulator(root);
  const log = join(root, "emu.log");
  const job = startAvd("Env_Probe", {
    logPath: () => log,
    listAvds: async () => [{ name: "Env_Probe", running: "no" } as never],
    repairTarget: async () => {},
    findRunning: async () => null,
    portFree: async () => true,
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 20))),
  });
  // 假 emulator 打完就退出：这次启动按“开机中退出”失败，日志里是它看到的环境变量
  await assert.rejects(job.done);
  assert.match(await readFile(log, "utf8"), new RegExp(`^AVDHOME=${join(homedir(), ".android/avd").replace(/[.]/g, "\\.")}$`, "m"));
});
