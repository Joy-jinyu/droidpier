/**
 * 点了「启动」「切换到这台」、结果还没到时，按钮换成进行中的字并禁用（免得连点发出好几次）。emu.start、emu.use 发出就回 ok，
 * 结果要从别处看出来：
 * - 启动：网关推来这台的开机进度（开始开机、失败都算）；
 * - 切换：画面换到了这台；
 * - 两种都算：网关报了错（它不认这次操作时只回一条 error）、和网关断开了；
 * 都没有时 PENDING_MS 后放开（估的：切换一般 1～2 秒，启动一两秒内就有开机进度）。
 */
export type Pending = { name: string; what: "start" | "use" } | null;
export const PENDING_MS = 20_000;

/** status：down 是没连着网关（ui/gateway-state.ts 的 gatewayDown），onScreen 是画面上连着的设备 id（没有为 null）。 */
export type PendingEvent =
  | { kind: "boot"; name: string }
  | { kind: "status"; down: boolean; onScreen: string | null }
  | { kind: "gateway-error" }
  | { kind: "not-sent" }
  | { kind: "timeout" };

export function pendingAfter(p: Pending, e: PendingEvent): Pending {
  if (!p) return null;
  if (e.kind === "boot") return p.what === "start" && p.name === e.name ? null : p;
  if (e.kind === "status") return e.down || (p.what === "use" && e.onScreen === p.name) ? null : p;
  return null;
}
