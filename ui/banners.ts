/**
 * 画面上方的提示（adb 卡住、通知、网关更新、剪贴板、传文件）同一时间只显示一条，按 BANNER_ORDER 的先后：
 * 要用户处理的（adb 卡住、错误、剪贴板没写进去）在前；4 秒就收起的一般消息其次，排在后面就会没人看见就过期；
 * 一直挂着的状态（网关更新、传文件进度）最后。其余的排着，前一条关掉或结束后再出来。
 */
export const BANNER_ORDER = ["adb", "error", "clip", "info", "gateway", "uploads"] as const;
export type BannerKind = (typeof BANNER_ORDER)[number];

/** 现在显示哪一条，以及后面还排着几条；没有提示时 shown 是 null。 */
export function pickBanner(active: readonly BannerKind[]): { shown: BannerKind | null; waiting: number } {
  const sorted = BANNER_ORDER.filter((k) => active.includes(k));
  return { shown: sorted[0] ?? null, waiting: Math.max(0, sorted.length - 1) };
}

/** 一般消息 4 秒后自己收起；错误一直留着，等用户关（读得慢、正在看画面的人不会错过）。 */
export function noticeTimeoutMs(n: { error?: boolean; sticky?: boolean }): number | null {
  return n.error || n.sticky ? null : 4000;
}
