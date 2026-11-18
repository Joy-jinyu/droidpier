import { test } from "node:test";
import assert from "node:assert/strict";
import { pendingAfter, type Pending } from "../../ui/start-pending.ts";

const start: Pending = { name: "Pixel_9", what: "start" };
const use: Pending = { name: "Pixel_9", what: "use" };
const up = (onScreen: string | null) => ({ kind: "status" as const, down: false, onScreen });

test("启动：这台的开机进度到了就不再等；别的设备的进度不算", () => {
  assert.equal(pendingAfter(start, { kind: "boot", name: "Pixel_9" }), null);
  assert.equal(pendingAfter(start, { kind: "boot", name: "Other" }), start);
});

test("切换：画面换到这台才不再等；还是旧设备时继续等", () => {
  assert.equal(pendingAfter(use, up("Pixel_9")), null);
  assert.equal(pendingAfter(use, up("Old")), use);
  assert.equal(pendingAfter(start, up("Pixel_9")), start);
});

test("网关拒绝了（报错）、没发出去、超时：都不再等", () => {
  for (const kind of ["gateway-error", "not-sent", "timeout"] as const) {
    assert.equal(pendingAfter(start, { kind }), null, kind);
    assert.equal(pendingAfter(use, { kind }), null, kind);
  }
});

test("和网关断开：不再等", () => {
  assert.equal(pendingAfter(start, { kind: "status", down: true, onScreen: null }), null);
  assert.equal(pendingAfter(use, { kind: "status", down: true, onScreen: null }), null);
});

test("没在等时什么事件都不改", () => {
  assert.equal(pendingAfter(null, { kind: "boot", name: "Pixel_9" }), null);
  assert.equal(pendingAfter(null, up("Pixel_9")), null);
});
