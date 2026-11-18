/** 超过 max 个字符时保留开头和结尾、中间换成“…”；nsh 的 web 端只支持末尾省略。 */
export function middleEllipsis(text: string, max: number): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  return chars.slice(0, head).join("") + "…" + chars.slice(chars.length - (keep - head)).join("");
}

// 中日韩文字、全角符号：差不多一个字号宽
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;
// 默认按图画显示的表情（☕、⭐，BMP 以外的 😀）和 BMP 以外的字（扩展区的汉字）也差不多一个字号宽
const EMOJI = /\p{Emoji_Presentation}/u;
const isWide = (c: string) => WIDE.test(c) || EMOJI.test(c) || c.codePointAt(0)! > 0xffff;
/** 拉丁字母和数字的平均字宽按 0.6 个字号估（无衬线字体偏宽地估，宁可早一点省略，也不让末尾被截掉）。 */
const NARROW_EM = 0.6;

/**
 * 按宽度（点）估算 fontSize 的字放得下多少，放不下时中间省略（middleEllipsis）；width 还不知道（0）时原样返回。
 * 只是估算：真的超出时显示的地方还要有末尾截断兜底（numberOfLines: 1，配合 noBreak）。
 */
export function fitMiddle(text: string, width: number, fontSize: number): string {
  const chars = [...text];
  const em = chars.reduce((n, c) => n + (isWide(c) ? 1 : NARROW_EM), 0);
  if (width <= 0 || em * fontSize <= width) return text;
  return middleEllipsis(text, Math.max(3, Math.floor((chars.length * width) / (em * fontSize))));
}

/**
 * 一行字里的空白都换成不断行空格：去掉首尾空白，连续的空白（含换行、制表符）换成一个。nsh 0.4.0 网页端的单行文字
 * （numberOfLines: 1）放不下时截在最后一个放得下的空格处再加「…」：「Resizable (Experimental) API 36」在 120 宽里只剩
 * 「Resizable…」，后面空着；遇到换行只显示第一行，开头就是换行（网页标题里常有）时整行只剩「…」。没有空格时按字截断，
 * 放得下多少显示多少；中文、网址、括号也是按字截的（2026-11-17、2026-11-18 用最小的 nsh 应用在 Chrome 里实测）。
 */
export function noBreak(text: string): string {
  return text.trim().replace(/\s+/g, "\u00a0");
}
