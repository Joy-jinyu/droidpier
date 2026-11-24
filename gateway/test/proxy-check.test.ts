import { test } from "node:test";
import assert from "node:assert/strict";
import { checkProxy, clearProxy } from "../src/proxy-check.ts";

/**
 * 假模拟器：settings 里存着 http_proxy（undefined 表示没设过）；reply 是经代理发请求时 nc 输出的第一行；
 * untrusted 是扫最近日志里证书校验失败时输出的包名行。
 */
function device(opts: { proxy?: string; reply?: string; untrusted?: string; ignorePut?: boolean } = {}) {
  let proxy = opts.proxy;
  const probes: string[] = [];
  const scans: string[] = [];
  const exec = async (args: string[]) => {
    const cmd = args.slice(1).join(" ");
    if (cmd === "settings get global http_proxy") return `${proxy ?? "null"}\n`;
    if (cmd === "settings put global http_proxy :0") {
      if (!opts.ignorePut) proxy = ":0";
      return "";
    }
    if (cmd.startsWith("logcat -d")) {
      scans.push(cmd);
      return opts.untrusted ?? "";
    }
    if (cmd.includes("| nc ")) {
      probes.push(cmd);
      return `${opts.reply ?? ""}\n`;
    }
    throw new Error(`没想到的命令：${cmd}`);
  };
  return { proxy: () => proxy, probes, scans, deps: { exec } };
}

test("没设过代理：报告没有代理，不发探测请求", async () => {
  const d = device();
  assert.deepEqual(await checkProxy(d.deps), { proxy: null });
  assert.equal(d.probes.length, 0);
});

test("代理已经清成 :0：也算没有代理", async () => {
  assert.deepEqual(await checkProxy(device({ proxy: ":0" }).deps), { proxy: null });
});

test("代理回了 HTTP 响应、日志里没有证书失败：能用", async () => {
  const d = device({ proxy: "10.0.2.2:9091", reply: "HTTP/1.0 204 No Content" });
  assert.deepEqual(await checkProxy(d.deps), { proxy: "10.0.2.2:9091", ok: true, untrusted: [] });
  assert.match(d.probes[0], /nc -w \d+ 10\.0\.2\.2 9091/);
});

test("代理回 502 也算能用：代理本身是好的", async () => {
  const d = device({ proxy: "10.0.2.2:9091", reply: "HTTP/1.1 502 Bad Gateway" });
  assert.deepEqual(await checkProxy(d.deps), { proxy: "10.0.2.2:9091", ok: true, untrusted: [] });
});

test("代理能连通但最近有 App 的证书校验失败（抓包工具在解密、设备没装它的证书）：报出这些 App", async () => {
  const d = device({ proxy: "10.0.2.2:9091", reply: "HTTP/1.0 204 No Content", untrusted: "global.longbridge.android.debug\n?\n" });
  assert.deepEqual(await checkProxy(d.deps), { proxy: "10.0.2.2:9091", ok: true, untrusted: ["global.longbridge.android.debug", "?"] });
  assert.match(d.scans[0], /-T "\$\(\( \$\(date \+%s\) - 300 \)\)\.000"/);
  assert.match(d.scans[0], /Trust anchor for certification path not found/);
});

test("代理连不上：不去扫日志", async () => {
  const d = device({ proxy: "10.20.95.233:9091", reply: "nc: Timeout" });
  await checkProxy(d.deps);
  assert.equal(d.scans.length, 0);
});

test("超时、拒绝连接、TCP 连上但没回复：都算连不上", async () => {
  for (const reply of ["nc: Timeout", "nc: connect: Connection refused", ""]) {
    const d = device({ proxy: "10.20.95.233:9091", reply });
    assert.deepEqual(await checkProxy(d.deps), { proxy: "10.20.95.233:9091", ok: false }, reply);
  }
});

test("认不出的代理地址：按连不上处理，不拼进 shell 命令", async () => {
  const d = device({ proxy: "evil;reboot:80" });
  assert.deepEqual(await checkProxy(d.deps), { proxy: "evil;reboot:80", ok: false });
  assert.equal(d.probes.length, 0);
});

test("以 - 开头的主机名：不拼进 nc 命令（会被当成选项）", async () => {
  const d = device({ proxy: "-l:9091" });
  assert.deepEqual(await checkProxy(d.deps), { proxy: "-l:9091", ok: false });
  assert.equal(d.probes.length, 0);
});

test("清除代理：写入 :0 后读回确认已经没有代理", async () => {
  const d = device({ proxy: "10.20.95.233:9091" });
  assert.equal(await clearProxy(d.deps, "10.20.95.233:9091"), "cleared");
  assert.deepEqual(await checkProxy(d.deps), { proxy: null });
});

test("清除代理：现在的设置和检测时看到的不同（换了设备），不动它", async () => {
  const d = device({ proxy: "10.0.2.2:9091" });
  assert.equal(await clearProxy(d.deps, "10.20.95.233:9091"), "changed");
  assert.equal(d.proxy(), "10.0.2.2:9091");
});

test("清除后读回来还是旧代理：报告没清掉", async () => {
  const d = device({ proxy: "10.20.95.233:9091", ignorePut: true });
  assert.equal(await clearProxy(d.deps, "10.20.95.233:9091"), "failed");
});
