import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../../scripts/install.sh", import.meta.url));
const NAME = "droidpier-darwin-arm64";

/** 假的下载站：一个打成 .tar.xz 的小脚本代替真可执行文件，sha256 可以故意写错；publish 换一版内容。 */
async function fixture(t: { after(fn: () => unknown): void }, opts: { badSha?: boolean; old?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "emu-install-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const files = join(dir, "files");
  const home = join(dir, "home");
  await mkdir(files);
  await mkdir(home);
  await mkdir(join(dir, "tmp"));
  // 新版的 --help 里有 droidpier start；old 模拟还不支持后台运行的旧版本
  const publish = async (label: string, old = opts.old ?? false) => {
    const help = old ? "" : `[ "$1" = --help ] && { printf '用法：\\n  droidpier start\\n'; exit 0; }\n`;
    await writeFile(join(dir, NAME), `#!/bin/sh\n${help}echo ${label} "$@"\n`);
    await chmod(join(dir, NAME), 0o644);
    execFileSync("/usr/bin/tar", ["-cJf", join(files, `${NAME}.tar.xz`), "-C", dir, NAME]);
    const sha = createHash("sha256").update(await readFile(join(files, `${NAME}.tar.xz`))).digest("hex");
    await writeFile(join(files, `${NAME}.tar.xz.sha256`), `${opts.badSha ? "0".repeat(64) : sha}  ${NAME}.tar.xz\n`);
  };
  await publish("fake-gateway");

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
  let open = true;
  const stop = () => new Promise<void>((r) => (open ? ((open = false), srv.close(() => r())) : r()));
  t.after(stop);
  const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;

  // 必须异步跑：同步等子进程会卡住同一个进程里的假下载站
  const run = (env: Record<string, string> = {}, args: string[] = []) =>
    new Promise<{ status: number; stdout: string; stderr: string }>((res) => {
      const env2 = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: home, TMPDIR: join(dir, "tmp"), DROIDPIER_DOWNLOAD: base, ...env };
      execFile("/bin/sh", [SCRIPT, ...args], { encoding: "utf8", env: env2, timeout: 20_000 }, (e, stdout, stderr) =>
        res({ status: e ? (typeof e.code === "number" ? e.code : 1) : 0, stdout, stderr }),
      );
    });
  return { dir, home, run, requests, base, publish, stop };
}

const ARCHIVE = `/${NAME}.tar.xz`;
const SHA = `/${NAME}.tar.xz.sha256`;

test("install.sh：第一次运行下载、校验、装到 ~/.local/bin，然后用 droidpier start 在后台启动", async (t) => {
  const { dir, home, run, requests } = await fixture(t);
  const r = await run();
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(await readdir(join(dir, "tmp")), [], "启动前要删掉临时下载目录");
  const target = join(home, ".local/bin/droidpier");
  assert.equal(execFileSync(target, { encoding: "utf8" }).trim(), "fake-gateway");
  assert.deepEqual(requests, [SHA, ARCHIVE]);
  assert.match(r.stdout, /不在 PATH 里/);
  assert.match(r.stdout, /export PATH="\$HOME\/\.local\/bin:\$PATH"/);
  assert.match(r.stdout, /在后台启动 droidpier\nfake-gateway start\n$/);
  assert.doesNotMatch(r.stdout, /保持这个终端开着/);
});

test("install.sh：已装且 sha256 没变时只取 .sha256，不重新下载，直接（重新）启动后台服务", async (t) => {
  const { run, requests } = await fixture(t);
  assert.equal((await run({ DROIDPIER_NO_START: "1" })).status, 0);
  requests.length = 0;
  const r = await run();
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(requests, [SHA]);
  assert.match(r.stdout, /已是最新版本/);
  assert.match(r.stdout, /fake-gateway start\n$/);
});

test("install.sh：远端 sha256 变了就重新下载、替换，再用 droidpier start 换上新版本", async (t) => {
  const { run, requests, publish } = await fixture(t);
  assert.equal((await run({ DROIDPIER_NO_START: "1" })).status, 0);
  await publish("fake-gateway-v2");
  requests.length = 0;
  const r = await run();
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(requests, [SHA, ARCHIVE]);
  assert.match(r.stdout, /更新 droidpier/);
  assert.match(r.stdout, /fake-gateway-v2 start\n$/);
});

test("install.sh：已装但没有记录过 sha256（旧版脚本装的）时当作更新重新下载", async (t) => {
  const { home, run, requests } = await fixture(t);
  assert.equal((await run({ DROIDPIER_NO_START: "1" })).status, 0);
  await rm(join(home, ".local/share/droidpier/installed.sha256"));
  requests.length = 0;
  const r = await run({ DROIDPIER_NO_START: "1" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(requests, [SHA, ARCHIVE]);
  assert.match(r.stdout, /更新 droidpier/);
});

test("install.sh：DROIDPIER_NO_START=1 只安装不启动，并说明怎么启动", async (t) => {
  const { home, run } = await fixture(t);
  const r = await run({ DROIDPIER_NO_START: "1" });
  assert.equal(r.status, 0, r.stderr);
  await stat(join(home, ".local/bin/droidpier"));
  assert.doesNotMatch(r.stdout, /fake-gateway/);
  assert.match(r.stdout, /运行 droidpier start 在后台启动/);
});

test("install.sh：脚本参数原样传给 droidpier start（curl … | sh -s -- --port 7310），由它存进后台服务", async (t) => {
  const { home, base } = await fixture(t);
  const env = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: home, DROIDPIER_DOWNLOAD: base };
  const r = await new Promise<{ status: number; stdout: string; stderr: string }>((res) => {
    const c = execFile("/bin/sh", ["-s", "--", "--port", "7310", "--no-open"], { encoding: "utf8", env, timeout: 20_000 }, (e, stdout, stderr) =>
      res({ status: e ? (typeof e.code === "number" ? e.code : 1) : 0, stdout, stderr }),
    );
    readFile(SCRIPT).then((src) => c.stdin!.end(src));
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /fake-gateway start --port 7310 --no-open\n$/);
});

test("install.sh：DROIDPIER_FOREGROUND=1 照旧在这个终端里前台运行", async (t) => {
  const { run } = await fixture(t);
  const r = await run({ DROIDPIER_FOREGROUND: "1" }, ["--port", "7310"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /启动 droidpier（保持这个终端开着；按 Ctrl\+C 停止）\nfake-gateway --port 7310\n$/);
});

test("install.sh：已装的 droidpier 不认识 start（离线时留着的旧版本）时退回前台运行", async (t) => {
  const { run } = await fixture(t, { old: true });
  const r = await run({}, ["--port", "7310"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /已装的 droidpier 不支持后台运行，在这个终端里前台运行（保持终端开着）\nfake-gateway --port 7310\n$/);
});

test("install.sh：下载站连不上但已经装过时，提示后启动已装的版本", async (t) => {
  const { run, stop } = await fixture(t);
  assert.equal((await run({ DROIDPIER_NO_START: "1" })).status, 0);
  await stop();
  const r = await run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /连不上下载站/);
  assert.match(r.stdout, /fake-gateway start\n$/);
});

test("install.sh：下载站连不上又没装过时失败", async (t) => {
  const { home, run, stop } = await fixture(t);
  await stop();
  const r = await run();
  assert.notEqual(r.status, 0);
  await assert.rejects(stat(join(home, ".local/bin/droidpier")));
});

test("install.sh：~/.local/bin 已在 PATH 里就不提示", async (t) => {
  const { home, run } = await fixture(t);
  const r = await run({ PATH: `${join(home, ".local/bin")}:/usr/bin:/bin:/usr/sbin:/sbin`, DROIDPIER_NO_START: "1" });
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
