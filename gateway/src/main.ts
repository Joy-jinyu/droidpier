// 网关入口：发现模拟器、托管页面、经 WebSocket 转发画面和输入
import { fileURLToPath } from "node:url";
import { findOwnRunning } from "./discovery.ts";
import { connectEmulator, type EmulatorSession } from "./emulator.ts";
import { startServer } from "./server.ts";
import { listAvds } from "./avd.ts";
import { startAvd, stopAvd } from "./lifecycle.ts";
import { cachedSession } from "./session-cache.ts";
import { avdHome, avdmanagerBin, cmdlineToolsManifestUrl, discoveryDir, emulatorBin, findJavaHome, openBrowser, sdkRoot, SYS_IMG_MANIFEST_URL } from "./platform.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { checkEnv, realEnvDeps } from "./setup.ts";
import { createInstaller, fetchWithIdle, realInstallerDeps } from "./installer.ts";
import { buildCatalog, realCatalogDeps } from "./catalog.ts";
import { createWebViews, defaultFetchJson, findFreePort, makeAdbExec, releasePort } from "./webviews.ts";
import { createReverses } from "./reverse.ts";
import { connectCdp } from "./cdp.ts";
import { adb, killAdbChildren } from "./adb.ts";
import { waitForReboot } from "./reboot.ts";
import { exitHandler } from "./exit.ts";
import { allowedOrigins, isOrigin, PUBLIC_ORIGIN } from "./auth.ts";
import { buildPageUrl, DEFAULT_PORT } from "./page-url.ts";
import { explainBusyPort } from "./already-running.ts";

// scripts/build-binary.ts 打包时把 DROIDPIER_VERSION 替换成构建时间；直接用源码跑时没有
declare const DROIDPIER_VERSION: string | undefined;
const VERSION = typeof DROIDPIER_VERSION === "string" ? DROIDPIER_VERSION : "";

// `nsh package ui --target web` 在仓库根目录运行时，产物落在根目录的 .nsh/out，不在 ui/.nsh/out（实测）
// 打成单个可执行文件后，scripts/build-binary.ts 用 --asset 把这个目录嵌在 import.meta.dir/Droidpier 下，node:fs 照常能读
const STATIC_DIR = (globalThis as { Bun?: { isStandaloneExecutable: boolean } }).Bun?.isStandaloneExecutable
  ? join(import.meta.dirname, "Droidpier")
  : fileURLToPath(new URL("../../.nsh/out/Droidpier", import.meta.url));

const portArg = process.argv.indexOf("--port");
const port = portArg > 0 ? Number(process.argv[portArg + 1]) : DEFAULT_PORT;
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`--port 不合法：${process.argv[portArg + 1]}`);
  process.exit(1);
}
const noOpen = process.argv.includes("--no-open");
// 默认打开公网页面；--local 改为打开本机页面；--public 是兼容别名，不改行为（见 gateway/src/page-url.ts）
// 本地模拟公网页面时临时放行的来源，例如 --allow-origin http://droid.test:7351
const extraOrigins = process.argv.flatMap((a, i) => (process.argv[i - 1] === "--allow-origin" ? [a] : []));
for (const o of extraOrigins) {
  if (!isOrigin(o)) {
    console.error(`--allow-origin 不合法：${o}（要写成 http://主机:端口）`);
    process.exit(1);
  }
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

const env = await checkEnv(realEnvDeps());
const installer = createInstaller(realInstallerDeps({ sdkRoot: sdkRoot(), avdHome: avdHome(), manifestUrl: cmdlineToolsManifestUrl(), findJava: () => findJavaHome() }));
const catalogDeps = realCatalogDeps({
  sdkRoot: sdkRoot(),
  avdHome: avdHome(),
  avdmanager: avdmanagerBin(),
  manifestUrl: SYS_IMG_MANIFEST_URL,
  findJava: () => findJavaHome(),
  fetchText: async (url) => {
    const r = await fetchWithIdle(url, 60_000);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  },
});
const first = await getSession();
const srv = await startServer({
  port,
  version: VERSION,
  allowedOrigins: allowedOrigins(PUBLIC_ORIGIN, port, extraOrigins),
  staticDir: STATIC_DIR,
  getSession,
  // 开机完成以 sys.boot_completed 为准；adb 一直不通时最多等 120 秒，之后以画面为准
  rebootWait: (serial) => waitForReboot({
    check: () => adb.device(serial)(["shell", "getprop", "sys.boot_completed"]),
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    maxMs: 120_000,
    pollMs: 1000,
  }),
  // 还没装模拟器程序时没有 emulator -list-avds 可跑，设备列表就是空的
  avd: { list: async () => (existsSync(emulatorBin()) ? listAvds() : []), start: (name) => startAvd(name), stop: (serial) => stopAvd(serial), use: getSession.use },
  setup: {
    check: () => checkEnv(realEnvDeps()),
    installer,
    catalog: () => buildCatalog(catalogDeps),
  },
  debug: {
    forDevice: (serial) => {
      const exec = makeAdbExec(serial);
      return {
        // freePort 保留的端口只有 releasePort 才放回，两个必须成对传
        webviews: createWebViews({ serial, exec, fetchJson: defaultFetchJson, freePort: findFreePort, releasePort }),
        reverses: createReverses(exec),
      };
    },
    connectCdp,
  },
}).catch(async (e: NodeJS.ErrnoException) => {
  if (e.code !== "EADDRINUSE") throw e;
  // 再运行一次安装命令时常见：同一个端口上已经有一个 droidpier
  last?.close();
  const pageUrl = buildPageUrl(process.argv, port);
  const r = await explainBusyPort({ port, pageUrl, ownVersion: VERSION });
  for (const l of r.lines) (r.code ? console.error : console.log)(l);
  if (r.code === 0 && !noOpen) openBrowser(pageUrl, (err) => console.log(`打开浏览器失败：${err.message}`));
  process.exit(r.code);
});
const pageUrl = buildPageUrl(process.argv, srv.port);
console.log(`droidpier: ${pageUrl}  (${first ? `emulator-${serial}` : "no emulator"})`);
// 终端里只提示，不提问：安装要在页面上确认
if (!env.ok) {
  console.log(`打开页面完成安装：${pageUrl}`);
  for (const m of env.missing) console.log(`  缺 ${m.id}：${m.detail}${m.command ? `\n    手动安装：${m.command}` : ""}`);
}
if (!noOpen) openBrowser(pageUrl, (e) => console.log(`打开浏览器失败：${e.message}`));

const onSignal = exitHandler({
  cleanup: async () => {
    // 正在跑的 sdkmanager / avdmanager 不能留在网关后面
    installer.stop();
    // srv.close() 会收掉当前设备的 webviews.close() 和 reverses.removeAll()
    await srv.close();
    last?.close();
    // 等取消订阅时异步删除 mmap 临时文件
    await new Promise((r) => setTimeout(r, 200));
  },
  exit: (code) => process.exit(code),
  timeoutMs: 3000,
  log: (s) => console.log(s),
});
// 清理超时被强制退出时也不留下卡住的 adb 进程
process.on("exit", killAdbChildren);
process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);
process.on("SIGHUP", onSignal);
