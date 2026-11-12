const MAX_REASON = 300;
const SEVERE = /panic|fatal/i;
const KEY = /panic|fatal|error|cannot|not enough|requires/i;

/** 从模拟器日志里挑出最能说明为什么退出的一两行：先 PANIC / FATAL，再 ERROR 等关键行，都没有就取最后两行；最多 300 字。 */
export function bootLogReason(log: string): string {
  const lines = log.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const key = lines.filter((l) => KEY.test(l));
  const picked = key.length
    ? [...key.filter((l) => SEVERE.test(l)), ...key.filter((l) => !SEVERE.test(l))].slice(0, 2)
    : lines.slice(-2);
  const text = [...new Set(picked)].join("; ");
  return text.length > MAX_REASON ? `${text.slice(0, MAX_REASON - 1)}…` : text;
}

const UPDATE_EMULATOR = "模拟器版本太旧，跑不了这个系统镜像：在 Android Studio 的 SDK Manager → SDK Tools 里更新 Android Emulator";

// 前面的先匹配：x86 的“Missing emulator engine program”是镜像架构问题，不是版本问题
const HINTS: Array<[RegExp, string]> = [
  [/not enough (disk )?space|space to create userdata/i, "磁盘空间不够，清理出空间后再启动"],
  [
    /another emulator instance|is already running|multiple emulators with the same avd/i,
    "这个 AVD 已经在运行（或上次没退干净）：先关掉它，或在活动监视器里结束 qemu-system 进程",
  ],
  [
    /emulation currently requires hardware acceleration|cpu architecture '[^']*' is not supported|missing emulator engine program for 'x86/i,
    "这是 x86 / x86_64 镜像，Apple 芯片的 Mac 跑不了：换一个 arm64-v8a 镜像的 AVD",
  ],
  [/newer version of the emulator|missing emulator engine program|emulator (is )?(too old|out of date)/i, UPDATE_EMULATOR],
  [
    /avd system path|cannot find kernel file|system image.*(not installed|missing)/i,
    "这个 AVD 的系统镜像没装或找不到：在 Android Studio 的 SDK Manager 里装上对应的系统镜像",
  ],
];

/** 日志里认得出的常见启动失败，翻成中文建议；认不出返回 null。 */
export function bootLogHint(log: string): string | null {
  return HINTS.find(([re]) => re.test(log))?.[1] ?? null;
}
