import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, readFile, rm } from "node:fs/promises";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAvdConfig, listAvds } from "../src/avd.ts";
import { parseDiscovery } from "../src/discovery.ts";

const fixturesDir = join(import.meta.dirname, "fixtures/avd");

test("parseAvdConfig 解析 Pixel_5_API_34", async () => {
  const text = await readFile(join(fixturesDir, "pixel5-api34.config.ini"), "utf8");
  assert.deepEqual(parseAvdConfig(text), {
    width: 1080,
    height: 2340,
    ramMb: 4096,
    apiLevel: 34,
    abi: "arm64-v8a",
  });
});

test("parseAvdConfig hw.ramSize=2G 解析成 2048", () => {
  assert.deepEqual(parseAvdConfig("hw.ramSize=2G\n"), { ramMb: 2048 });
});

test("parseAvdConfig 缺字段时只返回存在的字段，不抛错", async () => {
  const text = await readFile(join(fixturesDir, "missing-fields.config.ini"), "utf8");
  assert.deepEqual(parseAvdConfig(text), { width: 1080, abi: "x86_64" });
});

test("parseDiscovery 能读出 avd.name", () => {
  const d = parseDiscovery("port.serial=5554\ngrpc.port=8554\navd.name=Pixel_5_API_34\n");
  assert.equal(d.avdName, "Pixel_5_API_34");
});

test("listAvds 合并运行状态：正在运行的 AVD 显示 grpc 并带 grpcPort", async (t) => {
  // 准备临时 avdHome：一个带 config.ini 的 AVD
  const tmpBase = await mkdtemp(join(tmpdir(), "emu-avd-test-"));
  const discDir = await mkdtemp(join(tmpdir(), "emu-disc-test-"));
  t.after(() => Promise.all([rm(tmpBase, { recursive: true, force: true }), rm(discDir, { recursive: true, force: true })]));

  const avdDir = join(tmpBase, "Pixel_5_API_34.avd");
  await mkdir(avdDir);
  await writeFile(
    join(avdDir, "config.ini"),
    "hw.lcd.width=1080\nhw.lcd.height=2340\nhw.ramSize=4096\nabi.type=arm64-v8a\nimage.sysdir.1=system-images/android-34/google_apis/arm64-v8a/\n"
  );
  // <avdHome>/<name>.ini 用于路径解析
  await writeFile(join(tmpBase, "Pixel_5_API_34.ini"), `path=${avdDir}\n`);

  // 用当前进程 pid（肯定活着）
  const pid = process.pid;
  await writeFile(
    join(discDir, `pid_${pid}.ini`),
    `port.serial=5554\ngrpc.port=8554\navd.name=Pixel_5_API_34\n`
  );

  const avds = await listAvds({
    exec: async (_file: string, args: string[]) => {
      if (args.includes("-list-avds")) return { stdout: "Pixel_5_API_34\n", stderr: "" };
      if (args.includes("devices")) return { stdout: "List of devices attached\nemulator-5554 device\n", stderr: "" };
      return { stdout: "", stderr: "" };
    },
    discoveryDir: discDir,
    avdHome: tmpBase,
  });

  assert.equal(avds.length, 1);
  const avd = avds[0];
  assert.equal(avd.name, "Pixel_5_API_34");
  assert.equal(avd.running, "grpc");
  assert.equal(avd.grpcPort, 8554);
  assert.equal(avd.serial, 5554);
  assert.equal(avd.width, 1080);
  assert.equal(avd.apiLevel, 34);
});

test("listAvds emulator -list-avds 有 INFO 行时过滤掉", async (t) => {
  const tmpBase = await mkdtemp(join(tmpdir(), "emu-avd-test-"));
  const discDir = await mkdtemp(join(tmpdir(), "emu-disc-test-"));
  t.after(() => Promise.all([rm(tmpBase, { recursive: true, force: true }), rm(discDir, { recursive: true, force: true })]));

  const avds = await listAvds({
    exec: async (_file: string, args: string[]) => {
      if (args.includes("-list-avds"))
        return { stdout: "INFO: Storing crashdata in /tmp/xyz\nPixel_5_API_34\n", stderr: "" };
      return { stdout: "", stderr: "" };
    },
    discoveryDir: discDir,
    avdHome: tmpBase,
  });

  assert.equal(avds.length, 1);
  assert.equal(avds[0].name, "Pixel_5_API_34");
});

test("listAvds SDK 路径带空格（比如装在名字带空格的外置盘上）时也能列出 AVD", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "emu avd sdk-"));
  const sdk = join(base, "Android SDK");
  const avdHome = join(base, "avd");
  const discDir = join(base, "running");
  t.after(() => rm(base, { recursive: true, force: true }));
  await mkdir(join(sdk, "emulator"), { recursive: true });
  await mkdir(join(sdk, "platform-tools"), { recursive: true });
  await mkdir(avdHome);
  await mkdir(discDir);
  await writeFile(join(sdk, "emulator/emulator"), "#!/bin/sh\n[ \"$1\" = -list-avds ] && echo Pixel_5_API_34\n");
  await writeFile(join(sdk, "platform-tools/adb"), "#!/bin/sh\nprintf 'List of devices attached\\nemulator-5554\\tdevice\\n'\n");
  await chmod(join(sdk, "emulator/emulator"), 0o755);
  await chmod(join(sdk, "platform-tools/adb"), 0o755);
  // 没开 gRPC 的运行中模拟器：只有 adb devices 读到了串口，才会报成 no-grpc
  await writeFile(join(discDir, `pid_${process.pid}.ini`), "port.serial=5554\navd.name=Pixel_5_API_34\n");
  const saved = process.env.ANDROID_HOME;
  process.env.ANDROID_HOME = sdk;
  t.after(() => {
    if (saved === undefined) delete process.env.ANDROID_HOME;
    else process.env.ANDROID_HOME = saved;
  });

  const avds = await listAvds({ discoveryDir: discDir, avdHome });

  assert.deepEqual(avds.map((a) => [a.name, a.running, a.serial]), [["Pixel_5_API_34", "no-grpc", 5554]]);
});
