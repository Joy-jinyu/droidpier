/** 设备画面的缩放档位：1 是整台设备正好放进窗口（适应窗口），大于 1 时设备区可以滚动。 */
export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** 读回存着的缩放；没存过、不是档位里的值都按适应窗口。 */
export function parseZoom(raw: unknown): number {
  const z = typeof raw === "string" ? Number(raw) : raw;
  return ZOOM_STEPS.includes(z as number) ? (z as number) : 1;
}

/** 往大（dir 1）或往小（dir -1）走一档，到头了停在两端。 */
export function stepZoom(zoom: number, dir: 1 | -1): number {
  const i = ZOOM_STEPS.indexOf(parseZoom(zoom));
  return ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + dir))];
}
