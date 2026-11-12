export type NormalizeOk = { url: string; reversePort?: number };
export type NormalizeErr = { error: string };

/** 解析用户输入的跳转地址。
 * - 自动补 http://；用 URL 解析；localhost/127.0.0.1 时附 reversePort。
 * - 内部空格或其他非法格式返回 {error}。
 */
export function normalizeTarget(input: string): NormalizeOk | NormalizeErr {
  const trimmed = input.trim();
  // 内部空格不合法
  if (/\s/.test(trimmed)) return { error: "地址格式不对" };

  const raw = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { error: "地址格式不对" };
  }

  const host = parsed.hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1";

  if (!isLocal) {
    return { url: parsed.href };
  }

  // 端口：有显式端口用显式端口；没有则 http→80，https→443
  let reversePort: number;
  if (parsed.port !== "") {
    reversePort = Number(parsed.port);
  } else {
    reversePort = parsed.protocol === "https:" ? 443 : 80;
  }

  return { url: parsed.href, reversePort };
}
