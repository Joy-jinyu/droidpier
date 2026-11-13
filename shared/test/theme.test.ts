import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTheme } from "../theme.ts";

test("parseTheme 认得三种外观", () => {
  assert.equal(parseTheme("system"), "system");
  assert.equal(parseTheme("light"), "light");
  assert.equal(parseTheme("dark"), "dark");
});

test("parseTheme 没存过或存的不认识时跟随系统", () => {
  assert.equal(parseTheme(null), "system");
  assert.equal(parseTheme(undefined), "system");
  assert.equal(parseTheme("Dark"), "system");
  assert.equal(parseTheme(1), "system");
});
