/** pid 列的字数：Android 默认 pid_max 是 32768，五位放得下；更长的 pid 照原样显示，这一行往后错开。 */
export const PID_CHARS = 5;
/** tag 列的字数：更长的 tag 截断，末尾换成“…”。 */
export const TAG_CHARS = 20;

/**
 * 日志一行的前两列：时间加 pid、级别加 tag，补空格到固定字数。等宽字体下字数一样宽度就一样，
 * 所以每一行的级别和内容都从同一个位置开始。time 是 logcat 的“MM-DD HH:MM:SS.mmm”，只留时分秒。
 */
export function logCells(l: { time: string; pid: number; level: string; tag: string }): { head: string; tag: string } {
  const tag = [...l.tag];
  const fitted = tag.length > TAG_CHARS ? tag.slice(0, TAG_CHARS - 1).join("") + "…" : l.tag.padEnd(TAG_CHARS);
  return { head: `${l.time.slice(6)} ${String(l.pid).padStart(PID_CHARS)}`, tag: `${l.level} ${fitted}` };
}
