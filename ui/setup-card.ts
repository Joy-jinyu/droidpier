/**
 * 环境检查卡片显示与否。卡片盖在设备画面上方（会挡住顶部和两侧按键），所以只要没在安装，缺项时也能收起；
 * 安装进行中一直显示，收起后要等下一次开始安装才再显示。
 */
export function setupCardShown(s: { ok: boolean; busy: boolean; failed: boolean; hasInstalls: boolean; dismissed: boolean }): boolean {
  if (s.busy) return true;
  if (s.dismissed) return false;
  return !s.ok || s.failed || s.hasInstalls;
}
