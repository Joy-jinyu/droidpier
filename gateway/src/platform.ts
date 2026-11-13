import { execFile, spawn } from "node:child_process";
import { access, readdir, stat, statfs } from "node:fs/promises";
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

/** sdkmanager 的绝对路径（cmdline-tools/latest）。 */
export function sdkmanagerBin(sdk = sdkRoot()): string {
  return join(sdk, "cmdline-tools/latest/bin/sdkmanager");
}

/** avdmanager 的绝对路径（cmdline-tools/latest）。 */
export function avdmanagerBin(sdk = sdkRoot()): string {
  return join(sdk, "cmdline-tools/latest/bin/avdmanager");
}

/**
 * Google 官方 SDK 仓库清单，sdkmanager 自己读的也是这份（https://dl.google.com/android/repository/repository2-3.xml）。
 * cmdline-tools 的 zip 地址相对它解析，sha1 在 <checksum type="sha1">。
 */
export function cmdlineToolsManifestUrl(): string {
  return "https://dl.google.com/android/repository/repository2-3.xml";
}

/**
 * Google 的 google_apis 系统镜像清单（2026-11-12 读的）：addons_list-5.xml 里 “Google API add-on System Images” 指向它，
 * 包路径是 system-images;android-<级别>;google_apis;<abi>，下载大小在 <archive><complete><size>，稳定通道是 channel-0。
 */
export const SYS_IMG_MANIFEST_URL = "https://dl.google.com/android/repository/sys-img/google_apis/sys-img2-3.xml";

/**
 * 固定安装的 cmdline-tools 版本。23.0 起 sdkmanager 换成 Android CLI 的包装：不再逐项询问许可证、自己写 licenses/，
 * 还往 ~/.android/bin、~/.android/cli 装东西（2026-11-12 实测）；22.0 是最后一个逐项问 Accept? (y/N) 的 Java 版（同日实测）。
 */
export const CMDLINE_TOOLS_REVISION = "22.0";

/** 清单里本机对应的 host-os / host-arch（第一版只做 darwin-arm64）。 */
export const MANIFEST_HOST = { os: "macosx", arch: "aarch64" };

/** 找 Java 用到的外部依赖，测试里换成假的。 */
export type JavaIo = {
  home: string;
  /** JAVA_HOME 环境变量。 */
  env: string | undefined;
  exists(path: string): Promise<boolean>;
  readdir(dir: string): Promise<string[]>;
  /** /usr/libexec/java_home 成功时的输出；失败为 null。 */
  javaHomeCmd(): Promise<string | null>;
};

const STUDIO_JBR = "Android Studio.app/Contents/jbr/Contents/Home";

const realJavaIo = (): JavaIo => ({
  home: homedir(),
  env: process.env.JAVA_HOME,
  exists: (p) => access(p).then(() => true, () => false),
  readdir: (d) => readdir(d),
  // 只问 java_home 有没有装 JDK；不跑 /usr/bin/java（没装 JDK 时它会弹系统安装框）
  javaHomeCmd: () =>
    new Promise((res) => execFile("/usr/libexec/java_home", { timeout: 5000 }, (e, out) => res(e ? null : out.trim() || null))),
});

/**
 * sdkmanager / avdmanager 用的 Java：JAVA_HOME → /Applications 和 ~/Applications 里 Android Studio 自带的 JBR
 * → JetBrains Toolbox 装的 Android Studio → /usr/libexec/java_home。都没有返回 null。
 */
export async function findJavaHome(io: JavaIo = realJavaIo()): Promise<string | null> {
  const toolbox = join(io.home, "Library/Application Support/JetBrains/Toolbox/apps/AndroidStudio/ch-0");
  const builds = await io.readdir(toolbox).catch(() => [] as string[]);
  const candidates = [
    io.env,
    join("/Applications", STUDIO_JBR),
    join(io.home, "Applications", STUDIO_JBR),
    ...builds.sort().reverse().map((b) => join(toolbox, b, STUDIO_JBR)),
  ];
  for (const c of candidates) if (c && (await io.exists(join(c, "bin/java")))) return c;
  return io.javaHomeCmd();
}

/** 手动安装 cmdline-tools 用的 zip：清单里 cmdline-tools;22.0 的 macOS arm64 包（2026-11-12 读的 repository2-3.xml）。 */
export const CMDLINE_TOOLS_ZIP_URL = "https://dl.google.com/android/repository/commandlinetools-mac_arm64-15859902_latest.zip";

/** 用户显式设的 ANDROID_AVD_HOME；没设为 undefined。 */
export function explicitAvdHome(): string | undefined {
  return process.env.ANDROID_AVD_HOME;
}

/** AVD 主目录：优先 ANDROID_AVD_HOME，其次 ~/.android/avd。 */
export function avdHome(): string {
  return process.env.ANDROID_AVD_HOME ?? join(homedir(), ".android/avd");
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
