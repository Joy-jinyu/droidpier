import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesAvd } from "../../ui/device-search.ts";

const avd = { name: "Resizable_Experimental", displayName: "测试机 Pixel" };

test("matchesAvd 按显示名或 id 找，不分大小写，前后空格不算", () => {
  assert.equal(matchesAvd(avd, "pixel"), true);
  assert.equal(matchesAvd(avd, "  resizable "), true);
  assert.equal(matchesAvd(avd, "测试"), true);
  assert.equal(matchesAvd(avd, "nexus"), false);
});

test("matchesAvd 空查询全部匹配，没有显示名也能按 id 找", () => {
  assert.equal(matchesAvd(avd, ""), true);
  assert.equal(matchesAvd({ name: "dp_t0078" }, "t007"), true);
});
