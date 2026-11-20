// 侧栏「手机」「MuMu 模拟器」分组和主区标题的真机文案
import type { MumuInfo, PhoneInfo } from "../shared/protocol";

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
  if (p.emulator === "mumu") return "离线，MuMu 可能已关机";
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

/** 侧栏分组：MuMu 模拟器单独一组，其余是真机。 */
export function splitPhones(list: PhoneInfo[] | null): { phones: PhoneInfo[]; mumu: PhoneInfo[] } {
  const all = list ?? [];
  return { phones: all.filter((p) => p.emulator !== "mumu"), mumu: all.filter((p) => p.emulator === "mumu") };
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

/** 侧栏「MuMu 模拟器」的一行：mumu 是 MuMu 自己列表里的那台（能开关机），phone 是它在 adb 里的那台（能切过去看画面）。 */
export type MumuRow = { key: string; mumu?: MumuInfo; phone?: PhoneInfo };

/**
 * MuMu 分组的行：有 MuMu 列表时按它列，运行中的按 adbId 配上 adb 里的那台；adb 里标了 mumu 但列表里对不上的也列出来。
 * 没有 MuMu 列表（旧网关、没装 mumutool）时只按 adb 里标了 mumu 的设备列。
 */
export function mumuRows(mumu: MumuInfo[] | null, phones: PhoneInfo[] | null): MumuRow[] {
  const inAdb = splitPhones(phones).mumu;
  const rows: MumuRow[] = (mumu ?? []).map((m) => {
    const phone = m.adbId ? inAdb.find((p) => p.id === m.adbId) : undefined;
    return phone ? { key: `mumu:${m.index}`, mumu: m, phone } : { key: `mumu:${m.index}`, mumu: m };
  });
  // MuMu 关机后 adb 里会一直留着一条离线的：有 MuMu 列表时它已经由列表里那一行（未运行）代表，不再单独列
  for (const p of inAdb) if (!rows.some((r) => r.phone?.id === p.id) && (mumu === null || p.state === "device")) rows.push({ key: p.id, phone: p });
  return rows;
}

const MUMU_STATE: Record<Exclude<MumuInfo["state"], "running">, string> = { stopped: "未运行", starting: "启动中…", stopping: "关机中…" };

/** 行副标题：没开机、开关机中照 MuMu 的状态说；开着的按 adb 里那台说（同真机），adb 还没连上时说正在连接。 */
export function mumuRowStatus(r: MumuRow, current: boolean): string {
  if (r.mumu && r.mumu.state !== "running") return MUMU_STATE[r.mumu.state];
  // MuMu 说在运行、adb 里那台还没上线（刚开机时旧条目还是离线）：在连，不是关机了
  if (!r.phone || (r.mumu && r.phone.state !== "device")) return "正在连接…";
  return phoneStatus(r.phone, current);
}

/** 行标题：MuMu 里起的名字（「我的安卓」）；只有 adb 里那台时用它报的型号。 */
export function mumuRowTitle(r: MumuRow): string {
  return r.mumu?.name ?? phoneLabel(r.phone!);
}

/** 主区标题和提示里这台真机的名字：MuMu 的那台用 MuMu 里起的名字（和侧栏一致），别的照 phoneLabel。 */
export function phoneTitle(p: PhoneInfo, mumu: MumuInfo[] | null): string {
  return (p.emulator === "mumu" && mumu?.find((m) => m.adbId === p.id)?.name) || phoneLabel(p);
}
