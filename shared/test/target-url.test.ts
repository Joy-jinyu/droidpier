import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTarget } from "../target-url.ts";

test("localhost:5173 → url 加 http://，reversePort=5173", () => {
  assert.deepEqual(normalizeTarget("localhost:5173"), {
    url: "http://localhost:5173/",
    reversePort: 5173,
  });
});

test("127.0.0.1:5173/a?b=1#c 有首尾空格 → reversePort=5173，url 保留路径", () => {
  const r = normalizeTarget(" 127.0.0.1:5173/a?b=1#c ");
  assert.ok("url" in r && "reversePort" in r);
  if ("url" in r) {
    assert.equal((r as any).reversePort, 5173);
    assert.ok((r as any).url.endsWith("/a?b=1#c"));
  }
});

test("http://localhost 没写端口 → reversePort=80", () => {
  const r = normalizeTarget("http://localhost");
  assert.ok("reversePort" in r);
  assert.equal((r as any).reversePort, 80);
});

test("https://example.com/x → 没有 reversePort", () => {
  const r = normalizeTarget("https://example.com/x");
  assert.ok(!("reversePort" in r));
  assert.ok("url" in r);
});

test("http://10.0.2.2:5173 → 没有 reversePort", () => {
  const r = normalizeTarget("http://10.0.2.2:5173");
  assert.ok(!("reversePort" in r));
  assert.ok("url" in r);
});

test(":::: 无法解析 → {error}", () => {
  const r = normalizeTarget("::::");
  assert.ok("error" in r);
});

// Review Focus 3：内部有空格的地址（如 "local host:5173"）不能解析，应返回 error
test("内部有空格的地址 → {error}", () => {
  const r = normalizeTarget("local host:5173");
  assert.ok("error" in r);
});

// https://localhost 没写端口 → reversePort=443
test("https://localhost 没写端口 → reversePort=443", () => {
  const r = normalizeTarget("https://localhost");
  assert.ok("reversePort" in r);
  assert.equal((r as any).reversePort, 443);
});

// spec: 只有 localhost/127.0.0.1 才做 reverse；[::1] 是 IPv6 本地地址但不在范围内
test("[::1]:5173 → 没有 reversePort", () => {
  const r = normalizeTarget("http://[::1]:5173");
  assert.ok(!("reversePort" in r));
  assert.ok("url" in r);
});
