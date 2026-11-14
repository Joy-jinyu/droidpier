import { test } from "node:test";
import assert from "node:assert/strict";
import * as auth from "../src/auth.ts";
import { allowedOrigins, checkHost, checkUpgrade, createTickets, isOrigin, isPublicOrigin, PUBLIC_ORIGIN } from "../src/auth.ts";

test("网关不再生成、比较启动口令", () => {
  assert.equal("newToken" in auth, false);
  assert.equal("sameToken" in auth, false);
});

test("allowedOrigins：公网入口 + 127.0.0.1 和 localhost 的网关端口；公网入口为 null 时只有本机两项", () => {
  assert.deepEqual(allowedOrigins("https://emu.example.dev", 7300), [
    "https://emu.example.dev",
    "http://127.0.0.1:7300",
    "http://localhost:7300",
  ]);
  assert.deepEqual(allowedOrigins(null, 7301), ["http://127.0.0.1:7301", "http://localhost:7301"]);
});

test("公网入口是 https://droid.devpier.dev，进白名单；名字相近的、http 的、带路径的都不算", () => {
  assert.equal(PUBLIC_ORIGIN, "https://droid.devpier.dev");
  const allowed = allowedOrigins(PUBLIC_ORIGIN, 7300);
  assert.deepEqual(allowed, ["https://droid.devpier.dev", "http://127.0.0.1:7300", "http://localhost:7300"]);
  assert.equal(checkUpgrade("https://droid.devpier.dev", allowed), true);
  for (const o of ["http://droid.devpier.dev", "https://droid.devpier.dev.evil.example", "https://devpier.dev", "https://x.droid.devpier.dev", "https://droid.devpier.dev:443", "https://droid.devpier.dev/"]) {
    assert.equal(checkUpgrade(o, allowed), false, o);
  }
});

test("allowedOrigins：额外来源排在最后，只加给的那几个", () => {
  assert.deepEqual(allowedOrigins(PUBLIC_ORIGIN, 7306, ["http://droid.test:7351"]), [
    "https://droid.devpier.dev",
    "http://127.0.0.1:7306",
    "http://localhost:7306",
    "http://droid.test:7351",
  ]);
  assert.equal(checkUpgrade("http://droid.test:7352", allowedOrigins(PUBLIC_ORIGIN, 7306, ["http://droid.test:7351"])), false);
});

test("isOrigin：只认 scheme://host[:port] 的完整写法", () => {
  for (const o of ["http://droid.test:7351", "https://droid.devpier.dev", "http://127.0.0.1:9000"]) assert.equal(isOrigin(o), true, o);
  for (const o of ["droid.test:7351", "http://droid.test:7351/", "http://droid.test:7351/app/", "https://droid.devpier.dev:443", "HTTP://droid.test", "*", "null", "", "file:///tmp"]) {
    assert.equal(isOrigin(o), false, o);
  }
});

test("checkUpgrade：只放行白名单里的 Origin，没有 Origin 一律拒绝", () => {
  const allowed = allowedOrigins("https://emu.example.dev", 7300);
  assert.equal(checkUpgrade("https://evil.example", allowed), false);
  assert.equal(checkUpgrade("http://127.0.0.1:7300", allowed), true);
  assert.equal(checkUpgrade("http://localhost:7300", allowed), true);
  assert.equal(checkUpgrade("https://emu.example.dev", allowed), true);
  assert.equal(checkUpgrade("http://127.0.0.1:7301", allowed), false);
  assert.equal(checkUpgrade("null", allowed), false);
  assert.equal(checkUpgrade("", allowed), false);
  assert.equal(checkUpgrade(undefined, allowed), false);
});

test("票据：随机至少 128 位，绑定 socket + 页面 id，用一次作废", () => {
  const tk = createTickets();
  const a = tk.issue("sock", "p1");
  const b = tk.issue("sock", "p1");
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]{22,}$/);
  assert.equal(tk.take("nope", "sock", "p1"), false);
  assert.equal(tk.take(a, "sock", "p1"), true);
  assert.equal(tk.take(a, "sock", "p1"), false);
  assert.equal(tk.take(b, "sock", "p1"), true);
});

test("票据：socket 或页面 id 对不上就拒绝，并且这张票作废", () => {
  const tk = createTickets();
  const a = tk.issue("sock", "p1");
  const b = tk.issue("sock", "p1");
  assert.equal(tk.take(a, "sock", "p2"), false);
  assert.equal(tk.take(a, "sock", "p1"), false);
  assert.equal(tk.take(b, "other", "p1"), false);
  assert.equal(tk.take(b, "sock", "p1"), false);
});

test("票据：60 秒后过期", () => {
  let now = 1_000_000;
  const tk = createTickets({ now: () => now });
  const a = tk.issue("sock", "p1");
  const b = tk.issue("sock", "p1");
  now += 59_999;
  assert.equal(tk.take(a, "sock", "p1"), true);
  now += 2;
  assert.equal(tk.take(b, "sock", "p1"), false);
});

test("checkHost：只认 127.0.0.1:<端口> 和 localhost:<端口>，公网入口和别的域名都不算", () => {
  for (const h of ["127.0.0.1:7300", "localhost:7300", "LOCALHOST:7300"]) assert.equal(checkHost(h, 7300), true, h);
  for (const h of ["droid.devpier.dev", "droid.devpier.dev:7300", "evil.example:7300", "127.0.0.1", "localhost", "127.0.0.1:7301", "[::1]:7300", "", undefined]) {
    assert.equal(checkHost(h, 7300), false, String(h));
  }
});

test("isPublicOrigin：公网页面只能是 https；本机试用的 127.0.0.1、*.localhost 例外", () => {
  for (const o of ["https://droid.devpier.dev", "https://emu.example.dev", "https://x.pages.dev:8443", "http://127.0.0.1:7351", "http://droid.localhost:7351", "http://localhost:7351"]) assert.equal(isPublicOrigin(o), true, o);
  for (const o of ["http://emu.example.dev", "http://192.168.1.2:7351", "http://localhost.example.dev", "https://emu.example.dev/", "https://emu.example.dev/app", "ftp://emu.example.dev", ""]) assert.equal(isPublicOrigin(o), false, o);
});
