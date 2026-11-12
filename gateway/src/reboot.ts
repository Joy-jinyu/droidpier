/**
 * 发出重启指令后等系统开机完成。check 读 sys.boot_completed（带超时，失败就抛）。
 * 刚发出指令时还能读到上一次开机留下的 1，所以先要见过一次“没开机”或读失败，之后的 1 才算数。
 * adb 一直起不来时等满 maxMs 返回 adb-down，由画面判断是否恢复。
 */
export async function waitForReboot(d: {
  check: () => Promise<string>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  maxMs: number;
  pollMs: number;
}): Promise<"done" | "adb-down"> {
  const start = d.now();
  let wentDown = false;
  while (d.now() - start < d.maxMs) {
    const out = await d.check().then((s) => s.trim(), () => null);
    if (out === "1") {
      if (wentDown) return "done";
    } else wentDown = true;
    await d.sleep(d.pollMs);
  }
  return "adb-down";
}
