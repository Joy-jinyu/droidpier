/** 管理本网关建立的 adb reverse 映射。
 * exec 接收 adb -s <设备 id> 之后的参数（与 makeAdbExec 返回的函数一致）。
 */
export function createReverses(exec: (args: string[]) => Promise<string>) {
  const ports = new Set<number>();
  // 飞行中的 ensure：并发调用共享同一个 Promise，避免重复执行 reverse
  const inflight = new Map<number, Promise<void>>();

  function ensure(port: number): Promise<void> {
    if (ports.has(port)) return Promise.resolve();
    const existing = inflight.get(port);
    if (existing) return existing;

    const p = exec(["reverse", `tcp:${port}`, `tcp:${port}`]).then(
      () => { ports.add(port); inflight.delete(port); },
      (err) => { inflight.delete(port); throw err; },
    );
    inflight.set(port, p);
    return p;
  }

  async function removeAll(): Promise<void> {
    // 进行中的 ensure 成功后也要移除，先等它们落定
    while (inflight.size) await Promise.allSettled(inflight.values());
    // 每个端口都要试一遍：一个失败不能让后面的残留
    const all = [...ports];
    ports.clear();
    const results = await Promise.allSettled(all.map((port) => exec(["reverse", "--remove", `tcp:${port}`])));
    const failed = all.flatMap((port, i) => {
      const r = results[i];
      return r.status === "rejected" ? [`tcp:${port}：${(r.reason as Error)?.message ?? r.reason}`] : [];
    });
    if (failed.length) throw new Error(`部分 adb reverse 没移除：${failed.join("；")}`);
  }

  function list(): number[] {
    return [...ports];
  }

  return { ensure, removeAll, list };
}
