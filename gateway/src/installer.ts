import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdir, mkdtemp, readdir, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { manifestUrlFor, packageDir } from "./platform.ts";
import { SYSTEM_IMAGE } from "./setup.ts";
import { writeAvd } from "./avd-create.ts";
import { findPackage, isLicenceAccepted, licenceFileText, type RepoPackage } from "./sdk-repo.ts";
import { INSTALL_IDS, type AvdSpec, type InstallProgress, type Licence } from "../../shared/protocol.ts";

export type Progress = InstallProgress;
export type { Licence };

type FetchResult = { ok: boolean; status: number; text(): Promise<string>; body: AsyncIterable<Uint8Array> | null };

export type InstallerDeps = {
  sdkRoot: string;
  avdHome: string;
  /** signal 中止时（网关退出）要停下。 */
  fetch(url: string, signal: AbortSignal): Promise<FetchResult>;
  unzip(zip: string, dest: string, signal: AbortSignal): Promise<void>;
};

/** 一轮安装要装的东西：image 是 system-image 项装哪个镜像（默认 SYSTEM_IMAGE），avd 是 avd 项建的设备。 */
export type InstallJob = { image?: string; avd?: AvdSpec };

export type Installer = {
  /**
   * 按固定顺序装 ids 里的项；某项失败后，后面的都标 failed。每个包下载前先查许可证：没同意过就交给 onLicense，
   * 等 acceptLicenses / rejectLicenses。avd 必须带 job.avd；system-image 装 job.image，没有时装 job.avd 的镜像或默认镜像。
   */
  run(ids: string[], onProgress: (p: Progress) => void, onLicense: ((l: Licence) => void) | undefined, job: InstallJob): Promise<void>;
  /** 页面上的用户对许可证 id 点了“同意”：id 正是在等的那份时才算数。 */
  acceptLicenses(id: number): void;
  /** 页面上的用户对许可证 id 点了“不同意”：这一项失败。 */
  rejectLicenses(id: number): void;
  /** 网关退出：停掉正在等的许可证、下载和解压。 */
  stop(): void;
};

class StepError extends Error {}

const PACKAGES: Record<string, string> = { emulator: "emulator", "platform-tools": "platform-tools" };
const exists = (p: string) => access(p).then(() => true, () => false);

export function createInstaller(deps: InstallerDeps): Installer {
  // 正在等页面回答的许可证；id 跨轮次递增，页面的回答必须带着它
  let waiting: { id: number; answer: (yes: boolean) => void } | null = null;
  let licenceSeq = 0;
  let abort = new AbortController();

  const askLicence = (id: string, pkg: RepoPackage, emit: (p: Progress) => void, onLicense?: (l: Licence) => void) =>
    new Promise<boolean>((resolve) => {
      const licence = { id: ++licenceSeq, name: pkg.licence.id, text: pkg.licence.text };
      waiting = { id: licence.id, answer: resolve };
      if (abort.signal.aborted) return resolve(false);
      emit({ id, phase: "license", logTail: `等你同意许可证 ${pkg.licence.id}` });
      onLicense?.(licence);
    });

  /** 许可证：已经同意过（licenses/<id> 里有它的哈希）就不问；问了且同意后照 sdkmanager 的格式记下。 */
  const ensureLicence = async (id: string, pkg: RepoPackage, emit: (p: Progress) => void, onLicense?: (l: Licence) => void) => {
    const file = join(deps.sdkRoot, "licenses", pkg.licence.id);
    const before = await readFile(file, "utf8").catch(() => "");
    if (isLicenceAccepted(before, pkg.licence.text)) return;
    if (!(await askLicence(id, pkg, emit, onLicense))) throw new StepError(`没有同意许可证 ${pkg.licence.id}，没有安装`);
    await mkdir(dirname(file), { recursive: true });
    // 等回答期间别处也可能写了它：重读一次再追加
    await writeFile(file, licenceFileText(await readFile(file, "utf8").catch(() => ""), pkg.licence.text));
  };

  const download = async (id: string, url: string, pkg: RepoPackage, zip: string, emit: (p: Progress) => void) => {
    const res = await deps.fetch(url, abort.signal);
    if (!res.ok || !res.body) throw new StepError(`下载失败：HTTP ${res.status}`);
    const hash = createHash("sha1");
    const file = createWriteStream(zip);
    let got = 0;
    let lastPct = -1;
    try {
      for await (const chunk of res.body) {
        hash.update(chunk);
        got += chunk.length;
        if (!file.write(chunk)) await new Promise((r) => file.once("drain", r));
        const pct = Math.min(100, Math.floor((got / pkg.archive.size) * 100));
        if (pct !== lastPct) {
          lastPct = pct;
          emit({ id, phase: "download", pct, logTail: `下载 ${url}` });
        }
      }
    } finally {
      await new Promise((r) => file.end(r));
    }
    const sha1 = hash.digest("hex");
    if (sha1 !== pkg.archive.sha1) throw new StepError(`sha1 校验不通过（清单 ${pkg.archive.sha1}，下载到的 ${sha1}），没有解压`);
    return sha1;
  };

  /**
   * 装一个 SDK 包：读清单 → 许可证 → 下载（只走 https）→ 校验 sha1 → 解压到临时目录 → 写 package.xml → 换到 <sdk>/<包目录>。
   * 临时目录在 SDK 里（和目标同一块盘，rename 是原子的），结束后删掉；已有的目标目录（残缺的）先挪走，装好后删掉。
   */
  const installPackage = async (id: string, pkgPath: string, emit: (p: Progress) => void, onLicense?: (l: Licence) => void) => {
    const manifestUrl = manifestUrlFor(pkgPath);
    if (!manifestUrl) throw new StepError(`不认识的包：${pkgPath}`);
    emit({ id, phase: "download", pct: 0, logTail: `读取 ${manifestUrl}` });
    const res = await deps.fetch(manifestUrl, abort.signal);
    if (!res.ok) throw new StepError(`读取清单失败：HTTP ${res.status}`);
    const pkg = findPackage(await res.text(), pkgPath);
    if (!pkg) throw new StepError(`清单里没有 macOS arm64 能用的 ${pkgPath} 稳定版`);
    const url = new URL(pkg.archive.url, manifestUrl);
    if (url.protocol !== "https:") throw new StepError(`下载地址不是 https，不下载：${url.href}`);
    await ensureLicence(id, pkg, emit, onLicense);
    const target = packageDir(deps.sdkRoot, pkgPath);
    const tmpRoot = join(deps.sdkRoot, ".droidpier-tmp");
    await mkdir(tmpRoot, { recursive: true });
    const tmp = await mkdtemp(join(tmpRoot, `${id}-`));
    try {
      const zip = join(tmp, "package.zip");
      const sha1 = await download(id, url.href, pkg, zip, emit);
      emit({ id, phase: "unpack", logTail: `sha1 ${sha1} 校验通过，解压中` });
      const staging = join(tmp, "unzip");
      await mkdir(staging);
      await deps.unzip(zip, staging, abort.signal);
      // zip 里只有一个顶层目录（emulator/、platform-tools/、arm64-v8a/），sdkmanager 也是把它整个挪到包目录
      const tops = (await readdir(staging, { withFileTypes: true })).filter((d) => d.name !== "__MACOSX");
      const src = tops.length === 1 && tops[0].isDirectory() ? join(staging, tops[0].name) : staging;
      emit({ id, phase: "install", logTail: `装到 ${target}` });
      await writeFile(join(src, "package.xml"), pkg.packageXml);
      await mkdir(dirname(target), { recursive: true });
      if (await exists(target)) await rename(target, join(tmp, "old"));
      await rename(src, target);
      emit({ id, phase: "done", logTail: `已装 ${pkgPath} ${pkg.revision} 到 ${target}` });
    } finally {
      await rm(tmp, { recursive: true, force: true });
      // 只在空了时删：另一个网关可能也在用
      await rmdir(tmpRoot).catch(() => {});
    }
  };

  const installOne = async (id: string, emit: (p: Progress) => void, onLicense: ((l: Licence) => void) | undefined, job: InstallJob) => {
    if (id === "avd") {
      if (!job.avd) throw new StepError("没有指定设备名、机型和系统版本");
      emit({ id, phase: "install", logTail: `创建 ${job.avd.name}` });
      await writeAvd(job.avd, deps.avdHome);
      emit({ id, phase: "done", logTail: `已创建 ${job.avd.name}（内存 ${job.avd.ramMb} MB）` });
    } else if (id === "system-image") {
      await installPackage(id, job.image ?? job.avd?.image ?? SYSTEM_IMAGE, emit, onLicense);
    } else if (PACKAGES[id]) {
      await installPackage(id, PACKAGES[id], emit, onLicense);
    } else {
      throw new StepError(`不认识的安装项：${id}`);
    }
  };

  return {
    async run(ids, onProgress, onLicense, job) {
      if (abort.signal.aborted) abort = new AbortController();
      const todo = INSTALL_IDS.filter((id) => ids.includes(id));
      let failed: string | null = null;
      for (const id of todo) {
        if (failed) {
          onProgress({ id, phase: "failed", logTail: `${failed} 没装好，跳过` });
          continue;
        }
        try {
          await installOne(id, onProgress, onLicense, job);
        } catch (e) {
          failed = id;
          onProgress({ id, phase: "failed", logTail: abort.signal.aborted ? "网关退出，安装已停止" : (e as Error).message });
        } finally {
          waiting = null;
        }
      }
    },
    acceptLicenses(id) {
      const w = waiting;
      if (!w || w.id !== id) return;
      waiting = null;
      w.answer(true);
    },
    rejectLicenses(id) {
      const w = waiting;
      if (!w || w.id !== id) return;
      waiting = null;
      w.answer(false);
    },
    stop() {
      abort.abort(new Error("网关退出"));
      const w = waiting;
      waiting = null;
      w?.answer(false);
    },
  };
}

/** fetch，期间超过 idleMs 没收到任何数据（连接、响应头、正文）就中止；outer 中止时也中止。 */
export async function fetchWithIdle(url: string, idleMs: number, outer?: AbortSignal): Promise<FetchResult> {
  const ac = new AbortController();
  if (outer) {
    if (outer.aborted) ac.abort(outer.reason);
    else outer.addEventListener("abort", () => ac.abort(outer.reason), { once: true });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bump = () => {
    clearTimeout(timer);
    timer = setTimeout(() => ac.abort(new Error(`${idleMs} 毫秒没有收到数据：${url}`)), idleMs);
  };
  bump();
  let r: Response;
  try {
    r = await fetch(url, { signal: ac.signal });
  } catch (e) {
    clearTimeout(timer);
    throw ac.signal.aborted ? ac.signal.reason : e;
  }
  bump();
  const src = r.body as AsyncIterable<Uint8Array> | null;
  const body = src
    ? (async function* () {
        try {
          for await (const c of src) {
            bump();
            yield c;
          }
        } catch (e) {
          throw ac.signal.aborted ? ac.signal.reason : e;
        } finally {
          clearTimeout(timer);
        }
      })()
    : null;
  if (!body) clearTimeout(timer);
  return {
    ok: r.ok,
    status: r.status,
    body,
    text: async () => {
      const parts: Uint8Array[] = [];
      if (body) for await (const c of body) parts.push(c);
      return Buffer.concat(parts).toString("utf8");
    },
  };
}

const execFileP = promisify(execFile);

/** 真实依赖：网络用带空闲超时的 fetch，解压用系统 unzip（保留可执行权限）。 */
export function realInstallerDeps(opts: { sdkRoot: string; avdHome: string }): InstallerDeps {
  return {
    sdkRoot: opts.sdkRoot,
    avdHome: opts.avdHome,
    // 60 秒没有任何数据就算断了（清单和 zip 都是）
    fetch: (url, signal) => fetchWithIdle(url, 60_000, signal),
    unzip: async (zip, dest, signal) => {
      await execFileP("/usr/bin/unzip", ["-q", zip, "-d", dest], { signal, maxBuffer: 16 * 2 ** 20 });
    },
  };
}
