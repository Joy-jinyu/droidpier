// 后台服务自己更新：定时比对公网页面上下载包的 sha256 和 install.sh 记下的那份，有新版就下载、校验、试运行，
// 换掉 ~/.local/bin/droidpier。正在跑的进程不受影响，等空闲时退出，launchd 用新文件把它拉起来（gateway/src/main.ts）
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fetchWithIdle } from "./installer.ts";
import { DOWNLOAD_NAME } from "./platform.ts";

export type UpdateResult = "updated" | "current" | "skipped" | "failed";

export type UpdateDeps = {
  /** 下载包所在的站点（公网页面的来源）。 */
  origin: string;
  /** 要换掉的可执行文件，和 install.sh 记下的已装压缩包 sha256。 */
  bin: string;
  stamp: string;
  fetchText(url: string): Promise<string>;
  download(url: string, dest: string): Promise<void>;
  sha256(file: string): Promise<string>;
  /** 解开 .tar.xz，返回里面的可执行文件路径。 */
  extract(xz: string, dir: string): Promise<string>;
  /** 新文件能不能跑：droidpier --version 正常退出、报出版本号。 */
  runs(bin: string): Promise<boolean>;
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, data: string): Promise<void>;
  mkdir(dir: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string): Promise<void>;
  log(s: string): void;
};

/** 查一次更新，有新版就装好。“skipped”：不是 install.sh 装的，或者这个版本在本机试过跑不起来。 */
export function createUpdater(d: UpdateDeps): { check(): Promise<UpdateResult> } {
  // 试运行失败的版本，这个进程里不再下载它，等下一个版本
  let bad = "";
  return {
    async check() {
      const installed = (await d.readFile(d.stamp))?.trim();
      if (!installed) return "skipped";
      const base = `${d.origin}/download/${DOWNLOAD_NAME}.tar.xz`;
      let want: string;
      try {
        want = (await d.fetchText(`${base}.sha256`)).split(/\s+/)[0];
      } catch (e) {
        d.log(`检查更新失败：${(e as Error).message}`);
        return "failed";
      }
      if (!/^[0-9a-f]{64}$/.test(want)) {
        d.log("检查更新失败：下载站的 sha256 文件不对");
        return "failed";
      }
      if (want === installed) return "current";
      if (want === bad) return "skipped";
      // 临时目录放在可执行文件旁边：同一块盘上才能用 rename 一步换好；名字固定，上次中途被打断留下的先删掉
      const tmp = join(dirname(d.bin), ".droidpier-update");
      await d.rm(tmp).catch(() => {});
      try {
        await d.mkdir(tmp);
        d.log("发现新版本，下载中");
        await d.download(base, join(tmp, `${DOWNLOAD_NAME}.tar.xz`));
        // sha256 和下载包同域：防下载损坏，防不了下载站本身被换（同 scripts/install.sh）
        const got = await d.sha256(join(tmp, `${DOWNLOAD_NAME}.tar.xz`));
        if (got !== want) throw new Error(`校验失败：sha256 应为 ${want}，下载到的是 ${got}`);
        const next = await d.extract(join(tmp, `${DOWNLOAD_NAME}.tar.xz`), tmp);
        if (!(await d.runs(next))) {
          bad = want;
          throw new Error("新版本在这台 Mac 上跑不起来，先不换");
        }
        await d.rename(next, d.bin);
        // 文件已经换了：记不下 sha256 也算更新好了，否则每小时都会再下载、再换一遍
        await d.writeFile(d.stamp, `${want}\n`).catch((e: Error) => d.log(`记录已装版本失败：${e.message}`));
        d.log(`已更新 ${d.bin}，空闲时重启换上`);
        return "updated";
      } catch (e) {
        d.log(`更新失败：${(e as Error).message}`);
        return "failed";
      } finally {
        await d.rm(tmp).catch(() => {});
      }
    },
  };
}

const run = (cmd: string, args: string[]) =>
  new Promise<string>((resolve, reject) =>
    execFile(cmd, args, { timeout: 60_000 }, (e, stdout) => (e ? reject(e) : resolve(stdout))),
  );

export function realUpdateDeps(o: { origin: string; bin: string; stamp: string; log: (s: string) => void }): UpdateDeps {
  // 跳转后的地址不能换协议：https 被跳到 http，路上的人就能把 .sha256 和下载包一起换掉（同 install.sh 的 --proto-redir）
  const get = async (url: string, idleMs: number) => {
    const r = await fetchWithIdle(url, idleMs);
    if (new URL(r.url).protocol !== new URL(o.origin).protocol) throw new Error(`下载被跳转到了 ${r.url}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r;
  };
  return {
    ...o,
    fetchText: async (url) => (await get(url, 30_000)).text(),
    download: async (url, dest) => {
      const r = await get(url, 60_000);
      if (!r.body) throw new Error("下载包是空的");
      await pipeline(Readable.from(r.body), createWriteStream(dest));
    },
    sha256: (file) =>
      new Promise((resolve, reject) => {
        const h = createHash("sha256");
        createReadStream(file).on("data", (c) => h.update(c)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
      }),
    extract: async (xz, dir) => {
      // macOS 自带的 tar 能解 xz（同 scripts/install.sh）
      await run("/usr/bin/tar", ["-xJf", xz, "-C", dir, DOWNLOAD_NAME]);
      const bin = join(dir, DOWNLOAD_NAME);
      await chmod(bin, 0o755);
      return bin;
    },
    runs: async (bin) => /^droidpier \S+/.test(await run(bin, ["--version"]).catch(() => "")),
    readFile: (p) => readFile(p, "utf8").catch(() => null),
    writeFile: (p, data) => writeFile(p, data),
    mkdir: (dir) => mkdir(dir, { recursive: true }).then(() => {}),
    rename: (from, to) => rename(from, to),
    rm: (p) => rm(p, { recursive: true, force: true }),
  };
}
