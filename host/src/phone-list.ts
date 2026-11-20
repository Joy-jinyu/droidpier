import type { PhoneInfo } from "../../shared/protocol.ts";

/**
 * 网关推来的列表（真机、MuMu）的当前值：null 表示网关没发过（旧网关）或已断开。
 * 断开时必须清空：换上旧网关后不会再有 phones 消息来覆盖旧列表，页面会一直显示「已连接」。
 */
export function createPhoneList<T = PhoneInfo>(show: (list: T[] | null) => void) {
  let list: T[] | null = null;
  return {
    onPhones(next: T[]) {
      list = next;
      show(list);
    },
    onDisconnect() {
      if (list === null) return;
      list = null;
      show(null);
    },
    current: () => list,
  };
}
