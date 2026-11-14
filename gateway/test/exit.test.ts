import { test } from "node:test";
import assert from "node:assert/strict";
import { exitHandler } from "../src/exit.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("清理完成后以 0 退出", async () => {
  const codes: number[] = [];
  const onSignal = exitHandler({ cleanup: async () => {}, exit: (c) => void codes.push(c), timeoutMs: 1000, log: () => {} });
  await onSignal();
  assert.deepEqual(codes, [0]);
});

test("给了退出码就用它退出：后台服务被关掉时要让 launchd 拉起来", async () => {
  const codes: number[] = [];
  const onSignal = exitHandler({ cleanup: async () => {}, exit: (c) => void codes.push(c), code: 143, timeoutMs: 1000, log: () => {} });
  await onSignal();
  assert.deepEqual(codes, [143]);
});

test("清理卡住：到时限直接退出", async () => {
  const codes: number[] = [];
  const onSignal = exitHandler({ cleanup: () => new Promise(() => {}), exit: (c) => void codes.push(c), timeoutMs: 50, log: () => {} });
  const t0 = Date.now();
  await onSignal();
  assert.deepEqual(codes, [0]);
  assert.ok(Date.now() - t0 < 500);
});

test("清理抛错也退出", async () => {
  const codes: number[] = [];
  const onSignal = exitHandler({ cleanup: async () => { throw new Error("adb gone"); }, exit: (c) => void codes.push(c), timeoutMs: 1000, log: () => {} });
  await onSignal();
  assert.deepEqual(codes, [0]);
});

test("清理途中再收到信号：立即退出", async () => {
  const codes: number[] = [];
  const onSignal = exitHandler({ cleanup: () => sleep(200), exit: (c) => void codes.push(c), timeoutMs: 20_000, log: () => {} });
  void onSignal();
  await sleep(10);
  await onSignal();
  assert.deepEqual(codes, [1]);
});
