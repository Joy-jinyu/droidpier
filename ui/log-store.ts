// 日志面板的行：网关一批批推来，页面最多留 MAX_LINES 行（docs/superpowers/plans/2026-11-16-real-device-pr5-logcat.md 取舍 2）
import type { LogLevel, LogLine } from "../shared/logcat";

/** 页面最多留多少行；刷屏时超出的丢最旧的，列表才不会越来越慢。 */
export const MAX_LINES = 20000;

/** skipped 是「省略了 N 行」那一行（网关因页面跟不上没发的）；它的 n 取负数，不和网关的序号撞。 */
export type LogRow = LogLine | { n: number; skipped: number };

let skipSeq = 0;

export function applyBatch(rows: readonly LogRow[], batch: { lines: LogLine[]; reset: boolean; dropped: number }): LogRow[] {
  const out: LogRow[] = batch.reset ? [] : rows.slice();
  if (batch.dropped > 0) out.push({ n: --skipSeq, skipped: batch.dropped });
  for (const l of batch.lines) out.push(l);
  return out.length > MAX_LINES ? out.slice(out.length - MAX_LINES) : out;
}

/** 级别的颜色角色，App.tsx 的 LEVEL_TOKEN 把它换成主题 token。 */
export function levelColor(l: LogLevel): "muted" | "text" | "warn" | "danger" {
  return l === "W" ? "warn" : l === "E" || l === "F" ? "danger" : l === "I" ? "text" : "muted";
}

/**
 * 日志列表空着时说什么：断开了、暂停了、有过滤条件（App、级别、关键字）时没有符合的、真的还没有日志，分开说。
 * 网关按条件过滤后才推过来，页面看不出不加条件时有没有日志，所以有条件时只能说「没有符合条件的」。
 */
export function logEmptyText(s: { live: boolean; paused: boolean; filtered: boolean }): string {
  if (!s.live) return "设备已断开，重新连上后继续显示日志。";
  if (s.paused) return "已暂停";
  return s.filtered ? "没有符合条件的日志。" : "还没有日志";
}
