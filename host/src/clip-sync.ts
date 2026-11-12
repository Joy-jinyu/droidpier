/**
 * 设备复制的内容写进电脑剪贴板：写成功收起提示条（show(null)），失败让提示条显示这条。
 * 只按最新一条的结果决定，旧内容的结果晚到时忽略。
 */
export function createClipSync(write: (text: string) => Promise<void>, show: (text: string | null) => void) {
  let seq = 0;
  return {
    onClip(text: string) {
      const my = ++seq;
      write(text).then(
        () => { if (my === seq) show(null); },
        () => { if (my === seq) show(text); },
      );
    },
  };
}
