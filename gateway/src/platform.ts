import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { stat, statfs } from "node:fs/promises";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { join } from "node:path";

/** Android SDK 根目录：优先 ANDROID_HOME，其次 macOS 默认位置。 */
export function sdkRoot(): string {
  return process.env.ANDROID_HOME ?? join(homedir(), "Library/Android/sdk");
}

/** 模拟器发现文件所在目录（macOS）。 */
export function discoveryDir(): string {
  return join(homedir(), "Library/Caches/TemporaryItems/avd/running");
}

/** emulator_controller.proto 的绝对路径。 */
export function protoPath(): string {
  return join(sdkRoot(), "emulator/lib/emulator_controller.proto");
}

/** adb 可执行文件的绝对路径。 */
export function adbPath(): string {
  return join(sdkRoot(), "platform-tools/adb");
}

/** emulator 可执行文件的绝对路径。 */
export function emulatorBin(): string {
  return join(sdkRoot(), "emulator/emulator");
}

/** 网关拉起的模拟器的输出日志（每个 AVD 一份，每次启动覆盖）。 */
export function emulatorLogPath(avd: string): string {
  return join(homedir(), "Library/Logs/Droidpier", `${avd}.log`);
}

/** 网关下载包的名字：<公网页面>/download/<名字>.tar.xz 和 .sha256（scripts/build-binary.ts 打包，scripts/install.sh 安装）。 */
export const DOWNLOAD_NAME = "droidpier-darwin-arm64";

/** install.sh 装好的可执行文件，和它记下的已装压缩包 sha256（路径同 scripts/install.sh 的 target、stamp）。 */
export function installedPaths(home = homedir()): { bin: string; stamp: string } {
  return { bin: join(home, ".local/bin/droidpier"), stamp: join(home, ".local/share/droidpier/installed.sha256") };
}

/** 后台运行的 LaunchAgent label（macOS launchd）。 */
export const SERVICE_LABEL = "dev.devpier.droidpier";

/** 后台运行用的 LaunchAgent plist（macOS launchd，见 gateway/src/service.ts）。 */
export function launchAgentPath(label: string, home = homedir()): string {
  return join(home, "Library/LaunchAgents", `${label}.plist`);
}

/** 后台运行的网关日志，和模拟器日志放在同一个目录；测试用的 label 用自己的文件名。 */
export function serviceLogPath(label: string, home = homedir()): string {
  return join(home, "Library/Logs/Droidpier", label === SERVICE_LABEL ? "droidpier.log" : `${label}.log`);
}

/** adb 可执行文件的绝对路径（adbPath 的别名）。 */
export function adbBin(): string {
  return adbPath();
}

/**
 * Google 官方 SDK 仓库清单（sdkmanager 和 Android Studio 读的也是它）：emulator、platform-tools 的 zip 地址相对它解析，
 * sha1 在 <checksum type="sha1">，许可证全文在 <license>（2026-11-13 读的）。
 */
export const REPO_MANIFEST_URL = "https://dl.google.com/android/repository/repository2-3.xml";

/** 系统镜像 tag 对应的清单目录：sys-img/<目录>/sys-img2-3.xml（addons_list-5.xml 列出的，2026-11-13 读的）。 */
const SYS_IMG_DIRS: Record<string, string> = { google_apis: "google_apis", google_apis_playstore: "google_apis_playstore", default: "android" };

/** tag 的系统镜像清单地址；不认识的 tag 返回 null。 */
export function sysImgManifestUrl(tag: string): string | null {
  return Object.hasOwn(SYS_IMG_DIRS, tag) ? `https://dl.google.com/android/repository/sys-img/${SYS_IMG_DIRS[tag]}/sys-img2-3.xml` : null;
}

/**
 * Google 的 google_apis 系统镜像清单（2026-11-12 读的）：包路径是 system-images;android-<级别>;google_apis;<abi>，
 * 下载大小在 <archive><complete><size>，稳定通道是 channel-0。
 */
export const SYS_IMG_MANIFEST_URL = sysImgManifestUrl("google_apis")!;

/** 包路径（emulator、platform-tools、system-images;android-34;google_apis;arm64-v8a）在哪份清单里；不认识的返回 null。 */
export function manifestUrlFor(pkg: string): string | null {
  if (pkg === "emulator" || pkg === "platform-tools") return REPO_MANIFEST_URL;
  const tag = /^system-images;[^;]+;([^;]+);[^;]+$/.exec(pkg)?.[1];
  return tag ? sysImgManifestUrl(tag) : null;
}

/** 包装到 SDK 里的目录：包路径的 ; 换成 /（sdkmanager 的规则）。 */
export function packageDir(sdk: string, pkg: string): string {
  return join(sdk, ...pkg.split(";"));
}

/** 清单里本机对应的 host-os / host-arch（第一版只做 darwin-arm64）。 */
export const MANIFEST_HOST = { os: "macosx", arch: "aarch64" };

/** 本机能跑的系统镜像 ABI。 */
export const IMAGE_ABI = "arm64-v8a";

/** 用户显式设的 ANDROID_AVD_HOME；没设或设成空字符串为 undefined（空值不能当成当前目录）。 */
export function explicitAvdHome(): string | undefined {
  return process.env.ANDROID_AVD_HOME || undefined;
}

/**
 * AVD 主目录，照 developer.android.com/tools/variables 的顺序：ANDROID_AVD_HOME（非空）；其次 $ANDROID_USER_HOME/avd，
 * 但只在它里面已经有 .ini 时（AVD 还留在老地方的用户不会因为设了 ANDROID_USER_HOME 就“没有设备”）；最后 ~/.android/avd。
 * 各版本模拟器自己的找法不一样（32.1 完全不认 ANDROID_USER_HOME），所以网关拉起模拟器时用 emulatorEnv 把这个结果显式传过去。
 */
export function avdHome(): string {
  const explicit = explicitAvdHome();
  if (explicit) return explicit;
  if (process.env.ANDROID_USER_HOME) {
    const dir = join(process.env.ANDROID_USER_HOME, "avd");
    try {
      if (readdirSync(dir).some((n) => n.endsWith(".ini"))) return dir;
    } catch {}
  }
  return join(homedir(), ".android/avd");
}

/** 网关拉起 emulator（-list-avds、-avd）用的环境：带上 ANDROID_AVD_HOME=avdHome()，模拟器和网关看同一个目录。 */
export function emulatorEnv(): NodeJS.ProcessEnv {
  return { ...process.env, ANDROID_AVD_HOME: avdHome() };
}

/** Android 用户目录：ANDROID_USER_HOME（非空），其次 ~/.android。AVD .ini 里的 path.rel 相对它。 */
export function androidUserHome(): string {
  return process.env.ANDROID_USER_HOME || join(homedir(), ".android");
}

/** 用系统默认浏览器打开网址（macOS 的 open 命令），失败只回调不抛。 */
export function openBrowser(url: string, onError: (e: Error) => void): void {
  spawn("open", [url], { stdio: "ignore", detached: true }).on("error", onError).unref();
}

/** dir 所在磁盘给当前用户的剩余空间（MB）和设备号（判断两个目录是不是同一块盘）；dir 还不存在时量它最近的已存在的上级目录。 */
export async function diskOf(dir: string): Promise<{ freeMb: number; dev: number }> {
  for (let d = dir; ; d = dirname(d)) {
    try {
      const [s, st] = await Promise.all([statfs(d), stat(d)]);
      return { freeMb: Math.floor((s.bavail * s.bsize) / 2 ** 20), dev: st.dev };
    } catch (e) {
      if (dirname(d) === d) throw e;
    }
  }
}
