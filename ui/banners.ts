/**
 * 画面上方的提示（adb 卡住、通知、网关更新、剪贴板）同一时间只显示一条，按 BANNER_ORDER 的先后：
 * 要用户处理的（adb 卡住、留着等用户关的通知、剪贴板没写进去）在前；几秒就收起的一般消息其次，它的倒计时从真的显示出来才开始
 * （timedNotice），排在后面也不会没人看见就过期；网关更新最后。其余的排着，前一条关掉或结束后再出来。
 * 传文件的进度不在这里排：它是单独的一张卡片，一直显示在这条下面，不会被关不掉的提示（网关正在自动更新）挡住。
 */
export const BANNER_ORDER = ["adb", "error", "clip", "info", "gateway"] as const;
/** error 是留着等用户关的通知（错误，以及 sticky 的），一条算一个；info 是几秒就收起的一般消息。 */
export type BannerKind = (typeof BANNER_ORDER)[number];

/** 现在显示哪一条，以及后面还排着几条；没有提示时 shown 是 null。active 里同一种可以有几条。 */
export function pickBanner(active: readonly BannerKind[]): { shown: BannerKind | null; waiting: number } {
  const sorted = BANNER_ORDER.flatMap((k) => active.filter((a) => a === k));
  return { shown: sorted[0] ?? null, waiting: Math.max(0, sorted.length - 1) };
}

/** sticky：不自动消失，文字可选中复制，带关闭按钮。 */
export type Notice = { text: string; error?: boolean; sticky?: boolean };

/** 一般消息 4 秒后自己收起；错误一直留着，等用户关（读得慢、正在看画面的人不会错过）。 */
export function noticeTimeoutMs(n: { error?: boolean; sticky?: boolean }): number | null {
  return n.error || n.sticky ? null : 4000;
}

/**
 * 通知分两处放：kept 是留着等用户关的（按到达先后，最新的在最后），info 是一般消息，只留最新的一条。
 * 规则保证错误不会没人看见就没了：后来的一般消息不顶掉错误（错误在前面先显示）；后来的错误先显示，
 * 前面的错误还在 kept 里，关掉这条就露出来。
 */
export type Notices = { kept: Notice[]; info: Notice | null };
export const NO_NOTICES: Notices = { kept: [], info: null };

export function addNotice(q: Notices, n: Notice): Notices {
  if (noticeTimeoutMs(n) !== null) return { ...q, info: n };
  // 同样的话已经在排着（比如连点了几次都没连上网关）：挪到最新，不重复
  return { ...q, kept: [...q.kept.filter((k) => k.text !== n.text), n] };
}

/** 现在该显示的那条：有留着的先显示最新的一条，没有才显示一般消息。 */
export function currentNotice(q: Notices): Notice | null {
  return q.kept[q.kept.length - 1] ?? q.info;
}

/** 用户关掉、或一般消息到时间了：去掉 n 这一条（按对象认，同样文字的新消息不受影响）。 */
export function dropNotice(q: Notices, n: Notice): Notices {
  if (q.info === n) return { ...q, info: null };
  return { ...q, kept: q.kept.filter((k) => k !== n) };
}

/** 画面上方有哪些提示在排（给 pickBanner）。adb 卡住只在连着设备时算；clip 是剪贴板要用户点一下才写得进。 */
export function activeBanners(s: { adbStuck: boolean; state: string; notices: Notices; gateway: boolean; clip: boolean }): BannerKind[] {
  const out: BannerKind[] = [];
  if (s.adbStuck && s.state === "connected") out.push("adb");
  out.push(...s.notices.kept.map(() => "error" as const));
  if (s.notices.info) out.push("info");
  if (s.gateway) out.push("gateway");
  if (s.clip) out.push("clip");
  return out;
}

/** 这一条有没有「关闭」：一般消息（自己收起）、网关正在自动更新的没有。gatewayManual：网关提示是要用户运行命令的那种。 */
export function bannerClosable(k: BannerKind, gatewayManual: boolean): boolean {
  if (k === "info") return false;
  if (k === "gateway") return gatewayManual;
  return true;
}

/** 「关掉这条后还有 N 条提示」只写在能关掉的那条下面；关不掉的下面写了用户也没法照做。 */
export function waitingShown(b: { shown: BannerKind | null; waiting: number }, gatewayManual: boolean): boolean {
  return b.shown !== null && b.waiting > 0 && bannerClosable(b.shown, gatewayManual);
}

/** 现在该倒计时的一般消息：只有它真的显示在画面上时才计时，被前面的提示挡着时不算（返回 null）。 */
export function timedNotice(shown: BannerKind | null, q: Notices): Notice | null {
  return shown === "info" ? q.info : null;
}
