// 网关入口：发现模拟器、托管页面、经 WebSocket 转发画面和输入
import { fileURLToPath } from "node:url";
import { findOwnRunning } from "./discovery.ts";
import { connectEmulator, type EmulatorSession } from "./emulator.ts";
import { startServer } from "./server.ts";
import { deleteAvd, listAvds, renameAvd } from "./avd.ts";
import { startAvd, stopAvd } from "./lifecycle.ts";
import { cachedSession } from "./session-cache.ts";
import { avdHome, installedPaths, serviceLogPath, discoveryDir, emulatorBin, openBrowser, sdkRoot, SYS_IMG_MANIFEST_URL } from "./platform.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { checkEnv, realEnvDeps } from "./setup.ts";
import { cleanStaleInstallTmp, createInstaller, fetchWithIdle, realInstallerDeps, requireRepoUrl } from "./installer.ts";
import { buildCatalog, realCatalogDeps } from "./catalog.ts";
import { createWebViews, defaultFetchJson, findFreePort, makeAdbExec, releasePort } from "./webviews.ts";
import { createReverses } from "./reverse.ts";
import { connectCdp } from "./cdp.ts";
import { adb, killAdbChildren } from "./adb.ts";
import { waitForReboot } from "./reboot.ts";
import { exitHandler } from "./exit.ts";
import { createUpdater, realUpdateDeps } from "./self-update.ts";
import { allowedOrigins, PUBLIC_ORIGIN } from "./auth.ts";
import { buildPageUrl } from "./page-url.ts";
import { parseCli, USAGE, versionLine } from "./cli.ts";
import { checkPortFirst, explainBusyPort } from "./already-running.ts";
import { cleanStaleUploads } from "./upload-temp.ts";
import { realRotateIo, realServiceDeps, rotateLog, serviceLabel, serviceLogs, serviceStart, serviceStatus, serviceStop } from "./service.ts";
import { tmpdir } from "node:os";

// scripts/build-binary.ts 打包时把 DROIDPIER_VERSION 替换成构建时间；直接用源码跑时没有
declare const DROIDPIER_VERSION: string | undefined;
const VERSION = typeof DROIDPIER_VERSION === "string" ? DROIDPIER_VERSION : "";
/** 多久查一次有没有新版本：一次只取一个很小的 .sha256 文件。 */
const UPDATE_CHECK_MS = 60 * 60_000;
/** 换好新版本后退出用的码：非 0，launchd 当作崩溃、用新文件拉起来（KeepAlive.SuccessfulExit=false，gateway/src/service.ts）。 */
const UPDATED_EXIT_CODE = 75;

// `nsh package ui --target web` 在仓库根目录运行时，产物落在根目录的 .nsh/out，不在 ui/.nsh/out（实测）
// 打成单个可执行文件后，scripts/build-binary.ts 用 --asset 把这个目录嵌在 import.meta.dir/Droidpier 下，node:fs 照常能读
const STATIC_DIR = (globalThis as { Bun?: { isStandaloneExecutable: boolean } }).Bun?.isStandaloneExecutable
  ? join(import.meta.dirname, "Droidpier")
  : fileURLToPath(new URL("../../.nsh/out/Droidpier", import.meta.url));

// --help / --version / 参数有错都在这里退出，不碰端口、SDK 和模拟器
const cli = parseCli(process.argv.slice(2));
if (cli.kind === "help") {
  console.log(USAGE);
  process.exit(0);
}
if (cli.kind === "version") {
  console.log(versionLine(VERSION));
  process.exit(0);
}
if (cli.kind === "error") {
  console.error(`${cli.message}\n\n${USAGE}`);
  process.exit(1);
}
if (cli.kind === "service") {
  if (process.platform !== "darwin") {
    console.error("后台运行目前只支持 macOS；在终端里直接运行 droidpier");
    process.exit(1);
  }
  const l = serviceLabel(process.env);
  if ("error" in l) {
    console.error(l.error);
    process.exit(1);
  }
  const d = realServiceDeps(l.label);
  const run = { start: () => serviceStart(d, { args: cli.args, noOpen: cli.noOpen }), stop: () => serviceStop(d), status: () => serviceStatus(d), logs: () => serviceLogs(d) };
  process.exit(await run[cli.command]());
}
const { port, noOpen, allowOrigins: extraOrigins, service, autoUpdate } = cli.options;
if (service) {
  const l = serviceLabel(process.env);
  if ("label" in l) await rotateLog(serviceLogPath(l.label), realRotateIo).catch((e: Error) => console.log(`日志轮转失败：${e.message}`));
}
// 默认打开公网页面；--local 改为打开本机页面；--public 是兼容别名，不改行为（见 gateway/src/page-url.ts）

/** 端口被占时打印判断、需要时打开页面，然后退出。后台服务一律按正常退出，launchd 不会每 10 秒重试一次。 */
function exitBusy(r: { code: 0 | 1; lines: string[] }, pageUrl: string): never {
  for (const l of r.lines) (r.code ? console.error : console.log)(l);
  if (r.code === 0 && !noOpen) openBrowser(pageUrl, (err) => console.log(`打开浏览器失败：${err.message}`));
  process.exit(service ? 0 : r.code);
}

// 再运行一次安装命令时常见：同一个端口上已经有一个 droidpier。先查端口，免得连上模拟器再退出
{
  const pageUrl = buildPageUrl(process.argv, port);
  const r = await checkPortFirst({ port, pageUrl, ownVersion: VERSION });
  if (r) exitBusy(r, pageUrl);
}

let lastNote = "";
const note = (s: string) => {
  if (s !== lastNote) console.log(s);
  lastNote = s;
};

let serial: number | undefined;
let last: EmulatorSession | null = null;

async function discover(avdName?: string): Promise<EmulatorSession | null> {
  const running = await findOwnRunning(avdName);
  if (!running) {
    note(`没有找到带 gRPC 的运行中模拟器${avdName ? ` ${avdName}` : ""}（${discoveryDir()}）`);
    return null;
  }
  try {
    const s = await connectEmulator(running);
    serial = running.serial;
    last = s;
    note(`已连接 emulator-${running.serial}（gRPC ${running.grpcPort}，${s.device.width}x${s.device.height}）`);
    s.onClosed(() => note(`emulator-${running.serial} 已退出`));
    return s;
  } catch (e) {
    note((e as Error).message);
    return null;
  }
}

const getSession = cachedSession(discover);

void cleanStaleUploads(tmpdir(), Date.now());
void cleanStaleInstallTmp(sdkRoot(), Date.now());
const env = await checkEnv(realEnvDeps());
const installer = createInstaller(realInstallerDeps({ sdkRoot: sdkRoot(), avdHome: avdHome() }));
const catalogDeps = realCatalogDeps({
  sdkRoot: sdkRoot(),
  avdHome: avdHome(),
  manifestUrl: SYS_IMG_MANIFEST_URL,
  fetchText: async (url) => {
    const r = await fetchWithIdle(url, 60_000);
    requireRepoUrl(r.url, "系统镜像清单跳转后");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  },
});
const first = await getSession();
const srv = await startServer({
  port,
  version: VERSION,
  service,
  allowedOrigins: allowedOrigins(PUBLIC_ORIGIN, port, extraOrigins),
  staticDir: STATIC_DIR,
  getSession,
  // 开机完成以 sys.boot_completed 为准；adb 一直不通时最多等 120 秒，之后以画面为准
  rebootWait: (id) => waitForReboot({
    check: () => adb.device(id)(["shell", "getprop", "sys.boot_completed"]),
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    maxMs: 120_000,
    pollMs: 1000,
  }),
  // 还没装模拟器程序时没有 emulator -list-avds 可跑，设备列表就是空的
  avd: { list: async () => (existsSync(emulatorBin()) ? listAvds() : []), start: (name) => startAvd(name), stop: (serial) => stopAvd(serial), use: getSession.use, rename: (name, displayName) => renameAvd(name, displayName), delete: (name) => deleteAvd(name) },
  setup: {
    check: () => checkEnv(realEnvDeps()),
    installer,
    catalog: () => buildCatalog(catalogDeps),
  },
  // 装大 APK 要几分钟；走单独的长任务队列，不挡 H5 列表这类短命令（gateway/src/adb.ts）
  files: { adb: (id, args) => adb.long(id)(args, 10 * 60_000) },
  debug: {
    forDevice: (id) => {
      const exec = makeAdbExec(id);
      return {
        // freePort 保留的端口只有 releasePort 才放回，两个必须成对传
        webviews: createWebViews({ exec, fetchJson: defaultFetchJson, freePort: findFreePort, releasePort }),
        reverses: createReverses(exec),
      };
    },
    connectCdp,
  },
}).catch(async (e: NodeJS.ErrnoException) => {
  if (e.code !== "EADDRINUSE") throw e;
  // 启动前查过端口还是被抢了（两次几乎同时运行）
  last?.close();
  const pageUrl = buildPageUrl(process.argv, port);
  exitBusy(await explainBusyPort({ port, pageUrl, ownVersion: VERSION }), pageUrl);
});
const pageUrl = buildPageUrl(process.argv, srv.port);
console.log(`droidpier: ${pageUrl}  (${first ? `emulator-${serial}` : "no emulator"})`);
// 终端里只提示，不提问：安装要在页面上确认
if (!env.ok) {
  console.log(`打开页面完成安装：${pageUrl}`);
  for (const m of env.missing) console.log(`  缺 ${m.id}：${m.detail}`);
}
if (!noOpen) openBrowser(pageUrl, (e) => console.log(`打开浏览器失败：${e.message}`));

const cleanup = async () => {
  // 正在进行的下载和解压不能留在网关后面
  installer.stop();
  // srv.close() 会收掉当前设备的 webviews.close() 和 reverses.removeAll()
  await srv.close();
  last?.close();
  // 等取消订阅时异步删除 mmap 临时文件
  await new Promise((r) => setTimeout(r, 200));
};
// 平时清理完以 0 退出；自动更新换好文件后改成 UPDATED_EXIT_CODE 再走同一个处理，清理途中来信号也只清理一次
let cleanExitCode = 0;
const onSignal = exitHandler({
  cleanup,
  exit: (code) => process.exit(code === 0 ? cleanExitCode : code),
  timeoutMs: 3000,
  log: (s) => console.log(s),
});
// 清理超时被强制退出时也不留下卡住的 adb 进程
process.on("exit", killAdbChildren);
process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);
process.on("SIGHUP", onSignal);

// 自动更新只在 install.sh 装的那个打包版作为后台服务运行时做：前台运行退出了没人拉起来，从源码运行没有下载包可比
const installed = installedPaths();
if (service && autoUpdate && VERSION && process.execPath !== installed.bin) {
  console.log(`不自动更新：运行的是 ${process.execPath}，不是安装命令装的 ${installed.bin}`);
} else if (service && autoUpdate && VERSION) {
  const updater = createUpdater(realUpdateDeps({ origin: PUBLIC_ORIGIN, ...installed, log: (s) => console.log(s) }));
  let checkedAt = 0;
  let checking = false;
  let updated = false;
  const timer = setInterval(async () => {
    // 下载慢的时候一次检查可能跨过下一轮：上一轮没完就不开新的
    if (!checking && !updated && Date.now() - checkedAt >= UPDATE_CHECK_MS) {
      checking = true;
      checkedAt = Date.now();
      updated = (await updater.check()) === "updated";
      checking = false;
    }
    if (updated && srv.idle()) {
      clearInterval(timer);
      console.log("新版本已装好，现在没人在用，重启换上");
      cleanExitCode = UPDATED_EXIT_CODE;
      await onSignal();
    }
  }, 60_000).unref();
}
