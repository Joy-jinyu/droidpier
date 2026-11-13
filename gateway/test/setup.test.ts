import { test } from "node:test";
import assert from "node:assert/strict";
import { checkEnv, SYSTEM_IMAGE, type EnvDeps } from "../src/setup.ts";

const SDK = "/fake/sdk";
const AVD_HOME = "/fake/avd";

/** 假文件系统：files 的键是存在的文件（值是内容），它们的上级目录也存在。 */
function fakeFs(files: Record<string, string>): EnvDeps & { freeAsked: string[] } {
  const all = new Set<string>();
  for (const f of Object.keys(files)) {
    for (let p = f; p && p !== "/"; p = p.slice(0, p.lastIndexOf("/")) || "/") all.add(p);
  }
  const freeAsked: string[] = [];
  return {
    freeAsked,
    sdkRoot: SDK,
    avdHome: AVD_HOME,
    exists: async (p) => all.has(p.replace(/\/+$/, "")),
    disk: async (dir) => {
      freeAsked.push(dir);
      return { freeMb: dir === AVD_HOME ? 7000 : 5000, dev: dir === AVD_HOME ? 2 : 1 };
    },
    readFile: async (p) => {
      if (!(p in files)) throw new Error("ENOENT");
      return files[p];
    },
    readdir: async (dir) => {
      if (!all.has(dir)) throw new Error("ENOENT");
      const prefix = dir + "/";
      return [...new Set([...all].filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length).split("/")[0]))];
    },
  };
}

const TOOLS = { [`${SDK}/emulator/emulator`]: "", [`${SDK}/platform-tools/adb`]: "" };
const image = (api: string, tag = "google_apis", abi = "arm64-v8a") => ({ [`${SDK}/system-images/android-${api}/${tag}/${abi}/system.img`]: "" });
/** avdmanager 写的那种 AVD：<name>.ini 的 path= 指向 <name>.avd，config.ini 里有镜像目录。 */
const avd = (name: string, sysdir: string, opts: { dir?: string; display?: string } = {}) => {
  const dir = opts.dir ?? `${AVD_HOME}/${name}.avd`;
  return {
    [`${AVD_HOME}/${name}.ini`]: `avd.ini.encoding=UTF-8\npath=${dir}\ntarget=android-34\n`,
    [`${dir}/config.ini`]: `AvdId=${name}\n${opts.display ? `avd.ini.displayname=${opts.display}\n` : ""}image.sysdir.1=${sysdir}\n`,
  };
};

test("什么都没有：只列模拟器、adb、系统镜像、设备四项，不再要 SDK 目录、命令行工具和 Java", async () => {
  const r = await checkEnv(fakeFs({}));
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing.map((m) => m.id), ["emulator", "platform-tools", "system-image", "avd"]);
  assert.ok(r.missing.every((m) => m.auto));
  const img = r.missing.find((m) => m.id === "system-image")!;
  assert.equal(img.pkg, SYSTEM_IMAGE);
  assert.equal(SYSTEM_IMAGE, "system-images;android-34;google_apis;arm64-v8a");
  // 页面上的说明短而平白，路径放在“手动安装”里
  assert.deepEqual(r.missing.map((m) => m.detail), ["没有模拟器程序", "没有 adb", "没有系统镜像，会装 Android 14", "还没有模拟器设备"]);
  // 手动安装的说明在页面上（Android Studio 的做法）；不再给要 sdkmanager / avdmanager 和 Java 的命令
  assert.ok(r.missing.every((m) => m.command === undefined));
});

test("齐全：有模拟器、adb，和一台镜像目录还在的设备 → ok，没有缺失项", async () => {
  const r = await checkEnv(fakeFs({ ...TOOLS, ...image("34"), ...avd("Pixel_5", "system-images/android-34/google_apis/arm64-v8a/") }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, []);
  assert.equal(r.sdkRoot, SDK);
  assert.equal(r.avdHome, AVD_HOME);
});

test("只有 Android 16 的镜像和设备：任何版本都算，ok", async () => {
  const r = await checkEnv(fakeFs({ ...TOOLS, ...image("36"), ...avd("Pixel_9_API_36", "system-images/android-36/google_apis/arm64-v8a/") }));
  assert.equal(r.ok, true);
});

test("设备的镜像目录写在 .ini 的 path= 指向的别处，镜像目录不带结尾斜杠也认", async () => {
  const r = await checkEnv(fakeFs({ ...TOOLS, ...image("35", "google_apis_playstore"), ...avd("Mine", "system-images/android-35/google_apis_playstore/arm64-v8a", { dir: "/elsewhere/Mine.avd" }) }));
  assert.equal(r.ok, true);
});

test("已装了 Android 16 的镜像、没有设备：只缺设备，说明会用已装的镜像建，不再下 android-34", async () => {
  const r = await checkEnv(fakeFs({ ...TOOLS, ...image("36") }));
  assert.deepEqual(r.missing.map((m) => m.id), ["avd"]);
  assert.equal(r.missing[0].detail, "还没有模拟器设备，可以用已装的 Android 16 建一台");
});

test("有设备但它的镜像被删了：说哪台设备缺哪个镜像，提供装那个镜像，不列设备项", async () => {
  const r = await checkEnv(fakeFs({ ...TOOLS, ...avd("Pixel_5_API_35", "system-images/android-35/google_apis/arm64-v8a/", { display: "我的 Pixel" }) }));
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing.map((m) => m.id), ["system-image"]);
  const m = r.missing[0];
  assert.equal(m.detail, "设备 我的 Pixel 的系统镜像 Android 15 不在了");
  assert.equal(m.pkg, "system-images;android-35;google_apis;arm64-v8a");
  assert.equal(m.auto, true);
});

test("两台设备，一台缺镜像、一台好的：能启动一台就算齐全", async () => {
  const r = await checkEnv(fakeFs({
    ...TOOLS, ...image("34"),
    ...avd("Old", "system-images/android-30/google_apis/arm64-v8a/"),
    ...avd("Good", "system-images/android-34/google_apis/arm64-v8a/"),
  }));
  assert.equal(r.ok, true);
});

test("几台设备都缺镜像：每台都说，装第一台的镜像；没有显示名时用 id", async () => {
  const r = await checkEnv(fakeFs({
    ...TOOLS,
    ...avd("A", "system-images/android-35/google_apis/arm64-v8a/"),
    ...avd("B", "system-images/android-36.1/google_apis_playstore/arm64-v8a/"),
  }));
  const m = r.missing[0];
  assert.equal(m.detail, "设备 A 的系统镜像 Android 15 不在了；设备 B 的系统镜像 Android 16 不在了");
  assert.equal(m.pkg, "system-images;android-35;google_apis;arm64-v8a");
});

test("缺的镜像不是 arm64-v8a（这台 Mac 跑不了）：不能自动装", async () => {
  const r = await checkEnv(fakeFs({ ...TOOLS, ...avd("X", "system-images/android-29/google_apis_playstore/x86_64/") }));
  assert.equal(r.missing[0].id, "system-image");
  assert.equal(r.missing[0].auto, false);
});

test("设备的 config.ini 读不到或没写镜像目录：当成没有设备", async () => {
  const r = await checkEnv(fakeFs({ ...TOOLS, ...image("34"), [`${AVD_HOME}/Broken.ini`]: "path=/nowhere/Broken.avd\n" }));
  assert.deepEqual(r.missing.map((m) => m.id), ["avd"]);
});

test("只缺 adb：只列 platform-tools，带大小", async () => {
  const r = await checkEnv(fakeFs({ [`${SDK}/emulator/emulator`]: "", ...image("34"), ...avd("P", "system-images/android-34/google_apis/arm64-v8a/") }));
  assert.deepEqual(r.missing.map((m) => m.id), ["platform-tools"]);
  assert.ok(r.missing[0].sizeMb! > 0 && r.missing[0].diskMb! > 0);
});

test("磁盘：分别量 SDK 和 AVD 目录所在的盘（目录还不存在时由 disk 自己往上找）", async () => {
  const fs = fakeFs({});
  const r = await checkEnv(fs);
  assert.deepEqual(fs.freeAsked.sort(), [AVD_HOME, SDK]);
  assert.equal(r.freeMb, 5000);
  assert.equal(r.avdFreeMb, 7000);
  assert.equal(r.sameDisk, false);
});
