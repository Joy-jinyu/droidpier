// 侧栏「真机」分组和主区标题的真机文案
import type { PhoneInfo } from "../shared/protocol";

/** 行标题：「Samsung SM-G9910」；没查到型号时用设备 id。 */
export function phoneLabel(p: PhoneInfo): string {
  if (!p.model) return p.id;
  if (!p.manufacturer) return p.model;
  return `${p.manufacturer.charAt(0).toUpperCase()}${p.manufacturer.slice(1)} ${p.model}`;
}

const STATUS: Record<Exclude<PhoneInfo["state"], "device">, string> = {
  unauthorized: "请在手机上允许 USB 调试",
  offline: "离线，重新插拔试试",
};

/** 行副标题：连接状态和用户该做什么；current 表示它就是主区正在显示的设备。 */
export function phoneStatus(p: PhoneInfo, current: boolean): string {
  if (p.state === "device") return current ? "当前画面" : "可用";
  return STATUS[p.state];
}

/** 只有 adb 状态为 device 的手机能切过去。 */
export function canPick(p: PhoneInfo): boolean {
  return p.state === "device";
}

/** 行右侧的 Android 版本号，和模拟器行右侧的「15」同一写法；不知道时为空。 */
export function phoneDetail(p: PhoneInfo): string {
  return p.android ?? "";
}

/** 没收到过 phones 消息（旧网关）就不显示分组；收到过空列表要显示，提示插手机。 */
export function showPhones(list: PhoneInfo[] | null): boolean {
  return list !== null;
}

/**
 * 主区现在连着的真机：已连接和重启中都算（同模拟器的 isCurrent）。手机重启时会从 adb 列表里消失一阵，
 * 这时用 last（最后一次在列表里见到的这台）。
 */
export function currentPhoneOf(list: PhoneInfo[] | null, last: PhoneInfo | undefined, d: { kind: "emulator" | "phone"; deviceId: string; state: string }): PhoneInfo | undefined {
  if (d.kind !== "phone" || (d.state !== "connected" && d.state !== "rebooting")) return undefined;
  const found = (list ?? []).find((p) => p.id === d.deviceId);
  if (found) return found;
  return d.state === "rebooting" && last?.id === d.deviceId ? last : undefined;
}
