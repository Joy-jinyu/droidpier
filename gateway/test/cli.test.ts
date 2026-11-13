import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCli, USAGE, versionLine } from "../src/cli.ts";

test("parseCli：没有参数时用默认端口，打开浏览器", () => {
  assert.deepEqual(parseCli([]), { kind: "run", options: { port: 7300, noOpen: false, allowOrigins: [] } });
});

test("parseCli：认得的参数照旧生效", () => {
  const r = parseCli(["--port", "7306", "--local", "--no-open", "--public", "--allow-origin", "http://droid.test:7351"]);
  assert.deepEqual(r, { kind: "run", options: { port: 7306, noOpen: true, allowOrigins: ["http://droid.test:7351"] } });
});

test("parseCli：打错的参数报错，不按默认端口启动", () => {
  assert.deepEqual(parseCli(["--prot", "7306"]), { kind: "error", message: "不认识的参数：--prot" });
  assert.deepEqual(parseCli(["--no-opne"]), { kind: "error", message: "不认识的参数：--no-opne" });
});

test("parseCli：多出来的参数报错（droidpier 7306 少写了 --port）", () => {
  assert.deepEqual(parseCli(["7306"]), { kind: "error", message: "多余的参数：7306" });
});

test("parseCli：--port 缺值或不合法时报错", () => {
  assert.deepEqual(parseCli(["--port"]), { kind: "error", message: "--port 不合法：缺少端口号" });
  for (const v of ["abc", "0", "65536", "73.5"]) assert.deepEqual(parseCli(["--port", v]), { kind: "error", message: `--port 不合法：${v}` });
});

test("parseCli：--allow-origin 缺值或不是 Origin 写法时报错", () => {
  assert.match((parseCli(["--allow-origin"]) as { message: string }).message, /^--allow-origin 不合法：缺少来源/);
  assert.match((parseCli(["--allow-origin", "http://droid.test:7351/app/"]) as { message: string }).message, /^--allow-origin 不合法：http:\/\/droid\.test:7351\/app\//);
});

test("parseCli：--help / -h / --version 优先于其他参数", () => {
  assert.deepEqual(parseCli(["--help"]), { kind: "help" });
  assert.deepEqual(parseCli(["--port", "7306", "-h"]), { kind: "help" });
  assert.deepEqual(parseCli(["--prot", "--version"]), { kind: "version" });
});

test("帮助列出全部公开参数", () => {
  for (const f of ["--port", "--local", "--no-open", "--version", "--help"]) assert.ok(USAGE.includes(f), f);
});

test("versionLine：打包版本打印构建时间，源码运行说明没有版本号", () => {
  assert.equal(versionLine("2026-11-12T08:00:00.000Z"), "droidpier 2026-11-12T08:00:00.000Z");
  assert.match(versionLine(""), /源码/);
});

/** 用空的 HOME / SDK 跑网关入口：真的启动了的话会打印 "droidpier: <地址>" 或"模拟器"，端口被占时打印"已经在运行"。都带 --no-open，出错也不会开浏览器。 */
async function runMain(t: { after(fn: () => unknown): void }, args: string[]) {
  const home = await mkdtemp(join(tmpdir(), "emu-cli-home-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const main = fileURLToPath(new URL("../src/main.ts", import.meta.url));
  return new Promise<{ code: number; stdout: string; stderr: string }>((res) =>
    execFile(process.execPath, [main, ...args], {
      env: { PATH: process.env.PATH, HOME: home, ANDROID_HOME: join(home, "sdk"), ANDROID_AVD_HOME: join(home, "avd") },
      encoding: "utf8",
      timeout: 20_000,
    }, (e, stdout, stderr) => res({ code: e ? (typeof e.code === "number" ? e.code : 1) : 0, stdout, stderr })),
  );
}

test("网关入口：--version 打印版本后退出，不启动网关", async (t) => {
  const r = await runMain(t, ["--version", "--no-open"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.stdout.trim(), versionLine(""));
  assert.doesNotMatch(r.stdout + r.stderr, /模拟器|droidpier:|已经在运行/);
});

test("网关入口：--help 打印用法后退出", async (t) => {
  const r = await runMain(t, ["--help", "--no-open"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.stdout.trim(), USAGE);
});

test("网关入口：打错参数时报错退出，不在默认端口启动", async (t) => {
  const r = await runMain(t, ["--prot", "7306", "--no-open"]);
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /^不认识的参数：--prot\n\n用法：droidpier/);
  assert.doesNotMatch(r.stdout + r.stderr, /模拟器|droidpier:|已经在运行/);
});
