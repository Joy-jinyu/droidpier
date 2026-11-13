import { test } from "node:test";
import assert from "node:assert/strict";
import { setupCardShown } from "../../ui/setup-card.ts";

const base = { ok: true, busy: false, failed: false, hasInstalls: false, dismissed: false };

test("环境齐全、没装过东西：不显示", () => {
  assert.equal(setupCardShown(base), false);
});

test("缺项时显示；收起后不再显示，不挡设备按键", () => {
  assert.equal(setupCardShown({ ...base, ok: false }), true);
  assert.equal(setupCardShown({ ...base, ok: false, dismissed: true }), false);
});

test("安装进行中一直显示，收起也不隐藏", () => {
  assert.equal(setupCardShown({ ...base, ok: false, busy: true, hasInstalls: true, dismissed: true }), true);
});

test("安装失败后显示，收起后不再显示", () => {
  assert.equal(setupCardShown({ ...base, ok: false, failed: true, hasInstalls: true }), true);
  assert.equal(setupCardShown({ ...base, ok: false, failed: true, hasInstalls: true, dismissed: true }), false);
});

test("装完、环境齐全：显示结果，收起后不再显示", () => {
  assert.equal(setupCardShown({ ...base, hasInstalls: true }), true);
  assert.equal(setupCardShown({ ...base, hasInstalls: true, dismissed: true }), false);
});
