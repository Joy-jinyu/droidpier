// 网关入口：发现模拟器、托管页面、经 WebSocket 转发画面和输入
import { fileURLToPath } from "node:url";
import { findOwnRunning } from "./discovery.ts";
import { connectEmulator, type EmulatorSession } from "./emulator.ts";
import { startServer } from "./server.ts";
import { deleteAvd, listAvds, renameAvd } from "./avd.ts";
import { startAvd, stopAvd } from "./lifecycle.ts";
import { cachedSession } from "./session-cache.ts";
import { avdHome, serviceLogPath, discoveryDir, emulatorBin, openBrowser, sdkRoot, SYS_IMG_MANIFEST_URL } from "./platform.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { checkEnv, realEnvDeps } from "./setup.ts";
import { cleanStaleInstallTmp, createInstaller, fetchWithIdle, realInstallerDeps, requireRepoUrl } from "./installer.ts";
import { buildCatalog, realCatalogDeps } from "./catalog.ts";
import { createWebViews, defaultFetchJson, defaultFetchVersion, findFreePort, FOREGROUND_CMD, makeAdbExec, parseAppBounds, parseResumedPkg, releasePort } from "./webviews.ts";
import { parseWmSize } from "./inspect.ts";
import { createLogcatHub, dumpLogcat, parseApps, readLogcat } from "./logcat.ts";
import type { LogFilter } from "../../shared/logcat.ts";
import { createReverses } from "./reverse.ts";
import { connectCdp } from "./cdp.ts";
import { adb, emulatorId, killAdbChildren } from "./adb.ts";
import { turnOffAutoPrivateDns } from "./private-dns.ts";
import { createPhones } from "./phones.ts";
import { execFile } from "node:child_process";
import { createMumu, MUMU_TOOL, mumuInstalled, probePort } from "./mumu.ts";
import { connectPhone, type PhoneDeps } from "./phone-session.ts";
import { materializeScrcpyServer, scrcpyServerPath } from "./scrcpy-server.ts";
import net from "node:net";
import { waitForReboot } from "./reboot.ts";
import { cleanupAll, exitHandler } from "./exit.ts";
import { allowedOrigins, PUBLIC_ORIGIN } from "./auth.ts";
import { buildPageUrl } from "./page-url.ts";
import { parseCli, USAGE, versionLine } from "./cli.ts";
import { checkPortFirst, explainBusyPort } from "./already-running.ts";
import { cleanStaleUploads } from "./upload-temp.ts";
import { realRotateIo, realServiceDeps, rotateLog, SERVICE_LABEL, serviceLabel, serviceLogs, serviceStart, serviceStatus, serviceStop } from "./service.ts";
import { tmpdir } from "node:os";
import { checkPending, cleanStaleWork, confirmStable, createAutoUpdater, firstWithin, realCleanDeps, DOWNLOAD_BASE, downloadBase, installLayout, newerNotice, realUpdaterDeps, RESTART_EXIT_CODE, toReport, updateOnce } from "./updater.ts";

// scripts/build-binary.ts 打包时把 DROIDPIER_VERSION 替换成构建时间；直接用源码跑时没有
declare const DROIDPIER_VERSION: string | undefined;
const VERSION = typeof DROIDPIER_VERSION === "string" ? DROIDPIER_VERSION : "";

// `nsh package ui --target web` 在仓库根目录运行时，产物落在根目录的 .nsh/out，不在 ui/.nsh/out（实测）
// 打成单个可执行文件后，scripts/build-binary.ts 用 --asset 把这个目录嵌在 import.meta.dir/Droidpier 下，node:fs 照常能读
const STANDALONE = (globalThis as { Bun?: { isStandaloneExecutable: boolean } }).Bun?.isStandaloneExecutable === true;
const STATIC_DIR = STANDALONE
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
const label = serviceLabel(process.env);
if (service && "label" in label) await rotateLog(serviceLogPath(label.label), realRotateIo).catch((e: Error) => console.log(`日志轮转失败：${e.message}`));

// 自动更新（gateway/src/updater.ts）：后台服务自己换上新版本；前台运行只在有新版本时打印一行
const layout = autoUpdate ? installLayout(process.execPath, STANDALONE) : null;
// DROIDPIER_DOWNLOAD 只给测试用：正式 label 的后台服务不认它，只从写死的地址更新
const dl = downloadBase(process.env, !service || ("label" in label && label.label !== SERVICE_LABEL));
if (service && !autoUpdate) console.log("自动更新已关闭（--no-auto-update）");
else if (service && !layout) console.log("不是安装命令装的程序，不自动更新");
if ("error" in dl) console.log(`${dl.error}，不检查更新`);
let srv: Awaited<ReturnType<typeof startServer>> | undefined;
// 新版本稳定运行一分钟后清掉启动计数的定时器（见下面 confirmStable）
let stableTimer: ReturnType<typeof setTimeout> | undefined;
const updaterDeps = layout
  ? realUpdaterDeps({ base: "base" in dl ? dl.base : DOWNLOAD_BASE, ...layout, version: VERSION, busy: () => srv?.busy() ?? null, log: (s) => console.log(s) })
  : null;
// 刚换上的新版本：数启动次数，起不来就换回旧版本
if (service && updaterDeps && (await checkPending(updaterDeps)) === "rolled-back") process.exit(RESTART_EXIT_CODE);
if (service && layout) await cleanStaleWork(realCleanDeps({ bin: layout.bin, log: (s) => console.log(s) }));
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

let updatedEarly = false;
const updater = updaterDeps && "base" in dl ? createAutoUpdater({
  check: service
    ? async () => {
        const r = await updateOnce(updaterDeps);
        if (r.kind === "updated") {
          if (srv) restart();
          else updatedEarly = true;
        }
        return toReport(r);
      }
    : newerNotice(updaterDeps),
  abort: () => updaterDeps.abort?.(),
  now: () => Date.now(),
  setTimer: (fn, ms) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
  random: Math.random,
  intervalMs: 30 * 60_000,
  jitterMs: 5 * 60_000,
  pageGapMs: 60_000,
}) : null;
// 尽早查一次（在连模拟器、查 SDK 之前）：哪个版本在后面的启动步骤里崩溃，下载站上的修复版本也能换上
// 最多等 10 秒：连不上（丢包）或下载慢时先把网关起起来，droidpier start 等的是网关应答；检查在后台接着做，
// 换上了新版本就在网关起来后重启（见下面 restart）。启动更后面才崩溃的版本靠 checkPending 换回
if (updater && service) {
  const first = await firstWithin(updater.start(), 10_000, (fn, ms) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  });
  if (updatedEarly) process.exit(RESTART_EXIT_CODE);
  if (first === null) console.log("检查更新超过 10 秒，先启动网关，检查在后台接着做");
} else if (updater) void updater.start();

let lastNote = "";
const note = (s: string) => {
  if (s !== lastNote) console.log(s);
  lastNote = s;
};

let serial: number | undefined;
let last: EmulatorSession | null = null;

// 真机列表：discover 要靠它认出真机 id，所以先建
const phones = createPhones({ stream: adb.stream, exec: adb.device });

// pidof 在 App 没运行时返回码非零，当作没有 pid
const logcatPidof = (id: string, pkg: string) =>
  adb.device(id)(["shell", "pidof", pkg]).then((out) => out.trim().split(/\s+/).filter(Boolean).map(Number), () => [] as number[]);
// 日志面板：每台设备一个 adb logcat，有页面订阅才运行（gateway/src/logcat.ts）
const logcat = createLogcatHub({
  stream: (id, h) => adb.stream(["-s", id, "logcat", "-v", "threadtime", "-T", "500"], h),
  pidof: logcatPidof,
  log: note,
});
const logcatRead = async (id: string, f: LogFilter, limit: number) => {
  const dump = await dumpLogcat((n) => adb.device(id)(["logcat", "-d", "-v", "threadtime", "-t", String(n)]));
  const pids = f.pkg === null ? [] : await logcatPidof(id, f.pkg);
  return readLogcat(dump, pids, f, limit);
};
const apps = async (id: string) => ({
  foreground: await adb.device(id)(FOREGROUND_CMD).then(parseResumedPkg, () => null),
  apps: await adb.device(id)(["shell", "ps", "-A", "-o", "USER,NAME"]).then(parseApps, () => []),
});
phones.start();
// MuMu 模拟器：读设备列表、开关机，开机后替它连 adb（gateway/src/mumu.ts）。mumutool 一般一秒内返回，15 秒是我定的上限
const mumu = createMumu({
  tool: mumuInstalled()
    ? (args) => new Promise((resolve, reject) => execFile(MUMU_TOOL, args, { timeout: 15_000 }, (e, out) => (e ? reject(e) : resolve(out))))
    : undefined,
  probe: probePort,
  connect: (addr) => adb.run(["connect", addr]),
  connected: () => phones.list().filter((p) => p.state === "device").map((p) => p.id),
  log: note,
});
mumu.start();

/** 真机会话用到的 adb 操作，按设备 id 绑定。 */
const phoneDeps = (id: string): PhoneDeps => ({
  jarPath: () => materializeScrcpyServer(scrcpyServerPath(STANDALONE), tmpdir()),
  push: (local, remote) => adb.long(id)(["push", local, remote], 60_000).then(() => {}),
  freePort: findFreePort,
  releasePort,
  forward: (port, scid) => adb.device(id)(["forward", `tcp:${port}`, `localabstract:scrcpy_${scid}`]).then(() => {}),
  removeForward: (port) => adb.device(id)(["forward", "--remove", `tcp:${port}`]).then(() => {}),
  startServer: (cmd, h) => adb.stream(["-s", id, "shell", cmd], h),
  connect: (port) => new Promise((res, rej) => {
    const sock = net.connect(port, "127.0.0.1");
    sock.once("connect", () => res(sock));
    sock.once("error", rej);
  }),
  screencap: () => adb.deviceBuffer(id)(["exec-out", "screencap", "-p"], 10_000),
  // USB 慢时 adb reboot 可能超过短命令的 5 秒；报错由重启流程按「已在重启」处理（gateway/src/server.ts 的 reboot）
  reboot: () => adb.long(id)(["reboot"], 15_000).then(() => {}),
  log: note,
});

async function discover(avdName?: string): Promise<EmulatorSession | null> {
  // 真机：连不上时把原因抛给 use，页面能看到（模拟器那边吞成 null 是因为 ticker 会反复发现）
  if (avdName && phones.list().some((p) => p.id === avdName && p.state === "device")) {
    const s = await connectPhone(avdName, phoneDeps(avdName));
    last = s;
    note(`已连接真机 ${avdName}（${s.device.width}x${s.device.height}）`);
    s.onClosed(() => note(`真机 ${avdName} 已断开`));
    return s;
  }
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
    // 不等它：模拟器可能还在开机，等开机完成后在后台改（gateway/src/private-dns.ts）
    void turnOffAutoPrivateDns({
      exec: adb.device(emulatorId(running.serial)),
      now: () => Date.now(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      log: (m) => note(`emulator-${running.serial}：${m}`),
    });
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


srv = await startServer({
  port,
  phones,
  mumu,
  logcat,
  apps,
  logcatRead,
  version: VERSION,
  service,
  update: { autoUpdate: service && updater !== null, request: () => updater!.request(), last: () => updater?.last() ?? null },
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
      // freePort 保留的端口只有 releasePort 才放回，两个必须成对传
      const webviews = createWebViews({ exec, fetchJson: defaultFetchJson, fetchVersion: defaultFetchVersion, freePort: findFreePort, releasePort });
      const reverses = createReverses(exec);
      // 网关自动重连过这台设备后，adb server 已经撤掉了它的 forward / reverse：忘掉旧记录，下次用到时重新建
      const off = adb.onReconnect(id, () => {
        webviews.forget();
        reverses.forget();
      });
      return {
        webviews: { ...webviews, close: () => (off(), webviews.close()) },
        reverses,
        appBounds: (pkg) => exec(["shell", "dumpsys", "window", "windows"]).then((out) => parseAppBounds(out, pkg)),
        displaySize: () => exec(["shell", "wm", "size"]).then(parseWmSize),
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
// 新版本稳定运行一分钟后不再数它的启动次数
// 要重启时取消（restart、cleanup）：这一分钟里后台检查换上了更新的版本，计数属于那个版本，不能被这里删掉
stableTimer = service && updaterDeps
  ? setTimeout(() => void confirmStable(updaterDeps).catch((e: Error) => console.log(`记录新版本运行正常失败：${e.message}`)), 60_000)
  : undefined;
console.log(`droidpier: ${pageUrl}  (${first ? `emulator-${serial}` : "no emulator"})`);
// 终端里只提示，不提问：安装要在页面上确认
if (!env.ok) {
  console.log(`打开页面完成安装：${pageUrl}`);
  for (const m of env.missing) console.log(`  缺 ${m.id}：${m.detail}`);
}
if (!noOpen) openBrowser(pageUrl, (e) => console.log(`打开浏览器失败：${e.message}`));

// 收到退出信号和自动更新后重启共用一次清理
let cleaning: Promise<void> | null = null;
const cleanup = () => (cleaning ??= (async () => {
  clearTimeout(stableTimer);
  // 结束 adb track-devices，不留孤儿进程
  phones.stop();
  mumu.stop();
  await cleanupAll({
    // 中止进行中的下载，等它删掉临时目录
    stopUpdater: updater ? () => updater.stop() : undefined,
    // 正在进行的下载和解压不能留在网关后面
    stopInstaller: () => installer.stop(),
    // srv.close() 会收掉当前设备的 webviews.close() 和 reverses.removeAll()
    closeServer: srv ? () => srv!.close() : undefined,
  });
  last?.close();
  // 等取消订阅时异步删除 mmap 临时文件
  await new Promise((r) => setTimeout(r, 200));
})());
/** 后台服务收到退出信号后的退出码：128 + SIGTERM(15)，shell 里被信号杀掉的惯例。 */
const SIGNAL_EXIT_CODE = 143;
const onSignal = exitHandler({
  cleanup,
  exit: (code) => process.exit(code),
  // 后台服务被 kill、在活动监视器里退出时按非 0 退出，launchd 照崩溃处理、把它拉起来（KeepAlive.SuccessfulExit=false）；
  // droidpier stop 用 launchctl bootout：launchd 先卸下服务再发 SIGTERM，这时退出码不起作用
  code: service ? SIGNAL_EXIT_CODE : 0,
  timeoutMs: 3000,
  log: (s) => console.log(s),
});
// 新版本已经换上：清理后以非 0 退出，launchd（KeepAlive.SuccessfulExit=false）马上拉起新的可执行文件。
// 不用 launchctl kickstart -k 自己杀自己：退出码不依赖 label、uid 和 launchctl，plist 是旧版本写的也一样
const restartNow = exitHandler({ cleanup, exit: () => process.exit(RESTART_EXIT_CODE), timeoutMs: 3000, log: (s) => console.log(s) });
let restarting = false;
function restart() {
  if (restarting) return;
  restarting = true;
  clearTimeout(stableTimer);
  srv?.notifyUpdate({ state: "restarting" });
  // 让 restarting 先发到页面
  setTimeout(() => void restartNow(), 300);
}
// 网关起来之前后台的第一次检查已经换上了新版本
if (updatedEarly) restart();
// 清理超时被强制退出时也不留下卡住的 adb 进程
process.on("exit", killAdbChildren);
process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);
process.on("SIGHUP", onSignal);
