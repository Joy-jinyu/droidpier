/** H5 列表里判断用到的页面字段；visible 由网关按 description 算好（visible:true 且不是 never_attached / empty）。 */
export type ListedPage = { pkg?: string; url: string; visible: boolean };

/** 标题旁显示的包名：只认真正可见的页面；回到主屏等没有可见页面时为 null，不拿列表第一项充数（那是后台的）。 */
export function visiblePkg(list: ListedPage[]): string | null {
  return list.find((p) => p.visible)?.pkg ?? null;
}

/** H5 面板按哪个 App 列页面：真正可见的页面所在的 App；没有可见页面时取列表第一项的，面板里还能选后台页面。 */
export function foregroundPkg(list: ListedPage[]): string | null {
  return (list.find((p) => p.visible) ?? list[0])?.pkg ?? null;
}

/**
 * 工具栏 H5 键显示与否：连着设备，并且前台有真正可见的 H5 页面。
 * adb 没有响应时读不到列表、不知道有没有 H5 页面，也显示：打开后面板里说明原因、给重启按钮，不能让控制台无声无息地消失。
 * 控制台开着时一直保留，好用它收起控制台。list 为 null 表示还没成功读到过。
 */
export function h5KeyShown(s: { connected: boolean; adbStuck: boolean; consoleOpen: boolean; list: ListedPage[] | null }): boolean {
  if (!s.connected) return false;
  if (s.consoleOpen) return true;
  return s.adbStuck || !!s.list?.some((p) => p.visible);
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

// 零宽字符和普通空白：有的 H5 把 document.title 设成零宽空格来隐藏原生标题栏，trim() 去不掉它
const INVISIBLE = /[\s\u200b-\u200d\u2060\ufeff]/g;

/** 页面标题里有没有看得见的字；没有时界面上改用网址。 */
export function visibleTitle(title: string): string {
  return title.replace(INVISIBLE, "") === "" ? "" : title.trim();
}
