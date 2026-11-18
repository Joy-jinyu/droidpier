/** 超过 max 个字符时保留开头和结尾、中间换成“…”；nsh 的 web 端只支持末尾省略。 */
export function middleEllipsis(text: string, max: number): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  return chars.slice(0, head).join("") + "…" + chars.slice(chars.length - (keep - head)).join("");
}

// 中日韩文字、全角符号：差不多一个字号宽
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;
/** 拉丁字母和数字的平均字宽按 0.6 个字号估（无衬线字体偏宽地估，宁可早一点省略，也不让末尾被截掉）。 */
const NARROW_EM = 0.6;

/**
 * 按宽度（点）估算 fontSize 的字放得下多少，放不下时中间省略（middleEllipsis）；width 还不知道（0）时原样返回。
 * 只是估算：真的超出时显示的地方还要有末尾截断兜底（numberOfLines: 1）。
 */
export function fitMiddle(text: string, width: number, fontSize: number): string {
  const chars = [...text];
  const em = chars.reduce((n, c) => n + (WIDE.test(c) ? 1 : NARROW_EM), 0);
  if (width <= 0 || em * fontSize <= width) return text;
  return middleEllipsis(text, Math.max(3, Math.floor((chars.length * width) / (em * fontSize))));
}
