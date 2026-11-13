import { access, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AvdSpec, DeviceModel } from "../../shared/protocol.ts";

/** 创建设备对话框里的一个机型和它的屏幕：分辨率（像素）、密度（dpi）。 */
export type DeviceDef = DeviceModel & { width: number; height: number; density: number };

/**
 * 内置的手机机型表，取代 `avdmanager list device`：值照 Android Studio 自带的设备定义（devices.xml 里的
 * screen-x / screen-y / pixel-density）。Pixel 在前，新的在上。
 */
export const DEVICE_MODELS: DeviceDef[] = [
  { id: "pixel_9_pro_xl", name: "Pixel 9 Pro XL", oem: "Google", width: 1344, height: 2992, density: 480 },
  { id: "pixel_9_pro", name: "Pixel 9 Pro", oem: "Google", width: 1280, height: 2856, density: 480 },
  { id: "pixel_9", name: "Pixel 9", oem: "Google", width: 1080, height: 2424, density: 420 },
  { id: "pixel_9a", name: "Pixel 9a", oem: "Google", width: 1080, height: 2424, density: 420 },
  { id: "pixel_8_pro", name: "Pixel 8 Pro", oem: "Google", width: 1344, height: 2992, density: 480 },
  { id: "pixel_8", name: "Pixel 8", oem: "Google", width: 1080, height: 2400, density: 420 },
  { id: "pixel_8a", name: "Pixel 8a", oem: "Google", width: 1080, height: 2400, density: 420 },
  { id: "pixel_7_pro", name: "Pixel 7 Pro", oem: "Google", width: 1440, height: 3120, density: 560 },
  { id: "pixel_7", name: "Pixel 7", oem: "Google", width: 1080, height: 2400, density: 420 },
  { id: "pixel_7a", name: "Pixel 7a", oem: "Google", width: 1080, height: 2400, density: 420 },
  { id: "pixel_6_pro", name: "Pixel 6 Pro", oem: "Google", width: 1440, height: 3120, density: 560 },
  { id: "pixel_6", name: "Pixel 6", oem: "Google", width: 1080, height: 2400, density: 420 },
  { id: "pixel_6a", name: "Pixel 6a", oem: "Google", width: 1080, height: 2400, density: 420 },
  { id: "pixel_5", name: "Pixel 5", oem: "Google", width: 1080, height: 2340, density: 440 },
  { id: "pixel_4a", name: "Pixel 4a", oem: "Google", width: 1080, height: 2340, density: 440 },
  { id: "pixel_4_xl", name: "Pixel 4 XL", oem: "Google", width: 1440, height: 3040, density: 560 },
  { id: "pixel_4", name: "Pixel 4", oem: "Google", width: 1080, height: 2280, density: 440 },
  { id: "pixel_3a_xl", name: "Pixel 3a XL", oem: "Google", width: 1080, height: 2160, density: 400 },
  { id: "pixel_3a", name: "Pixel 3a", oem: "Google", width: 1080, height: 2220, density: 440 },
  { id: "pixel_3_xl", name: "Pixel 3 XL", oem: "Google", width: 1440, height: 2960, density: 560 },
  { id: "pixel_3", name: "Pixel 3", oem: "Google", width: 1080, height: 2160, density: 440 },
  { id: "pixel_2_xl", name: "Pixel 2 XL", oem: "Google", width: 1440, height: 2880, density: 560 },
  { id: "pixel_2", name: "Pixel 2", oem: "Google", width: 1080, height: 1920, density: 420 },
  { id: "pixel_xl", name: "Pixel XL", oem: "Google", width: 1440, height: 2560, density: 560 },
  { id: "pixel", name: "Pixel", oem: "Google", width: 1080, height: 1920, density: 420 },
  { id: "medium_phone", name: "Medium Phone", oem: "Generic", width: 1080, height: 2400, density: 420 },
  { id: "small_phone", name: "Small Phone", oem: "Generic", width: 720, height: 1280, density: 320 },
];

/** 镜像 tag 在 config.ini 里的显示名（avdmanager 从镜像的 source.properties 读到的同一个值）。 */
const TAG_DISPLAY: Record<string, string> = {
  google_apis: "Google APIs",
  google_apis_playstore: "Google Play",
  default: "Default Android System Image",
};

const CPU_ARCH: Record<string, string> = { "arm64-v8a": "arm64", x86_64: "x86_64" };

/**
 * config.ini 的内容：键和取值照 avdmanager / Android Studio 建的设备（gateway/test/fixtures/avd/pixel5-api34.config.ini），
 * 不带皮肤（skin.path=_no_skin，页面自己画机身），按键名排序。
 */
function configIni(spec: AvdSpec, model: DeviceDef, image: { dir: string; tag: string; abi: string; api: string }): string {
  const kv: Record<string, string> = {
    AvdId: spec.name,
    "PlayStore.enabled": String(image.tag === "google_apis_playstore"),
    "abi.type": image.abi,
    "avd.ini.displayname": spec.name.replace(/_/g, " "),
    "avd.ini.encoding": "UTF-8",
    "disk.dataPartition.size": "6G",
    "fastboot.chosenSnapshotFile": "",
    "fastboot.forceChosenSnapshotBoot": "no",
    "fastboot.forceColdBoot": "no",
    "fastboot.forceFastBoot": "yes",
    "hw.accelerometer": "yes",
    "hw.arc": "false",
    "hw.audioInput": "yes",
    "hw.battery": "yes",
    "hw.camera.back": "virtualscene",
    "hw.camera.front": "emulated",
    "hw.cpu.arch": CPU_ARCH[image.abi] ?? image.abi,
    "hw.cpu.ncore": "4",
    "hw.dPad": "no",
    "hw.device.manufacturer": model.oem,
    "hw.device.name": model.id,
    "hw.gps": "yes",
    "hw.gpu.enabled": "yes",
    "hw.gpu.mode": "auto",
    "hw.initialOrientation": "Portrait",
    "hw.keyboard": "yes",
    "hw.lcd.density": String(model.density),
    "hw.lcd.height": String(model.height),
    "hw.lcd.width": String(model.width),
    "hw.mainKeys": "no",
    "hw.ramSize": String(spec.ramMb),
    "hw.sdCard": "yes",
    "hw.sensors.orientation": "yes",
    "hw.sensors.proximity": "yes",
    "hw.trackBall": "no",
    "image.sysdir.1": `${image.dir}/`,
    "runtime.network.latency": "none",
    "runtime.network.speed": "full",
    "sdcard.size": "512M",
    showDeviceFrame: "no",
    "skin.dynamic": "yes",
    "skin.name": `${model.width}x${model.height}`,
    "skin.path": "_no_skin",
    "tag.display": TAG_DISPLAY[image.tag] ?? image.tag,
    "tag.id": image.tag,
  };
  return Object.entries(kv).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
}

const exists = (p: string) => access(p).then(() => true, () => false);

/**
 * 不用 avdmanager 建一台 AVD：写 <avdHome>/<name>.avd/config.ini 和 <avdHome>/<name>.ini（path、target，和 avdmanager 一样）。
 * 先在临时目录写好再换过去，出错不会留下半台设备；同名的 .ini 或 .avd 已存在时不动它们。名字的规则由调用方（avdNameError）查。
 */
export async function writeAvd(spec: AvdSpec, avdHome: string): Promise<void> {
  const model = DEVICE_MODELS.find((d) => d.id === spec.device);
  if (!model) throw new Error(`没有这个机型：${spec.device}`);
  const m = /^system-images;(android-[^;]+);([^;]+);([^;]+)$/.exec(spec.image);
  if (!m) throw new Error(`不认识的系统镜像：${spec.image}`);
  const [, api, tag, abi] = m;
  const avdDir = join(avdHome, `${spec.name}.avd`);
  const iniPath = join(avdHome, `${spec.name}.ini`);
  await mkdir(avdHome, { recursive: true });
  if ((await exists(avdDir)) || (await exists(iniPath))) throw new Error(`已有设备文件 ${spec.name}.ini 或 ${spec.name}.avd`);
  const suffix = `.droidpier-${process.pid}-${Date.now()}`;
  const tmpDir = join(avdHome, `.${spec.name}.avd${suffix}`);
  const tmpIni = join(avdHome, `.${spec.name}.ini${suffix}`);
  let moved = false;
  try {
    await mkdir(tmpDir);
    await writeFile(join(tmpDir, "config.ini"), configIni(spec, model, { dir: `system-images/${api}/${tag}/${abi}`, tag, abi, api }));
    // target 用镜像目录名（android-34、android-36.1），见 avd.ts 的 repairAvdTarget
    await writeFile(tmpIni, `avd.ini.encoding=UTF-8\npath=${avdDir}\ntarget=${api}\n`);
    await rename(tmpDir, avdDir);
    moved = true;
    await rename(tmpIni, iniPath);
  } catch (e) {
    await rm(moved ? avdDir : tmpDir, { recursive: true, force: true });
    await rm(tmpIni, { force: true });
    throw e;
  }
}
