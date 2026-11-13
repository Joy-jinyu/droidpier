import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCatalog, parseSysImgManifest, scanInstalledImages, type CatalogDeps } from "../src/catalog.ts";

test("机型：内置的手机表，Pixel 在前，默认 Pixel 5", async () => {
  const c = await buildCatalog(deps());
  assert.deepEqual(c.devices.find((d) => d.id === "pixel_5"), { id: "pixel_5", name: "Pixel 5", oem: "Google" });
  assert.ok(c.devices.slice(0, 3).every((d) => d.id.startsWith("pixel")));
  assert.equal(c.defaultDevice, "pixel_5");
});

// 结构照抄 https://dl.google.com/android/repository/sys-img/google_apis/sys-img2-3.xml（2026-11-12）
const pkg = (path: string, api: string, channel: string, major: number, size: number) => `
  <remotePackage path="${path}">
    <type-details xsi:type="sys-img:sysImgDetailsType">
      <api-level>${api}</api-level>
      <tag><id>${path.split(";")[2]}</id><display>Google APIs</display></tag>
      <abi>${path.split(";")[3]}</abi>
    </type-details>
    <revision><major>${major}</major></revision>
    <display-name>Google APIs ARM 64 v8a System Image</display-name>
    <uses-license ref="android-sdk-arm-dbt-license"/>
    <channelRef ref="${channel}"/>
    <archives>
      <archive><complete><size>${size}</size><checksum type="sha1">2fe8b46d419a3400e30f31b0152b241b50c8b99f</checksum><url>x.zip</url></complete></archive>
    </archives>
  </remotePackage>`;
const MANIFEST = `<?xml version="1.0"?>
<sys-img:sdk-sys-img>
  <channel id="channel-0">stable</channel>
  <channel id="channel-1">beta</channel>
  ${pkg("system-images;android-37.0;google_apis;arm64-v8a", "37.0", "channel-0", 8, 2104098168)}
  ${pkg("system-images;android-36-ext19;google_apis;arm64-v8a", "36", "channel-0", 1, 1868121156)}
  ${pkg("system-images;android-36;google_apis_ps16k;arm64-v8a", "36", "channel-0", 1, 1868121156)}
  ${pkg("system-images;android-36;google_apis;x86_64", "36", "channel-0", 1, 1868121156)}
  ${pkg("system-images;android-36;google_apis;arm64-v8a", "36", "channel-0", 7, 1872691175)}
  ${pkg("system-images;android-35;google_apis;arm64-v8a", "35", "channel-1", 10, 1778933980)}
  ${pkg("system-images;android-34;google_apis;arm64-v8a", "34", "channel-0", 14, 1610393229)}
  ${pkg("system-images;android-25;google_apis;arm64-v8a", "25", "channel-0", 20, 740445031)}
  ${pkg("system-images;android-24;google_apis;arm64-v8a", "24", "channel-0", 27, 1058251660)}
  ${pkg("system-images;android-26;google_apis;arm64-v8a", "26", "channel-0", 2, 700000000)}
  ${pkg("system-images;android-26;google_apis;arm64-v8a", "26", "channel-0", 3, 733331565)}
</sys-img:sdk-sys-img>`;

test("系统镜像清单：只取稳定版 arm64-v8a google_apis、API 26 及以上，带版本名和下载大小", () => {
  const list = parseSysImgManifest(MANIFEST);
  assert.deepEqual(list.map((i) => i.api), ["37.0", "36", "34", "26"]);
  const a34 = list.find((i) => i.api === "34")!;
  assert.deepEqual(a34, {
    pkg: "system-images;android-34;google_apis;arm64-v8a", api: "34", apiLevel: 34, tag: "google_apis", installed: false,
    version: "Android 14", sizeMb: 1536, diskMb: 4608,
  });
  assert.equal(list.find((i) => i.api === "37.0")!.apiLevel, 37);
  // 同一个包出现两次时取修订号高的
  assert.equal(list.find((i) => i.api === "26")!.sizeMb, 700);
});

test("已安装：扫描 system-images，只要 arm64-v8a，tag 先 google_apis，再 google_apis_playstore、default", async () => {
  const tree: Record<string, string[]> = {
    "/sdk/system-images": ["android-34", "android-33", "android-29", "android-25", "android-CANARY", ".DS_Store"],
    "/sdk/system-images/android-34": ["google_apis", "google_apis_playstore"],
    "/sdk/system-images/android-34/google_apis": ["arm64-v8a"],
    "/sdk/system-images/android-34/google_apis_playstore": ["arm64-v8a"],
    "/sdk/system-images/android-33": ["default", "google_apis_playstore"],
    "/sdk/system-images/android-33/default": ["arm64-v8a"],
    "/sdk/system-images/android-33/google_apis_playstore": ["arm64-v8a"],
    "/sdk/system-images/android-29": ["google_apis", "google_apis_playstore"],
    "/sdk/system-images/android-29/google_apis": ["x86_64"],
    "/sdk/system-images/android-29/google_apis_playstore": ["x86_64"],
    "/sdk/system-images/android-25": ["google_apis"],
    "/sdk/system-images/android-25/google_apis": ["arm64-v8a"],
    "/sdk/system-images/android-CANARY": ["google_apis"],
    "/sdk/system-images/android-CANARY/google_apis": ["arm64-v8a"],
  };
  const files = new Set(Object.keys(tree).filter((d) => tree[d].includes("arm64-v8a")).map((d) => `${d}/arm64-v8a/system.img`));
  const list = await scanInstalledImages("/sdk", {
    readdir: async (d) => {
      if (!tree[d]) throw new Error("ENOENT");
      return tree[d];
    },
    exists: async (p) => files.has(p),
  });
  assert.deepEqual(list, [
    { pkg: "system-images;android-34;google_apis;arm64-v8a", api: "34", apiLevel: 34, tag: "google_apis", installed: true, version: "Android 14" },
    { pkg: "system-images;android-33;google_apis_playstore;arm64-v8a", api: "33", apiLevel: 33, tag: "google_apis_playstore", installed: true, version: "Android 13" },
  ]);
});

const deps = (over: Partial<CatalogDeps> = {}): CatalogDeps => ({
  installed: async () => [
    { pkg: "system-images;android-29;google_apis;arm64-v8a", api: "29", apiLevel: 29, tag: "google_apis", installed: true, version: "Android 10" },
    { pkg: "system-images;android-33;google_apis_playstore;arm64-v8a", api: "33", apiLevel: 33, tag: "google_apis_playstore", installed: true, version: "Android 13" },
  ],
  manifest: async () => MANIFEST,
  existing: async () => ["emu_web_default"],
  ...over,
});

test("目录：已安装的在前，可下载的去掉已装的同一个包；默认 pixel_5 和已安装里 API 最高的", async () => {
  const c = await buildCatalog(deps({
    installed: async () => [
      { pkg: "system-images;android-34;google_apis;arm64-v8a", api: "34", apiLevel: 34, tag: "google_apis", installed: true, version: "Android 14" },
      { pkg: "system-images;android-29;google_apis;arm64-v8a", api: "29", apiLevel: 29, tag: "google_apis", installed: true, version: "Android 10" },
    ],
  }));
  assert.deepEqual(c.images.map((i) => `${i.api}${i.installed ? "*" : ""}`), ["34*", "29*", "37.0", "36", "26"]);
  assert.equal(c.defaultDevice, "pixel_5");
  assert.equal(c.defaultImage, "system-images;android-34;google_apis;arm64-v8a");
  assert.deepEqual(c.existing, ["emu_web_default"]);
});

test("目录：没装任何镜像时默认选 android-34", async () => {
  const c = await buildCatalog(deps({ installed: async () => [] }));
  assert.equal(c.defaultImage, "system-images;android-34;google_apis;arm64-v8a");
});

test("目录：清单读不到时只列已安装的并给出原因，机型照常", async () => {
  const c = await buildCatalog(deps({ manifest: async () => { throw new Error("HTTP 503"); } }));
  assert.ok(c.devices.length > 0);
  assert.deepEqual(c.images.map((i) => i.api), ["33", "29"]);
  assert.match(c.imagesError!, /读取可下载的系统版本失败：HTTP 503/);
});

test("系统镜像清单：修订号按 major.minor.micro 比数字；大小取 macosx 或不限系统的 complete 包，不取补丁和别的系统", () => {
  const body = (rev: string, archives: string) => `
  <remotePackage path="system-images;android-33;google_apis;arm64-v8a">
    <type-details xsi:type="sys-img:sysImgDetailsType"><api-level>33</api-level><abi>arm64-v8a</abi></type-details>
    <revision>${rev}</revision>
    <channelRef ref="channel-0"/>
    <archives>${archives}</archives>
  </remotePackage>`;
  const linux = `<archive><complete><size>${5 * 2 ** 20}</size><checksum type="sha1">a</checksum><url>l.zip</url></complete><host-os>linux</host-os></archive>`;
  const mac = (mb: number) => `<archive><patches><patch><based-on><major>1</major></based-on><size>${2 ** 20}</size><url>p.zip</url></patch></patches><complete><size>${mb * 2 ** 20}</size><checksum type="sha1">b</checksum><url>m.zip</url></complete><host-os>macosx</host-os></archive>`;
  const any = (mb: number) => `<archive><complete><size>${mb * 2 ** 20}</size><checksum type="sha1">c</checksum><url>a.zip</url></complete></archive>`;
  const xml = `<channel id="channel-0">stable</channel>
    ${body("<major>3</major><minor>9</minor>", linux + mac(300))}
    ${body("<major>3</major><minor>10</minor>", linux + mac(400))}
    ${body("<major>3</major><minor>10</minor><micro>0</micro>", any(999))}`;
  const [img] = parseSysImgManifest(xml);
  // 3.10 比 3.9 新（按数字比，不按字符串）；3.10.0 和 3.10 一样，不替换先出现的
  assert.equal(img.sizeMb, 400);
  assert.equal(parseSysImgManifest(`<channel id="channel-0">stable</channel>${body("<major>2</major>", any(123))}`)[0].sizeMb, 123);
  assert.equal(parseSysImgManifest(`<channel id="channel-0">stable</channel>${body("<major>2</major>", linux)}`).length, 0);
});
