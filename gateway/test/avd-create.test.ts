import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DEVICE_MODELS, writeAvd } from "../src/avd-create.ts";
import { parseAvdConfig } from "../src/avd.ts";

async function home(t: import("node:test").TestContext) {
  const root = await mkdtemp(join(tmpdir(), "avd-create-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return join(root, "avd");
}

const kv = (text: string) => new Map(text.split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const SPEC = { name: "Pixel_5_API_34", device: "pixel_5", image: "system-images;android-34;google_apis;arm64-v8a", ramMb: 4096 };

test("建设备：写 <name>.ini 和 <name>.avd/config.ini，格式照 avdmanager（AVD 目录不存在时先建）", async (t) => {
  const h = await home(t);
  // h 是 <Android 用户目录>/avd：和 Android Studio 一样再写一个相对用户目录的 path.rel
  await writeAvd(SPEC, h, dirname(h));
  const ini = await readFile(join(h, "Pixel_5_API_34.ini"), "utf8");
  assert.equal(ini, `avd.ini.encoding=UTF-8\npath=${join(h, "Pixel_5_API_34.avd")}\npath.rel=avd/Pixel_5_API_34.avd\ntarget=android-34\n`);
  const config = await readFile(join(h, "Pixel_5_API_34.avd/config.ini"), "utf8");
  const c = kv(config);
  assert.equal(c.get("AvdId"), "Pixel_5_API_34");
  assert.equal(c.get("avd.ini.displayname"), "Pixel 5 API 34");
  assert.equal(c.get("image.sysdir.1"), "system-images/android-34/google_apis/arm64-v8a/");
  assert.equal(c.get("tag.id"), "google_apis");
  assert.equal(c.get("tag.display"), "Google APIs");
  assert.equal(c.get("abi.type"), "arm64-v8a");
  assert.equal(c.get("hw.cpu.arch"), "arm64");
  assert.equal(c.get("hw.device.name"), "pixel_5");
  assert.equal(c.get("hw.device.manufacturer"), "Google");
  assert.equal(c.get("PlayStore.enabled"), "false");
  assert.equal(c.get("hw.keyboard"), "yes");
  assert.equal(c.get("hw.gpu.enabled"), "yes");
  assert.equal(c.get("skin.path"), "_no_skin");
  assert.equal(c.get("skin.name"), "1080x2340");
  // 页面列设备时读的字段（avd.ts 的 parseAvdConfig）
  assert.deepEqual(parseAvdConfig(config), { displayName: "Pixel 5 API 34", width: 1080, height: 2340, ramMb: 4096, apiLevel: 34, abi: "arm64-v8a" });
  assert.equal(c.get("hw.lcd.density"), "440");
  assert.deepEqual((await readdir(h)).sort(), ["Pixel_5_API_34.avd", "Pixel_5_API_34.ini"]);
});

test("AVD 目录不在 Android 用户目录里（ANDROID_AVD_HOME 指到别处）：不写 path.rel", async (t) => {
  const h = await home(t);
  await writeAvd(SPEC, h, join(dirname(h), "user"));
  assert.doesNotMatch(await readFile(join(h, "Pixel_5_API_34.ini"), "utf8"), /path\.rel/);
});

test("<name>.ini 是个指向不存在文件的符号链接（检查时看着像没有）：不覆盖它，也不留下 .avd", async (t) => {
  const h = await home(t);
  await mkdir(h, { recursive: true });
  await symlink(join(h, "nowhere.ini"), join(h, "Pixel_5_API_34.ini"));
  await assert.rejects(writeAvd(SPEC, h, dirname(h)), /EEXIST/);
  assert.equal(await readlink(join(h, "Pixel_5_API_34.ini")), join(h, "nowhere.ini"));
  assert.deepEqual(await readdir(h), ["Pixel_5_API_34.ini"]);
});

test("带小版本的镜像写 target=android-36.1（不是 avdmanager 写坏的 android-0）；Play 商店镜像打开 PlayStore.enabled", async (t) => {
  const h = await home(t);
  await writeAvd({ name: "P9", device: "pixel_9", image: "system-images;android-36.1;google_apis_playstore;arm64-v8a", ramMb: 4096 }, h);
  assert.match(await readFile(join(h, "P9.ini"), "utf8"), /^target=android-36\.1$/m);
  const c = kv(await readFile(join(h, "P9.avd/config.ini"), "utf8"));
  assert.equal(c.get("PlayStore.enabled"), "true");
  assert.equal(c.get("tag.display"), "Google Play");
  assert.equal(c.get("image.sysdir.1"), "system-images/android-36.1/google_apis_playstore/arm64-v8a/");
});

test("已有同名的 .ini 或 .avd 目录：拒绝，不动已有文件", async (t) => {
  const h = await home(t);
  await mkdir(h, { recursive: true });
  await writeFile(join(h, "Pixel_5_API_34.ini"), "mine");
  await assert.rejects(writeAvd(SPEC, h), /已有/);
  assert.equal(await readFile(join(h, "Pixel_5_API_34.ini"), "utf8"), "mine");
  assert.deepEqual(await readdir(h), ["Pixel_5_API_34.ini"]);
  await rm(join(h, "Pixel_5_API_34.ini"));
  await mkdir(join(h, "Pixel_5_API_34.avd"));
  await assert.rejects(writeAvd(SPEC, h), /已有/);
  assert.deepEqual(await readdir(h), ["Pixel_5_API_34.avd"]);
});

test("不认识的机型或镜像路径：拒绝，什么都不写", async (t) => {
  const h = await home(t);
  await assert.rejects(writeAvd({ ...SPEC, device: "tv_4k" }, h), /没有这个机型/);
  await assert.rejects(writeAvd({ ...SPEC, image: "system-images;android-34" }, h), /系统镜像/);
  // 连 AVD 目录都没建
  await assert.rejects(readdir(h), /ENOENT/);
});

test("机型表：只有手机，Pixel 5 在内，每个都有分辨率和密度", () => {
  assert.ok(DEVICE_MODELS.some((d) => d.id === "pixel_5"));
  for (const d of DEVICE_MODELS) {
    assert.ok(d.width > 0 && d.height > d.width && d.density > 0, d.id);
    assert.doesNotMatch(d.id, /tablet|tv|wear|desktop|xr/i);
  }
});
