// iOS 模拟器的日志：xcrun simctl spawn <udid> log stream 的 ndjson 输出转成 logcat threadtime 格式的行，
// 交给同一个日志面板（gateway/src/logcat.ts 按 threadtime 解析、过滤、合批）。App 列表和 pid 取自模拟器里的 launchctl list

import type { AdbStream, AdbStreamHandlers } from "./adb.ts";

/** os_log 的级别 → logcat 级别。Default（NSLog、os_log 默认级别）算 I。 */
const LEVEL: Record<string, string> = { Debug: "D", Info: "I", Default: "I", Error: "E", Fault: "F" };

type LogEvent = { timestamp?: string; messageType?: string; processID?: number; threadID?: number; processImagePath?: string; subsystem?: string; category?: string; eventMessage?: string };

/**
 * 一条 ndjson 日志 → threadtime 行（多行内容拆成同一个头的几行）；不是日志事件的返回 []。
 * tag 是进程名；有 subsystem 时内容前面带 [subsystem:category]，方便按它搜。
 */
export function iosLogLines(json: string): string[] {
  let e: LogEvent;
  try {
    e = JSON.parse(json);
  } catch {
    return [];
  }
  const level = e.messageType ? LEVEL[e.messageType] : undefined;
  const m = /^\d{4}-(\d\d-\d\d) (\d\d:\d\d:\d\d\.\d{3})/.exec(e.timestamp ?? "");
  if (!level || !m || typeof e.processID !== "number") return [];
  const proc = (e.processImagePath ?? "").split("/").pop() || "?";
  const where = e.subsystem ? `[${e.subsystem}${e.category ? `:${e.category}` : ""}] ` : "";
  const head = `${m[1]} ${m[2]} ${e.processID} ${e.threadID ?? 0} ${level} ${proc}: `;
  return `${where}${e.eventMessage ?? ""}`.split("\n").map((l) => head + l);
}

/** 把 log stream 的输出（可能断在半行）转成 threadtime 文本交给 onData。 */
export function iosLogTranslator(onData: (s: string) => void) {
  let partial = "";
  return (chunk: string) => {
    const rows = (partial + chunk).split("\n");
    partial = rows.pop() ?? "";
    const out = rows.flatMap(iosLogLines);
    if (out.length) onData(out.join("\n") + "\n");
  };
}

/**
 * 起模拟器的 log stream（info 及以上：debug 级系统日志每秒上千条）。
 * spawn 用 adb.ts 的 streamAdb，网关退出时跟 adb 子进程一起结束。
 */
export function iosLogStream(spawn: (bin: string, args: string[], h: AdbStreamHandlers) => AdbStream, udid: string, h: AdbStreamHandlers): AdbStream {
  return spawn("xcrun", ["simctl", "spawn", udid, "log", "stream", "--style", "ndjson", "--level", "info"], { onData: iosLogTranslator(h.onData), onExit: h.onExit });
}

/** launchctl list 里正在运行的 App：UIKitApplication:<bundle id>[…] 行，pid 列是 - 的没运行。 */
export function parseLaunchctlApps(out: string): Array<{ pid: number; bundle: string }> {
  const apps: Array<{ pid: number; bundle: string }> = [];
  for (const line of out.split("\n")) {
    const m = /^(\d+)\s+\S+\s+UIKitApplication:([^[\s]+)\[/.exec(line);
    if (m) apps.push({ pid: Number(m[1]), bundle: m[2] });
  }
  return apps;
}
