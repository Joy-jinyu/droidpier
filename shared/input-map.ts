import type { ClientMsg, Rotation } from "./protocol.ts";

/**
 * 把页面坐标换算成设备竖屏面板上的像素坐标，四舍五入，夹到设备范围内。
 * device 是竖屏尺寸；rotation 是设备顺时针转过的角度，画面始终按人眼看到的方向显示。
 */
export function toDevice(
  p: { x: number; y: number },
  rect: { left: number; top: number; width: number; height: number },
  device: { width: number; height: number },
  rotation: Rotation = 0
): { x: number; y: number } {
  const u = (p.x - rect.left) / rect.width;
  const v = (p.y - rect.top) / rect.height;
  // 映射关系在模拟器 32.1.14 上用 pointer_location 核对过，见 input-map.test.ts
  const [rx, ry] =
    rotation === 90 ? [v, 1 - u] :
    rotation === 180 ? [1 - u, 1 - v] :
    rotation === 270 ? [1 - v, u] :
    [u, v];
  const x = Math.round(rx * device.width);
  const y = Math.round(ry * device.height);
  return {
    x: Math.max(0, Math.min(device.width - 1, x)),
    y: Math.max(0, Math.min(device.height - 1, y)),
  };
}

/** 功能键集合。 */
const FUNCTION_KEYS = new Set([
  "Enter", "Backspace", "Delete", "Tab", "Escape",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "Home", "End", "PageUp", "PageDown",
]);

/**
 * 将键盘事件转换为 ClientMsg。
 * metaKey / isComposing → null；单个 ASCII 可打印字符 keydown → keypress 消息；
 * 功能键 → key 消息；其他 → null。
 */
export function keyToMsg(
  e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; isComposing: boolean },
  type: "keydown" | "keyup"
): ClientMsg | null {
  if (e.metaKey) return null;
  if (e.isComposing) return null;

  if (e.key.length === 1) {
    const code = e.key.codePointAt(0)!;
    if (code >= 0x20 && code <= 0x7e) {
      if (type === "keydown") return { t: "key", key: e.key, eventType: "keypress" };
      return null; // keyup
    }
  }

  if (FUNCTION_KEYS.has(e.key)) {
    return { t: "key", key: e.key, eventType: type };
  }

  return null;
}

/**
 * 设备按键的快捷键，键位照 Android Studio 模拟器：模拟器 36.4.10 里的快捷键表写的是 Ctrl，在 Mac 上就是 Cmd。
 * 只收页面上有对应按键的几个。键名前的 ⇧ 表示要同时按 Shift。
 */
const SHORTCUTS: Record<string, ClientMsg> = {
  "s": { t: "screenshot" },
  "p": { t: "key", key: "Power", eventType: "keypress" },
  "⇧h": { t: "key", key: "GoHome", eventType: "keypress" },
  "o": { t: "key", key: "AppSwitch", eventType: "keypress" },
  "Backspace": { t: "key", key: "GoBack", eventType: "keypress" },
  "=": { t: "key", key: "AudioVolumeUp", eventType: "keypress" },
  "-": { t: "key", key: "AudioVolumeDown", eventType: "keypress" },
  "ArrowLeft": { t: "rotate", dir: "left" },
  "ArrowRight": { t: "rotate" },
};

/** 设备有键盘焦点时按下的 Cmd 组合键 → 对应按键的消息；不是这几个快捷键就返回 null，交给浏览器。 */
export function shortcutToMsg(
  e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }
): ClientMsg | null {
  if (!e.metaKey || e.ctrlKey || e.altKey) return null;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  return SHORTCUTS[(e.shiftKey ? "⇧" : "") + key] ?? null;
}

/**
 * 将文本转换为 ClientMsg 数组。
 * 纯 ASCII → 逐字符 keypress；含非 ASCII → 单条 text 消息。
 */
export function textToMsgs(text: string): ClientMsg[] {
  const isAscii = [...text].every((c) => {
    const code = c.codePointAt(0)!;
    return code >= 0x20 && code <= 0x7e;
  });
  if (!isAscii) return [{ t: "text", text }];
  return [...text].map((c) => ({ t: "key" as const, key: c, eventType: "keypress" as const }));
}

/** 粘贴：不论 ASCII 与否都整段走剪贴板，长 ASCII 逐字按键太慢，还会被输入框自动补全括号之类改坏。 */
export function pasteToMsgs(text: string): ClientMsg[] {
  return text ? [{ t: "text", text }] : [];
}

/**
 * textarea 的 input 事件：只发不经组字、也没被 keydown 拦下的直接插入（Option 字符、表情面板）。
 * 可打印 ASCII 的 keydown 已 preventDefault，不会再来 input，所以不会重复发。
 */
export function inputToMsgs(e: { isComposing: boolean; inputType: string; data: string | null }): ClientMsg[] {
  if (e.isComposing || e.inputType !== "insertText" || !e.data) return [];
  return textToMsgs(e.data);
}

/** 各旋转下「屏幕上方」在设备面板的方向向量（供 wheelToSwipe 使用）。 */
const WHEEL_DIR: Record<Rotation, { dx: number; dy: number }> = {
  0:   { dx: 0,  dy: -1 },
  90:  { dx: -1, dy: 0  },
  180: { dx: 0,  dy: 1  },
  270: { dx: 1,  dy: 0  },
};

/** 滚轮滑动的最小安全位移（设备像素）；低于此值的位移会被回退为 []，避免退化成误触 tap。 */
const MIN_SWIPE_PX = 40;

/**
 * 把滚轮位移换算成设备上的滑动序列（触下 + 8 步移动 + 抬起，共 10 个点）。
 * - 100px deltaY → 300px 滑动；上限 900px。
 * - 方向与 deltaY 相反：往下滚（deltaY>0）手指往上滑。
 * - rotation 决定「屏幕向上」在设备面板里的方向，与 toDevice 惯例一致。
 * - 返回 [] 表示不应发送（deltaY=0，或设备边缘处无论如何凑不到 MIN_SWIPE_PX）。
 */
export function wheelToSwipe(
  deltaY: number,
  at: { x: number; y: number },
  device: { width: number; height: number },
  rotation: Rotation = 0
): Array<{ x: number; y: number; down: boolean; delayMs: number }> {
  if (deltaY === 0) return [];

  const rawDist = Math.sign(deltaY) * Math.min(Math.abs(deltaY) * 3, 900);
  const dir = WHEEL_DIR[rotation];
  const endX = Math.max(0, Math.min(device.width - 1, at.x + dir.dx * rawDist));
  const endY = Math.max(0, Math.min(device.height - 1, at.y + dir.dy * rawDist));

  // 夹边后实际位移；不足 MIN_SWIPE_PX 时把起点沿滑动的反方向移，确保够长。滑动方向是 dir 乘 deltaY 的符号，往上滚时和 dir 相反
  const actDist = dir.dx !== 0 ? Math.abs(endX - at.x) : Math.abs(endY - at.y);
  let startX = at.x;
  let startY = at.y;
  if (actDist < MIN_SWIPE_PX) {
    const back = Math.sign(deltaY) * MIN_SWIPE_PX;
    if (dir.dx !== 0) {
      startX = Math.max(0, Math.min(device.width - 1, endX - dir.dx * back));
    } else {
      startY = Math.max(0, Math.min(device.height - 1, endY - dir.dy * back));
    }
    const newDist = dir.dx !== 0 ? Math.abs(endX - startX) : Math.abs(endY - startY);
    if (newDist < MIN_SWIPE_PX) return []; // 设备空间不够，放弃
  }

  const pts: Array<{ x: number; y: number; down: boolean; delayMs: number }> = [];
  pts.push({ x: startX, y: startY, down: true, delayMs: 0 });
  for (let i = 1; i <= 8; i++) {
    const t = i / 8;
    pts.push({
      x: Math.round(startX + (endX - startX) * t),
      y: Math.round(startY + (endY - startY) * t),
      down: true,
      delayMs: 8,
    });
  }
  pts.push({ x: endX, y: endY, down: false, delayMs: 8 });
  return pts;
}
