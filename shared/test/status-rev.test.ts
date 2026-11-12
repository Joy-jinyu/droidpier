import { test } from "node:test";
import assert from "node:assert/strict";
import { isStaleStatus } from "../../ui/status-rev.ts";

test("isStaleStatus：比已应用的旧就丢掉，相同或更新的照用", () => {
  assert.equal(isStaleStatus(3, 4), true);
  assert.equal(isStaleStatus(4, 4), false);
  assert.equal(isStaleStatus(5, 4), false);
  assert.equal(isStaleStatus(0, -1), false);
});
