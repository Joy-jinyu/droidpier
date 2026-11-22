// iOS 模拟器的按键：页面发来的键名（同 Android：GoHome、Enter、单个可打印字符……）换成画面程序的命令。
// 键盘走 USB HID 键码（Keyboard/Keypad 页），硬件按键走 SimulatorKit 的按键来源编号（idb 的 FBSimulatorIndigoHID 用的同一套值）

/** 硬件按键的来源编号。 */
export const IOS_BUTTON = { home: 0x0, lock: 0x3e8 } as const;

export const HID_SHIFT = 0xe1;
export const HID_GUI = 0xe3;
export const HID_V = 0x19;

const FUNCTION: Record<string, number> = {
  Enter: 0x28, Escape: 0x29, Backspace: 0x2a, Tab: 0x2b,
  ArrowRight: 0x4f, ArrowLeft: 0x50, ArrowDown: 0x51, ArrowUp: 0x52,
  Home: 0x4a, PageUp: 0x4b, Delete: 0x4c, End: 0x4d, PageDown: 0x4e,
};

// 不按 Shift 的字符；下一行是同一个键按 Shift 得到的字符（美式键盘）
const PLAIN = "1234567890-=[]\\;'`,./ ";
const SHIFTED = "!@#$%^&*()_+{}|:\"~<>? ";
const PLAIN_USAGE = [0x1e, 0x1f, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x2d, 0x2e, 0x2f, 0x30, 0x31, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x2c];

/** 一个可打印 ASCII 字符 → HID 键码和要不要按 Shift；不认识的返回 null。 */
export function charUsage(c: string): { usage: number; shift: boolean } | null {
  if (c.length !== 1) return null;
  if (c >= "a" && c <= "z") return { usage: 0x04 + c.charCodeAt(0) - 97, shift: false };
  if (c >= "A" && c <= "Z") return { usage: 0x04 + c.charCodeAt(0) - 65, shift: true };
  const i = PLAIN.indexOf(c);
  if (i >= 0) return { usage: PLAIN_USAGE[i], shift: false };
  const j = SHIFTED.indexOf(c);
  if (j >= 0 && c !== " ") return { usage: PLAIN_USAGE[j], shift: true };
  return null;
}

/** 功能键（Enter、方向键……）的 HID 键码；不是功能键返回 null。 */
export function functionUsage(key: string): number | null {
  return FUNCTION[key] ?? null;
}

/** 画面程序的一条输入命令，或两条之间的停顿（毫秒）。 */
export type IosInput =
  | { t: "button"; source: number; down: boolean }
  | { t: "hidkey"; usage: number; down: boolean }
  | { t: "touch"; x: number; y: number; down: boolean; edge?: number }
  | { wait: number };

const press = (t: "button" | "hidkey", code: number): IosInput[] =>
  t === "button" ? [{ t, source: code, down: true }, { wait: 80 }, { t, source: code, down: false }] : [{ t, usage: code, down: true }, { t, usage: code, down: false }];

/** 系统手势从屏幕底边开始时触摸消息要带的边缘编号（IndigoHIDEdge，2026-11-22 iOS 18.3 实测 3 是底边，别的值不生效）。 */
export const EDGE_BOTTOM = 3;

/**
 * 全面屏机型回主屏：从底边往上滑到 35% 高（带底边标记）。硬件 Home 键在 iOS 18.3 的全面屏机型上不起作用，
 * iOS 27 上起作用（2026-11-22 实测），上滑两边都认。
 */
export function swipeUp(w: number, h: number): IosInput[] {
  const steps = 15;
  const out: IosInput[] = [];
  for (let i = 0; i <= steps; i++) {
    out.push({ t: "touch", x: w / 2, y: h - 2 - (h * 0.35 * i) / steps, down: true, edge: EDGE_BOTTOM });
    out.push({ wait: 16 });
  }
  out.push({ t: "touch", x: w / 2, y: h * 0.65, down: false, edge: EDGE_BOTTOM });
  return out;
}

/** 全面屏机型打开多任务：从底边上滑到 40% 高，停住约 0.75 秒等多任务出来，再松手。 */
export function swipeUpHold(w: number, h: number): IosInput[] {
  const out: IosInput[] = [];
  for (let i = 0; i <= 20; i++) {
    out.push({ t: "touch", x: w / 2, y: h - 2 - (h * 0.4 * i) / 20, down: true, edge: EDGE_BOTTOM });
    out.push({ wait: 20 });
  }
  for (let i = 0; i < 25; i++) {
    out.push({ t: "touch", x: w / 2, y: h * 0.6, down: true, edge: EDGE_BOTTOM });
    out.push({ wait: 30 });
  }
  out.push({ t: "touch", x: w / 2, y: h * 0.6, down: false, edge: EDGE_BOTTOM });
  return out;
}

/** iOS 没有返回键：从屏幕左边缘往右滑（UIKit 导航的返回手势），屏幕中线高度，滑到 40% 宽。 */
export function edgeSwipe(w: number, h: number): IosInput[] {
  const steps = 15;
  const out: IosInput[] = [];
  for (let i = 0; i <= steps; i++) {
    out.push({ t: "touch", x: 2 + ((w * 0.4 - 2) * i) / steps, y: h / 2, down: true });
    out.push({ wait: 16 });
  }
  out.push({ t: "touch", x: w * 0.4, y: h / 2, down: false });
  return out;
}

/**
 * 页面的一次按键 → 画面程序的命令序列；不支持的键返回 null（音量键：SimulatorKit 没有现成的消息）。
 * size 是帧缓冲尺寸，返回手势要用。
 */
export function iosKey(key: string, eventType: "keydown" | "keyup" | "keypress", size: { width: number; height: number }, homeButton = false): IosInput[] | null {
  // 页面上的硬件按钮和快捷键只发 keypress 或成对的 keydown/keyup：按钮在 keydown 时整个按一下，keyup 不再发
  const once = eventType !== "keyup";
  switch (key) {
    // 有 Home 键的机型按 Home 键、连按两下开多任务；全面屏机型用底边上滑手势
    case "GoHome":
      if (!once) return [];
      return homeButton ? press("button", IOS_BUTTON.home) : swipeUp(size.width, size.height);
    case "AppSwitch":
      if (!once) return [];
      return homeButton ? [...press("button", IOS_BUTTON.home), { wait: 120 }, ...press("button", IOS_BUTTON.home)] : swipeUpHold(size.width, size.height);
    case "Power":
      return once ? press("button", IOS_BUTTON.lock) : [];
    case "GoBack":
      return once ? edgeSwipe(size.width, size.height) : [];
  }
  const f = functionUsage(key);
  if (f !== null) {
    if (eventType === "keypress") return press("hidkey", f);
    return [{ t: "hidkey", usage: f, down: eventType === "keydown" }];
  }
  if (eventType === "keypress") {
    const c = charUsage(key);
    if (!c) return null;
    return c.shift ? [{ t: "hidkey", usage: HID_SHIFT, down: true }, ...press("hidkey", c.usage), { t: "hidkey", usage: HID_SHIFT, down: false }] : press("hidkey", c.usage);
  }
  return null;
}

/**
 * 粘贴：剪贴板写好后按 ⌘V，再等一会儿。iOS 收到 ⌘V 后才去读剪贴板、插入文字，紧跟着的按键会先打出来、
 * 再被粘贴盖掉（2026-11-22 实测「你好」后紧跟 A1 只剩「你好」）。150 ms 是我定的，同 Android 的 PASTE_GAP_MS 思路
 */
export const PASTE: IosInput[] = [{ t: "hidkey", usage: HID_GUI, down: true }, ...press("hidkey", HID_V), { t: "hidkey", usage: HID_GUI, down: false }, { wait: 150 }];
