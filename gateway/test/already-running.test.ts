import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { busyPortReport, checkPortFirst, explainBusyPort, probePort } from "../src/already-running.ts";
import { startServer } from "../src/server.ts";

const URL_ = "https://droid.devpier.dev/app/";

test("busyPortReport：端口上是 droidpier 时说明已在运行、给出页面地址、退出码 0", () => {
  const r = busyPortReport({ port: 7300, pageUrl: URL_, ownVersion: "2026-11-12T10:00:00Z", running: { kind: "droidpier", version: "2026-11-12T10:00:00Z" } });
  assert.equal(r.code, 0);
  assert.deepEqual(r.lines, ["droidpier 已经在运行（端口 7300）", URL_]);
});

test("busyPortReport：正在运行的版本更旧（或旧到没有 /healthz）时提示停掉再运行一次", () => {
  for (const version of ["2026-11-01T00:00:00Z", null]) {
    const r = busyPortReport({ port: 7300, pageUrl: URL_, ownVersion: "2026-11-12T10:00:00Z", running: { kind: "droidpier", version } });
    assert.equal(r.code, 0);
    assert.equal(r.lines.at(-1), "新版本已装好，停掉正在运行的 droidpier 后再运行一次即可更新");
  }
});

test("busyPortReport：端口上是后台服务时说明在后台运行、怎么停；更新提示改成 droidpier start", () => {
  const r = busyPortReport({ port: 7300, pageUrl: URL_, ownVersion: "2026-11-12T10:00:00Z", running: { kind: "droidpier", version: "2026-11-12T10:00:00Z", service: true } });
  assert.equal(r.code, 0);
  assert.deepEqual(r.lines, ["droidpier 已经在后台运行（端口 7300）", URL_, "停止后台运行：droidpier stop"]);
  const old = busyPortReport({ port: 7300, pageUrl: URL_, ownVersion: "2026-11-12T10:00:00Z", running: { kind: "droidpier", version: "2026-11-01T00:00:00Z", service: true } });
  assert.equal(old.lines.at(-1), "新版本已装好，运行 droidpier start 重启后台服务即可更新");
});

test("explainBusyPort：/healthz 报 service 时认出是后台服务", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "emu-busy-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const srv = await startServer({ port: 0, allowedOrigins: [], staticDir: dir, getSession: async () => null, version: "2026-11-12T10:00:00Z", service: true, log: () => {} });
  t.after(() => srv.close());
  const r = await explainBusyPort({ port: srv.port, pageUrl: URL_, ownVersion: "2026-11-12T10:00:00Z" });
  assert.equal(r.lines[0], `droidpier 已经在后台运行（端口 ${srv.port}）`);
  assert.deepEqual(await probePort(srv.port), { kind: "droidpier", version: "2026-11-12T10:00:00Z", service: true, pid: process.pid });
});

test("busyPortReport：自己是开发版（没有版本）时不判断新旧", () => {
  const r = busyPortReport({ port: 7300, pageUrl: URL_, ownVersion: "", running: { kind: "droidpier", version: null } });
  assert.equal(r.lines.length, 2);
});

test("busyPortReport：端口被别的程序占着时说明换端口的两种写法，退出码 1", () => {
  const r = busyPortReport({ port: 7300, pageUrl: URL_, ownVersion: "x", running: { kind: "other" } });
  assert.equal(r.code, 1);
  const text = r.lines.join("\n");
  assert.match(text, /端口 7300 被别的程序占用/);
  assert.match(text, /droidpier --port 7301/);
  assert.match(text, /install\.sh \| sh -s -- --port 7301/);
});

async function listen(t: { after(fn: () => unknown): void }, handler: Parameters<typeof createServer>[1]): Promise<number> {
  const s: Server = createServer(handler);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  // 探测的 fetch 会留下 keep-alive 连接，不强制断开 close 会一直等
  t.after(() => new Promise((r) => (s.close(r), s.closeAllConnections())));
  return (s.address() as { port: number }).port;
}

test("explainBusyPort：端口上跑着真的网关时认出 droidpier 和它的版本", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "emu-busy-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "index.html"), "<title>Droidpier</title>");
  const srv = await startServer({ port: 0, allowedOrigins: [], staticDir: dir, getSession: async () => null, version: "2026-11-01T00:00:00Z", log: () => {} });
  t.after(() => srv.close());
  // 第二个网关抢同一个端口：listen 报 EADDRINUSE
  await assert.rejects(
    startServer({ port: srv.port, allowedOrigins: [], staticDir: dir, getSession: async () => null, log: () => {} }),
    (e: NodeJS.ErrnoException) => e.code === "EADDRINUSE",
  );
  const r = await explainBusyPort({ port: srv.port, pageUrl: URL_, ownVersion: "2026-11-12T10:00:00Z" });
  assert.equal(r.code, 0);
  assert.equal(r.lines[0], `droidpier 已经在运行（端口 ${srv.port}）`);
  assert.match(r.lines.at(-1)!, /新版本已装好/);
});

test("explainBusyPort：没有 /healthz 的旧网关靠 /app/ 的标题认出来，当作旧版本", async (t) => {
  const port = await listen(t, (req, res) => {
    if (req.url === "/app/") res.end("<!doctype html><head><title>Droidpier</title>");
    else res.writeHead(404).end();
  });
  const r = await explainBusyPort({ port, pageUrl: URL_, ownVersion: "2026-11-12T10:00:00Z" });
  assert.equal(r.code, 0);
  assert.match(r.lines.at(-1)!, /新版本已装好/);
});

test("explainBusyPort：端口被别的 HTTP 服务占着时退出码 1", async (t) => {
  const port = await listen(t, (_req, res) => res.end("<title>Something else</title>"));
  const r = await explainBusyPort({ port, pageUrl: URL_, ownVersion: "x" });
  assert.equal(r.code, 1);
});

test("explainBusyPort：占着端口的程序不回应时在超时后判定为别的程序", async (t) => {
  const port = await listen(t, () => {});
  const r = await explainBusyPort({ port, pageUrl: URL_, ownVersion: "x", timeoutMs: 200 });
  assert.equal(r.code, 1);
});

test("checkPortFirst：端口空着时返回 null，并且把端口放回去", async () => {
  const free = await new Promise<number>((r) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => r(p));
    });
  });
  assert.equal(await checkPortFirst({ port: free, pageUrl: URL_, ownVersion: "x" }), null);
  // 检查完端口要能马上再绑
  const again = createServer();
  await new Promise<void>((r) => again.listen(free, "127.0.0.1", r));
  await new Promise((r) => again.close(r));
});

test("checkPortFirst：端口被占时直接给出判断", async (t) => {
  const port = await listen(t, (_req, res) => res.end("nope"));
  const r = await checkPortFirst({ port, pageUrl: URL_, ownVersion: "x" });
  assert.equal(r?.code, 1);
});

test("网关入口：端口上已有 droidpier 时先退出，不做环境检查和模拟器发现", async (t) => {
  const port = await listen(t, (req, res) => {
    if (req.url === "/healthz") res.end(JSON.stringify({ app: "droidpier", version: "" }));
    else res.writeHead(404).end();
  });
  // 空的 HOME / SDK：旧顺序会先做发现，打印"没有找到带 gRPC 的运行中模拟器"
  const home = await mkdtemp(join(tmpdir(), "emu-busy-home-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const main = fileURLToPath(new URL("../src/main.ts", import.meta.url));
  const r = await new Promise<{ code: number; out: string }>((res) =>
    execFile(process.execPath, [main, "--port", String(port), "--no-open", "--local"], {
      env: { PATH: process.env.PATH, HOME: home, ANDROID_HOME: join(home, "sdk"), ANDROID_AVD_HOME: join(home, "avd") },
      encoding: "utf8",
      timeout: 20_000,
    }, (e, stdout, stderr) => res({ code: e ? (typeof e.code === "number" ? e.code : 1) : 0, out: stdout + stderr })),
  );
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, new RegExp(`droidpier 已经在运行（端口 ${port}）`));
  assert.doesNotMatch(r.out, /模拟器|emulator-/);
});
