/** 控制台占位的打开状态里，判断要不要收起用到的部分。 */
export type OpenConsole = { key: string; serial: number };

export type ConsoleEvent =
  | { kind: "list"; keys: string[] }
  | { kind: "list-failed" }
  | { kind: "status"; state: string; serial: number };

/** 被审查的页面没了就收起控制台：成功读到的列表里没有它、设备换了或关了、开始重启。读列表失败不算页面没了。 */
export function shouldCloseConsole(open: OpenConsole | null, ev: ConsoleEvent): boolean {
  if (!open) return false;
  if (ev.kind === "list") return !ev.keys.includes(open.key);
  if (ev.kind === "list-failed") return false;
  return ev.state === "rebooting" || ev.serial !== open.serial;
}
