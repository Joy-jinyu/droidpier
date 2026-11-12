/** 带 rid 的请求和回复配对：超时或连接断开时以失败结束，不留挂起的等待者。 */
export function createPending<R>(timeoutMs: number) {
  let nextRid = 1;
  const waiting = new Map<number, { resolve: (r: R) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  return {
    /** send 收到新 rid，返回 false 表示没发出去。 */
    request(send: (rid: number) => boolean): Promise<R> {
      const rid = nextRid++;
      return new Promise<R>((resolve, reject) => {
        if (!send(rid)) return reject(new Error("没有连上网关"));
        const timer = setTimeout(() => {
          waiting.delete(rid);
          reject(new Error(`网关 ${Math.round(timeoutMs / 1000)} 秒没有回应`));
        }, timeoutMs);
        waiting.set(rid, { resolve, reject, timer });
      });
    },
    /** 交付回复；rid 已超时或不认识时返回 false。 */
    settle(rid: number, reply: R): boolean {
      const w = waiting.get(rid);
      if (!w) return false;
      waiting.delete(rid);
      clearTimeout(w.timer);
      w.resolve(reply);
      return true;
    },
    failAll(message: string) {
      const all = [...waiting.values()];
      waiting.clear();
      for (const w of all) {
        clearTimeout(w.timer);
        w.reject(new Error(message));
      }
    },
  };
}
