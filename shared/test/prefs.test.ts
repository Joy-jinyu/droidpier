import { test } from "node:test";
import assert from "node:assert/strict";
import { readPref, writePref } from "../../host/src/prefs.ts";

const g = globalThis as { localStorage?: unknown };

test("readPref / writePref 存了能读回，没存过是 null", (t) => {
  const m = new Map<string, string>();
  g.localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  t.after(() => delete g.localStorage);
  assert.equal(readPref("droidpier.x"), null);
  assert.equal(writePref("droidpier.x", "1"), true);
  assert.equal(readPref("droidpier.x"), "1");
});

test("存储不可用时 readPref 当没存过，writePref 返回 false", (t) => {
  const boom = () => { throw new Error("SecurityError"); };
  g.localStorage = { getItem: boom, setItem: boom };
  t.after(() => delete g.localStorage);
  assert.equal(readPref("droidpier.x"), null);
  assert.equal(writePref("droidpier.x", "1"), false);
});
