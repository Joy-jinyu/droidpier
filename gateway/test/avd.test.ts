import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
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
    exec: async (cmd: string) => {
      if (cmd.includes("-list-avds")) return { stdout: "Pixel_5_API_34\n", stderr: "" };
      if (cmd.includes("devices")) return { stdout: "List of devices attached\nemulator-5554 device\n", stderr: "" };
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
    exec: async (cmd: string) => {
      if (cmd.includes("-list-avds"))
        return { stdout: "INFO: Storing crashdata in /tmp/xyz\nPixel_5_API_34\n", stderr: "" };
      return { stdout: "", stderr: "" };
    },
    discoveryDir: discDir,
    avdHome: tmpBase,
  });

  assert.equal(avds.length, 1);
  assert.equal(avds[0].name, "Pixel_5_API_34");
});
