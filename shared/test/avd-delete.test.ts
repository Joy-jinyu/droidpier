import { test } from "node:test";
import assert from "node:assert/strict";
import { deleteBlocked } from "../../ui/avd-delete.ts";

test("deleteBlocked：运行中（含无法接管）和启动中的设备不能删，原因是先关闭", () => {
  assert.equal(deleteBlocked({ running: "no" }, false), null);
  assert.equal(deleteBlocked({ running: "grpc" }, false), "先关闭这台设备再删除");
  assert.equal(deleteBlocked({ running: "no-grpc" }, false), "先关闭这台设备再删除");
  assert.equal(deleteBlocked({ running: "no" }, true), "先关闭这台设备再删除");
});
