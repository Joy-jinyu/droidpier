import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findRunning, ownFilter, parseDiscovery, pidAlive } from "../src/discovery.ts";

test("parseDiscovery 读出 gRPC 端口和串口端口", () => {
  assert.deepEqual(parseDiscovery("port.serial=5554\ngrpc.port=8554\n"), { grpcPort: 8554, serial: 5554 });
});

test("parseDiscovery 带 token 时一并返回", () => {
  assert.deepEqual(parseDiscovery("port.serial=5554\ngrpc.port=8554\ngrpc.token=abc\n"), {
    grpcPort: 8554,
    serial: 5554,
    token: "abc",
  });
});

test("parseDiscovery 缺 grpc.port 时报错并指明字段", () => {
  assert.throws(() => parseDiscovery("port.serial=5554\n"), /grpc\.port/);
});

test("findRunning 只选进程还活着的那个发现文件", async () => {
  const dir = await mkdtemp(join(tmpdir(), "emu-disc-"));
  await writeFile(join(dir, "pid_1.ini"), "port.serial=5554\ngrpc.port=8554\n");
  await writeFile(join(dir, "pid_2.ini"), "port.serial=5556\ngrpc.port=8556\n");
  const found = await findRunning(dir, (pid) => pid === 2);
  assert.deepEqual(found, { pid: 2, grpcPort: 8556, serial: 5556 });
});

test("findRunning 目录不存在时返回 null", async () => {
  assert.equal(await findRunning(join(tmpdir(), "no-such-dir-xyz"), () => true), null);
});

test("parseDiscovery 缺 port.serial 时报错并指明字段", () => {
  assert.throws(() => parseDiscovery("grpc.port=8554\n"), /port\.serial/);
});

test("findRunning 跳过没开 gRPC 的活进程，选下一个", async () => {
  const dir = await mkdtemp(join(tmpdir(), "emu-disc-"));
  await writeFile(join(dir, "pid_3.ini"), "port.serial=5554\n");
  await writeFile(join(dir, "pid_4.ini"), "port.serial=5556\ngrpc.port=8556\n");
  assert.deepEqual(await findRunning(dir, () => true), { pid: 4, grpcPort: 8556, serial: 5556 });
});

test("findRunning 多个活进程时结果与目录顺序无关（取 pid 最小的）", async () => {
  const dir = await mkdtemp(join(tmpdir(), "emu-disc-"));
  await writeFile(join(dir, "pid_9.ini"), "port.serial=5556\ngrpc.port=8556\n");
  await writeFile(join(dir, "pid_10.ini"), "port.serial=5554\ngrpc.port=8554\n");
  assert.equal((await findRunning(dir, () => true))?.pid, 9);
});

test("pidAlive 对无权发信号但存在的进程（pid 1）返回 true", () => {
  assert.equal(pidAlive(1), true);
});

test("findRunning 指定 avdName 时只返回这个 AVD", async () => {
  const dir = await mkdtemp(join(tmpdir(), "emu-disc-"));
  await writeFile(join(dir, "pid_5.ini"), "port.serial=5554\ngrpc.port=8554\navd.name=A\n");
  await writeFile(join(dir, "pid_6.ini"), "port.serial=5556\ngrpc.port=8556\navd.name=B\n");
  assert.equal((await findRunning(dir, () => true, "B"))?.pid, 6);
  assert.equal(await findRunning(dir, () => true, "C"), null);
});

test("findRunning 给了 accept 时跳过它不认的 AVD（干净环境不接管别处的模拟器）", async () => {
  const dir = await mkdtemp(join(tmpdir(), "emu-disc-"));
  await writeFile(join(dir, "pid_1.ini"), "port.serial=5554\ngrpc.port=8554\navd.name=Users_Pixel\n");
  await writeFile(join(dir, "pid_2.ini"), "port.serial=5556\ngrpc.port=8556\navd.name=emu_web_default\n");
  const found = await findRunning(dir, () => true, undefined, (d) => d.avdName === "emu_web_default");
  assert.equal(found?.avdName, "emu_web_default");
  assert.equal(await findRunning(dir, () => true, undefined, () => false), null);
});

test("parseDiscovery 读出 avd.dir（目录名可能和 avd.name 不同）", () => {
  const d = parseDiscovery("port.serial=5556\navd.name=android8-chrome66\navd.dir=/Users/u/.android/avd/android8.avd\ngrpc.port=8556\n");
  assert.equal(d.avdName, "android8-chrome66");
  assert.equal(d.avdDir, "/Users/u/.android/avd/android8.avd");
});

/** 假文件系统：files 是 路径 → 内容；links 是 路径 → realpath 结果。 */
const io = (files: Record<string, string>, links: Record<string, string> = {}) => ({
  readFile: (p: string) => files[p] ?? null,
  realpath: (p: string) => links[p] ?? p,
});

test("ownFilter：没有显式设 ANDROID_AVD_HOME 时不过滤，连没有 avd.name 的模拟器也接管", async () => {
  assert.equal(ownFilter(undefined, io({}), () => {}), undefined);
  const dir = await mkdtemp(join(tmpdir(), "emu-disc-"));
  await writeFile(join(dir, "pid_1.ini"), "port.serial=5554\ngrpc.port=8554\n");
  assert.equal((await findRunning(dir, () => true, undefined, ownFilter(undefined, io({}), () => {})))?.serial, 5554);
});

test("ownFilter：同名但 avd.dir 在别处 → 不接管，记一次日志", () => {
  const logs: string[] = [];
  const accept = ownFilter("/tmp/avdhome", io({ "/tmp/avdhome/Pixel_5_API_34.ini": "path=/tmp/avdhome/Pixel_5_API_34.avd\n" }), (s) => logs.push(s))!;
  const d = { serial: 5554, grpcPort: 8554, avdName: "Pixel_5_API_34", avdDir: "/Users/u/.android/avd/Pixel_5_API_34.avd" };
  assert.equal(accept(d), false);
  assert.equal(accept(d), false);
  assert.deepEqual(logs, ["发现 emulator-5554（AVD Pixel_5_API_34，/Users/u/.android/avd/Pixel_5_API_34.avd）不在 /tmp/avdhome，没有接管"]);
});

test("ownFilter：.ini 的 path= 和 avd.dir 的 realpath 相同 → 接管", () => {
  const accept = ownFilter("/tmp/avdhome", io(
    { "/tmp/avdhome/mine.ini": "avd.ini.encoding=UTF-8\npath=/tmp/avdhome/mine.avd\n" },
    { "/tmp/avdhome/mine.avd": "/private/tmp/avdhome/mine.avd", "/tmp/link/mine.avd": "/private/tmp/avdhome/mine.avd" },
  ), () => {})!;
  assert.equal(accept({ serial: 5556, grpcPort: 8556, avdName: "mine", avdDir: "/tmp/link/mine.avd" }), true);
});

test("ownFilter：.ini 没有 path= 时 avd.dir 必须在 AVD 目录里", () => {
  const accept = ownFilter("/tmp/avdhome", io({ "/tmp/avdhome/a.ini": "target=android-34\n", "/tmp/avdhome/b.ini": "" }), () => {})!;
  assert.equal(accept({ serial: 5556, grpcPort: 8556, avdName: "a", avdDir: "/tmp/avdhome/a.avd" }), true);
  assert.equal(accept({ serial: 5558, grpcPort: 8558, avdName: "b", avdDir: "/tmp/other/b.avd" }), false);
  assert.equal(accept({ serial: 5560, grpcPort: 8560, avdName: "a", avdDir: "/tmp/avdhome-x/a.avd" }), false);
});

test("ownFilter：发现文件没有 avd.dir 或没有 .ini → 不接管", () => {
  const logs: string[] = [];
  const accept = ownFilter("/tmp/avdhome", io({ "/tmp/avdhome/mine.ini": "path=/tmp/avdhome/mine.avd\n" }), (s) => logs.push(s))!;
  assert.equal(accept({ serial: 5556, grpcPort: 8556, avdName: "mine" }), false);
  assert.equal(accept({ serial: 5558, grpcPort: 8558, avdName: "other", avdDir: "/tmp/avdhome/other.avd" }), false);
  assert.equal(accept({ serial: 5560, grpcPort: 8560 }), false);
  assert.equal(logs.length, 3);
});

test("parseDiscovery 的 avdName 取 avd.id：avd.name 是显示名，可能带空格和括号", () => {
  const d = parseDiscovery("port.serial=5554\navd.id=Resizable_Experimental\navd.name=Resizable (Experimental)\ngrpc.port=8554\n");
  assert.equal(d.avdName, "Resizable_Experimental");
});

test("findRunning 按 avd.id 找得到显示名不同的 AVD", async () => {
  const dir = await mkdtemp(join(tmpdir(), "emu-disc-"));
  await writeFile(join(dir, "pid_5.ini"), "port.serial=5554\ngrpc.port=8554\navd.id=Resizable_Experimental\navd.name=Resizable (Experimental)\n");
  assert.equal((await findRunning(dir, () => true, "Resizable_Experimental"))?.pid, 5);
});
