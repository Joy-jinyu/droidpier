import { test } from "node:test";
import assert from "node:assert/strict";
import { LatestFrame } from "../src/latest-frame.ts";

test("只保留最新一帧，被覆盖的旧帧计入 dropped", () => {
  const f = new LatestFrame<number>();
  f.put(1);
  f.put(2);
  f.put(3);
  assert.equal(f.take(), 3);
  assert.equal(f.dropped, 2);
});

test("取走之后再取返回 undefined", () => {
  const f = new LatestFrame<number>();
  f.put(1);
  f.take();
  assert.equal(f.take(), undefined);
});
