import { test } from "node:test";
import assert from "node:assert/strict";
import { canPick, currentPhoneOf, phoneDetail, phoneLabel, phoneStatus, showPhones } from "../../ui/phones.ts";

test("phoneLabel：厂商首字母大写加型号", () => {
  assert.equal(phoneLabel({ id: "R5CR10WN52H", state: "device", manufacturer: "samsung", model: "SM-G9910" }), "Samsung SM-G9910");
});

test("phoneLabel：只有型号时用型号，都没有时用设备 id", () => {
  assert.equal(phoneLabel({ id: "R5CR10WN52H", state: "device", model: "SM-G9910" }), "SM-G9910");
  assert.equal(phoneLabel({ id: "R5CR10WN52H", state: "unauthorized" }), "R5CR10WN52H");
});

test("phoneStatus：可用的手机按是不是当前画面给两种文案", () => {
  assert.equal(phoneStatus({ id: "a", state: "device" }, true), "当前画面");
  assert.equal(phoneStatus({ id: "a", state: "device" }, false), "可用");
});

test("phoneStatus：未授权、离线的文案不随当前设备变", () => {
  for (const cur of [true, false]) {
    assert.equal(phoneStatus({ id: "a", state: "unauthorized" }, cur), "请在手机上允许 USB 调试");
    assert.equal(phoneStatus({ id: "a", state: "offline" }, cur), "离线，重新插拔试试");
  }
});

test("canPick：只有可用的手机能点", () => {
  assert.equal(canPick({ id: "a", state: "device" }), true);
  assert.equal(canPick({ id: "a", state: "unauthorized" }), false);
  assert.equal(canPick({ id: "a", state: "offline" }), false);
});

test("phoneDetail：只显示版本号，和模拟器行右侧的「15」一致", () => {
  assert.equal(phoneDetail({ id: "a", state: "device", android: "12" }), "12");
  assert.equal(phoneDetail({ id: "a", state: "unauthorized" }), "");
});

test("showPhones：没收到过列表时不显示分组；空列表也显示（提示插手机）", () => {
  assert.equal(showPhones(null), false);
  assert.equal(showPhones([]), true);
});

test("currentPhoneOf：已连接和重启中都算当前真机；重启中手机不在列表里时用最后见到的", () => {
  const ph = { id: "R5", state: "device" as const, model: "SM-G9910" };
  const at = (state: string, kind: "emulator" | "phone" = "phone") => ({ kind, deviceId: "R5", state });
  assert.equal(currentPhoneOf([ph], undefined, at("connected")), ph);
  assert.equal(currentPhoneOf([ph], undefined, at("rebooting")), ph);
  assert.equal(currentPhoneOf([], ph, at("rebooting")), ph);
  assert.equal(currentPhoneOf([], ph, at("connected")), undefined);
  assert.equal(currentPhoneOf([ph], undefined, at("phone-closed")), undefined);
  assert.equal(currentPhoneOf([ph], undefined, at("connected", "emulator")), undefined);
  assert.equal(currentPhoneOf([], { ...ph, id: "OTHER" }, at("rebooting")), undefined);
});
