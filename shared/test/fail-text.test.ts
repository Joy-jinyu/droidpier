import { test } from "node:test";
import assert from "node:assert/strict";
import { failText, NEXT_STEP } from "../fail-text.ts";

test("failText：有原因时写原因", () => {
  assert.equal(failText("没有删除", "设备正在运行"), "没有删除：设备正在运行");
});

test("failText：没有原因或只有「未知原因」时给下一步，不停在「未知原因」", () => {
  for (const e of [undefined, null, "", "  ", "未知原因"]) {
    const t = failText("没有停止", e);
    assert.ok(t.startsWith("没有停止，原因不明。"), t);
    assert.ok(t.endsWith(NEXT_STEP));
    assert.ok(!t.includes("未知原因"));
  }
});
