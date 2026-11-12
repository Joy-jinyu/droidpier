import { test } from "node:test";
import assert from "node:assert/strict";
import { checkEnv, SYSTEM_IMAGE, type EnvDeps } from "../src/setup.ts";

const SDK = "/fake/sdk";
const AVD_HOME = "/fake/avd";
const freeAsked: string[] = [];

/** 假文件系统：files 里列出的路径存在，它们的上级目录也存在。 */
function fakeFs(files: string[], contents: Record<string, string> = {}, java: string | null = "/jdk"): EnvDeps {
  const all = new Set<string>();
  for (const f of files) {
    let p = f;
    while (p && p !== "/") {
      all.add(p);
      p = p.slice(0, p.lastIndexOf("/")) || "/";
    }
  }
  return {
    sdkRoot: SDK,
    avdHome: AVD_HOME,
    exists: async (p) => all.has(p),
    disk: async (dir) => {
      freeAsked.push(dir);
      return { freeMb: dir === AVD_HOME ? 7000 : 5000, dev: dir === AVD_HOME ? 2 : 1 };
    },
    findJava: async () => java,
    readFile: async (p) => {
      if (!all.has(p)) throw new Error("ENOENT");
      return contents[p] ?? "";
    },
    readdir: async (dir) => {
      if (!all.has(dir)) throw new Error("ENOENT");
      const prefix = dir + "/";
      return [...new Set([...all].filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length).split("/")[0]))];
    },
  };
}

const FULL = [
  `${SDK}/cmdline-tools/latest/bin/sdkmanager`,
  `${SDK}/cmdline-tools/latest/bin/avdmanager`,
  `${SDK}/emulator/emulator`,
  `${SDK}/platform-tools/adb`,
  `${SDK}/system-images/android-34/google_apis/arm64-v8a/system.img`,
  `${AVD_HOME}/Pixel_5.ini`,
];

test("什么都没有：missing 第一项是 sdk，后面按顺序全缺", async () => {
  const r = await checkEnv(fakeFs([]));
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing.map((m) => m.id), ["sdk", "cmdline-tools", "emulator", "platform-tools", "system-image", "avd"]);
  assert.equal(r.javaHome, "/jdk");
  assert.ok(r.missing.every((m) => m.auto));
});

test("只缺系统镜像：command 是 sdkmanager \"<镜像>\"，sizeMb 是 1500", async () => {
  const r = await checkEnv(fakeFs(FULL.filter((f) => !f.includes("system-images"))));
  assert.equal(r.ok, false);
  assert.equal(r.missing.length, 1);
  const m = r.missing[0];
  assert.equal(m.id, "system-image");
  assert.equal(m.command, `sdkmanager "${SYSTEM_IMAGE}"`);
  assert.equal(SYSTEM_IMAGE, "system-images;android-34;google_apis;arm64-v8a");
  assert.equal(m.sizeMb, 1500);
});

test("Android Studio 自带的 SDK 没有 cmdline-tools：只缺 cmdline-tools，说明它是什么", async () => {
  const r = await checkEnv(fakeFs(FULL.filter((f) => !f.includes("cmdline-tools"))));
  assert.deepEqual(r.missing.map((m) => m.id), ["cmdline-tools"]);
  assert.equal(r.missing[0].sizeMb, 150);
  assert.match(r.missing[0].detail, /sdkmanager/);
});

test("齐全：ok 为 true，missing 为空数组", async () => {
  const r = await checkEnv(fakeFs(FULL));
  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, []);
});

test("AVD 目录里没有 .ini：缺 avd", async () => {
  const r = await checkEnv(fakeFs(FULL.filter((f) => !f.endsWith(".ini")).concat(`${AVD_HOME}/notes.txt`)));
  assert.deepEqual(r.missing.map((m) => m.id), ["avd"]);
});

test("已有的 cmdline-tools 是 23 及以上（Android CLI 包装）：照常使用，标出来给确认框提示", async () => {
  const props = `${SDK}/cmdline-tools/latest/source.properties`;
  const r23 = await checkEnv(fakeFs([...FULL, props], { [props]: "Pkg.Revision=23.0\nPkg.Path=cmdline-tools;23.0\n" }));
  assert.equal(r23.ok, true);
  assert.equal(r23.androidCli, true);
  const r22 = await checkEnv(fakeFs([...FULL, props], { [props]: "Pkg.Revision=22.0\n" }));
  assert.equal(r22.androidCli, false);
});

test("每项带安装后占用 diskMb，报告 SDK 目录所在磁盘的剩余空间", async () => {
  freeAsked.length = 0;
  const r = await checkEnv(fakeFs([]));
  const disk = Object.fromEntries(r.missing.map((m) => [m.id, m.diskMb]));
  assert.equal(disk["system-image"], 3072);
  assert.equal(disk.emulator, 1200);
  assert.equal(disk.avd, 12288);
  assert.equal(r.freeMb, 5000);
  assert.equal(r.avdFreeMb, 7000);
  assert.equal(r.sameDisk, false);
  assert.deepEqual(freeAsked.sort(), [AVD_HOME, SDK]);
});

test("没有 Java、又缺要 sdkmanager / avdmanager 的项：第一项是 java，不能自动装，说明怎么办", async () => {
  const r = await checkEnv(fakeFs(FULL.filter((f) => !f.includes("system-images")), {}, null));
  assert.deepEqual(r.missing.map((m) => m.id), ["java", "system-image"]);
  assert.equal(r.missing[0].auto, false);
  assert.equal(r.missing[0].detail, "需要 Java 才能运行 sdkmanager：安装 Android Studio（自带 Java）或安装 JDK 17 以上，然后重新打开页面");
  assert.equal(r.javaHome, null);
});

test("没有 Java 但什么都不缺：不报 java", async () => {
  const r = await checkEnv(fakeFs(FULL, {}, null));
  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, []);
});

test("cmdline-tools 缺失项：说明页面会装 22.0、给出手动命令，不再引导去装 latest", async () => {
  const r = await checkEnv(fakeFs(FULL.filter((f) => !f.includes("cmdline-tools"))));
  const m = r.missing[0];
  assert.doesNotMatch(m.detail, /latest\)/);
  assert.match(m.detail, /22\.0/);
  assert.match(m.command ?? "", /commandlinetools-mac_arm64-.*\.zip/);
  assert.match(m.command ?? "", /cmdline-tools\/latest/);
});
