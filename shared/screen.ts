import type { Rotation } from "./protocol.ts";

type Size = { width: number; height: number };

/** 画面在容器里按设备（转过之后的）宽高比等比缩放、整块可见时的 CSS 尺寸，取整。 */
export function fitSize(box: Size, device: Size, rotation: Rotation): Size {
  const dw = rotation % 180 ? device.height : device.width;
  const dh = rotation % 180 ? device.width : device.height;
  if (box.width <= 0 || box.height <= 0 || dw <= 0 || dh <= 0) return { width: 0, height: 0 };
  const scale = Math.min(box.width / dw, box.height / dh);
  return {
    width: Math.min(box.width, Math.round(dw * scale)),
    height: Math.min(box.height, Math.round(dh * scale)),
  };
}

/**
 * 画在屏幕外面的机身：屏幕区（四边各去掉 bezel）按转过之后的宽高比、整个机身放进容器时的尺寸，取整。
 * zoom 只缩放屏幕区，机身边框宽度不变，屏幕区保持设备的宽高比。
 */
export function deviceFrame(box: Size, device: Size, rotation: Rotation, bezel: number, zoom = 1): Size {
  const inner = fitSize({ width: box.width - 2 * bezel, height: box.height - 2 * bezel }, device, rotation);
  if (!inner.width || !inner.height) return { width: 0, height: 0 };
  return { width: Math.round(inner.width * zoom) + 2 * bezel, height: Math.round(inner.height * zoom) + 2 * bezel };
}

/** 帧从模拟器产生到现在过了多少毫秒。tsMs 是 u32 毫秒（会回绕）；本机时钟略慢于帧时间戳时返回 0。 */
export function frameLatencyMs(nowMs: number, tsMs: number): number {
  // |0 按 2^32 取模并解释成有符号数：回绕后仍是小正数，时钟超前时是小负数
  return Math.max(0, (Math.floor(nowMs) - tsMs) | 0);
}
