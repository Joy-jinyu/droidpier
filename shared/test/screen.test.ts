import { test } from "node:test";
import assert from "node:assert/strict";
import { deviceFrame, fitSize, frameLatencyMs } from "../screen.ts";

const dev = { width: 1080, height: 2340 };

test("fitSize 竖屏放进矮窗口：按高度缩放，宽高比不变", () => {
  const r = fitSize({ width: 800, height: 700 }, dev, 0);
  assert.equal(r.height, 700);
  assert.ok(Math.abs(r.width / r.height - 1080 / 2340) < 0.01);
});

test("fitSize 竖屏放进窄窗口：按宽度缩放", () => {
  const r = fitSize({ width: 300, height: 2000 }, dev, 0);
  assert.equal(r.width, 300);
  assert.ok(r.height <= 2000);
  assert.ok(Math.abs(r.width / r.height - 1080 / 2340) < 0.01);
});

test("fitSize 横屏按转过来的宽高比", () => {
  const r = fitSize({ width: 1000, height: 800 }, dev, 90);
  assert.equal(r.width, 1000);
  assert.ok(Math.abs(r.width / r.height - 2340 / 1080) < 0.01);
  assert.deepEqual(fitSize({ width: 1000, height: 800 }, dev, 270), r);
});

test("fitSize 结果不超出容器，取整", () => {
  for (const box of [{ width: 333, height: 777 }, { width: 1234, height: 567 }, { width: 541, height: 1171 }]) {
    for (const rot of [0, 90] as const) {
      const r = fitSize(box, dev, rot);
      assert.ok(r.width <= box.width && r.height <= box.height, JSON.stringify({ box, rot, r }));
      assert.ok(Number.isInteger(r.width) && Number.isInteger(r.height));
    }
  }
});

test("fitSize 容器为 0 或设备尺寸未知时返回 0", () => {
  assert.deepEqual(fitSize({ width: 0, height: 500 }, dev, 0), { width: 0, height: 0 });
  assert.deepEqual(fitSize({ width: 500, height: 500 }, { width: 0, height: 0 }, 0), { width: 0, height: 0 });
});

test("frameLatencyMs：时间戳是 u32 毫秒，跨回绕仍得到正确差值", () => {
  const now = 1_762_000_000_123;
  assert.equal(frameLatencyMs(now, (now - 25) % 2 ** 32), 25);
  // now 的低 32 位刚回绕到 5，帧时间戳是回绕前的 2^32-10
  const wrapped = Math.floor(now / 2 ** 32) * 2 ** 32 + 5;
  assert.equal(frameLatencyMs(wrapped, 2 ** 32 - 10), 15);
});

test("frameLatencyMs：时间戳比本机时钟略超前时返回 0，不是 40 多亿", () => {
  const now = 1_762_000_000_123;
  assert.equal(frameLatencyMs(now, (now + 3) % 2 ** 32), 0);
});

test("deviceFrame：竖屏的机身按高度放进容器，屏幕区（去掉两边边框）是设备的宽高比", () => {
  const f = deviceFrame({ width: 1000, height: 800 }, dev, 0, 11);
  assert.equal(f.height, 800);
  assert.ok(Math.abs((f.width - 22) / (f.height - 22) - 1080 / 2340) < 0.01);
});

test("deviceFrame：横过来机身变横，宽高对调，屏幕区是转过来的宽高比，整块放得下", () => {
  const box = { width: 1000, height: 800 };
  const f = deviceFrame(box, dev, 90, 11);
  assert.ok(f.width > f.height);
  assert.equal(f.width, 1000);
  assert.ok(f.height <= 800);
  assert.ok(Math.abs((f.width - 22) / (f.height - 22) - 2340 / 1080) < 0.01);
  assert.deepEqual(deviceFrame(box, dev, 270, 11), f);
  assert.deepEqual(deviceFrame(box, dev, 180, 11), deviceFrame(box, dev, 0, 11));
});

test("deviceFrame：横屏放进矮容器时按高度缩放", () => {
  const f = deviceFrame({ width: 2000, height: 400 }, dev, 90, 11);
  assert.equal(f.height, 400);
  assert.ok(f.width <= 2000);
  assert.ok(Math.abs((f.width - 22) / (f.height - 22) - 2340 / 1080) < 0.01);
});

test("deviceFrame：结果取整、不超出容器；容器放不下边框或尺寸未知时返回 0", () => {
  for (const box of [{ width: 333, height: 777 }, { width: 1234, height: 567 }]) {
    for (const rot of [0, 90, 180, 270] as const) {
      const f = deviceFrame(box, dev, rot, 11);
      assert.ok(f.width <= box.width && f.height <= box.height, JSON.stringify({ box, rot, f }));
      assert.ok(Number.isInteger(f.width) && Number.isInteger(f.height));
    }
  }
  assert.deepEqual(deviceFrame({ width: 20, height: 500 }, dev, 0, 11), { width: 0, height: 0 });
  assert.deepEqual(deviceFrame({ width: 500, height: 500 }, { width: 0, height: 0 }, 0, 11), { width: 0, height: 0 });
});
