// 侧栏「iOS 模拟器」分组的行和文案
import type { IosSimInfo } from "../shared/protocol";

/** Xcode 默认带几十台（每个系统版本一套 iPhone、iPad）：没在运行的先收起来，搜索时照常列出匹配的。 */
export function iosSimRows(list: IosSimInfo[] | null, query: string, showAll: boolean): { rows: IosSimInfo[]; hidden: number } {
  const q = query.trim().toLowerCase();
  const all = (list ?? []).filter((s) => !q || s.name.toLowerCase().includes(q) || s.runtime.toLowerCase().includes(q));
  if (q || showAll) return { rows: all, hidden: 0 };
  const rows = all.filter((s) => s.state !== "shutdown");
  return { rows, hidden: all.length - rows.length };
}

const STATE: Record<Exclude<IosSimInfo["state"], "booted">, string> = { shutdown: "未运行", booting: "启动中…", "shutting-down": "关机中…" };

/** 行副标题：current 表示它就是主区正在显示的设备。 */
export function iosSimStatus(s: IosSimInfo, current: boolean): string {
  if (s.state === "booted") return current ? "运行中 · 当前画面" : "运行中";
  return STATE[s.state];
}

/** 主区现在连着的 iOS 模拟器：画面通路和真机一样（kind 是 phone），按 deviceId 对 UDID。 */
export function currentIosSimOf(list: IosSimInfo[] | null, d: { kind: "emulator" | "phone"; deviceId: string; state: string }): IosSimInfo | undefined {
  if (d.kind !== "phone" || (d.state !== "connected" && d.state !== "rebooting")) return undefined;
  return (list ?? []).find((s) => s.udid === d.deviceId);
}
