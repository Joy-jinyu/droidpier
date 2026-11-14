import { test } from "node:test";
import assert from "node:assert/strict";
import { createUpdater, type UpdateDeps } from "../src/self-update.ts";

const OLD = "a".repeat(64);
const NEW = "b".repeat(64);
const BIN = "/Users/someone/.local/bin/droidpier";
const STAMP = "/Users/someone/.local/share/droidpier/installed.sha256";

/** 假的下载站和文件系统：remote 是下载站上 .sha256 的内容，got 是下载到的文件算出来的 sha256。 */
function fake(o: { stamp?: string | null; remote?: string | Error; got?: string; runs?: boolean; stampFails?: boolean } = {}) {
  const files = new Map<string, string>();
  if (o.stamp !== null) files.set(STAMP, o.stamp ?? `${OLD}\n`);
  const calls: string[] = [];
  const log: string[] = [];
  const deps: UpdateDeps = {
    origin: "https://droid.devpier.dev",
    bin: BIN,
    stamp: STAMP,
    fetchText: async (url) => {
      calls.push(`fetch ${url}`);
      if (o.remote instanceof Error) throw o.remote;
      return o.remote ?? `${NEW}  droidpier-darwin-arm64.tar.xz\n`;
    },
    download: async (url, dest) => void calls.push(`download ${url} → ${dest}`),
    sha256: async () => o.got ?? NEW,
    extract: async (_xz, dir) => `${dir}/droidpier-darwin-arm64`,
    runs: async (bin) => (calls.push(`run ${bin}`), o.runs ?? true),
    readFile: async (p) => files.get(p) ?? null,
    writeFile: async (p, data) => {
      if (o.stampFails) throw new Error("disk full");
      files.set(p, data);
    },
    mkdir: async (dir) => void calls.push(`mkdir ${dir}`),
    rename: async (from, to) => void calls.push(`rename ${from} → ${to}`),
    rm: async (p) => void calls.push(`rm ${p}`),
    log: (s) => void log.push(s),
  };
  return { deps, files, calls, log };
}

test("下载站上的版本和装着的一样：不下载", async () => {
  const f = fake({ remote: `${OLD}  x\n` });
  assert.equal(await createUpdater(f.deps).check(), "current");
  assert.deepEqual(f.calls, ["fetch https://droid.devpier.dev/download/droidpier-darwin-arm64.tar.xz.sha256"]);
});

test("有新版本：下载到可执行文件旁边、校验、试运行，再换掉它并记下新的 sha256", async () => {
  const f = fake();
  assert.equal(await createUpdater(f.deps).check(), "updated");
  const tmp = "/Users/someone/.local/bin/.droidpier-update";
  assert.deepEqual(f.calls.slice(1), [
    `rm ${tmp}`,
    `mkdir ${tmp}`,
    `download https://droid.devpier.dev/download/droidpier-darwin-arm64.tar.xz → ${tmp}/droidpier-darwin-arm64.tar.xz`,
    `run ${tmp}/droidpier-darwin-arm64`,
    `rename ${tmp}/droidpier-darwin-arm64 → ${BIN}`,
    `rm ${tmp}`,
  ]);
  assert.equal(f.files.get(STAMP), `${NEW}\n`);
});

test("不是 install.sh 装的（没有记下的 sha256）：不查也不换", async () => {
  const f = fake({ stamp: null });
  assert.equal(await createUpdater(f.deps).check(), "skipped");
  assert.deepEqual(f.calls, []);
});

test("下载到的文件 sha256 对不上：不换，临时文件删掉", async () => {
  const f = fake({ got: "c".repeat(64) });
  assert.equal(await createUpdater(f.deps).check(), "failed");
  assert.ok(!f.calls.some((c) => c.startsWith("rename")));
  assert.equal(f.calls.at(-1), "rm /Users/someone/.local/bin/.droidpier-update");
  assert.equal(f.files.get(STAMP), `${OLD}\n`);
  assert.match(f.log.join("\n"), /校验失败/);
});

test("新版本跑不起来：不换；同一个版本之后不再下载，下载站出了新的再试", async () => {
  const f = fake({ runs: false });
  const u = createUpdater(f.deps);
  assert.equal(await u.check(), "failed");
  assert.ok(!f.calls.some((c) => c.startsWith("rename")));
  f.calls.length = 0;
  assert.equal(await u.check(), "skipped");
  assert.ok(!f.calls.some((c) => c.startsWith("download")));
});

test("连不上下载站、.sha256 内容不对：这次算失败，什么都不动", async () => {
  for (const remote of [new Error("offline"), "<html>not found</html>", ""]) {
    const f = fake({ remote });
    assert.equal(await createUpdater(f.deps).check(), "failed", String(remote));
    assert.ok(!f.calls.some((c) => c.startsWith("download")));
  }
});

test("文件换好了但记不下 sha256：仍算更新好了，等空闲重启，不会每小时再换一遍", async () => {
  const f = fake({ stampFails: true });
  assert.equal(await createUpdater(f.deps).check(), "updated");
  assert.ok(f.calls.some((c) => c.startsWith("rename")));
  assert.match(f.log.join("\n"), /记录已装版本失败/);
});
