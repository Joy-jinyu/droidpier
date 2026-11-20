import { test } from "node:test";
import assert from "node:assert/strict";
import { canPick, currentPhoneOf, phoneTitle, mumuRows, mumuRowStatus, mumuRowTitle, phoneDetail, phoneLabel, phoneStatus, showPhones, splitPhones } from "../../ui/phones.ts";

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

test("splitPhones：MuMu 单独一组，真机一组；旧网关不带标记时都算真机", () => {
  const mumu = { id: "127.0.0.1:16384", state: "device" as const, emulator: "mumu" as const };
  const phone = { id: "R5CR10WN52H", state: "device" as const };
  assert.deepEqual(splitPhones([phone, mumu]), { phones: [phone], mumu: [mumu] });
  assert.deepEqual(splitPhones([{ id: "127.0.0.1:16384", state: "device" }]), { phones: [{ id: "127.0.0.1:16384", state: "device" }], mumu: [] });
  assert.deepEqual(splitPhones(null), { phones: [], mumu: [] });
});

test("phoneStatus：MuMu 离线时提示开机，不说插拔", () => {
  assert.equal(phoneStatus({ id: "127.0.0.1:16384", state: "offline", emulator: "mumu" }, false), "离线，MuMu 可能已关机");
});

const MU_STOPPED = { index: 0, name: "我的安卓", state: "stopped" as const };
const MU_RUNNING = { index: 0, name: "我的安卓", state: "running" as const, adbId: "127.0.0.1:16384" };
const MU_PHONE = { id: "127.0.0.1:16384", state: "device" as const, emulator: "mumu" as const, android: "12" };

test("mumuRows：有 MuMu 列表时按它列出，运行中的配上 adb 里的那台；adb 里有但列表里对不上的 MuMu 也列出来", () => {
  assert.deepEqual(mumuRows([MU_RUNNING, { index: 1, name: "二", state: "stopped" }], [MU_PHONE]), [
    { key: "mumu:0", mumu: MU_RUNNING, phone: MU_PHONE },
    { key: "mumu:1", mumu: { index: 1, name: "二", state: "stopped" } },
  ]);
  const stray = { id: "127.0.0.1:16416", state: "device" as const, emulator: "mumu" as const };
  assert.deepEqual(mumuRows([MU_STOPPED], [stray]), [{ key: "mumu:0", mumu: MU_STOPPED }, { key: stray.id, phone: stray }]);
});

test("mumuRows：网关没发 MuMu 列表（旧网关、没装 mumutool）时只按 adb 里标了 mumu 的设备列", () => {
  assert.deepEqual(mumuRows(null, [MU_PHONE, { id: "R5CR10WN52H", state: "device" }]), [{ key: MU_PHONE.id, phone: MU_PHONE }]);
  assert.deepEqual(mumuRows(null, null), []);
});

test("mumuRowStatus：关机、启动中、关机中、运行中但 adb 还没连上、可用、当前画面", () => {
  assert.equal(mumuRowStatus({ key: "a", mumu: MU_STOPPED }, false), "未运行");
  assert.equal(mumuRowStatus({ key: "a", mumu: { ...MU_STOPPED, state: "starting" } }, false), "启动中…");
  assert.equal(mumuRowStatus({ key: "a", mumu: { ...MU_STOPPED, state: "stopping" } }, false), "关机中…");
  assert.equal(mumuRowStatus({ key: "a", mumu: MU_RUNNING }, false), "正在连接…");
  assert.equal(mumuRowStatus({ key: "a", mumu: MU_RUNNING, phone: MU_PHONE }, false), "可用");
  assert.equal(mumuRowStatus({ key: "a", mumu: MU_RUNNING, phone: MU_PHONE }, true), "当前画面");
  assert.equal(mumuRowStatus({ key: "a", phone: MU_PHONE }, true), "当前画面");
});

test("mumuRowTitle：有 MuMu 列表时用 MuMu 里的设备名，否则用 adb 读到的型号", () => {
  assert.equal(mumuRowTitle({ key: "a", mumu: MU_RUNNING, phone: { ...MU_PHONE, manufacturer: "HONOR", model: "REA-AN00" } }), "我的安卓");
  assert.equal(mumuRowTitle({ key: "a", phone: { ...MU_PHONE, manufacturer: "HONOR", model: "REA-AN00" } }), "HONOR REA-AN00");
});

test("mumuRows：MuMu 关机后 adb 里留着的离线条目不再单独占一行；没有 MuMu 列表时离线的照常显示", () => {
  const leftover = { ...MU_PHONE, state: "offline" as const };
  assert.deepEqual(mumuRows([MU_STOPPED], [leftover]), [{ key: "mumu:0", mumu: MU_STOPPED }]);
  assert.deepEqual(mumuRows(null, [leftover]), [{ key: leftover.id, phone: leftover }]);
});

test("mumuRowStatus：MuMu 已在运行但 adb 里那台还是离线（刚开机）时说正在连接，不说已关机", () => {
  assert.equal(mumuRowStatus({ key: "a", mumu: MU_RUNNING, phone: { ...MU_PHONE, state: "offline" } }, false), "正在连接…");
});

test("phoneTitle：MuMu 的那台用 MuMu 里的名字，别的照 phoneLabel", () => {
  const p = { ...MU_PHONE, manufacturer: "HONOR", model: "REA-AN00" };
  assert.equal(phoneTitle(p, [MU_RUNNING]), "我的安卓");
  assert.equal(phoneTitle(p, null), "HONOR REA-AN00");
  assert.equal(phoneTitle({ id: "R5", state: "device", manufacturer: "samsung", model: "SM-G9910" }, [MU_RUNNING]), "Samsung SM-G9910");
});
