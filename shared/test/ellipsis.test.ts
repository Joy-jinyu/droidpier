import { test } from "node:test";
import assert from "node:assert/strict";
import { middleEllipsis } from "../../ui/ellipsis.ts";

test("不超长时原样返回", () => {
  assert.equal(middleEllipsis("localhost:5173/a", 20), "localhost:5173/a");
  assert.equal(middleEllipsis("12345", 5), "12345");
});

test("超长时保留开头和结尾，中间换成省略号，总长等于上限", () => {
  const url = "https://example.com/help/?channel=demo&lang=en";
  const out = middleEllipsis(url, 30);
  assert.equal([...out].length, 30);
  assert.ok(out.startsWith("https://example"));
  assert.ok(out.endsWith("lang=en"));
  assert.ok(out.includes("…"));
});

test("按字符而不是 UTF-16 单元切，不切坏表情", () => {
  const out = middleEllipsis("😀".repeat(10), 5);
  assert.equal(out, "😀😀…😀😀");
});
