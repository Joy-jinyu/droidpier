import { test } from "node:test";
import assert from "node:assert/strict";
import { currentIosSimOf, iosSimRows, iosSimStatus } from "../../ui/ios-sims.ts";
import type { IosSimInfo } from "../protocol.ts";

const on: IosSimInfo = { udid: "A", name: "iPhone 11", runtime: "iOS 27.0", state: "booted" };
const off: IosSimInfo = { udid: "B", name: "iPad Air", runtime: "iOS 26.5", state: "shutdown" };
const booting: IosSimInfo = { udid: "C", name: "iPhone 17", runtime: "iOS 26.5", state: "booting" };

test("iosSimRows：默认只列没关机的并报出收起了几台；展开或搜索时列全部匹配的", () => {
  assert.deepEqual(iosSimRows([on, off, booting], "", false), { rows: [on, booting], hidden: 1 });
  assert.deepEqual(iosSimRows([on, off, booting], "", true), { rows: [on, off, booting], hidden: 0 });
  assert.deepEqual(iosSimRows([on, off, booting], "ipad", false), { rows: [off], hidden: 0 });
  assert.deepEqual(iosSimRows([on, off, booting], "26.5", false), { rows: [off, booting], hidden: 0 });
  assert.deepEqual(iosSimRows(null, "", false), { rows: [], hidden: 0 });
});

test("iosSimStatus：运行中的是当前画面时说当前画面", () => {
  assert.equal(iosSimStatus(on, true), "当前画面");
  assert.equal(iosSimStatus(on, false), "运行中");
  assert.equal(iosSimStatus(off, false), "未运行");
  assert.equal(iosSimStatus(booting, false), "启动中…");
});

test("currentIosSimOf：phone 会话的 deviceId 对上 UDID、且已连接或重启中才算", () => {
  assert.equal(currentIosSimOf([on], { kind: "phone", deviceId: "A", state: "connected" }), on);
  assert.equal(currentIosSimOf([on], { kind: "phone", deviceId: "A", state: "phone-closed" }), undefined);
  assert.equal(currentIosSimOf([on], { kind: "emulator", deviceId: "A", state: "connected" }), undefined);
  assert.equal(currentIosSimOf(null, { kind: "phone", deviceId: "A", state: "connected" }), undefined);
});
