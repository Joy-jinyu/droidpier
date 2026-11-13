import { access, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { androidUserHome, avdHome, diskOf, IMAGE_ABI, manifestUrlFor, sdkRoot } from "./platform.ts";
import { androidVersion, scanInstalledImages } from "./catalog.ts";
import { avdDataDir } from "./avd.ts";
import { AVD_DISK_MB } from "../../shared/avd-spec.ts";
import type { EnvMissing, EnvReport } from "../../shared/protocol.ts";

export type { EnvMissing, EnvReport };

/** 没有能用的系统镜像时默认装的镜像。 */
export const SYSTEM_IMAGE = "system-images;android-34;google_apis;arm64-v8a";

/**
 * 下载大小和装好后的占用（MB）。emulator 37.2 的 macOS aarch64 包 397 MB、platform-tools 37.0.1 的 16 MB（2026-11-13 读的清单）；
 * 装好后 emulator 1.2G、platform-tools 37M（2026-11-12 du 临时 SDK）；android-34 镜像下载 1536 MB、装好 3.0G（du 同一个包）。
 * 别的镜像没量过，按新镜像的大小估（android-36 下载 1786 MB，装好按 catalog.ts 的 3 倍算）。
 */
const SIZE = {
  emulator: { sizeMb: 400, diskMb: 1200 },
  "platform-tools": { sizeMb: 16, diskMb: 37 },
  defaultImage: { sizeMb: 1536, diskMb: 3072 },
  otherImage: { sizeMb: 1800, diskMb: 5400 },
};

export type EnvDeps = {
  sdkRoot: string;
  avdHome: string;
  /** Android 用户目录：AVD .ini 里的 path.rel 相对它。 */
  userHome: string;
  exists(path: string): Promise<boolean>;
  isDir(path: string): Promise<boolean>;
  readdir(dir: string): Promise<string[]>;
  readFile(path: string): Promise<string>;
  disk(dir: string): Promise<{ freeMb: number; dev: number }>;
};

/** 读真实文件系统的依赖。 */
export function realEnvDeps(): EnvDeps {
  return {
    sdkRoot: sdkRoot(),
    avdHome: avdHome(),
    userHome: androidUserHome(),
    exists: (p) => access(p).then(() => true, () => false),
    isDir: (p) => stat(p).then((s) => s.isDirectory(), () => false),
    readdir: (d) => readdir(d),
    readFile: (p) => readFile(p, "utf8"),
    disk: diskOf,
  };
}

/** ini 文本里 key 的值（第一行），没有为 undefined。 */
function ini(text: string, key: string): string | undefined {
  const line = text.split(/\r?\n/).find((l) => l.includes("=") && l.slice(0, l.indexOf("=")).trim() === key);
  return line?.slice(line.indexOf("=") + 1).trim();
}

type AvdImage = { name: string; label: string; sysdir: string; ok: boolean; abi: string };

/**
 * avdHome 里每台 AVD 的镜像目录（config.ini 的 image.sysdir.1，相对 SDK）和它能不能开机：镜像是这台 Mac 能跑的 ABI，
 * 而且 system.img 在（和 catalog.ts 认已装镜像的规则一样）。数据目录照 avdmanager 的顺序找（avd.ts 的 avdDataDir）；
 * 找不到数据目录、读不到 config.ini 或没写镜像目录的不算设备。
 */
async function avdImages(deps: EnvDeps): Promise<AvdImage[]> {
  const names = (await deps.readdir(deps.avdHome).catch(() => [] as string[])).filter((n) => n.endsWith(".ini")).map((n) => n.slice(0, -4)).sort();
  const list: AvdImage[] = [];
  for (const name of names) {
    const top = await deps.readFile(join(deps.avdHome, `${name}.ini`)).catch(() => "");
    const dir = await avdDataDir(top, deps.userHome, deps.isDir).catch(() => null);
    if (dir === null) continue;
    const config = await deps.readFile(join(dir, "config.ini")).catch(() => null);
    const sysdir = config === null ? undefined : ini(config, "image.sysdir.1")?.replace(/\\/g, "/").replace(/\/+$/, "");
    if (!config || !sysdir) continue;
    const abi = sysdir.slice(sysdir.lastIndexOf("/") + 1);
    const ok = abi === IMAGE_ABI && (await deps.exists(join(deps.sdkRoot, sysdir, "system.img")));
    list.push({ name, label: ini(config, "avd.ini.displayname") || name, sysdir, ok, abi });
  }
  return list;
}

/** 镜像目录 system-images/android-35/google_apis/arm64-v8a 对应的包路径；认不出返回 null。 */
function pkgOf(sysdir: string): string | null {
  const m = /^system-images\/(android-[^/]+)\/([^/]+)\/([^/]+)$/.exec(sysdir);
  return m ? `system-images;${m[1]};${m[2]};${m[3]}` : null;
}

const apiOf = (pkg: string) => /;android-([^;]+);/.exec(pkg)?.[1] ?? "?";

/**
 * 检查这台 Mac 能不能开一台设备：要有 emulator、platform-tools 的 adb，以及至少一台镜像目录还在的 AVD（任何 Android 版本都行）。
 * 不能时只列真缺的：模拟器、adb、系统镜像、设备。SDK 目录不存在不算缺（安装时自己建）。
 */
export async function checkEnv(deps: EnvDeps): Promise<EnvReport> {
  const sdk = deps.sdkRoot;
  const missing: EnvMissing[] = [];
  if (!(await deps.exists(join(sdk, "emulator/emulator")))) {
    missing.push({ id: "emulator", auto: true, ...SIZE.emulator, detail: "没有模拟器程序" });
  }
  if (!(await deps.exists(join(sdk, "platform-tools/adb")))) {
    missing.push({ id: "platform-tools", auto: true, ...SIZE["platform-tools"], detail: "没有 adb" });
  }
  const avds = await avdImages(deps);
  if (!avds.some((a) => a.ok)) {
    const broken = avds.filter((a) => !a.ok);
    const installed = await scanInstalledImages(sdk, deps);
    let autoImage = false;
    if (broken.length > 0) {
      // 有设备，但都开不了机：说清楚哪台缺哪个，装第一台的
      const pkg = pkgOf(broken[0].sysdir);
      autoImage = !!pkg && pkg.endsWith(`;${IMAGE_ABI}`) && manifestUrlFor(pkg) !== null;
      missing.push({
        id: "system-image", auto: autoImage, ...(pkg ? { pkg } : {}), ...(pkg === SYSTEM_IMAGE ? SIZE.defaultImage : SIZE.otherImage),
        detail: broken.map((a) => {
          const img = pkgOf(a.sysdir) ? androidVersion(apiOf(pkgOf(a.sysdir)!)) : a.sysdir;
          return a.abi === IMAGE_ABI ? `设备 ${a.label} 的系统镜像 ${img} 不在了` : `设备 ${a.label} 的系统镜像 ${img} 是 ${a.abi} 的，这台 Mac 跑不了`;
        }).join("；"),
      });
    } else if (installed.length === 0) {
      missing.push({
        id: "system-image", auto: true, pkg: SYSTEM_IMAGE, ...SIZE.defaultImage,
        detail: "没有系统镜像，会装 Android 14",
      });
    }
    // 没有设备，或者设备缺的镜像装不了：建一台（建设备对话框里可以选别的系统版本）
    if (broken.length === 0 || !autoImage) {
      const what = broken.length ? "还没有能启动的模拟器设备" : "还没有模拟器设备";
      missing.push({
        id: "avd", auto: true, diskMb: AVD_DISK_MB,
        detail: installed.length ? `${what}，可以用已装的 ${androidVersion(installed[0].api)} 建一台` : what,
      });
    }
  }
  const [sdkDisk, avdDisk] = await Promise.all([deps.disk(sdk), deps.disk(deps.avdHome)]);
  return {
    ok: missing.length === 0, missing, sdkRoot: sdk, avdHome: deps.avdHome,
    freeMb: sdkDisk.freeMb, avdFreeMb: avdDisk.freeMb, sameDisk: sdkDisk.dev === avdDisk.dev,
  };
}
