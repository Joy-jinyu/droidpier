import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyFailure, DEFAULT_GATEWAY_PORT, gatewayAnswers, gatewayPort, isSupportedBrowser, parsePort, refineLocalFailure, siteOrigin } from "../../host/src/launch.ts";
import { installCmd, OFFICIAL_ORIGIN } from "../../shared/protocol.ts";

test("parsePort 读出 #port，旧链接里的口令不管", () => {
  assert.equal(parsePort("#port=7306"), 7306);
  assert.equal(parsePort("#port=7300&token=abc"), 7300);
  assert.equal(parsePort("port=7310"), 7310);
});

test("parsePort 没有端口或端口不合法返回 null", () => {
  for (const h of ["", "#", "#token=abc", "#port=abc", "#port=0", "#port=70000", "#port=7300.5", "#port="]) assert.equal(parsePort(h), null, h);
});

test("isSupportedBrowser 只认 Chrome 和 Edge", () => {
  assert.equal(isSupportedBrowser([{ brand: "Google Chrome" }]), true);
  assert.equal(isSupportedBrowser([{ brand: "Not=A?Brand" }, { brand: "Microsoft Edge" }]), true);
  assert.equal(isSupportedBrowser([{ brand: "Chromium" }]), false);
  assert.equal(isSupportedBrowser(undefined), false);
});

test("classifyFailure：公网页面从没连上、连续失败 3 次算本地网络权限被拒", () => {
  assert.equal(classifyFailure({ opened: false, pageIsPublic: true, attempts: 3 }), "lna-denied");
  assert.equal(classifyFailure({ opened: false, pageIsPublic: true, attempts: 1 }), "retry");
});

test("classifyFailure：4001 只会来自还要口令的旧网关，算网关过旧，不再有 bad-token", () => {
  assert.equal(classifyFailure({ opened: true, closeCode: 4001, pageIsPublic: true, attempts: 1 }), "old-gateway");
  assert.equal(classifyFailure({ opened: true, closeCode: 4001, pageIsPublic: false, attempts: 1 }), "old-gateway");
});

test("classifyFailure：关闭码决定版本不符、来源不在白名单", () => {
  assert.equal(classifyFailure({ opened: true, closeCode: 4002, pageIsPublic: false, attempts: 1 }), "outdated");
  assert.equal(classifyFailure({ opened: true, closeCode: 4003, pageIsPublic: true, attempts: 1 }), "bad-origin");
});

test("classifyFailure：本机页面这次没连上算网关没运行；这次连上过再断开就重连", () => {
  assert.equal(classifyFailure({ opened: false, closeCode: 1006, pageIsPublic: false, attempts: 1 }), "no-gateway");
  assert.equal(classifyFailure({ opened: false, closeCode: 1006, pageIsPublic: false, attempts: 2 }), "no-gateway");
  assert.equal(classifyFailure({ opened: true, closeCode: 1006, pageIsPublic: true, attempts: 5 }), "retry");
  assert.equal(classifyFailure({ opened: true, closeCode: 1006, pageIsPublic: false, attempts: 5 }), "retry");
});

const PUBLIC_LOC = { protocol: "https:", hostname: "droid.devpier.dev", port: "" };

test("gatewayPort：#port 优先，没有就是 7300；不记上次的端口（换回默认端口后不会一直连旧端口）", () => {
  assert.equal(DEFAULT_GATEWAY_PORT, 7300);
  assert.equal(gatewayPort({ hashPort: 7306, loc: PUBLIC_LOC }), 7306);
  assert.equal(gatewayPort({ hashPort: null, loc: PUBLIC_LOC }), 7300);
});

test("gatewayPort：网关自己托管的本机页面没有 #port 时连页面自己的端口", () => {
  assert.equal(gatewayPort({ hashPort: null, loc: { protocol: "http:", hostname: "127.0.0.1", port: "7306" } }), 7306);
  assert.equal(gatewayPort({ hashPort: null, loc: { protocol: "http:", hostname: "localhost", port: "7306" } }), 7306);
  assert.equal(gatewayPort({ hashPort: 7320, loc: { protocol: "http:", hostname: "127.0.0.1", port: "7306" } }), 7320);
});

test("refineLocalFailure：按本地网络权限细分 lna-denied", () => {
  assert.equal(refineLocalFailure("lna-denied", "denied"), "lna-denied");
  assert.equal(refineLocalFailure("lna-denied", "prompt"), "lna-prompt");
  assert.equal(refineLocalFailure("lna-denied", "granted"), "no-gateway");
  assert.equal(refineLocalFailure("lna-denied", null), "no-gateway");
});

test("gatewayAnswers：/healthz 有回应（no-cors）为 true；连不上、超时为 false", async () => {
  const urls: string[] = [];
  const ok = (async (url: string, init: RequestInit) => { urls.push(url); assert.equal(init.mode, "no-cors"); return new Response(null); }) as unknown as typeof fetch;
  assert.equal(await gatewayAnswers(ok, 7306), true);
  assert.deepEqual(urls, ["http://127.0.0.1:7306/healthz"]);
  const down = (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
  assert.equal(await gatewayAnswers(down, 7306), false);
  const hang = ((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal!.addEventListener("abort", () => rej(init.signal!.reason)))) as unknown as typeof fetch;
  // AbortSignal.timeout 的定时器不占事件循环，测试里另挂一个
  const keep = setTimeout(() => {}, 1000);
  assert.equal(await gatewayAnswers(hang, 7306, 20), false);
  clearTimeout(keep);
});

test("siteOrigin：公网页面用自己的来源，部署在别处的也一样；网关托管的本机页面用官方的", () => {
  assert.equal(siteOrigin({ hostname: "droid.devpier.dev", origin: "https://droid.devpier.dev" }), "https://droid.devpier.dev");
  assert.equal(siteOrigin({ hostname: "emu.example.dev", origin: "https://emu.example.dev" }), "https://emu.example.dev");
  for (const hostname of ["127.0.0.1", "localhost"]) {
    assert.equal(siteOrigin({ hostname, origin: `http://${hostname}:7306` }), OFFICIAL_ORIGIN);
  }
  assert.equal(installCmd("https://emu.example.dev"), "curl -fsSL https://emu.example.dev/install.sh | sh");
});
