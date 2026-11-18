/** 没说原因的失败给的下一步：网关的日志里有详细原因（公开文档「故障排除」也让人看这里）。 */
export const NEXT_STEP = "请再试一次；还不行就在终端运行 droidpier logs 看网关日志";

/**
 * 「做某事失败」的一句话：有原因时写原因，没有原因（或网关只说了「未知原因」）时给下一步，不停在「未知原因」。
 * what 是「没有删除」这样的结果。
 */
export function failText(what: string, error?: string | null): string {
  const reason = error?.trim();
  return reason && reason !== "未知原因" ? `${what}：${reason}` : `${what}，原因不明。${NEXT_STEP}`;
}
