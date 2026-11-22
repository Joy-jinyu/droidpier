import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesAvd, matchesText, searchSidebar } from "../../ui/device-search.ts";

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

test("matchesText：任一文字含查询词就算匹配，不分大小写；空查询全部匹配；没有的文字（undefined）不算", () => {
  assert.equal(matchesText("galaxy", "Samsung SM-G9910", undefined, "Galaxy S21"), true);
  assert.equal(matchesText("  R5CR ", "Samsung", "R5CR10WN52H"), true);
  assert.equal(matchesText("pixel", "Samsung", undefined), false);
  assert.equal(matchesText("", undefined), true);
});

test("searchSidebar：三组一起筛；只有全都没匹配时才算 noMatch；不搜索时全部保留", () => {
  const text = { avd: (a: string) => [a], phone: (p: string) => [p], mumu: (m: string) => [m] };
  const groups = { avds: ["Pixel_5", "android10-chrome80"], phones: ["Samsung SM-G9910"], mumu: ["我的安卓"] };
  assert.deepEqual(searchSidebar("", groups, text), { searching: false, ...groups, noMatch: false });
  assert.deepEqual(searchSidebar("安卓", groups, text), { searching: true, avds: [], phones: [], mumu: ["我的安卓"], noMatch: false });
  assert.deepEqual(searchSidebar("chrome", groups, text).avds, ["android10-chrome80"]);
  assert.equal(searchSidebar("zzz", groups, text).noMatch, true);
});
