import { test } from "node:test";
import assert from "node:assert/strict";
import { createClipSync } from "../../host/src/clip-sync.ts";

const deferred = () => {
  let resolve!: () => void, reject!: (e: Error) => void;
  const p = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { p, resolve, reject };
};
const flush = () => new Promise((r) => setTimeout(r, 0));

test("写入成功：通知收起提示条", async () => {
  const shown: Array<string | null> = [];
  const sync = createClipSync(async () => {}, (t) => shown.push(t));
  sync.onClip("A");
  await flush();
  assert.deepEqual(shown, [null]);
});

test("写入失败：提示条显示这条内容", async () => {
  const shown: Array<string | null> = [];
  const sync = createClipSync(() => Promise.reject(new Error("没焦点")), (t) => shown.push(t));
  sync.onClip("A");
  await flush();
  assert.deepEqual(shown, ["A"]);
});

test("A 失败后 B 成功：提示条收起，不再拿着旧的 A", async () => {
  const shown: Array<string | null> = [];
  let n = 0;
  const sync = createClipSync(() => (n++ === 0 ? Promise.reject(new Error("x")) : Promise.resolve()), (t) => shown.push(t));
  sync.onClip("A");
  await flush();
  sync.onClip("B");
  await flush();
  assert.deepEqual(shown, ["A", null]);
});

test("旧内容的结果晚到：只按最新一条决定", async () => {
  const shown: Array<string | null> = [];
  const a = deferred();
  const b = deferred();
  const queue = [a, b];
  const sync = createClipSync(() => queue.shift()!.p, (t) => shown.push(t));
  sync.onClip("A");
  sync.onClip("B");
  b.resolve();
  await flush();
  a.reject(new Error("晚到的失败"));
  await flush();
  assert.deepEqual(shown, [null]);
});
