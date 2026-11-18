/**
 * 停止设备的流程：确认框（ask）→ 停止中（stopping，几台可以同时停）→ 停完或失败。
 * 网关的 stopAvd 等设备真的停了才回（旧网关由 host 改用 stop 再看列表，见 host/src/main.ts 的 stopOld），回复就是结果；
 * 回复之前列表里已经看到它停了（gone）也算停完。等多久由 host 的请求超时管（没回时给出说明），这里不再计时。
 * label 是页面上的名字（显示名），停完、失败的提示用它。
 */
export type StopTarget = { name: string; label: string };
/** error：确认框里显示的失败原因。 */
export type StopFlow = { ask: StopTarget | null; stopping: StopTarget[]; error: string | null };
export const STOP_IDLE: StopFlow = { ask: null, stopping: [], error: null };

export type StopEvent =
  | { kind: "open"; target: StopTarget }
  | { kind: "cancel" }
  | { kind: "confirm" }
  | { kind: "done"; name: string }
  | { kind: "failed"; name: string; text: string }
  | { kind: "gone"; name: string };

/** send：要发停止请求的设备 id；notice：要在画面上方提示的话（确认框已经关了时才给，开着时写在框里）。 */
export type StopStep = { flow: StopFlow; send?: string; notice?: { text: string; error?: boolean } };

export const isStopping = (f: StopFlow, name: string) => f.stopping.some((t) => t.name === name);

export function stopStep(f: StopFlow, e: StopEvent): StopStep {
  switch (e.kind) {
    case "open":
      return { flow: { ...f, ask: e.target, error: null } };
    case "cancel":
      // 停止中的确认框关不掉，等结果
      return f.ask && isStopping(f, f.ask.name) ? { flow: f } : { flow: { ...f, ask: null, error: null } };
    case "confirm": {
      const a = f.ask;
      if (!a || isStopping(f, a.name)) return { flow: f };
      return { flow: { ...f, stopping: [...f.stopping, a], error: null }, send: a.name };
    }
    default: {
      // 已经收过尾的（列表先看到停了，回复后到）不再提示一次
      const t = f.stopping.find((x) => x.name === e.name);
      if (!t) return { flow: f };
      const stopping = f.stopping.filter((x) => x !== t);
      const asked = f.ask?.name === e.name;
      if (e.kind !== "failed") return { flow: { ...f, stopping, ask: asked ? null : f.ask }, notice: { text: `已停止 ${t.label}` } };
      return asked ? { flow: { ...f, stopping, error: e.text } } : { flow: { ...f, stopping }, notice: { text: e.text, error: true } };
    }
  }
}
