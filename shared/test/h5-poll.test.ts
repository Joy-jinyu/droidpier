import { test } from "node:test";
import assert from "node:assert/strict";
import { h5PollMs } from "../../ui/h5-poll.ts";

test("H5 列表轮询：刚打开或刚失败时 3 秒一次，连续成功 3 次后放宽到 5 秒", () => {
  assert.equal(h5PollMs(0, false), 3000);
  assert.equal(h5PollMs(2, false), 3000);
  assert.equal(h5PollMs(3, false), 5000);
  assert.equal(h5PollMs(50, false), 5000);
});

test("控制台开着时保持 3 秒：页面没了要在 3 秒左右收起控制台", () => {
  assert.equal(h5PollMs(50, true), 3000);
});
