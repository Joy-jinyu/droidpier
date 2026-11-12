import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldCloseConsole } from "../../ui/console-gone.ts";

const open = { key: "webview_devtools_remote_1/p1", serial: 5554 };

test("成功读到的列表里没有被审查的页面：收起控制台", () => {
  assert.equal(shouldCloseConsole(open, { kind: "list", keys: ["webview_devtools_remote_1/p2"] }), true);
  assert.equal(shouldCloseConsole(open, { kind: "list", keys: [] }), true);
});

test("列表里还有它：保留", () => {
  assert.equal(shouldCloseConsole(open, { kind: "list", keys: [open.key, "x/y"] }), false);
});

test("读列表失败或超时：不算页面没了，保留", () => {
  assert.equal(shouldCloseConsole(open, { kind: "list-failed" }), false);
});

test("设备换了、模拟器关了、开始重启：收起", () => {
  assert.equal(shouldCloseConsole(open, { kind: "status", state: "connected", serial: 5556 }), true);
  assert.equal(shouldCloseConsole(open, { kind: "status", state: "emulator-closed", serial: 0 }), true);
  assert.equal(shouldCloseConsole(open, { kind: "status", state: "rebooting", serial: 5554 }), true);
});

test("同一台设备上的普通状态更新：保留", () => {
  assert.equal(shouldCloseConsole(open, { kind: "status", state: "connected", serial: 5554 }), false);
});

test("没有打开控制台：什么都不做", () => {
  assert.equal(shouldCloseConsole(null, { kind: "list", keys: [] }), false);
  assert.equal(shouldCloseConsole(null, { kind: "status", state: "rebooting", serial: 5554 }), false);
});
