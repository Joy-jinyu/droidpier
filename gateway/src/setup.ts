import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { avdHome, avdmanagerBin, CMDLINE_TOOLS_REVISION, CMDLINE_TOOLS_ZIP_URL, diskOf, findJavaHome, sdkmanagerBin, sdkRoot } from "./platform.ts";
import { AVD_DISK_MB } from "../../shared/avd-spec.ts";
import { DEFAULT_AVD, NEEDS_JAVA, type EnvMissing, type EnvReport } from "../../shared/protocol.ts";

export type { EnvMissing, EnvReport };

/** 默认设备用的系统镜像。 */
export const SYSTEM_IMAGE = "system-images;android-34;google_apis;arm64-v8a";


/**
 * 装好后的占用（MB），2026-11-12 在本机量的：cmdline-tools 22.0 解压后 173M、emulator 1.2G、platform-tools 37M（du 临时 SDK），
 * 系统镜像 android-34 google_apis arm64-v8a 3.0G（du 用户 SDK 里同一个包）；avd 见 AVD_DISK_MB。
 */
const DISK_MB = { "cmdline-tools": 173, emulator: 1200, "platform-tools": 37, "system-image": 3072, avd: AVD_DISK_MB };

export type EnvDeps = {
  sdkRoot: string;
  avdHome: string;
  exists(path: string): Promise<boolean>;
  readdir(dir: string): Promise<string[]>;
  readFile(path: string): Promise<string>;
  disk(dir: string): Promise<{ freeMb: number; dev: number }>;
  findJava(): Promise<string | null>;
};

/** 没有 Java 时 java 缺失项的说明。 */
export const NEED_JAVA = "需要 Java 才能运行 sdkmanager：安装 Android Studio（自带 Java）或安装 JDK 17 以上，然后重新打开页面";

/** 读真实文件系统的依赖。 */
export function realEnvDeps(): EnvDeps {
  return {
    sdkRoot: sdkRoot(),
    avdHome: avdHome(),
    exists: (p) => access(p).then(() => true, () => false),
    readdir: (d) => readdir(d),
    readFile: (p) => readFile(p, "utf8"),
    disk: diskOf,
    findJava: () => findJavaHome(),
  };
}

/** 检查本机 SDK 和 AVD 缺什么；所有项都能在用户确认后由网关自动装。 */
export async function checkEnv(deps: EnvDeps): Promise<EnvReport> {
  const sdk = deps.sdkRoot;
  const imageDir = join(sdk, "system-images", ...SYSTEM_IMAGE.split(";").slice(1));
  const hasAvd = await deps.readdir(deps.avdHome).then((names) => names.some((n) => n.endsWith(".ini")), () => false);
  const all: Array<EnvMissing & { present: boolean }> = [
    {
      id: "sdk", present: await deps.exists(sdk), auto: true,
      detail: `没有 Android SDK 目录 ${sdk}`, command: `mkdir -p "${sdk}"`,
    },
    {
      id: "cmdline-tools", present: await deps.exists(sdkmanagerBin(sdk)) && await deps.exists(avdmanagerBin(sdk)), auto: true, sizeMb: 150, diskMb: DISK_MB["cmdline-tools"],
      detail: `没有命令行工具（cmdline-tools），所以没有 sdkmanager 和 avdmanager。在页面上点“安装”会装 ${CMDLINE_TOOLS_REVISION} 版（会逐项询问许可证）`,
      command: `curl -fLo /tmp/cmdline-tools.zip ${CMDLINE_TOOLS_ZIP_URL} && rm -rf /tmp/cmdline-tools-unzip && unzip -q /tmp/cmdline-tools.zip -d /tmp/cmdline-tools-unzip && mkdir -p "${sdk}/cmdline-tools" && mv /tmp/cmdline-tools-unzip/cmdline-tools "${sdk}/cmdline-tools/latest"`,
    },
    {
      id: "emulator", present: await deps.exists(join(sdk, "emulator/emulator")), auto: true, sizeMb: 400, diskMb: DISK_MB.emulator,
      detail: "没有模拟器程序（emulator）", command: 'sdkmanager "emulator"',
    },
    {
      id: "platform-tools", present: await deps.exists(join(sdk, "platform-tools/adb")), auto: true, sizeMb: 15, diskMb: DISK_MB["platform-tools"],
      detail: "没有 adb（platform-tools）", command: 'sdkmanager "platform-tools"',
    },
    {
      id: "system-image", present: await deps.exists(join(imageDir, "system.img")), auto: true, sizeMb: 1500, diskMb: DISK_MB["system-image"],
      detail: `没有系统镜像 Android 14（${SYSTEM_IMAGE}）`, command: `sdkmanager "${SYSTEM_IMAGE}"`,
    },
    {
      id: "avd", present: hasAvd, auto: true, diskMb: DISK_MB.avd,
      detail: `没有模拟器设备（${deps.avdHome} 下没有 AVD）`,
      command: `avdmanager create avd -n ${DEFAULT_AVD.name} -k "${SYSTEM_IMAGE}" -d ${DEFAULT_AVD.device}`,
    },
  ];
  // 23 起的 sdkmanager 是 Android CLI 的包装，会自己接受许可证；已经装了就照用，只让页面提示一句
  const props = await deps.readFile(join(sdk, "cmdline-tools/latest/source.properties")).catch(() => "");
  const major = Number(/^Pkg\.Revision=(\d+)/m.exec(props)?.[1] ?? 0);
  const missing = all.filter((m) => !m.present).map(({ present: _, ...m }) => m);
  const javaHome = await deps.findJava();
  if (!javaHome && missing.some((m) => NEEDS_JAVA.includes(m.id))) missing.unshift({ id: "java", auto: false, detail: NEED_JAVA });
  const [sdkDisk, avdDisk] = await Promise.all([deps.disk(sdk), deps.disk(deps.avdHome)]);
  return {
    ok: missing.length === 0, missing, sdkRoot: sdk, avdHome: deps.avdHome, androidCli: major >= 23, javaHome,
    freeMb: sdkDisk.freeMb, avdFreeMb: avdDisk.freeMb, sameDisk: sdkDisk.dev === avdDisk.dev,
  };
}
