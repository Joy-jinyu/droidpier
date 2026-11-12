import type { EmulatorSession } from "./emulator.ts";

/**
 * 缓存一个会话：没找到或会话报告退出后清空，下次调用时重新发现。
 * use(name) 只发现这个 AVD，找到就替换缓存并关闭旧会话；找不到返回 null，缓存不变。
 */
export function cachedSession(discover: (avdName?: string) => Promise<EmulatorSession | null>) {
  let current: Promise<EmulatorSession | null> | null = null;
  // 只清自己那一份：切换后旧会话再退出，不能把新缓存清掉
  const track = (p: Promise<EmulatorSession | null>) => {
    const drop = () => {
      if (current === p) current = null;
    };
    p.then((s) => (s ? s.onClosed(drop) : drop()), drop);
    return p;
  };
  const get = (): Promise<EmulatorSession | null> => (current ??= track(discover()));
  const switchTo = async (avdName: string): Promise<EmulatorSession | null> => {
    const s = await discover(avdName);
    if (!s) return null;
    const old = await current?.catch(() => null);
    current = track(Promise.resolve(s));
    if (old && old !== s) old.close();
    return s;
  };
  // use 串行执行：并发时两次都读到同一个旧会话，先建的新会话就没人关
  let chain: Promise<unknown> = Promise.resolve();
  get.use = (avdName: string): Promise<EmulatorSession | null> => {
    const r = chain.then(() => switchTo(avdName));
    chain = r.catch(() => {});
    return r;
  };
  return get;
}
