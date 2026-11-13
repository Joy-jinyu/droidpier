import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createInstaller, fetchWithIdle, replaceDir, type InstallerDeps, type Licence, type Progress } from "../src/installer.ts";
import { licenceHashes } from "../src/sdk-repo.ts";
import { H, REPO, SYS_IMG } from "./fixtures/repo-manifests.ts";

const REPO_URL = "https://dl.google.com/android/repository/repository2-3.xml";
const SYS_IMG_URL = "https://dl.google.com/android/repository/sys-img/google_apis/sys-img2-3.xml";
const BASE = "https://dl.google.com/android/repository/";
const sha1 = (b: Buffer) => createHash("sha1").update(b).digest("hex");
/** 假 zip：内容写着解压后的顶层目录和里面的一个文件，假 unzip 照着建。 */
const zipOf = (top: string, file: string) => Buffer.from(JSON.stringify({ top, file }));
const ZIPS: Record<string, Buffer> = {
  [`${BASE}platform-tools_r37.0.1-darwin.zip`]: zipOf("platform-tools", "adb"),
  [`${BASE}emulator-darwin_aarch64-16740729.zip`]: zipOf("emulator", "emulator"),
  [`${BASE}sys-img/google_apis/arm64-v8a-34_r14.zip`]: zipOf("arm64-v8a", "system.img"),
};
const sizeOf = (url: string) => `<size>${ZIPS[url].length}</size>`;
/** 清单里的 sha1、大小换成假 zip 真正的值；bad 里的包故意留着对不上的 sha1。 */
const repo = (bad: string[] = []) => REPO
  .replace(H("6"), bad.includes("platform-tools") ? H("0") : sha1(ZIPS[`${BASE}platform-tools_r37.0.1-darwin.zip`]))
  .replace("<size>16110554</size>", sizeOf(`${BASE}platform-tools_r37.0.1-darwin.zip`))
  .replace(H("3"), bad.includes("emulator") ? H("0") : sha1(ZIPS[`${BASE}emulator-darwin_aarch64-16740729.zip`]))
  .replace("<size>416113219</size>", sizeOf(`${BASE}emulator-darwin_aarch64-16740729.zip`));
const sysImg = () => SYS_IMG
  .replace(H("8"), sha1(ZIPS[`${BASE}sys-img/google_apis/arm64-v8a-34_r14.zip`]))
  .replace("<size>1610393229</size>", sizeOf(`${BASE}sys-img/google_apis/arm64-v8a-34_r14.zip`));

type FakeOpts = {
  bad?: string[];
  manifests?: Record<string, string>;
  status?: number;
  /** 换掉 zip 的正文（默认分两块给出假 zip）。 */
  body?: (zip: Buffer) => AsyncIterable<Uint8Array>;
  /** 请求地址 → 跳转后的最终地址。 */
  redirect?: Record<string, string>;
  /** 开始下载 zip 前调用（这时临时目录已经建好）。 */
  beforeZip?: (sdk: string) => Promise<void>;
};

async function fakes(t: import("node:test").TestContext, opts: FakeOpts = {}) {
  const root = await mkdtemp(join(tmpdir(), "emu-installer-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  // SDK 目录还不存在：安装时自己建
  const sdk = join(root, "sdk");
  const avdHome = join(root, "avd");
  const unzips: string[] = [];
  const fetches: string[] = [];
  const manifests = opts.manifests ?? { [REPO_URL]: repo(opts.bad), [SYS_IMG_URL]: sysImg() };
  const deps: InstallerDeps = {
    sdkRoot: sdk,
    avdHome,
    fetch: async (url) => {
      fetches.push(url);
      const final = opts.redirect?.[url] ?? url;
      if (url in manifests) return { ok: true, status: 200, url: final, text: async () => manifests[url], body: null };
      const zip = ZIPS[url];
      if (!zip || opts.status) return { ok: false, status: opts.status ?? 404, url: final, text: async () => "", body: null };
      await opts.beforeZip?.(sdk);
      const body = opts.body?.(zip) ?? (async function* () { yield zip.subarray(0, 5); yield zip.subarray(5); })();
      return { ok: true, status: 200, url: final, text: async () => "", body };
    },
    unzip: async (zip, dest) => {
      unzips.push(zip);
      const { top, file } = JSON.parse(await readFile(zip, "utf8"));
      await mkdir(join(dest, top), { recursive: true });
      await writeFile(join(dest, top, file), "bin");
      await writeFile(join(dest, top, "source.properties"), "Pkg.Revision=1\n");
    },
  };
  return { deps, sdk, avdHome, unzips, fetches };
}

const tick = () => new Promise((r) => setTimeout(r, 10));
const lastOf = (ps: Progress[], id: string) => ps.filter((p) => p.id === id).at(-1);
/** 跑安装，每份许可证都由 answer 决定同不同意（模拟页面上的用户点按钮）。 */
async function runWith(deps: InstallerDeps, ids: string[], answer: (l: Licence) => boolean | null = () => true, job = {}) {
  const ps: Progress[] = [];
  const ls: Licence[] = [];
  const inst = createInstaller(deps);
  await inst.run(ids, (p) => ps.push(p), (l) => {
    ls.push(l);
    const a = answer(l);
    if (a !== null) queueMicrotask(() => (a ? inst.acceptLicenses(l.id) : inst.rejectLicenses(l.id)));
  }, job);
  return { ps, ls, inst };
}

test("platform-tools：先给许可证，同意后才下载；sha1 对上才解压，装到 <sdk>/platform-tools 并写 package.xml", async (t) => {
  const f = await fakes(t);
  let fetchedAtLicence: string[] = [];
  const { ps, ls } = await runWith(f.deps, ["platform-tools"], () => {
    fetchedAtLicence = [...f.fetches];
    return true;
  });
  assert.deepEqual(fetchedAtLicence, [REPO_URL]);
  assert.equal(ls.length, 1);
  assert.equal(ls[0].name, "android-sdk-license");
  assert.match(ls[0].text, /^Terms & "Conditions"/);
  assert.equal(lastOf(ps, "platform-tools")?.phase, "done");
  assert.deepEqual(ps.map((p) => p.phase).filter((p, i, a) => p !== a[i - 1]), ["download", "license", "download", "unpack", "install", "done"]);
  assert.equal(await readFile(join(f.sdk, "platform-tools/adb"), "utf8"), "bin");
  assert.match(await readFile(join(f.sdk, "platform-tools/package.xml"), "utf8"), /<localPackage path="platform-tools" obsolete="false">/);
  // 许可证按 sdkmanager 的格式记下，Android Studio 会当成已同意
  const lic = await readFile(join(f.sdk, "licenses/android-sdk-license"), "utf8");
  assert.equal(lic, licenceHashes(ls[0].text).map((h) => `\n${h}`).join(""));
  // 临时目录收拾干净
  assert.deepEqual((await readdir(f.sdk)).sort(), ["licenses", "platform-tools"]);
});

test("sha1 对不上：失败，什么都不解压，目标目录不存在", async (t) => {
  const f = await fakes(t, { bad: ["platform-tools"] });
  const { ps } = await runWith(f.deps, ["platform-tools"]);
  assert.equal(lastOf(ps, "platform-tools")?.phase, "failed");
  assert.match(lastOf(ps, "platform-tools")!.logTail, /sha1/);
  assert.deepEqual(f.unzips, []);
  assert.equal(existsSync(join(f.sdk, "platform-tools")), false);
  assert.deepEqual(await readdir(f.sdk), ["licenses"]);
});

test("写 zip 出错（比如磁盘满了）：这一项失败，网关不崩，临时目录收拾干净", async (t) => {
  // 临时目录改成只读：建 package.zip 失败，和磁盘满时写失败走同一条路
  const f = await fakes(t, {
    beforeZip: async (sdk) => {
      for (const d of await readdir(join(sdk, ".droidpier-tmp"))) await chmod(join(sdk, ".droidpier-tmp", d), 0o500);
    },
  });
  const { ps } = await runWith(f.deps, ["platform-tools"]);
  assert.equal(lastOf(ps, "platform-tools")?.phase, "failed");
  assert.match(lastOf(ps, "platform-tools")!.logTail, /EACCES|permission/i);
  assert.deepEqual(f.unzips, []);
  assert.deepEqual(await readdir(f.sdk), ["licenses"]);
});

test("下载到的比清单写的大：一超过就停，不解压", async (t) => {
  let pulled = 0;
  const f = await fakes(t, {
    body: (zip) => (async function* () {
      yield zip;
      for (let i = 0; i < 100; i++) {
        pulled++;
        yield Buffer.from("x");
      }
    })(),
  });
  const { ps } = await runWith(f.deps, ["platform-tools"]);
  assert.equal(lastOf(ps, "platform-tools")?.phase, "failed");
  assert.match(lastOf(ps, "platform-tools")!.logTail, /字节/);
  assert.ok(pulled < 100, `读了 ${pulled} 块`);
  assert.deepEqual(f.unzips, []);
});

test("下载到的比清单写的小：失败，不解压", async (t) => {
  const f = await fakes(t, { body: (zip) => (async function* () { yield zip.subarray(0, zip.length - 1); })() });
  const { ps } = await runWith(f.deps, ["platform-tools"]);
  assert.equal(lastOf(ps, "platform-tools")?.phase, "failed");
  assert.match(lastOf(ps, "platform-tools")!.logTail, /字节/);
  assert.deepEqual(f.unzips, []);
});

test("不同意许可证：失败，不下载，不写许可证文件", async (t) => {
  const f = await fakes(t);
  const { ps } = await runWith(f.deps, ["platform-tools"], () => false);
  assert.equal(lastOf(ps, "platform-tools")?.phase, "failed");
  assert.match(lastOf(ps, "platform-tools")!.logTail, /没有同意许可证/);
  assert.deepEqual(f.fetches, [REPO_URL]);
  assert.equal(existsSync(join(f.sdk, "licenses")), false);
});

test("许可证以前同意过（licenses/ 里有它的哈希）：不再问", async (t) => {
  const f = await fakes(t);
  await mkdir(join(f.sdk, "licenses"), { recursive: true });
  await writeFile(join(f.sdk, "licenses/android-sdk-license"), `\n${licenceHashes('Terms & "Conditions"\n\nJanuary 16, 2019\n')[1]}`);
  const { ps, ls } = await runWith(f.deps, ["platform-tools"]);
  assert.deepEqual(ls, []);
  assert.equal(lastOf(ps, "platform-tools")?.phase, "done");
});

test("回答带的 id 不是在等的那份：不算数，还在等", async (t) => {
  const f = await fakes(t);
  const ps: Progress[] = [];
  const inst = createInstaller(f.deps);
  let licence = null as Licence | null;
  const done = inst.run(["platform-tools"], (p) => ps.push(p), (l) => (licence = l), {});
  while (!licence) await tick();
  inst.acceptLicenses(licence!.id + 1);
  inst.rejectLicenses(licence!.id - 1);
  await tick();
  assert.equal(lastOf(ps, "platform-tools")?.phase, "license");
  assert.deepEqual(f.fetches, [REPO_URL]);
  inst.acceptLicenses(licence!.id);
  await done;
  assert.equal(lastOf(ps, "platform-tools")?.phase, "done");
});

test("emulator：下 macOS aarch64 的包；已有的残缺 emulator 目录换成新的", async (t) => {
  const f = await fakes(t);
  await mkdir(join(f.sdk, "emulator/lib"), { recursive: true });
  await writeFile(join(f.sdk, "emulator/lib/old"), "x");
  const { ps } = await runWith(f.deps, ["emulator"]);
  assert.equal(lastOf(ps, "emulator")?.phase, "done");
  assert.ok(f.fetches.includes(`${BASE}emulator-darwin_aarch64-16740729.zip`));
  assert.equal(existsSync(join(f.sdk, "emulator/emulator")), true);
  assert.equal(existsSync(join(f.sdk, "emulator/lib/old")), false);
});

test("replaceDir：新目录换不过去时，旧的包目录放回原处", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "emu-replace-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const [src, target, parking] = ["new", "emulator", "old"].map((n) => join(root, n));
  await mkdir(src);
  await writeFile(join(src, "emulator"), "new");
  await mkdir(target);
  await writeFile(join(target, "emulator"), "old");
  const { rename } = await import("node:fs/promises");
  let calls = 0;
  const failSecond = async (a: string, b: string) => {
    if (++calls === 2) throw new Error("EXDEV");
    await rename(a, b);
  };
  await assert.rejects(replaceDir(src, target, parking, failSecond), /EXDEV/);
  assert.equal(await readFile(join(target, "emulator"), "utf8"), "old");
  assert.equal(existsSync(parking), false);
  // 正常时换成新的，旧的留在 parking 由调用方删
  await replaceDir(src, target, parking);
  assert.equal(await readFile(join(target, "emulator"), "utf8"), "new");
  assert.equal(await readFile(join(parking, "emulator"), "utf8"), "old");
});

test("系统镜像：读它那份清单，装到 system-images/android-34/google_apis/arm64-v8a，许可证是 arm-dbt", async (t) => {
  const f = await fakes(t);
  const { ps, ls } = await runWith(f.deps, ["system-image"], () => true, { image: "system-images;android-34;google_apis;arm64-v8a" });
  assert.equal(lastOf(ps, "system-image")?.phase, "done");
  assert.deepEqual(ls.map((l) => l.name), ["android-sdk-arm-dbt-license"]);
  assert.deepEqual(f.fetches, [SYS_IMG_URL, `${BASE}sys-img/google_apis/arm64-v8a-34_r14.zip`]);
  assert.equal(existsSync(join(f.sdk, "system-images/android-34/google_apis/arm64-v8a/system.img")), true);
  assert.match(await readFile(join(f.sdk, "system-images/android-34/google_apis/arm64-v8a/package.xml"), "utf8"), /sysImgDetailsType/);
});

test("一轮里装几样：按固定顺序，同一份许可证同意一次就不再问；前一项失败后面都标失败", async (t) => {
  const f = await fakes(t);
  const { ps, ls } = await runWith(f.deps, ["platform-tools", "emulator"]);
  assert.deepEqual(ps.filter((p) => p.phase === "done").map((p) => p.id), ["emulator", "platform-tools"]);
  assert.equal(ls.length, 1);
  const g = await fakes(t, { bad: ["emulator"] });
  const r = await runWith(g.deps, ["platform-tools", "emulator"]);
  assert.equal(lastOf(r.ps, "emulator")?.phase, "failed");
  assert.equal(lastOf(r.ps, "platform-tools")?.phase, "failed");
  assert.match(lastOf(r.ps, "platform-tools")!.logTail, /emulator 没装好/);
});

test("下载地址不是 https：不下载", async (t) => {
  const f = await fakes(t, { manifests: { [REPO_URL]: repo().replace("platform-tools_r37.0.1-darwin.zip", "http://dl.example/p.zip") } });
  const { ps } = await runWith(f.deps, ["platform-tools"]);
  assert.equal(lastOf(ps, "platform-tools")?.phase, "failed");
  assert.match(lastOf(ps, "platform-tools")!.logTail, /https/);
  assert.deepEqual(f.fetches, [REPO_URL]);
});

test("清单里写的下载地址不在 dl.google.com：不下载", async (t) => {
  const f = await fakes(t, { manifests: { [REPO_URL]: repo().replace("platform-tools_r37.0.1-darwin.zip", "https://dl.example/p.zip") } });
  const { ps } = await runWith(f.deps, ["platform-tools"]);
  assert.equal(lastOf(ps, "platform-tools")?.phase, "failed");
  assert.match(lastOf(ps, "platform-tools")!.logTail, /dl\.google\.com/);
  assert.deepEqual(f.fetches, [REPO_URL]);
});

test("清单或 zip 被跳转到别的主机：不用它", async (t) => {
  const zipUrl = `${BASE}platform-tools_r37.0.1-darwin.zip`;
  const f = await fakes(t, { redirect: { [zipUrl]: "https://mirror.example/p.zip" } });
  const { ps } = await runWith(f.deps, ["platform-tools"]);
  assert.equal(lastOf(ps, "platform-tools")?.phase, "failed");
  assert.match(lastOf(ps, "platform-tools")!.logTail, /mirror\.example/);
  assert.deepEqual(f.unzips, []);
  const g = await fakes(t, { redirect: { [REPO_URL]: "http://dl.google.com/android/repository/repository2-3.xml" } });
  const r = await runWith(g.deps, ["platform-tools"]);
  assert.equal(lastOf(r.ps, "platform-tools")?.phase, "failed");
  assert.deepEqual(r.ls, []);
});

test("许可证 id 不像文件名（比如 ../x）：不问也不写许可证文件", async (t) => {
  const f = await fakes(t, { manifests: { [REPO_URL]: repo().replaceAll('"android-sdk-license"', '"../../evil"') } });
  const { ps, ls } = await runWith(f.deps, ["platform-tools"]);
  assert.equal(lastOf(ps, "platform-tools")?.phase, "failed");
  assert.match(lastOf(ps, "platform-tools")!.logTail, /许可证/);
  assert.deepEqual(ls, []);
  assert.equal(existsSync(f.sdk), false);
});

test("清单里没有这个包或读清单失败：失败并说明", async (t) => {
  const f = await fakes(t, { manifests: {} });
  const { ps } = await runWith(f.deps, ["platform-tools"]);
  assert.match(lastOf(ps, "platform-tools")!.logTail, /读取清单失败：HTTP 404/);
  const g = await fakes(t, { manifests: { [REPO_URL]: "<x/>" } });
  const r = await runWith(g.deps, ["platform-tools"]);
  assert.match(lastOf(r.ps, "platform-tools")!.logTail, /清单里没有/);
});

test("等许可证时网关退出（stop）：这一项失败，不下载", async (t) => {
  const f = await fakes(t);
  const ps: Progress[] = [];
  const inst = createInstaller(f.deps);
  const done = inst.run(["platform-tools"], (p) => ps.push(p), () => queueMicrotask(() => inst.stop()), {});
  await done;
  assert.equal(lastOf(ps, "platform-tools")?.phase, "failed");
  assert.deepEqual(f.fetches, [REPO_URL]);
});

test("建设备：直接写 AVD 文件，不跑 avdmanager", async (t) => {
  const f = await fakes(t);
  const avd = { name: "Pixel_5_API_34", device: "pixel_5", image: "system-images;android-34;google_apis;arm64-v8a", ramMb: 4096 };
  const { ps } = await runWith(f.deps, ["avd"], () => true, { avd });
  assert.equal(lastOf(ps, "avd")?.phase, "done");
  assert.match(lastOf(ps, "avd")!.logTail, /Pixel_5_API_34/);
  assert.match(await readFile(join(f.avdHome, "Pixel_5_API_34.avd/config.ini"), "utf8"), /hw\.ramSize=4096/);
  const none = await runWith(f.deps, ["avd"]);
  assert.equal(lastOf(none.ps, "avd")?.phase, "failed");
});

test("建设备时镜像没装：先装 spec 里的镜像再建", async (t) => {
  const f = await fakes(t);
  const avd = { name: "P", device: "pixel_5", image: "system-images;android-34;google_apis;arm64-v8a", ramMb: 4096 };
  const { ps } = await runWith(f.deps, ["avd", "system-image"], () => true, { avd });
  assert.deepEqual(ps.filter((p) => p.phase === "done").map((p) => p.id), ["system-image", "avd"]);
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
