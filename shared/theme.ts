/** 页面外观：跟随系统、浅色、深色。 */
export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

/** 读回存着的外观；没存过、存的不认识（旧版本或被改过）都按跟随系统。 */
export function parseTheme(raw: unknown): Theme {
  return THEMES.includes(raw as Theme) ? (raw as Theme) : "system";
}
