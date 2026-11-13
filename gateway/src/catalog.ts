import { access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { pickDefaultImage } from "../../shared/avd-spec.ts";
import type { AvdCatalog, DeviceModel, SystemImage } from "../../shared/protocol.ts";
import { IMAGE_ABI, MANIFEST_HOST } from "./platform.ts";
import { DEVICE_MODELS } from "./avd-create.ts";

const ABI = IMAGE_ABI;
const MIN_API = 26;
/** 已安装镜像的 tag 优先顺序。 */
const TAGS = ["google_apis", "google_apis_playstore", "default"];
const DEFAULT_DEVICE = "pixel_5";

/**
 * 安装后大约占用 = 下载大小 × 3：本机 du 量的 google_apis arm64-v8a 解压后 / zip 大小，
 * android-26 1437/700、android-29 3154/1116、android-34 3055/1536、android-28 2681/817（最大 3.3，余量另算 1 GB）。
 */
const DISK_RATIO = 3;

// API 级别对应的 Android 版本号（developer.android.com 的版本表）
const ANDROID: Record<number, string> = {
  26: "8.0", 27: "8.1", 28: "9", 29: "10", 30: "11", 31: "12", 32: "12L", 33: "13", 34: "14", 35: "15", 36: "16", 37: "17",
};
const versionOf = (apiLevel: number) => (ANDROID[apiLevel] ? { version: `Android ${ANDROID[apiLevel]}` } : {});

/** 镜像目录里的级别（如 "35"、"36.1"）对应的叫法：Android 15；不认识的写 API <级别>。 */
export function androidVersion(api: string): string {
  return versionOf(Math.floor(Number(api))).version ?? `API ${api}`;
}

/** <revision> 里的 major.minor.micro，缺的记 0。 */
function revisionOf(body: string): number[] {
  const rev = /<revision>([\s\S]*?)<\/revision>/.exec(body)?.[1] ?? "";
  return ["major", "minor", "micro"].map((k) => Number(new RegExp(`<${k}>(\\d+)</${k}>`).exec(rev)?.[1] ?? 0));
}

function compareRev(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** 本机能用的完整包大小（字节）：host-os 是 macosx 或没写的 archive 里 <complete> 的 <size>；补丁包的 size 不算。没有返回 null。 */
function macArchiveSize(body: string): number | null {
  for (const a of body.match(/<archive>[\s\S]*?<\/archive>/g) ?? []) {
    const os = /<host-os>(.*?)<\/host-os>/.exec(a)?.[1];
    if (os !== undefined && os !== MANIFEST_HOST.os) continue;
    const size = /<complete>[\s\S]*?<size>(\d+)<\/size>[\s\S]*?<\/complete>/.exec(a)?.[1];
    if (size) return Number(size);
  }
  return null;
}

/**
 * 解析 Google 的系统镜像清单（sys-img2-3.xml）：只取稳定通道的 system-images;android-<级别>;google_apis;arm64-v8a，
 * 级别 26 及以上（36-ext19 这类扩展版、ps16k、x86_64 都不要）；同一个包出现多次取修订号高的。按级别从高到低。
 */
export function parseSysImgManifest(xml: string): SystemImage[] {
  const stable = /<channel id="([^"]+)">stable<\/channel>/.exec(xml)?.[1] ?? "channel-0";
  const best = new Map<string, { rev: number[]; img: SystemImage }>();
  for (const m of xml.matchAll(/<remotePackage path="(system-images;android-(\d+(?:\.\d+)?);google_apis;arm64-v8a)"[^>]*>([\s\S]*?)<\/remotePackage>/g)) {
    const [, pkg, api, body] = m;
    if (/<channelRef ref="([^"]+)"/.exec(body)?.[1] !== stable) continue;
    const apiLevel = Math.floor(Number(api));
    if (apiLevel < MIN_API) continue;
    const bytes = macArchiveSize(body);
    if (bytes === null) continue;
    const rev = revisionOf(body);
    const sizeMb = Math.ceil(bytes / 2 ** 20);
    const img: SystemImage = { pkg, api, apiLevel, tag: "google_apis", installed: false, ...versionOf(apiLevel), sizeMb, diskMb: sizeMb * DISK_RATIO };
    const prev = best.get(pkg);
    if (!prev || compareRev(rev, prev.rev) > 0) best.set(pkg, { rev, img });
  }
  return [...best.values()].map((b) => b.img).sort((a, b) => Number(b.api) - Number(a.api));
}

type Fs = { readdir(dir: string): Promise<string[]>; exists(path: string): Promise<boolean> };

/** 扫描 <sdk>/system-images/android-<级别>/<tag>/arm64-v8a，每个级别取一个 tag（按 TAGS 的顺序），按级别从高到低。 */
export async function scanInstalledImages(sdk: string, fs: Fs): Promise<SystemImage[]> {
  const root = join(sdk, "system-images");
  const dirs = await fs.readdir(root).catch(() => [] as string[]);
  const found: SystemImage[] = [];
  for (const dir of dirs) {
    const api = /^android-(\d+(?:\.\d+)?)$/.exec(dir)?.[1];
    if (!api) continue;
    const apiLevel = Math.floor(Number(api));
    if (apiLevel < MIN_API) continue;
    const tags = await fs.readdir(join(root, dir)).catch(() => [] as string[]);
    for (const tag of TAGS) {
      if (!tags.includes(tag) || !(await fs.exists(join(root, dir, tag, ABI, "system.img")))) continue;
      found.push({ pkg: `system-images;${dir};${tag};${ABI}`, api, apiLevel, tag, installed: true, ...versionOf(apiLevel) });
      break;
    }
  }
  return found.sort((a, b) => Number(b.api) - Number(a.api));
}

export type CatalogDeps = {
  installed(): Promise<SystemImage[]>;
  /** 系统镜像清单的 XML。 */
  manifest(): Promise<string>;
  /** 已有的 AVD 名字。 */
  existing(): Promise<string[]>;
};

/** 组出创建设备对话框的目录：已安装的镜像在前，可下载的去掉已安装的同一个包。 */
export async function buildCatalog(deps: CatalogDeps): Promise<AvdCatalog> {
  const [installed, remote, existing] = await Promise.all([
    deps.installed(),
    deps.manifest().then((x) => ({ list: parseSysImgManifest(x) }), (e: Error) => ({ error: `读取可下载的系统版本失败：${e.message}` })),
    deps.existing(),
  ]);
  const have = new Set(installed.map((i) => i.pkg));
  const images = [...[...installed].sort((a, b) => Number(b.api) - Number(a.api)), ...("list" in remote ? remote.list.filter((i) => !have.has(i.pkg)) : [])];
  const list = DEVICE_MODELS.map(({ id, name, oem }) => ({ id, name, oem }));
  return {
    devices: list,
    images,
    existing,
    defaultDevice: list.find((d) => d.id === DEFAULT_DEVICE)?.id ?? list[0]?.id ?? null,
    defaultImage: pickDefaultImage(images)?.pkg ?? null,
    ...("error" in remote ? { imagesError: remote.error } : {}),
  };
}

/** 真实依赖：扫 SDK 目录、读清单、列 avdHome 里的 .ini。清单读成功一次后就缓存，失败了下次重读。 */
export function realCatalogDeps(opts: { sdkRoot: string; avdHome: string; manifestUrl: string; fetchText(url: string): Promise<string> }): CatalogDeps {
  const exists = (p: string) => access(p).then(() => true, () => false);
  let manifest: Promise<string> | null = null;
  return {
    installed: () => scanInstalledImages(opts.sdkRoot, { readdir: (d) => readdir(d), exists }),
    manifest: () => {
      if (manifest) return manifest;
      const p = opts.fetchText(opts.manifestUrl);
      manifest = p;
      p.catch(() => { if (manifest === p) manifest = null; });
      return p;
    },
    existing: async () => (await readdir(opts.avdHome).catch(() => [] as string[])).filter((n) => n.endsWith(".ini")).map((n) => n.slice(0, -4)),
  };
}
