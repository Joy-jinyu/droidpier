import type { ClientMsg } from "../../shared/protocol.ts";

/** 跟踪当前按下但还没 keyup 的功能键，失焦时补发 keyup。 */
export function createHeldKeys(send: (m: ClientMsg) => void) {
  // 已发 keydown 但还没发 keyup 的 key 名
  const held = new Set<string>();

  return {
    /** 检查一条已发出的 key 消息，记录或清除 held 状态。 */
    onMsg(m: ClientMsg): void {
      if (m.t !== "key") return;
      if (m.eventType === "keydown") {
        held.add(m.key);
      } else if (m.eventType === "keyup") {
        held.delete(m.key);
      }
      // keypress 不记录
    },
    /** 对所有还在按的键补发 keyup，然后清空。 */
    releaseAll(): void {
      for (const key of held) {
        send({ t: "key", key, eventType: "keyup" });
      }
      held.clear();
    },
  };
}
