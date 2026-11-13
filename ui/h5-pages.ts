/** H5 列表里判断用到的页面字段；visible 由网关按 description 算好（visible:true 且不是 never_attached / empty）。 */
export type ListedPage = { pkg?: string; url: string; visible: boolean };

/** 前台 App 的包名：真正可见的页面所在的 App；没有可见页面时取列表第一项的。 */
export function foregroundPkg(list: ListedPage[]): string | null {
  return (list.find((p) => p.visible) ?? list[0])?.pkg ?? null;
}

/**
 * 左侧 H5 键显示与否：连着设备、adb 有响应，并且前台有真正可见的 H5 页面。
 * 控制台开着时一直保留，好用它收起控制台。list 为 null 表示还没成功读到过。
 */
export function h5KeyShown(s: { connected: boolean; adbStuck: boolean; consoleOpen: boolean; list: ListedPage[] | null }): boolean {
  if (!s.connected) return false;
  if (s.consoleOpen) return true;
  return !s.adbStuck && !!s.list?.some((p) => p.visible);
}

const isPreload = (p: ListedPage) => p.url.startsWith("data:");

/** 控制台默认审查的页面：可见的优先，不选 data: 预加载页面；都不合适时不选。 */
export function pickPage<T extends ListedPage>(list: T[]): T | undefined {
  const real = list.filter((p) => !isPreload(p));
  return real.find((p) => p.visible) ?? real[0];
}

/** 设备上正在看的页面：前台可见的那一个，不算 data: 预加载页面；没有就是 undefined（不是可调试的 WebView 或 Chrome 时也没有）。 */
export function activePage<T extends ListedPage>(list: T[]): T | undefined {
  return list.find((p) => p.visible && !isPreload(p));
}
