import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, lstat, readdir, readFile, rename, rm, symlink } from "node:fs/promises";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseAvdConfig, listAvds, renameAvd } from "../src/avd.ts";
import { parseDiscovery } from "../src/discovery.ts";

const fixturesDir = join(import.meta.dirname, "fixtures/avd");

test("parseAvdConfig 解析 Pixel_5_API_34", async () => {
  const text = await readFile(join(fixturesDir, "pixel5-api34.config.ini"), "utf8");
  assert.deepEqual(parseAvdConfig(text), {
    displayName: "Pixel 5 API 34",
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

/** 一台叫 Resizable_Experimental 的 AVD：<avdHome>/<id>.ini 指向它的目录，config 是 config.ini 的内容。 */
async function oneAvd(t: import("node:test").TestContext, config: string) {
  const home = await mkdtemp(join(tmpdir(), "emu-avd-test-"));
  const disc = await mkdtemp(join(tmpdir(), "emu-disc-test-"));
  t.after(() => Promise.all([rm(home, { recursive: true, force: true }), rm(disc, { recursive: true, force: true })]));
  const dir = join(home, "Resizable_Experimental.avd");
  await mkdir(dir);
  await writeFile(join(dir, "config.ini"), config);
  await writeFile(join(home, "Resizable_Experimental.ini"), `path=${dir}\n`);
  const deps = {
    exec: async (cmd: string) => ({ stdout: cmd.includes("-list-avds") ? "Resizable_Experimental\n" : "", stderr: "" }),
    discoveryDir: disc,
    avdHome: home,
  };
  return { deps, configPath: join(dir, "config.ini") };
}

test("renameAvd 改掉已有的 avd.ini.displayname，其他行不动，listAvds 读到新名字", async (t) => {
  const { deps, configPath } = await oneAvd(t, "hw.lcd.width=1080\navd.ini.displayname=Resizable (Experimental)\nhw.lcd.height=2400\n");
  await renameAvd("Resizable_Experimental", "  测试机 A  ", deps);
  assert.equal(await readFile(configPath, "utf8"), "hw.lcd.width=1080\navd.ini.displayname=测试机 A\nhw.lcd.height=2400\n");
  const [avd] = await listAvds(deps);
  assert.equal(avd.name, "Resizable_Experimental");
  assert.equal(avd.displayName, "测试机 A");
});

test("renameAvd 没有 avd.ini.displayname 时加在末尾", async (t) => {
  const { deps, configPath } = await oneAvd(t, "hw.lcd.width=1080");
  await renameAvd("Resizable_Experimental", "测试机", deps);
  assert.equal(await readFile(configPath, "utf8"), "hw.lcd.width=1080\navd.ini.displayname=测试机\n");
});

test("renameAvd 不认识的 id、带换行的名字都拒绝，config.ini 不变", async (t) => {
  const { deps, configPath } = await oneAvd(t, "avd.ini.displayname=旧名字\n");
  await assert.rejects(renameAvd("../Other", "x", deps), /没有这个设备/);
  await assert.rejects(renameAvd("Resizable_Experimental", "a\nhw.ramSize=1", deps), /控制字符/);
  assert.equal(await readFile(configPath, "utf8"), "avd.ini.displayname=旧名字\n");
});

test("renameAvd 只认带 = 的行，重复的 avd.ini.displayname 都换掉", async (t) => {
  const { deps, configPath } = await oneAvd(t, "avd.ini.displaynameX\navd.ini.displayname=A\navd.ini.displayname=B\n");
  await renameAvd("Resizable_Experimental", "C", deps);
  assert.equal(await readFile(configPath, "utf8"), "avd.ini.displaynameX\navd.ini.displayname=C\navd.ini.displayname=C\n");
  assert.equal((await listAvds(deps))[0].displayName, "C");
});

test("renameAvd 不问 adb：adb 卡住时照样改名", async (t) => {
  const { deps, configPath } = await oneAvd(t, "avd.ini.displayname=旧名字\n");
  const exec = async (cmd: string) => (cmd.includes("-list-avds") ? deps.exec(cmd) : new Promise<never>(() => {}));
  await renameAvd("Resizable_Experimental", "新名字", { ...deps, exec });
  assert.equal(await readFile(configPath, "utf8"), "avd.ini.displayname=新名字\n");
});

test("renameAvd 改符号链接指向的文件，链接还在，权限不变，不留临时文件", async (t) => {
  const { deps, configPath } = await oneAvd(t, "avd.ini.displayname=旧名字\n");
  const real = `${configPath}.real`;
  await rename(configPath, real);
  await chmod(real, 0o640);
  await symlink(real, configPath);
  await renameAvd("Resizable_Experimental", "新名字", deps);
  assert.ok((await lstat(configPath)).isSymbolicLink());
  assert.equal(await readFile(real, "utf8"), "avd.ini.displayname=新名字\n");
  assert.equal((await lstat(real)).mode & 0o777, 0o640);
  const left = (await readdir(dirname(configPath))).filter((f) => f.includes("droidpier-"));
  assert.deepEqual(left, []);
});
