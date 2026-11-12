import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../../scripts/install.sh", import.meta.url));
const NAME = "droidpier-darwin-arm64";

/** 假的下载站：一个打成 .tar.xz 的小脚本代替真可执行文件，sha256 可以故意写错。 */
async function fixture(t: { after(fn: () => unknown): void }, opts: { badSha?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "emu-install-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const files = join(dir, "files");
  const home = join(dir, "home");
  await mkdir(files);
  await mkdir(home);
  await writeFile(join(dir, NAME), "#!/bin/sh\necho fake-gateway\n");
  await chmod(join(dir, NAME), 0o644);
  execFileSync("/usr/bin/tar", ["-cJf", join(files, `${NAME}.tar.xz`), "-C", dir, NAME]);
  const sha = createHash("sha256").update(await readFile(join(files, `${NAME}.tar.xz`))).digest("hex");
  await writeFile(join(files, `${NAME}.tar.xz.sha256`), `${opts.badSha ? "0".repeat(64) : sha}  ${NAME}.tar.xz\n`);

  const requests: string[] = [];
  const srv = createServer(async (req, res) => {
    requests.push(req.url ?? "");
    try {
      res.end(await readFile(join(files, (req.url ?? "").slice(1))));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;

  // 必须异步跑：同步等子进程会卡住同一个进程里的假下载站
  const run = (env: Record<string, string> = {}) =>
    new Promise<{ status: number; stdout: string; stderr: string }>((res) => {
      const env2 = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: home, DROIDPIER_DOWNLOAD: base, ...env };
      execFile("/bin/sh", [SCRIPT], { encoding: "utf8", env: env2, timeout: 20_000 }, (e, stdout, stderr) =>
        res({ status: e ? (typeof e.code === "number" ? e.code : 1) : 0, stdout, stderr }),
      );
    });
  return { dir, home, run, requests, base };
}

test("install.sh：下载、校验后装到 ~/.local/bin，装好的文件能运行，PATH 里没有时提示怎么加", async (t) => {
  const { home, run } = await fixture(t);
  const r = await run();
  assert.equal(r.status, 0, r.stderr);
  const target = join(home, ".local/bin/droidpier");
  assert.equal(execFileSync(target, { encoding: "utf8" }).trim(), "fake-gateway");
  assert.match(r.stdout, /不在 PATH 里/);
  assert.match(r.stdout, /export PATH="\$HOME\/\.local\/bin:\$PATH"/);
  assert.match(r.stdout, /运行 droidpier 启动/);
});

test("install.sh：~/.local/bin 已在 PATH 里就不提示", async (t) => {
  const { home, run } = await fixture(t);
  const r = await run({ PATH: `${join(home, ".local/bin")}:/usr/bin:/bin:/usr/sbin:/sbin` });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /不在 PATH 里/);
});

test("install.sh：sha256 对不上就失败，不留下文件", async (t) => {
  const { home, run } = await fixture(t, { badSha: true });
  const r = await run();
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /校验失败/);
  await assert.rejects(stat(join(home, ".local/bin/droidpier")));
});

test("install.sh：不是 darwin-arm64 时说明只支持 Apple 芯片的 Mac，不下载", async (t) => {
  const { dir, home, run, requests } = await fixture(t);
  const fakeBin = join(dir, "fake-bin");
  await mkdir(fakeBin);
  await writeFile(join(fakeBin, "uname"), '#!/bin/sh\n[ "$1" = "-s" ] && echo Linux || echo x86_64\n');
  await chmod(join(fakeBin, "uname"), 0o755);
  const r = await run({ PATH: `${fakeBin}:/usr/bin:/bin:/usr/sbin:/sbin` });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /只支持 Apple 芯片的 Mac（darwin-arm64），这台机器是 Linux-x86_64/);
  assert.deepEqual(requests, []);
  await assert.rejects(stat(join(home, ".local/bin/droidpier")));
});

test("install.sh：下载地址不是 https（本机测试地址除外）时拒绝，不装任何东西", async (t) => {
  const { home, run, base } = await fixture(t);
  // 同一个假下载站，换成 localhost 主机名：不是 https、也不是 127.0.0.1 测试地址，必须拒绝
  const r = await run({ DROIDPIER_DOWNLOAD: base.replace("127.0.0.1", "localhost") });
  assert.notEqual(r.status, 0);
  await assert.rejects(stat(join(home, ".local/bin/droidpier")));
});
