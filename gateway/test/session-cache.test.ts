import { test } from "node:test";
import assert from "node:assert/strict";
import { cachedSession } from "../src/session-cache.ts";
import type { EmulatorSession } from "../src/emulator.ts";

function fake(name: string) {
  const cbs: Array<() => void> = [];
  const s = {
    name,
    closed: false,
    device: { width: 1, height: 1 },
    serial: 5554,
    id: "emulator-5554",
    frames: () => () => {},
    touch: async () => {},
    key: async () => {},
    text: async () => {},
    onClosed: (cb: () => void) => void cbs.push(cb),
    close() {
      this.closed = true;
    },
    fireClosed: () => cbs.forEach((cb) => cb()),
  };
  return s as typeof s & EmulatorSession;
}

test("use 切到指定 AVD：替换缓存并关闭旧会话；旧会话之后退出不影响新缓存", async () => {
  const a = fake("A");
  const b = fake("B");
  const calls: Array<string | undefined> = [];
  const get = cachedSession(async (name) => (calls.push(name), name === "B" ? b : a));
  assert.equal(await get(), a);
  assert.equal(await get.use("B"), b);
  assert.equal(a.closed, true);
  a.fireClosed();
  assert.equal(await get(), b);
  assert.deepEqual(calls, [undefined, "B"]);
});

test("use 一台找不到的 AVD 返回 null，缓存不变", async () => {
  const a = fake("A");
  const get = cachedSession(async (name) => (name ? null : a));
  await get();
  assert.equal(await get.use("X"), null);
  assert.equal(await get(), a);
  assert.equal(a.closed, false);
});

test("两个并发 use：只留一个活会话，被替换的那个被 close", async () => {
  const a = fake("A");
  const made: Array<ReturnType<typeof fake>> = [];
  let open!: () => void;
  // 两次发现在同一时刻完成，最容易读到同一个旧会话
  const gate = new Promise<void>((r) => (open = r));
  const get = cachedSession(async (name) => {
    if (!name) return a;
    await gate;
    const s = fake(name);
    made.push(s);
    return s;
  });
  await get();
  const both = Promise.all([get.use("B"), get.use("C")]);
  setTimeout(open, 10);
  const [s1, s2] = await both;
  const cached = await get();
  assert.equal(cached, s2);
  assert.equal(a.closed, true);
  assert.equal(made.length, 2);
  assert.equal(s1!.closed, true);
  assert.equal(s2!.closed, false);
});
