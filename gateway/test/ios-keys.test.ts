import { test } from "node:test";
import assert from "node:assert/strict";
import { charUsage, edgeSwipe, EDGE_BOTTOM, functionUsage, iosKey, IOS_BUTTON, HID_SHIFT, PASTE, swipeUp, swipeUpHold } from "../src/ios-keys.ts";

const SIZE = { width: 828, height: 1792 };
const cmds = (seq: ReturnType<typeof iosKey>) => (seq ?? []).filter((s) => !("wait" in s));

test("charUsage：字母、数字、符号换成 HID 键码，大写和上档符号带 Shift", () => {
  assert.deepEqual(charUsage("a"), { usage: 0x04, shift: false });
  assert.deepEqual(charUsage("Z"), { usage: 0x1d, shift: true });
  assert.deepEqual(charUsage("0"), { usage: 0x27, shift: false });
  assert.deepEqual(charUsage("!"), { usage: 0x1e, shift: true });
  assert.deepEqual(charUsage(" "), { usage: 0x2c, shift: false });
  assert.deepEqual(charUsage("?"), { usage: 0x38, shift: true });
  assert.equal(charUsage("中"), null);
  assert.equal(functionUsage("Enter"), 0x28);
  assert.equal(functionUsage("F1"), null);
});

test("iosKey：有 Home 键的机型主页按一下 Home、多任务连按两下；电源按锁屏键；keyup 不再发", () => {
  assert.deepEqual(cmds(iosKey("GoHome", "keypress", SIZE, true)), [{ t: "button", source: IOS_BUTTON.home, down: true }, { t: "button", source: IOS_BUTTON.home, down: false }]);
  assert.equal(cmds(iosKey("AppSwitch", "keydown", SIZE, true)).length, 4);
  assert.deepEqual(cmds(iosKey("Power", "keydown", SIZE))[0], { t: "button", source: IOS_BUTTON.lock, down: true });
  assert.deepEqual(iosKey("GoHome", "keyup", SIZE), []);
});

test("iosKey：返回是从左边缘往右滑，按下、移动、在 40% 宽处抬起", () => {
  const seq = cmds(iosKey("GoBack", "keydown", SIZE)) as Array<{ x: number; y: number; down: boolean }>;
  assert.deepEqual(seq, cmds(edgeSwipe(828, 1792)));
  assert.equal(seq[0].x, 2);
  assert.equal(seq.at(-1)!.down, false);
  assert.equal(seq.at(-1)!.x, 828 * 0.4);
  assert.ok(seq.every((p) => p.y === 896));
});

test("iosKey：功能键按下抬起分开发；可打印字符按一下，大写包在 Shift 里；音量键和不认识的返回 null", () => {
  assert.deepEqual(iosKey("Backspace", "keydown", SIZE), [{ t: "hidkey", usage: 0x2a, down: true }]);
  assert.deepEqual(iosKey("Backspace", "keyup", SIZE), [{ t: "hidkey", usage: 0x2a, down: false }]);
  assert.deepEqual(iosKey("a", "keypress", SIZE), [{ t: "hidkey", usage: 0x04, down: true }, { t: "hidkey", usage: 0x04, down: false }]);
  const A = iosKey("A", "keypress", SIZE)!;
  assert.deepEqual([A[0], A.at(-1)], [{ t: "hidkey", usage: HID_SHIFT, down: true }, { t: "hidkey", usage: HID_SHIFT, down: false }]);
  assert.equal(iosKey("AudioVolumeUp", "keydown", SIZE), null);
  assert.equal(iosKey("é", "keypress", SIZE), null);
});

test("PASTE 是 ⌘V：先按住 Command，按 V，再松开 Command", () => {
  assert.deepEqual(PASTE.map((s) => ("wait" in s ? "wait" : `${s.t === "hidkey" ? s.usage.toString(16) : ""}${s.down ? "↓" : "↑"}`)), ["e3↓", "19↓", "19↑", "e3↑", "wait"]);
});

test("iosKey：全面屏机型（默认）主页是带底边标记的上滑，多任务是上滑后停住再松手", () => {
  const home = cmds(iosKey("GoHome", "keypress", SIZE)) as Array<{ t: string; y: number; down: boolean; edge?: number }>;
  assert.deepEqual(home, cmds(swipeUp(828, 1792)));
  assert.ok(home.every((p) => p.t === "touch" && p.edge === EDGE_BOTTOM));
  assert.equal(home[0].y, 1790);
  assert.equal(home.at(-1)!.down, false);
  const recents = cmds(iosKey("AppSwitch", "keydown", SIZE)) as Array<{ y: number; down: boolean }>;
  assert.deepEqual(recents, cmds(swipeUpHold(828, 1792)));
  // 停住：最后松手前有一串同一位置的按住
  assert.ok(recents.slice(-10, -1).every((p) => p.down && p.y === 1792 * 0.6));
});
