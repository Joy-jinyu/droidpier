import { test } from "node:test";
import assert from "node:assert/strict";
import { bootLogReason, bootLogHint } from "../src/boot-log.ts";

// 2026-11-12 在本机用 emulator 32.1.14 启动一个指向不存在系统镜像的临时 AVD 得到的输出（路径已换成占位）
const MISSING_IMAGE = `WARNING | /sdk/system-images/android-99/google_apis/arm64-v8a/ is not a valid directory.
WARNING | emulator has searched the above paths but found no valid sdk root directory.
PANIC: Cannot find AVD system path. Please define ANDROID_SDK_ROOT
INFO    | Android emulator version 32.1.14.0 (build_id 10330179) (CL:N/A)
INFO    | AVD Bogus has path /avd/Bogus.avd
INFO    | trying to check whether /sdk is a valid sdk root
`;

test("bootLogReason：优先取 PANIC / FATAL / ERROR 等关键行", () => {
  assert.equal(bootLogReason(MISSING_IMAGE), "PANIC: Cannot find AVD system path. Please define ANDROID_SDK_ROOT");
});

test("bootLogReason：PANIC / FATAL 排在普通 ERROR 前面，最多两行，连续空白压成一个", () => {
  const log = "ERROR   | some noise\nINFO | x\nFATAL   | real cause\nERROR | third\n";
  assert.equal(bootLogReason(log), "FATAL | real cause; ERROR | some noise");
});

test("bootLogReason：cannot / not enough / requires 也算关键行，不分大小写", () => {
  assert.equal(bootLogReason("INFO | a\nThis CANNOT work\nINFO | b\n"), "This CANNOT work");
  assert.equal(bootLogReason("x86_64 emulation currently requires hardware acceleration!\n"), "x86_64 emulation currently requires hardware acceleration!");
});

test("bootLogReason：没有关键行时取最后两行非空行", () => {
  assert.equal(bootLogReason("INFO | one\n\nINFO | two\nINFO | three\n\n"), "INFO | two; INFO | three");
});

test("bootLogReason：空日志返回空串", () => {
  assert.equal(bootLogReason(""), "");
  assert.equal(bootLogReason("\n  \n"), "");
});

test("bootLogReason：超过 300 字截断并加省略号", () => {
  const r = bootLogReason(`PANIC: ${"x".repeat(500)}`);
  assert.equal(r.length, 300);
  assert.ok(r.endsWith("…"));
});

test("bootLogHint：系统镜像没装", () => {
  assert.match(bootLogHint(MISSING_IMAGE) ?? "", /系统镜像/);
  assert.match(bootLogHint("PANIC: Broken AVD system path. Check your ANDROID_SDK_ROOT value [/x]!") ?? "", /系统镜像/);
});

test("bootLogHint：同一个 AVD 已在运行", () => {
  const h = bootLogHint("ERROR | Another emulator instance is running. Please close it or run all emulators with -read-only flag.");
  assert.match(h ?? "", /已经在运行/);
  assert.match(bootLogHint("emulator: ERROR: Running multiple emulators with the same AVD is an experimental feature.") ?? "", /已经在运行/);
});

test("bootLogHint：x86 镜像在 Apple 芯片上跑不了", () => {
  for (const line of [
    "PANIC: x86_64 emulation currently requires hardware acceleration!",
    "PANIC: Avd's CPU Architecture 'x86_64' is not supported by the QEMU2 emulator on aarch64 host.",
    "PANIC: Missing emulator engine program for 'x86' CPU.",
  ]) assert.match(bootLogHint(line) ?? "", /arm64/, line);
});

test("bootLogHint：模拟器版本太旧", () => {
  for (const line of [
    "PANIC: Missing emulator engine program for 'arm64' CPU.",
    "FATAL | This system image requires a newer version of the emulator.",
  ]) assert.match(bootLogHint(line) ?? "", /更新 Android Emulator/, line);
});

test("bootLogHint：磁盘空间不够", () => {
  assert.match(bootLogHint("ERROR | Not enough space to create userdata partition. Available: 100 MB") ?? "", /磁盘空间/);
});

test("bootLogHint：认不出时返回 null", () => {
  assert.equal(bootLogHint("INFO | hello"), null);
});
