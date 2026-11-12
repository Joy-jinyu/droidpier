import { test } from "node:test";
import assert from "node:assert/strict";
import { spaceCheck } from "../disk-space.ts";

const same = (freeMb: number) => ({ freeMb, avdFreeMb: freeMb, sameDisk: true });

test("spaceCheck：需要 = 下载 + 安装后占用 + 1 GB 余量；够用时 shortMb 为 0", () => {
  const r = spaceCheck([{ id: "system-image", sizeMb: 1500, diskMb: 3072 }, { id: "avd", diskMb: 12288 }, { id: "sdk" }], same(30000));
  assert.deepEqual(r, { downloadMb: 1500, diskMb: 15360, needMb: 1500 + 15360 + 1024, shortMb: 0 });
});

test("spaceCheck：不够时 shortMb 是还差多少", () => {
  const r = spaceCheck([{ id: "system-image", sizeMb: 1500, diskMb: 3072 }], same(4000));
  assert.equal(r.needMb, 5596);
  assert.equal(r.shortMb, 1596);
});

test("spaceCheck：SDK 和 AVD 在两块盘上，各算各的", () => {
  const items = [{ id: "system-image", sizeMb: 1500, diskMb: 3072 }, { id: "avd", diskMb: 12288 }];
  // SDK 盘够，AVD 盘差 1024 + 12288 - 10000
  assert.equal(spaceCheck(items, { freeMb: 6000, avdFreeMb: 10000, sameDisk: false }).shortMb, 3312);
  // 两块都不够时取差得多的那块
  assert.equal(spaceCheck(items, { freeMb: 1000, avdFreeMb: 13000, sameDisk: false }).shortMb, 4596);
});
