import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, lstat, readdir, readFile, rename, rm, symlink } from "node:fs/promises";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { parseAvdConfig, listAvds, renameAvd, repairAvdTarget, deleteAvd } from "../src/avd.ts";
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

test("listAvds 认出显示名和 id 不同的运行中 AVD（发现文件按 avd.id 对上）", async (t) => {
  const tmpBase = await mkdtemp(join(tmpdir(), "emu-avd-test-"));
  const discDir = await mkdtemp(join(tmpdir(), "emu-disc-test-"));
  t.after(() => Promise.all([rm(tmpBase, { recursive: true, force: true }), rm(discDir, { recursive: true, force: true })]));
  await writeFile(
    join(discDir, `pid_${process.pid}.ini`),
    "port.serial=5554\ngrpc.port=8554\navd.id=Resizable_Experimental\navd.name=Resizable (Experimental)\n",
  );

  const avds = await listAvds({
    exec: async (_file: string, args: string[]) => {
      if (args.includes("-list-avds")) return { stdout: "Resizable_Experimental\n", stderr: "" };
      return { stdout: "List of devices attached\nemulator-5554 device\n", stderr: "" };
    },
    discoveryDir: discDir,
    avdHome: tmpBase,
  });

  assert.equal(avds[0].running, "grpc");
  assert.equal(avds[0].serial, 5554);
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
    exec: async (_file: string, args: string[]) => ({ stdout: args.includes("-list-avds") ? "Resizable_Experimental\n" : "", stderr: "" }),
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
  const exec = async (file: string, args: string[]) => (args.includes("-list-avds") ? deps.exec(file, args) : new Promise<never>(() => {}));
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

/** 一台 target 写坏的 AVD：<avdHome>/<id>.ini 的 target 行是 target，config.ini 的镜像目录是 sysdir。 */
async function brokenTarget(t: import("node:test").TestContext, target: string, sysdir: string) {
  const { deps } = await oneAvd(t, `abi.type = arm64-v8a\nimage.sysdir.1 = ${sysdir}\n`);
  const iniPath = join(deps.avdHome, "Resizable_Experimental.ini");
  await writeFile(iniPath, `avd.ini.encoding=UTF-8\npath=${join(deps.avdHome, "Resizable_Experimental.avd")}\npath.rel=avd/Resizable_Experimental.avd\n${target}\n`);
  return { deps, iniPath };
}

test("repairAvdTarget 把 target=android-0 按 config.ini 的镜像目录改成 android-36.1，其他行不动", async (t) => {
  const { deps, iniPath } = await brokenTarget(t, "target=android-0", "system-images/android-36.1/google_apis_playstore/arm64-v8a/");
  assert.equal(await repairAvdTarget("Resizable_Experimental", deps), "android-36.1");
  const ini = await readFile(iniPath, "utf8");
  assert.match(ini, /^target=android-36\.1$/m);
  assert.doesNotMatch(ini, /android-0/);
  assert.match(ini, /^path\.rel=avd\/Resizable_Experimental\.avd$/m);
});

test("repairAvdTarget 对正常的 target 和认不出的镜像目录什么都不改", async (t) => {
  const ok = await brokenTarget(t, "target=android-35", "system-images/android-36.1/google_apis/arm64-v8a/");
  const before = await readFile(ok.iniPath, "utf8");
  assert.equal(await repairAvdTarget("Resizable_Experimental", ok.deps), null);
  assert.equal(await readFile(ok.iniPath, "utf8"), before);

  const odd = await brokenTarget(t, "target=android-0", "somewhere/else/");
  const oddBefore = await readFile(odd.iniPath, "utf8");
  assert.equal(await repairAvdTarget("Resizable_Experimental", odd.deps), null);
  assert.equal(await readFile(odd.iniPath, "utf8"), oddBefore);
});

test("repairAvdTarget 没有这台 AVD 的 .ini 时返回 null，不抛错", async (t) => {
  const { deps } = await oneAvd(t, "");
  assert.equal(await repairAvdTarget("Nope", deps), null);
});

test("repairAvdTarget 认 = 两边的空格和 CRLF 换行，只改 target 那一行，换行风格不变", async (t) => {
  const { deps, iniPath } = await brokenTarget(t, "target = android-0", "system-images/android-36.1/google_apis/arm64-v8a/");
  await writeFile(iniPath, "avd.ini.encoding=UTF-8\r\ntarget = android-0\r\n\r\npath.rel=avd/Resizable_Experimental.avd\r\n");
  assert.equal(await repairAvdTarget("Resizable_Experimental", deps), "android-36.1");
  assert.equal(await readFile(iniPath, "utf8"), "avd.ini.encoding=UTF-8\r\ntarget=android-36.1\r\n\r\npath.rel=avd/Resizable_Experimental.avd\r\n");
});

test("repairAvdTarget 也认反斜杠分隔的镜像目录", async (t) => {
  const { deps, iniPath } = await brokenTarget(t, "target=android-0", "system-images\\android-36.1\\google_apis\\arm64-v8a\\");
  assert.equal(await repairAvdTarget("Resizable_Experimental", deps), "android-36.1");
  assert.match(await readFile(iniPath, "utf8"), /^target=android-36\.1$/m);
});

/** 删除用的临时目录：userHome（相当于 ~/.android）下的 avd 是 avdHome，里面两台 AVD（A 要删、B 留着）；outside 在 avdHome 外。 */
async function twoAvds(t: import("node:test").TestContext) {
  const userHome = await mkdtemp(join(tmpdir(), "emu-user-del-"));
  const home = join(userHome, "avd");
  await mkdir(home);
  const disc = await mkdtemp(join(tmpdir(), "emu-disc-del-"));
  const outside = await mkdtemp(join(tmpdir(), "emu-outside-"));
  t.after(() => Promise.all([userHome, disc, outside].map((d) => rm(d, { recursive: true, force: true }))));
  for (const n of ["A", "B"]) {
    await mkdir(join(home, `${n}.avd`));
    await writeFile(join(home, `${n}.avd`, "config.ini"), `avd.ini.displayname=${n}\n`);
    await writeFile(join(home, `${n}.ini`), `avd.ini.encoding=UTF-8\npath=${join(home, `${n}.avd`)}\npath.rel=avd/${n}.avd\ntarget=android-34\n`);
  }
  await writeFile(join(outside, "keep.txt"), "x");
  const deps = {
    exec: async (_file: string, args: string[]) => ({ stdout: args.includes("-list-avds") ? "A\nB\n" : "", stderr: "" }),
    discoveryDir: disc,
    avdHome: home,
    userHome,
    // 4242–4244 当作活着的模拟器进程，其余都不在
    alive: (pid: number) => pid >= 4242 && pid <= 4244,
  };
  return { home, disc, outside, deps };
}

const exists = (p: string) => lstat(p).then(() => true, () => false);

test("deleteAvd 删掉 <name>.ini 和它的 .avd 目录，别的 AVD 不动", async (t) => {
  const { home, deps } = await twoAvds(t);
  await deleteAvd("A", deps);
  assert.equal(await exists(join(home, "A.ini")), false);
  assert.equal(await exists(join(home, "A.avd")), false);
  assert.equal(await exists(join(home, "B.ini")), true);
  assert.equal(await exists(join(home, "B.avd", "config.ini")), true);
});

test("deleteAvd path= 不是目录时按 path.rel（相对 ~/.android）找目录", async (t) => {
  const { home, deps } = await twoAvds(t);
  await writeFile(join(home, "A.ini"), `path=${join(home, "gone.avd")}\npath.rel=avd/A.avd\n`);
  await deleteAvd("A", deps);
  assert.equal(await exists(join(home, "A.avd")), false);
  assert.equal(await exists(join(home, "A.ini")), false);
});

test("deleteAvd path= 缺失、path.rel 指到别的 AVD 或 avdHome 外时拒绝，什么都不删", async (t) => {
  const { home, outside, deps } = await twoAvds(t);
  for (const rel of ["avd/B.avd", relative(dirname(home), outside)]) {
    await writeFile(join(home, "A.ini"), `path.rel=${rel}\n`);
    await assert.rejects(deleteAvd("A", deps));
    assert.equal(await exists(join(home, "A.ini")), true, rel);
  }
  assert.equal(await exists(join(home, "B.avd", "config.ini")), true);
  assert.equal(await exists(join(outside, "keep.txt")), true);
});

test("deleteAvd path= 和 path.rel 都不是目录时只删 .ini", async (t) => {
  const { home, deps } = await twoAvds(t);
  await writeFile(join(home, "A.ini"), `path=${join(home, "gone.avd")}\npath.rel=avd/gone.avd\n`);
  await deleteAvd("A", deps);
  assert.equal(await exists(join(home, "A.ini")), false);
  assert.equal(await exists(join(home, "A.avd", "config.ini")), true);
});

test("deleteAvd 拒绝运行中的设备：发现文件按名字对上", async (t) => {
  const { home, disc, deps } = await twoAvds(t);
  await writeFile(join(disc, "pid_4242.ini"), `port.serial=5554\ngrpc.port=8554\navd.id=A\n`);
  await assert.rejects(deleteAvd("A", deps), /先关闭这台设备再删除/);
  assert.equal(await exists(join(home, "A.avd", "config.ini")), true);
  // 进程已经不在的发现文件不算
  await deleteAvd("A", { ...deps, alive: () => false });
  assert.equal(await exists(join(home, "A.ini")), false);
});

test("deleteAvd 拒绝运行中的设备：发现文件名字不同但 avd.dir 是这个目录", async (t) => {
  const { home, disc, deps } = await twoAvds(t);
  await writeFile(join(disc, "pid_4243.ini"), `port.serial=5556\navd.name=Something Else\navd.dir=${join(home, "A.avd")}\n`);
  await assert.rejects(deleteAvd("A", deps), /先关闭这台设备再删除/);
  assert.equal(await exists(join(home, "A.avd", "config.ini")), true);
});

test("deleteAvd 数据目录里的 .lock 记着活着的进程时当作运行中；进程不在了、空锁文件都不算", async (t) => {
  const { home, deps } = await twoAvds(t);
  await writeFile(join(home, "A.avd", "multiinstance.lock"), "");
  await writeFile(join(home, "A.avd", "hardware-qemu.ini.lock"), "4244");
  await assert.rejects(deleteAvd("A", deps), /先关闭这台设备再删除/);
  assert.equal(await exists(join(home, "A.avd", "config.ini")), true);
  // 模拟器崩溃后留下的旧锁（2026-11-13 实测停着的 AVD 目录里也有）
  await writeFile(join(home, "A.avd", "hardware-qemu.ini.lock"), "99999");
  await deleteAvd("A", deps);
  assert.equal(await exists(join(home, "A.avd")), false);
});

test("deleteAvd .ini 的 path= 指到 avdHome 外面时拒绝，什么都不删", async (t) => {
  const { home, outside, deps } = await twoAvds(t);
  await writeFile(join(home, "A.ini"), `path=${outside}\n`);
  await assert.rejects(deleteAvd("A", deps), /不是 .* 里的 \.avd 目录/);
  assert.equal(await exists(join(outside, "keep.txt")), true);
  assert.equal(await exists(join(home, "A.ini")), true);
});

test("deleteAvd 拒绝 avdHome 本身、不以 .avd 结尾、不是 avdHome 的直接子目录、别的 AVD 的目录、互相包含的目录、相对路径", async (t) => {
  const { home, deps } = await twoAvds(t);
  await mkdir(join(home, "data"));
  await mkdir(join(home, "deep"));
  await mkdir(join(home, "deep", "X.avd"));
  await mkdir(join(home, "B.avd", "inner.avd"));
  for (const path of [home, join(home, "data"), join(home, "deep", "X.avd"), join(home, "B.avd"), join(home, "B.avd", "inner.avd"), "A.avd"]) {
    await writeFile(join(home, "A.ini"), `path=${path}\n`);
    await assert.rejects(deleteAvd("A", deps), Error, path);
  }
  // 别的 AVD 的 .ini 没写 path= 时，它的目录按 <avdHome>/<名>.avd 算
  await writeFile(join(home, "B.ini"), "target=android-34\n");
  await writeFile(join(home, "A.ini"), `path=${join(home, "B.avd")}\n`);
  await assert.rejects(deleteAvd("A", deps));
  assert.equal(await exists(join(home, "B.avd", "inner.avd")), true);
  assert.equal(await exists(join(home, "data")), true);
  assert.equal(await exists(join(home, "deep", "X.avd")), true);
});

test("deleteAvd 不认识的 id、不合规的名字都拒绝", async (t) => {
  const { home, deps } = await twoAvds(t);
  await assert.rejects(deleteAvd("C", deps), /没有这个设备/);
  await assert.rejects(deleteAvd("../A", deps));
  assert.equal(await exists(join(home, "A.ini")), true);
});
