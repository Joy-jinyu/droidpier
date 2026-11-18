import { test } from "node:test";
import assert from "node:assert/strict";
import { fitMiddle, middleEllipsis } from "../../ui/ellipsis.ts";

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

test("fitMiddle 放得下或还不知道宽度时原样返回", () => {
  assert.equal(fitMiddle("Pixel 9", 200, 18), "Pixel 9");
  assert.equal(fitMiddle("Resizable (Experimental) API 36", 0, 18), "Resizable (Experimental) API 36");
});

test("fitMiddle 放不下时中间省略，开头和结尾都留着", () => {
  const name = "Resizable (Experimental) API 36 Google Play";
  const out = fitMiddle(name, 200, 18);
  assert.ok([...out].length < [...name].length);
  assert.ok(out.startsWith("Resiz"));
  assert.ok(out.endsWith("Play"));
  assert.ok(out.includes("…"));
});

test("fitMiddle 中文按一个字号宽估，比同样字数的英文先省略", () => {
  assert.equal(fitMiddle("abcdefghij", 130, 18), "abcdefghij");
  assert.ok(fitMiddle("一二三四五六七八九十", 130, 18).includes("…"));
});
