import { spawn as spawnCp } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { avdmanagerBin, CMDLINE_TOOLS_REVISION, MANIFEST_HOST, sdkmanagerBin } from "./platform.ts";
import { SYSTEM_IMAGE } from "./setup.ts";
import { repairAvdTarget } from "./avd.ts";
import { INSTALL_IDS, type AvdSpec, type InstallProgress, type Licence } from "../../shared/protocol.ts";

export type Progress = InstallProgress;
export type { Licence };

/** 子进程里安装器用到的部分：stdout 和 stderr 合在一起给。 */
export type Proc = {
  onOutput(cb: (chunk: string) => void): void;
  write(s: string): void;
  kill(): void;
  exit: Promise<number | null>;
};

type FetchResult = { ok: boolean; status: number; text(): Promise<string>; body: AsyncIterable<Uint8Array> | null };

export type InstallerDeps = {
  sdkRoot: string;
  avdHome: string;
  manifestUrl: string;
  fetch(url: string): Promise<FetchResult>;
  unzip(zip: string, dest: string): Promise<void>;
  spawn(cmd: string, args: string[]): Proc;
  /** 每轮安装开始前调用一次（真实依赖在这里重新找 Java）。 */
  prepare?(): Promise<void>;
};

export type Installer = {
  /**
   * 按固定顺序装 ids 里的项；某项失败后，后面的都标 failed。onLicense 收到许可证正文，等 acceptLicenses / rejectLicenses。
   * avd 必须带 spec；system-image 有 spec 时装 spec.image，没有时装默认镜像。
   */
  run(ids: string[], onProgress: (p: Progress) => void, onLicense?: (l: Licence) => void, spec?: AvdSpec): Promise<void>;
  /** 页面上的用户对许可证 id 点了“同意”：id 正是在等的那份时才往 sdkmanager 写 y。 */
  acceptLicenses(id: number): void;
  /** 页面上的用户对许可证 id 点了“不同意”：回答 n，这一项失败。 */
  rejectLicenses(id: number): void;
  /** 网关退出：杀掉正在跑的子进程。 */
  stop(): void;
};

const SDK_PACKAGES: Record<string, string> = {
  emulator: "emulator",
  "platform-tools": "platform-tools",
  "system-image": SYSTEM_IMAGE,
};
const LOG_LINES = 6;
const ACCEPT_PROMPT = "Accept? (y/N):";

class StepError extends Error {}

/** 读清单里 cmdline-tools;<revision> 在本机（macOS arm64）的 zip 地址、sha1 和大小。 */
export function findCmdlineTools(xml: string, revision: string): { url: string; sha1: string; size: number } | null {
  const path = `cmdline-tools;${revision}`.replace(/[.]/g, "\\.");
  const pkg = new RegExp(`<remotePackage path="${path}">([\\s\\S]*?)</remotePackage>`).exec(xml)?.[1];
  if (!pkg) return null;
  for (const a of pkg.match(/<archive>[\s\S]*?<\/archive>/g) ?? []) {
    const os = /<host-os>(.*?)<\/host-os>/.exec(a)?.[1];
    const arch = /<host-arch>(.*?)<\/host-arch>/.exec(a)?.[1];
    if (os !== MANIFEST_HOST.os || arch !== MANIFEST_HOST.arch) continue;
    const url = /<url>(.*?)<\/url>/.exec(a)?.[1];
    const sha1 = /<checksum type="sha1">([0-9a-f]{40})<\/checksum>/.exec(a)?.[1];
    const size = Number(/<size>(\d+)<\/size>/.exec(a)?.[1]);
    if (url && sha1) return { url, sha1, size };
  }
  return null;
}

/** 最后几行输出；进度条用 \r 刷新同一行，也按行算。 */
function tail(out: string): string {
  return out.split(/[\r\n]+/).map((l) => l.trimEnd()).filter(Boolean).slice(-LOG_LINES).join("\n");
}

export function createInstaller(deps: InstallerDeps): Installer {
  // 当前停在许可证提问上的子进程；id 跨轮次递增，页面的回答必须带着它
  let waiting: { id: number; proc: Proc; rejected: () => void; answered: () => void } | null = null;
  let licenceSeq = 0;
  const procs = new Set<Proc>();

  const runProc = (id: string, cmd: string, args: string[], emit: (p: Progress) => void, onLicense?: (l: Licence) => void, opts: { stdin?: string; phase?: Progress["phase"] } = {}) =>
    new Promise<void>((resolve, reject) => {
      const proc = deps.spawn(cmd, args);
      procs.add(proc);
      let out = "";
      // 提问边输出边数：out 只留最后 64KB，重新数会漏；carry 是上一段末尾可能是半个提问的部分
      let carry = "";
      let rejected = false;
      let phase: Progress["phase"] = opts.phase ?? "download";
      let pct: number | undefined;
      const report = () => emit({ id, phase, ...(pct === undefined ? {} : { pct }), logTail: tail(out) });
      if (opts.stdin !== undefined) proc.write(opts.stdin);
      proc.onOutput((chunk) => {
        out = (out + chunk).slice(-64 * 1024);
        // sdkmanager 的进度条形如 [====    ] 45% Downloading ...
        const m = [...chunk.matchAll(/\]\s*(\d{1,3})%/g)].at(-1);
        if (m) pct = Number(m[1]);
        const last = out.split(/[\r\n]+/).filter((l) => l.trim()).at(-1) ?? "";
        if (/Downloading/i.test(last)) phase = "download";
        else if (/Unzipping/i.test(last)) phase = "unpack";
        else if (/Installing/i.test(last)) phase = "install";
        const scan = carry + chunk;
        const asked = scan.split(ACCEPT_PROMPT).length > 1;
        carry = scan.slice(-(ACCEPT_PROMPT.length - 1));
        if (asked) {
          phase = "license";
          // 正文从标题“License <id>:”（冒号后换行）到提问为止；正文里的“License Agreement”不带冒号换行
          const end = out.lastIndexOf(ACCEPT_PROMPT);
          // 只在上一次提问之后找：sdkmanager 不回显 y，下一份的标题可能紧跟在上一个提问或进度条后面，不在行首
          const prev = out.lastIndexOf(ACCEPT_PROMPT, end - 1);
          const from = prev < 0 ? 0 : prev + ACCEPT_PROMPT.length;
          const head = /License ([\w.-]+):[ \t]*\r?\n/.exec(out.slice(from, end));
          const start = head ? from + head.index : from;
          const licence = { id: ++licenceSeq, name: head?.[1] ?? "", text: out.slice(start, end).trim() };
          waiting = {
            id: licence.id,
            proc,
            rejected: () => (rejected = true),
            answered: () => {
              phase = "install";
              report();
            },
          };
          onLicense?.(licence);
        }
        report();
      });
      proc.exit.then((code) => {
        procs.delete(proc);
        if (waiting?.proc === proc) waiting = null;
        if (rejected) reject(new StepError("没有同意许可证，没有安装"));
        else if (code === 0) resolve();
        else reject(new StepError(`${tail(out)}\n退出码 ${code}`.trim()));
      });
      report();
    });

  const installCmdlineTools = async (emit: (p: Progress) => void) => {
    const id = "cmdline-tools";
    const latest = join(deps.sdkRoot, "cmdline-tools/latest");
    if (existsSync(latest)) throw new StepError(`${latest} 已存在但不完整，请先手动移走它`);
    emit({ id, phase: "download", pct: 0, logTail: `读取 ${deps.manifestUrl}` });
    const res = await deps.fetch(deps.manifestUrl);
    if (!res.ok) throw new StepError(`读取清单失败：HTTP ${res.status}`);
    const found = findCmdlineTools(await res.text(), CMDLINE_TOOLS_REVISION);
    if (!found) throw new StepError(`清单里没有 macOS arm64 的命令行工具 ${CMDLINE_TOOLS_REVISION}`);
    const url = new URL(found.url, deps.manifestUrl).href;
    const tmp = join(deps.sdkRoot, ".emu-web-tmp");
    await mkdir(tmp, { recursive: true });
    try {
      const zip = join(tmp, "cmdline-tools.zip");
      const zres = await deps.fetch(url);
      if (!zres.ok || !zres.body) throw new StepError(`下载失败：HTTP ${zres.status}`);
      const hash = createHash("sha1");
      const file = createWriteStream(zip);
      let got = 0;
      let lastPct = -1;
      try {
        for await (const chunk of zres.body) {
          hash.update(chunk);
          got += chunk.length;
          if (!file.write(chunk)) await new Promise((r) => file.once("drain", r));
          const pct = found.size ? Math.min(100, Math.floor((got / found.size) * 100)) : 0;
          if (pct !== lastPct) {
            lastPct = pct;
            emit({ id, phase: "download", pct, logTail: `下载 ${url}` });
          }
        }
      } finally {
        await new Promise((r) => file.end(r));
      }
      const sha1 = hash.digest("hex");
      if (sha1 !== found.sha1) throw new StepError(`sha1 校验不通过（清单 ${found.sha1}，下载到的 ${sha1}），没有解压`);
      emit({ id, phase: "unpack", logTail: `sha1 ${sha1} 校验通过，解压中` });
      const staging = await mkdtemp(join(tmp, "unzip-"));
      await deps.unzip(zip, staging);
      // 下载期间别人建了 latest 也不覆盖
      if (existsSync(latest)) throw new StepError(`${latest} 已存在但不完整，请先手动移走它`);
      await mkdir(join(deps.sdkRoot, "cmdline-tools"), { recursive: true });
      // zip 里的顶层目录叫 cmdline-tools，官方要求放成 cmdline-tools/latest
      await rename(join(staging, "cmdline-tools"), latest);
      emit({ id, phase: "done", logTail: `已装到 ${latest}` });
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  };

  const createAvd = async (spec: AvdSpec | undefined, emit: (p: Progress) => void, onLicense?: (l: Licence) => void) => {
    if (!spec) throw new StepError("没有指定设备名、机型和系统版本");
    // avdmanager 会问要不要自定义硬件配置，答 no
    await runProc("avd", avdmanagerBin(deps.sdkRoot),
      ["create", "avd", "-n", spec.name, "-k", spec.image, "-d", spec.device], emit, onLicense, { stdin: "no\n", phase: "install" });
    await repairAvdTarget(spec.name, { avdHome: deps.avdHome });
    const ini = await readFile(join(deps.avdHome, `${spec.name}.ini`), "utf8").catch(() => "");
    const dir = /^path=(.*)$/m.exec(ini)?.[1]?.trim() ?? join(deps.avdHome, `${spec.name}.avd`);
    const config = join(dir, "config.ini");
    const text = await readFile(config, "utf8");
    const line = `hw.ramSize=${spec.ramMb}`;
    await writeFile(config, /^hw\.ramSize=.*$/m.test(text) ? text.replace(/^hw\.ramSize=.*$/m, line) : `${text.trimEnd()}\n${line}\n`);
    emit({ id: "avd", phase: "done", logTail: `已创建 ${spec.name}（内存 ${spec.ramMb} MB）` });
  };

  const installOne = async (id: string, emit: (p: Progress) => void, onLicense: ((l: Licence) => void) | undefined, spec: AvdSpec | undefined) => {
    if (id === "sdk") {
      await mkdir(deps.sdkRoot, { recursive: true });
      emit({ id, phase: "done", logTail: `已创建 ${deps.sdkRoot}` });
    } else if (id === "cmdline-tools") {
      await installCmdlineTools(emit);
    } else if (id === "avd") {
      await createAvd(spec, emit, onLicense);
    } else {
      const pkg = id === "system-image" && spec ? spec.image : SDK_PACKAGES[id];
      await runProc(id, sdkmanagerBin(deps.sdkRoot), [`--sdk_root=${deps.sdkRoot}`, "--install", pkg], emit, onLicense);
      emit({ id, phase: "done", logTail: "安装完成" });
    }
  };

  return {
    async run(ids, onProgress, onLicense, spec) {
      await deps.prepare?.();
      const todo = INSTALL_IDS.filter((id) => ids.includes(id));
      let failed: string | null = null;
      for (const id of todo) {
        if (failed) {
          onProgress({ id, phase: "failed", logTail: `${failed} 没装好，跳过` });
          continue;
        }
        try {
          await installOne(id, onProgress, onLicense, spec);
        } catch (e) {
          failed = id;
          onProgress({ id, phase: "failed", logTail: (e as Error).message });
        }
      }
    },
    acceptLicenses(id) {
      const w = waiting;
      if (!w || w.id !== id) return;
      waiting = null;
      w.proc.write("y\n");
      w.answered();
    },
    rejectLicenses(id) {
      const w = waiting;
      if (!w || w.id !== id) return;
      waiting = null;
      w.rejected();
      w.proc.write("n\n");
    },
    stop() {
      waiting = null;
      for (const p of procs) p.kill();
    },
  };
}

/** fetch，期间超过 idleMs 没收到任何数据（连接、响应头、正文）就中止。 */
export async function fetchWithIdle(url: string, idleMs: number): Promise<FetchResult> {
  const ac = new AbortController();
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

/** 真实依赖：网络用带空闲超时的 fetch，解压用系统 unzip，子进程带上 SDK / AVD 目录和 Java。 */
export function realInstallerDeps(opts: { sdkRoot: string; avdHome: string; manifestUrl: string; findJava: () => Promise<string | null> }): InstallerDeps {
  const env: Record<string, string | undefined> = {
    ...process.env,
    ANDROID_HOME: opts.sdkRoot,
    ANDROID_SDK_ROOT: opts.sdkRoot,
    ANDROID_AVD_HOME: opts.avdHome,
  };
  return {
    // 用户可能刚装了 Android Studio / JDK 再点安装：每轮都重新找
    prepare: async () => {
      const java = await opts.findJava();
      if (java) env.JAVA_HOME = java;
    },
    sdkRoot: opts.sdkRoot,
    avdHome: opts.avdHome,
    manifestUrl: opts.manifestUrl,
    // 60 秒没有任何数据就算断了（清单和 zip 都是）
    fetch: (url) => fetchWithIdle(url, 60_000),
    unzip: async (zip, dest) => {
      await execFileP("/usr/bin/unzip", ["-q", zip, "-d", dest]);
    },
    spawn: (cmd, args) => {
      const c = spawnCp(cmd, args, { env, stdio: ["pipe", "pipe", "pipe"] });
      const outs: Array<(s: string) => void> = [];
      const out = (s: string) => outs.forEach((cb) => cb(s));
      c.stdout.on("data", (d: Buffer) => out(d.toString()));
      c.stderr.on("data", (d: Buffer) => out(d.toString()));
      // 子进程已退出时写 stdin 会报 EPIPE，结果以退出码为准
      c.stdin.on("error", () => {});
      const exit = new Promise<number | null>((r) => {
        c.once("error", (e) => {
          out(`${e.message}\n`);
          r(127);
        });
        c.once("close", (code) => r(code));
      });
      return {
        onOutput: (cb) => void outs.push(cb),
        write: (s) => void c.stdin.write(s),
        kill: () => void c.kill(),
        exit,
      };
    },
  };
}
