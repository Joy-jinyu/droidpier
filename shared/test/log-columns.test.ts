import { test } from "node:test";
import assert from "node:assert/strict";
import { logCells, PID_CHARS, TAG_CHARS } from "../../ui/log-columns.ts";

const line = (pid: number, tag: string) => ({ time: "11-17 09:05:01.123", pid, level: "I", tag });

test("logCells 不同位数的 pid 和不同长度的 tag 补成一样的字数", () => {
  const a = logCells(line(7, "A"));
  const b = logCells(line(12345, "ActivityManager"));
  assert.equal(a.head.length, b.head.length);
  assert.equal(a.tag.length, b.tag.length);
  assert.equal(a.head, `09:05:01.123 ${"7".padStart(PID_CHARS)}`);
  assert.equal(a.tag, `I ${"A".padEnd(TAG_CHARS)}`);
});

test("logCells 太长的 tag 截断成固定字数，末尾是省略号", () => {
  const { tag } = logCells(line(1, "x".repeat(TAG_CHARS + 5)));
  assert.equal([...tag].length, 2 + TAG_CHARS);
  assert.ok(tag.endsWith("…"));
});

test("logCells 正好放得下的 tag 不截断", () => {
  const exact = "y".repeat(TAG_CHARS);
  assert.equal(logCells(line(1, exact)).tag, `I ${exact}`);
});
