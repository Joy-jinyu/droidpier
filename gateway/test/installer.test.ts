import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createInstaller, fetchWithIdle, findCmdlineTools, type InstallerDeps, type Licence, type Proc, type Progress } from "../src/installer.ts";
import { CMDLINE_TOOLS_REVISION } from "../src/platform.ts";

const MANIFEST_URL = "https://dl.example/android/repository/repository2-3.xml";
const ZIP = Buffer.from("pretend this is a zip");
const ZIP_SHA1 = createHash("sha1").update(ZIP).digest("hex");

/** 清单里 cmdline-tools;latest 的结构照抄官方 repository2-3.xml。 */
const manifest = (sha1: string) => `<?xml version="1.0"?>
<sdk:sdk-repository>
  <remotePackage path="cmdline-tools;latest">
    <archives>
      <archive><complete><size>7</size><checksum type="sha1">2222222222222222222222222222222222222222</checksum><url>commandlinetools-mac_arm64-23_latest.zip</url></complete><host-os>macosx</host-os><host-arch>aarch64</host-arch></archive>
    </archives>
  </remotePackage>
  <remotePackage path="cmdline-tools;22.0">
    <archives>
      <archive><complete><size>99</size><checksum type="sha1">0000000000000000000000000000000000000000</checksum><url>commandlinetools-linux-1_latest.zip</url></complete><host-os>linux</host-os></archive>
      <archive><complete><size>98</size><checksum type="sha1">1111111111111111111111111111111111111111</checksum><url>commandlinetools-mac_x86_64-1_latest.zip</url></complete><host-os>macosx</host-os><host-arch>x64</host-arch></archive>
      <archive><complete><size>${ZIP.length}</size><checksum type="sha1">${sha1}</checksum><url>commandlinetools-mac_arm64-1_latest.zip</url></complete><host-os>macosx</host-os><host-arch>aarch64</host-arch></archive>
    </archives>
  </remotePackage>
</sdk:sdk-repository>`;

type FakeProc = Proc & { cmd: string; args: string[]; writes: string[]; emit(s: string): void; finish(code: number): void; killed: boolean };

async function fakes(opts: { sha1?: string; onSpawn?: (p: FakeProc) => void } = {}) {
  const root = await mkdtemp(join(tmpdir(), "emu-installer-"));
  const sdk = join(root, "sdk");
  const avdHome = join(root, "avd");
  await mkdir(sdk, { recursive: true });
  await mkdir(avdHome, { recursive: true });
  const procs: FakeProc[] = [];
  const unzips: string[] = [];
  const fetches: string[] = [];
  const deps: InstallerDeps = {
    sdkRoot: sdk,
    avdHome,
    manifestUrl: MANIFEST_URL,
    fetch: async (url) => {
      fetches.push(url);
      if (url === MANIFEST_URL) return { ok: true, status: 200, text: async () => manifest(opts.sha1 ?? ZIP_SHA1), body: null };
      assert.equal(url, "https://dl.example/android/repository/commandlinetools-mac_arm64-1_latest.zip");
      return { ok: true, status: 200, text: async () => "", body: (async function* () { yield ZIP.subarray(0, 5); yield ZIP.subarray(5); })() };
    },
    unzip: async (zip, dest) => {
      unzips.push(zip);
      await mkdir(join(dest, "cmdline-tools/bin"), { recursive: true });
      await writeFile(join(dest, "cmdline-tools/bin/sdkmanager"), "#!/bin/sh\n");
    },
    spawn: (cmd, args) => {
      const outs: Array<(s: string) => void> = [];
      let done!: (code: number | null) => void;
      const p: FakeProc = {
        cmd, args, writes: [], killed: false,
        onOutput: (cb) => void outs.push(cb),
        write: (s) => void p.writes.push(s),
        kill: () => { p.killed = true; done(null); },
        exit: new Promise((r) => (done = r)),
        emit: (s) => outs.forEach((cb) => cb(s)),
        finish: (code) => done(code),
      };
      procs.push(p);
      queueMicrotask(() => opts.onSpawn?.(p));
      return p;
    },
  };
  return { deps, sdk, avdHome, procs, unzips, fetches };
}

const tick = () => new Promise((r) => setTimeout(r, 10));
const lastOf = (ps: Progress[], id: string) => ps.filter((p) => p.id === id).at(-1);

test("cmdline-tools：sha1 不符 → failed，且没有解压", async () => {
  const f = await fakes({ sha1: "deadbeef".repeat(5) });
  const ps: Progress[] = [];
  await createInstaller(f.deps).run(["cmdline-tools"], (p) => ps.push(p));
  assert.equal(lastOf(ps, "cmdline-tools")?.phase, "failed");
  assert.match(lastOf(ps, "cmdline-tools")!.logTail, /sha1/);
  assert.deepEqual(f.unzips, []);
  assert.equal(existsSync(join(f.sdk, "cmdline-tools/latest")), false);
});

test("cmdline-tools：sha1 对得上 → 解压到 <sdk>/cmdline-tools/latest", async () => {
  const f = await fakes();
  const ps: Progress[] = [];
  await createInstaller(f.deps).run(["cmdline-tools"], (p) => ps.push(p));
  assert.equal(lastOf(ps, "cmdline-tools")?.phase, "done");
  assert.ok(ps.some((p) => p.phase === "download" && p.pct === 100));
  assert.equal(existsSync(join(f.sdk, "cmdline-tools/latest/bin/sdkmanager")), true);
});

const LICENSE = "License android-sdk-license:\n---------\nTerms and Conditions\nThis is the licence.\nThe License Agreement applies.\n---------\nAccept? (y/N): ";

test("未调用 acceptLicenses 时不向 stdin 写 y，阶段停在 license", async () => {
  const f = await fakes({ onSpawn: (p) => p.emit(LICENSE) });
  const ps: Progress[] = [];
  const texts: Licence[] = [];
  const inst = createInstaller(f.deps);
  const run = inst.run(["emulator"], (p) => ps.push(p), (l) => texts.push(l));
  await tick();
  await tick();
  const p = f.procs[0];
  assert.match(p.args.join(" "), /--install emulator/);
  assert.ok(!p.writes.some((w) => /y/i.test(w)), `写了 ${JSON.stringify(p.writes)}`);
  assert.equal(lastOf(ps, "emulator")?.phase, "license");
  assert.equal(texts.length, 1);
  // 正文里也有 “License ” 字样：要从 “License <id>:” 这行开始，不能从正文中间截
  assert.match(texts[0].text, /^License android-sdk-license:\n[\s\S]*Terms and Conditions[\s\S]*The License Agreement applies/);
  assert.equal(texts[0].name, "android-sdk-license");
  // 不同意：这一项失败
  inst.rejectLicenses(texts[0].id);
  p.finish(0);
  await run;
  assert.ok(!p.writes.some((w) => /y/i.test(w)));
  assert.equal(lastOf(ps, "emulator")?.phase, "failed");
});

test("调用 acceptLicenses 后写 y 并继续", async () => {
  const f = await fakes({ onSpawn: (p) => p.emit(LICENSE) });
  const ps: Progress[] = [];
  const inst = createInstaller(f.deps);
  const ls: Licence[] = [];
  const run = inst.run(["emulator"], (p) => ps.push(p), (l) => ls.push(l));
  await tick();
  inst.acceptLicenses(ls[0].id);
  const p = f.procs[0];
  assert.deepEqual(p.writes, ["y\n"]);
  // 同意之后 sdkmanager 才开始下载：阶段回到下载并带百分比
  p.emit("\r[==      ] 12% Downloading emulator.zip...");
  await tick();
  assert.equal(lastOf(ps, "emulator")?.phase, "download");
  assert.equal(lastOf(ps, "emulator")?.pct, 12);
  p.emit("\rInstalling Android Emulator\n");
  p.finish(0);
  await run;
  assert.equal(lastOf(ps, "emulator")?.phase, "done");
});

test("sdkmanager 输出 [====    ] 45% 时进度 pct 为 45", async () => {
  const f = await fakes({ onSpawn: (p) => p.emit("\r[====    ] 45% Downloading emulator-darwin_aarch64.zip...") });
  const ps: Progress[] = [];
  const run = createInstaller(f.deps).run(["emulator"], (p) => ps.push(p));
  await tick();
  assert.equal(lastOf(ps, "emulator")?.pct, 45);
  assert.equal(lastOf(ps, "emulator")?.phase, "download");
  f.procs[0].finish(0);
  await run;
});

test("创建 AVD：用选的名字、机型和镜像，config.ini 的 hw.ramSize 按 spec 写", async () => {
  let avdHome = "";
  const f = await fakes({
    onSpawn: async (p) => {
      assert.match(p.cmd, /cmdline-tools\/latest\/bin\/avdmanager$/);
      assert.deepEqual(p.args, ["create", "avd", "-n", "Nexus_5X_API_27", "-k", "system-images;android-27;google_apis;arm64-v8a", "-d", "Nexus 5X"]);
      const dir = join(avdHome, "Nexus_5X_API_27.avd");
      await mkdir(dir, { recursive: true });
      await writeFile(join(avdHome, "Nexus_5X_API_27.ini"), `path=${dir}\n`);
      await writeFile(join(dir, "config.ini"), "hw.lcd.width=1080\nhw.ramSize=1536\nhw.lcd.height=1920\n");
      p.finish(0);
    },
  });
  avdHome = f.avdHome;
  const ps: Progress[] = [];
  const spec = { name: "Nexus_5X_API_27", device: "Nexus 5X", image: "system-images;android-27;google_apis;arm64-v8a", ramMb: 2048 };
  await createInstaller(f.deps).run(["avd"], (p) => ps.push(p), undefined, spec);
  assert.equal(lastOf(ps, "avd")?.phase, "done");
  assert.match(lastOf(ps, "avd")!.logTail, /已创建 Nexus_5X_API_27（内存 2048 MB）/);
  const ini = await readFile(join(f.avdHome, "Nexus_5X_API_27.avd/config.ini"), "utf8");
  assert.match(ini, /^hw\.ramSize=2048$/m);
  assert.doesNotMatch(ini, /1536/);
  assert.match(ini, /hw\.lcd\.height=1920/);
});

test("没有 spec 时不创建 AVD", async () => {
  const f = await fakes();
  const ps: Progress[] = [];
  await createInstaller(f.deps).run(["avd"], (p) => ps.push(p));
  assert.equal(lastOf(ps, "avd")?.phase, "failed");
  assert.equal(f.procs.length, 0);
});

test("系统镜像：装 spec 里选的那个", async () => {
  const f = await fakes({ onSpawn: (p) => p.finish(0) });
  const spec = { name: "A", device: "pixel_5", image: "system-images;android-36;google_apis;arm64-v8a", ramMb: 4096 };
  await createInstaller(f.deps).run(["system-image"], () => {}, undefined, spec);
  assert.deepEqual(f.procs[0].args.slice(1), ["--install", "system-images;android-36;google_apis;arm64-v8a"]);
});

test("前一项失败：后面的不再执行，标为 failed", async () => {
  const f = await fakes({ sha1: "0".repeat(40) });
  const ps: Progress[] = [];
  await createInstaller(f.deps).run(["emulator", "cmdline-tools"], (p) => ps.push(p));
  assert.equal(f.procs.length, 0);
  assert.equal(lastOf(ps, "emulator")?.phase, "failed");
});

test("cmdline-tools 固定用 22.0（最后一个逐项询问许可证的版本），不取 latest", () => {
  assert.equal(CMDLINE_TOOLS_REVISION, "22.0");
  assert.deepEqual(findCmdlineTools(manifest(ZIP_SHA1), CMDLINE_TOOLS_REVISION), { url: "commandlinetools-mac_arm64-1_latest.zip", sha1: ZIP_SHA1, size: ZIP.length });
});

const LICENSE_ARM = "License android-sdk-arm-dbt-license:\n---------\nARM terms\n---------\nAccept? (y/N): ";

test("同意时带的 id 不是正在等的许可证：不写 y", async () => {
  const f = await fakes({ onSpawn: (p) => p.emit(LICENSE) });
  const ls: Licence[] = [];
  const inst = createInstaller(f.deps);
  const run = inst.run(["emulator"], () => {}, (l) => ls.push(l));
  await tick();
  inst.acceptLicenses(ls[0].id - 1);
  inst.acceptLicenses(ls[0].id + 1);
  assert.deepEqual(f.procs[0].writes, []);
  inst.rejectLicenses(ls[0].id);
  f.procs[0].finish(0);
  await run;
});

test("一次 sdkmanager 里问两份许可证：每份都要自己的同意，前一份的 id 不能答后一份", async () => {
  const f = await fakes({ onSpawn: (p) => p.emit(LICENSE) });
  const ls: Licence[] = [];
  const inst = createInstaller(f.deps);
  const run = inst.run(["system-image"], () => {}, (l) => ls.push(l));
  await tick();
  const p = f.procs[0];
  inst.acceptLicenses(ls[0].id);
  assert.deepEqual(p.writes, ["y\n"]);
  p.emit(LICENSE_ARM);
  await tick();
  assert.equal(ls.length, 2);
  assert.equal(ls[1].name, "android-sdk-arm-dbt-license");
  assert.ok(ls[1].id > ls[0].id);
  // 页面上晚到的、给第一份的同意，不能当成第二份的
  inst.acceptLicenses(ls[0].id);
  assert.deepEqual(p.writes, ["y\n"]);
  inst.acceptLicenses(ls[1].id);
  assert.deepEqual(p.writes, ["y\n", "y\n"]);
  p.finish(0);
  await run;
});

test("不同意：这一项失败，后面的项不再执行", async () => {
  const f = await fakes({ onSpawn: (p) => p.emit(LICENSE) });
  const ps: Progress[] = [];
  const ls: Licence[] = [];
  const inst = createInstaller(f.deps);
  const run = inst.run(["emulator", "platform-tools"], (p) => ps.push(p), (l) => ls.push(l));
  await tick();
  inst.rejectLicenses(ls[0].id);
  assert.deepEqual(f.procs[0].writes, ["n\n"]);
  f.procs[0].finish(0);
  await run;
  assert.equal(f.procs.length, 1);
  assert.equal(lastOf(ps, "emulator")?.phase, "failed");
  assert.equal(lastOf(ps, "platform-tools")?.phase, "failed");
  assert.match(lastOf(ps, "platform-tools")!.logTail, /跳过/);
});

test("提问被拆在两段输出里、前面有超过 64KB 的进度：每次提问只算一次，都能认出来", async () => {
  const f = await fakes();
  const ls: Licence[] = [];
  const inst = createInstaller(f.deps);
  const run = inst.run(["emulator"], () => {}, (l) => ls.push(l));
  await tick();
  const p = f.procs[0];
  p.emit(LICENSE.slice(0, -8));
  p.emit(LICENSE.slice(-8));
  await tick();
  assert.equal(ls.length, 1);
  inst.acceptLicenses(ls[0].id);
  for (let i = 0; i < 2000; i++) p.emit(`\r[====    ] ${i % 100}% Downloading emulator.zip...`);
  p.emit(LICENSE_ARM);
  await tick();
  assert.equal(ls.length, 2);
  assert.equal(ls[1].name, "android-sdk-arm-dbt-license");
  inst.acceptLicenses(ls[1].id);
  assert.deepEqual(p.writes, ["y\n", "y\n"]);
  p.finish(0);
  await run;
});

test("stop：杀掉正在跑的子进程，这一项失败", async () => {
  const f = await fakes({ onSpawn: (p) => p.emit(LICENSE) });
  const ps: Progress[] = [];
  const inst = createInstaller(f.deps);
  const run = inst.run(["emulator"], (p) => ps.push(p), () => {});
  await tick();
  inst.stop();
  await run;
  assert.equal(f.procs[0].killed, true);
  assert.equal(lastOf(ps, "emulator")?.phase, "failed");
});

test("cmdline-tools/latest 已存在：下载之前就失败，不读清单也不下载", async () => {
  const f = await fakes();
  await mkdir(join(f.sdk, "cmdline-tools/latest"), { recursive: true });
  const ps: Progress[] = [];
  await createInstaller(f.deps).run(["cmdline-tools"], (p) => ps.push(p));
  assert.equal(lastOf(ps, "cmdline-tools")?.phase, "failed");
  assert.match(lastOf(ps, "cmdline-tools")!.logTail, /已存在/);
  assert.deepEqual(f.fetches, []);
});

test("fetchWithIdle：服务器一直不回数据，过了空闲时限就失败", async (t) => {
  const srv = createServer(() => {});
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  t.after(() => { srv.closeAllConnections(); srv.close(); });
  const port = (srv.address() as { port: number }).port;
  await assert.rejects(fetchWithIdle(`http://127.0.0.1:${port}/x`, 100), /100 毫秒没有收到数据|abort/i);
});

test("fetchWithIdle：响应头到了但正文停住，读正文时失败", async (t) => {
  const srv = createServer((_req, res) => { res.writeHead(200); res.write("a"); });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  t.after(() => { srv.closeAllConnections(); srv.close(); });
  const port = (srv.address() as { port: number }).port;
  // 时限要留够连接和等响应头的时间：全部测试并行跑时这段超过过 100 毫秒，没到正文就先超时（2026-11-13 实测）
  const r = await fetchWithIdle(`http://127.0.0.1:${port}/x`, 1000);
  await assert.rejects(r.text(), /1000 毫秒没有收到数据|abort/i);
});
