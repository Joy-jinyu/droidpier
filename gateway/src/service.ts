// 后台运行：用当前用户的 LaunchAgent（launchd）跑网关，关闭终端不影响，登录后自动启动，崩溃后自动拉起
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { parseCli } from "./cli.ts";
import { portHolder, probePort, type PortHolder } from "./already-running.ts";
import { buildPageUrl } from "./page-url.ts";
import { launchAgentPath, openBrowser, SERVICE_LABEL, serviceLogPath } from "./platform.ts";

export { SERVICE_LABEL };

/** launchd 不读 shell 配置，只给这个 PATH；网关用到的系统命令都在里面。 */
const SERVICE_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

/** 带进 plist 的环境变量：SDK、AVD、Java 放在非默认位置的用户靠它们。这次运行 start 时没设就沿用上次存的。 */
const PASSED_ENV = ["ANDROID_HOME", "ANDROID_AVD_HOME", "JAVA_HOME"];

const LAUNCHCTL = "/bin/launchctl";

export type ExecResult = { code: number; stdout: string; stderr: string };

export type ServiceDeps = {
  label: string;
  uid: number;
  home: string;
  /** 启动网关的命令：打包好的可执行文件，或者 node + main.ts（从源码运行时）。 */
  program: string[];
  env: Record<string, string | undefined>;
  exec(cmd: string, args: string[]): Promise<ExecResult>;
  /** 文件不存在时返回 null。 */
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, data: string): Promise<void>;
  mkdir(dir: string): Promise<void>;
  rm(path: string): Promise<void>;
  /** 端口空着返回 null；会试着绑一下端口，服务可能正在启动时不要用。 */
  holder(port: number): Promise<PortHolder | null>;
  /** 只问 /healthz，不碰端口；没有 droidpier 应答时返回 null。pid 为 null 表示对方没报（旧版本）。 */
  health(port: number): Promise<{ version: string | null; service: boolean; pid: number | null } | null>;
  open(url: string): void;
  sleep(ms: number): Promise<void>;
  log(s: string): void;
  /** 启动后最多等多久网关应答。 */
  waitMs: number;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** LaunchAgent 的 plist。KeepAlive.SuccessfulExit=false：崩溃（非 0 退出、被杀）后重启，正常退出不重启。 */
export function plistXml(o: { label: string; program: string[]; args: string[]; logPath: string; env: Record<string, string> }): string {
  const str = (s: string) => `<string>${esc(s)}</string>`;
  const env = { PATH: SERVICE_PATH, ...o.env };
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
    `<plist version="1.0">`,
    `<dict>`,
    `  <key>Label</key>`,
    `  ${str(o.label)}`,
    `  <key>ProgramArguments</key>`,
    `  <array>`,
    ...[...o.program, "--service", ...o.args].map((a) => `    ${str(a)}`),
    `  </array>`,
    `  <key>RunAtLoad</key>`,
    `  <true/>`,
    `  <key>KeepAlive</key>`,
    `  <dict>`,
    `    <key>SuccessfulExit</key>`,
    `    <false/>`,
    `  </dict>`,
    `  <key>ThrottleInterval</key>`,
    `  <integer>10</integer>`,
    `  <key>EnvironmentVariables</key>`,
    `  <dict>`,
    ...Object.entries(env).flatMap(([k, v]) => [`    <key>${esc(k)}</key>`, `    ${str(v)}`]),
    `  </dict>`,
    `  <key>StandardOutPath</key>`,
    `  ${str(o.logPath)}`,
    `  <key>StandardErrorPath</key>`,
    `  ${str(o.logPath)}`,
    `</dict>`,
    `</plist>`,
    ``,
  ].join("\n");
}

function programArgs(xml: string): string[] {
  const m = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(xml);
  return m ? [...m[1].matchAll(/<string>([\s\S]*?)<\/string>/g)].map((x) => unesc(x[1])) : [];
}

/** 从自己写的 plist 读回 --service 后面的用户参数。 */
export function argsFromPlist(xml: string): string[] {
  const all = programArgs(xml);
  const i = all.indexOf("--service");
  return i < 0 ? [] : all.slice(i + 1);
}

/** plist 里启动网关的命令（--service 之前的部分）。 */
function programFromPlist(xml: string): string[] {
  const all = programArgs(xml);
  const i = all.indexOf("--service");
  return i < 0 ? all : all.slice(0, i);
}

/** plist 里存的环境变量。 */
function envFromPlist(xml: string): Record<string, string> {
  const m = /<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/.exec(xml);
  const env: Record<string, string> = {};
  for (const x of m?.[1].matchAll(/<key>([\s\S]*?)<\/key>\s*<string>([\s\S]*?)<\/string>/g) ?? []) env[unesc(x[1])] = unesc(x[2]);
  return env;
}

/** DROIDPIER_SERVICE_LABEL（只给测试用）要能安全地拼进文件名和 launchctl 的目标名。 */
export function serviceLabel(env: Record<string, string | undefined>): { label: string } | { error: string } {
  const v = env.DROIDPIER_SERVICE_LABEL;
  if (!v) return { label: SERVICE_LABEL };
  return /^[A-Za-z0-9.-]+$/.test(v) && !v.includes("..") ? { label: v } : { error: `DROIDPIER_SERVICE_LABEL 不合法：${v}（只能有字母、数字、点和减号）` };
}

const paths = (d: ServiceDeps) => ({ plist: launchAgentPath(d.label, d.home), log: serviceLogPath(d.label, d.home) });
const target = (d: ServiceDeps) => `gui/${d.uid}/${d.label}`;

/** launchd 里这个服务的状态：没加载、加载了但没在跑（pid 为 null）、在跑。 */
async function state(d: ServiceDeps): Promise<{ loaded: boolean; pid: number | null }> {
  const r = await d.exec(LAUNCHCTL, ["print", target(d)]);
  if (r.code !== 0) return { loaded: false, pid: null };
  // 只看第一层（一个 tab 缩进）的 pid，里面嵌套的段落也有同名字段
  const m = /^\tpid = (\d+)$/m.exec(r.stdout);
  return { loaded: true, pid: m ? Number(m[1]) : null };
}

async function tail(d: ServiceDeps, n: number): Promise<string[] | null> {
  const s = await d.readFile(paths(d).log);
  if (s === null) return null;
  const lines = s.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.slice(-n);
}

function portOf(args: string[]): number | null {
  const r = parseCli(args);
  return r.kind === "run" ? r.options.port : null;
}

/** 写好 plist 并（重新）启动后台服务，等网关应答后打开一次页面。 */
export async function serviceStart(d: ServiceDeps, o: { args: string[]; noOpen: boolean }): Promise<number> {
  const p = paths(d);
  const prev = await d.readFile(p.plist);
  // 不带参数时沿用上次的参数，这样更新后重启不会把 --port 丢掉
  const args = o.args.length ? o.args : prev ? argsFromPlist(prev) : [];
  const port = portOf(args);
  if (port === null) {
    d.log(`后台服务的参数不对：${args.join(" ")}。重新指定参数运行 droidpier start，例如 droidpier start --port 7300`);
    return 1;
  }
  const prevEnv = prev ? envFromPlist(prev) : {};
  const env: Record<string, string> = {};
  for (const k of PASSED_ENV) {
    const v = d.env[k] || prevEnv[k];
    if (v) env[k] = v;
  }
  const xml = plistXml({ label: d.label, program: d.program, args, logPath: p.log, env });

  const before = await state(d);
  // 服务没在跑，或者要换到另一个端口：先看目标端口有没有被别人占着
  const prevPort = prev ? portOf(argsFromPlist(prev)) : null;
  if (before.pid === null || prevPort !== port) {
    const h = await d.holder(port);
    if (h) {
      d.log(
        h.kind === "droidpier"
          ? `端口 ${port} 上已经有一个 droidpier 在运行（多半是在另一个终端里前台运行的）。先在那个终端按 Ctrl+C 停掉它，再运行 droidpier start`
          : `端口 ${port} 被别的程序占用了，后台服务没有启动。换一个端口：droidpier start --port ${port + 1}`,
      );
      return 1;
    }
  }

  if (prev && programFromPlist(prev).join(" ") !== d.program.join(" ")) d.log(`后台服务改为运行 ${d.program.join(" ")}`);
  await d.mkdir(dirname(p.plist));
  await d.mkdir(dirname(p.log));
  await d.writeFile(p.plist, xml);
  if (before.loaded && prev === xml) {
    // 配置没变：kickstart -k 杀掉旧进程再起，更新后的可执行文件就换上了
    const r = await d.exec(LAUNCHCTL, ["kickstart", "-k", target(d)]);
    if (r.code !== 0) {
      d.log(`launchctl kickstart 失败：${(r.stderr || r.stdout).trim()}`);
      return 1;
    }
  } else {
    if (before.loaded) await d.exec(LAUNCHCTL, ["bootout", target(d)]);
    // bootout 返回时旧进程可能还在退出，这时 bootstrap 会失败，过一会儿再试
    let r: ExecResult | null = null;
    for (let i = 0; i < 10; i++) {
      r = await d.exec(LAUNCHCTL, ["bootstrap", `gui/${d.uid}`, p.plist]);
      if (r.code === 0) break;
      await d.sleep(500);
    }
    if (r && r.code !== 0) {
      d.log(`launchctl bootstrap 失败：${(r.stderr || r.stdout).trim()}`);
      return 1;
    }
  }

  const pageUrl = buildPageUrl(args, port);
  let pid: number | null = null;
  for (let waited = 0; ; waited += 500) {
    const s = await state(d);
    // 只认 launchd 拉起的那个进程的应答：同一个端口上也可能有前台运行的 droidpier
    const h = s.pid !== null && s.pid !== before.pid ? await d.health(port) : null;
    if (h?.service && h.pid === s.pid) {
      pid = s.pid;
      break;
    }
    if (waited >= d.waitMs) break;
    await d.sleep(500);
  }
  if (pid === null) {
    d.log(`droidpier 后台服务没有启动起来。日志：${p.log}`);
    for (const l of (await tail(d, 20)) ?? []) d.log(`  ${l}`);
    return 1;
  }
  d.log("droidpier 已在后台运行，关闭终端不影响；开机后自动启动");
  d.log(`  页面：${pageUrl}`);
  d.log("  停止：droidpier stop");
  d.log("  查看状态：droidpier status");
  d.log(`  日志：${p.log}`);
  if (!o.noOpen) d.open(pageUrl);
  return 0;
}

/** 停掉后台服务并删掉 plist：开机也不再启动，droidpier start 重新打开。 */
export async function serviceStop(d: ServiceDeps): Promise<number> {
  const p = paths(d);
  const xml = await d.readFile(p.plist);
  const s = await state(d);
  if (!s.loaded && xml === null) {
    d.log("droidpier 没有在后台运行");
    return 0;
  }
  if (s.loaded) {
    const r = await d.exec(LAUNCHCTL, ["bootout", target(d)]);
    if (r.code !== 0 && (await state(d)).loaded) {
      d.log(`launchctl bootout 失败：${(r.stderr || r.stdout).trim()}`);
      return 1;
    }
  }
  await d.rm(p.plist);
  // bootout 返回时网关还在退出清理（最多 3 秒），launchd 这时仍列着它；等它真正退出，
  // 紧接着再运行 droidpier、droidpier start 或 status 才不会撞上正在退出的旧进程（2026-11-13 实测）
  let listed = (await state(d)).loaded;
  for (let waited = 0; waited < d.waitMs && listed; waited += 200) {
    await d.sleep(200);
    listed = (await state(d)).loaded;
  }
  if (listed) {
    d.log("droidpier 后台服务还在退出，稍后用 droidpier status 查看；开机不会再自动启动");
    return 0;
  }
  d.log("已停止 droidpier 后台服务，开机也不会再自动启动。再次启动：droidpier start");
  return 0;
}

/** 后台服务在不在跑、pid、端口、版本、页面和日志位置；在跑退出码 0，否则 1。 */
export async function serviceStatus(d: ServiceDeps): Promise<number> {
  const p = paths(d);
  const xml = await d.readFile(p.plist);
  const args = xml ? argsFromPlist(xml) : [];
  const port = portOf(args) ?? portOf([])!;
  const s = await state(d);
  if (s.pid !== null) {
    const h = await d.health(port);
    d.log("droidpier 正在后台运行");
    d.log(`  pid：${s.pid}`);
    d.log(`  端口：${port}${h ? "" : "（没有应答，可能还在启动）"}`);
    if (h?.version) d.log(`  版本：${h.version}`);
    d.log(`  页面：${buildPageUrl(args, port)}`);
    d.log(`  日志：${p.log}`);
    return 0;
  }
  if (s.loaded || xml !== null) {
    d.log("droidpier 已设成后台运行，但现在没有在运行（可能启动失败了）");
    d.log("  看日志：droidpier logs");
    d.log("  重新启动：droidpier start");
    return 1;
  }
  d.log("droidpier 没有在后台运行。启动：droidpier start");
  const h = await d.holder(port);
  if (h?.kind === "droidpier") d.log(`端口 ${port} 上有一个在终端里前台运行的 droidpier`);
  return 1;
}

/** 打印日志位置和最后 50 行。 */
export async function serviceLogs(d: ServiceDeps): Promise<number> {
  const { log } = paths(d);
  const lines = await tail(d, 50);
  if (lines === null) {
    d.log(`还没有日志：${log}`);
    return 0;
  }
  d.log(`日志：${log}（最后 ${lines.length} 行）`);
  for (const l of lines) d.log(l);
  return 0;
}

/** 真实的依赖。label 来自 serviceLabel()：DROIDPIER_SERVICE_LABEL 只给测试用，换一个 label，不碰正式的后台服务。 */
export function realServiceDeps(label: string): ServiceDeps {
  const standalone = (globalThis as { Bun?: { isStandaloneExecutable: boolean } }).Bun?.isStandaloneExecutable;
  return {
    label,
    uid: process.getuid!(),
    home: homedir(),
    program: standalone ? [process.execPath] : [process.execPath, ...process.execArgv, process.argv[1]],
    env: process.env,
    exec: (cmd, args) =>
      new Promise((res) =>
        execFile(cmd, args, { encoding: "utf8", timeout: 30_000 }, (e, stdout, stderr) =>
          res({ code: e ? (typeof e.code === "number" ? e.code : 1) : 0, stdout, stderr }),
        ),
      ),
    readFile: (p) => readFile(p, "utf8").catch(() => null),
    writeFile: (p, s) => writeFile(p, s),
    mkdir: async (dir) => void (await mkdir(dir, { recursive: true })),
    rm: (p) => rm(p, { force: true }),
    holder: (port) => portHolder(port),
    health: async (port) => {
      const h = await probePort(port, 1000);
      return h.kind === "droidpier" ? { version: h.version, service: h.service === true, pid: h.pid ?? null } : null;
    },
    open: (url) => openBrowser(url, (e) => console.log(`打开浏览器失败：${e.message}`)),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (s) => console.log(s),
    waitMs: 30_000,
  };
}
