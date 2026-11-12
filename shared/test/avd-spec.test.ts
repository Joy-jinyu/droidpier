import { test } from "node:test";
import assert from "node:assert/strict";
import { avdNameError, createItems, defaultAvdName, pickDefaultImage, ramMbFor } from "../avd-spec.ts";
import { spaceCheck } from "../disk-space.ts";
import { parseClientMsg, type SystemImage } from "../protocol.ts";

const img = (api: string, installed: boolean, sizeMb?: number): SystemImage => ({
  pkg: `system-images;android-${api};google_apis;arm64-v8a`, api, apiLevel: Math.floor(Number(api)), tag: "google_apis", installed,
  ...(sizeMb ? { sizeMb, diskMb: sizeMb * 3 } : {}),
});

test("默认设备名：机型名的空格换成下划线，加 _API_<级别>", () => {
  assert.equal(defaultAvdName("Pixel 5", "34"), "Pixel_5_API_34");
  assert.equal(defaultAvdName("Pixel 6 Pro", "36.1"), "Pixel_6_Pro_API_36.1");
  // 不允许的字符去掉
  assert.equal(defaultAvdName('4.65" 720p (Galaxy Nexus)', "30"), "4.65_720p_Galaxy_Nexus_API_30");
  // 开头不是字母数字的去掉，保证默认名能通过校验
  assert.equal(defaultAvdName("(-Test) phone", "30"), "Test_phone_API_30");
});

test("设备名校验：只允许 [A-Za-z0-9._-]，不能空，不能和已有的重名（不分大小写）", () => {
  assert.equal(avdNameError("Pixel_5_API_34", ["emu_web_default"]), null);
  assert.match(avdNameError("", [])!, /输入设备名/);
  assert.match(avdNameError("Pixel 5", [])!, /只能用/);
  assert.match(avdNameError("像素", [])!, /只能用/);
  assert.match(avdNameError("Pixel/5", [])!, /只能用/);
  // 开头是 - 会被 avdmanager 当成选项；开头是 . 或 _ 也不行
  assert.match(avdNameError("-n", [])!, /开头/);
  assert.match(avdNameError(".hidden", [])!, /开头/);
  assert.match(avdNameError("_a", [])!, /开头/);
  assert.equal(avdNameError("9_lives", []), null);
  assert.match(avdNameError("pixel_5_api_34", ["Pixel_5_API_34"])!, /已有同名设备 Pixel_5_API_34/);
});

test("内存：API 28 及以上 4096 MB，低于 28 的镜像 2048 MB", () => {
  assert.equal(ramMbFor(34), 4096);
  assert.equal(ramMbFor(28), 4096);
  assert.equal(ramMbFor(27), 2048);
  assert.equal(ramMbFor(26), 2048);
});

test("默认系统版本：已安装里 API 最高的；没有已安装的就选 android-34", () => {
  assert.equal(pickDefaultImage([img("36", false, 1800), img("29", true), img("33", true), img("34", false, 1500)])?.api, "33");
  assert.equal(pickDefaultImage([img("36", false, 1800), img("34", false, 1500), img("30", false, 1200)])?.api, "34");
  assert.equal(pickDefaultImage([img("36", false, 1800)])?.api, "36");
  assert.equal(pickDefaultImage([]), null);
});

test("创建要的磁盘：镜像已装只算 AVD；没装加上镜像的下载和安装后大小", () => {
  assert.deepEqual(createItems(img("34", true)), [{ id: "avd", diskMb: 12288 }]);
  assert.deepEqual(createItems(img("35", false, 1700)), [{ id: "system-image", sizeMb: 1700, diskMb: 5100 }, { id: "avd", diskMb: 12288 }]);
  // 1700 + 5100 + 12288 + 1024 = 20112，剩 8000 差 12112
  assert.equal(spaceCheck(createItems(img("35", false, 1700)), { freeMb: 8000, avdFreeMb: 8000, sameDisk: true }).shortMb, 12112);
});

test("协议：catalog 和 createAvd", () => {
  assert.deepEqual(parseClientMsg(JSON.stringify({ t: "catalog" })), { t: "catalog" });
  assert.deepEqual(
    parseClientMsg(JSON.stringify({ t: "createAvd", name: "Pixel_5_API_34", device: "pixel_5", image: "system-images;android-34;google_apis;arm64-v8a", x: 1 })),
    { t: "createAvd", name: "Pixel_5_API_34", device: "pixel_5", image: "system-images;android-34;google_apis;arm64-v8a" },
  );
  assert.equal(parseClientMsg(JSON.stringify({ t: "createAvd", name: "a", device: "pixel_5" })), null);
  assert.equal(parseClientMsg(JSON.stringify({ t: "createAvd", name: 1, device: "pixel_5", image: "x" })), null);
});
