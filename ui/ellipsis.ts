/** 超过 max 个字符时保留开头和结尾、中间换成“…”；nsh 的 web 端只支持末尾省略。 */
export function middleEllipsis(text: string, max: number): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  return chars.slice(0, head).join("") + "…" + chars.slice(chars.length - (keep - head)).join("");
}
