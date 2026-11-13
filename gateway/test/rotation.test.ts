import { test } from "node:test";
import assert from "node:assert/strict";
import { rotationFromSkin, rotationFromZ, turn, zForRotation } from "../src/emulator.ts";

test("方向模型 z 轴和设备顺时针角度互相换算", () => {
  assert.deepEqual([0, -90, 180, 90].map(rotationFromZ), [0, 90, 180, 270]);
  assert.deepEqual(([0, 90, 180, 270] as const).map(zForRotation), [0, -90, 180, 90]);
});

test("z 轴角度带误差或超出一圈时取最近的 90°", () => {
  assert.deepEqual([-180, 270, -270, 359, -91, 1].map(rotationFromZ), [180, 90, 270, 0, 90, 0]);
});

test("帧里的 SkinRotation 换成设备顺时针角度", () => {
  assert.deepEqual(
    ["PORTRAIT", "LANDSCAPE", "REVERSE_PORTRAIT", "REVERSE_LANDSCAPE"].map(rotationFromSkin),
    [0, 270, 180, 90]
  );
  assert.equal(rotationFromSkin(undefined), null);
  assert.equal(rotationFromSkin("BOGUS"), null);
});

test("向右是顺时针 +90°，向左是逆时针 -90°，跨过 0° 时绕回", () => {
  assert.deepEqual(([0, 90, 180, 270] as const).map((r) => turn(r, "right")), [90, 180, 270, 0]);
  assert.deepEqual(([0, 90, 180, 270] as const).map((r) => turn(r, "left")), [270, 0, 90, 180]);
});
