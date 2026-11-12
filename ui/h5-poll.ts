/**
 * H5 列表的轮询间隔：连续成功 3 次后从 3 秒放宽到 5 秒，失败一次就回到 3 秒，少打扰设备里的 adb。
 * 控制台开着时保持 3 秒：被审查的页面没了要尽快收起控制台。
 */
export function h5PollMs(okStreak: number, consoleOpen: boolean): number {
  return okStreak >= 3 && !consoleOpen ? 5000 : 3000;
}
