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
