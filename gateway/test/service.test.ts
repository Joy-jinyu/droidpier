import { test } from "node:test";
import assert from "node:assert/strict";
import { argsFromPlist, plistXml, rotateLog, serviceLabel, serviceLogs, serviceStart, serviceStatus, serviceStop, SERVICE_LABEL, type ServiceDeps } from "../src/service.ts";

const HOME = "/Users/someone";
const PLIST = `${HOME}/Library/LaunchAgents/${SERVICE_LABEL}.plist`;
const LOG = `${HOME}/Library/Logs/Droidpier/droidpier.log`;
const BIN = `${HOME}/.local/bin/droidpier`;

type Holder = { kind: "droidpier"; version: string | null; service?: boolean } | { kind: "other" } | null;

/** 假的 launchd + 文件系统 + 端口：bootstrap 读 plist 起一个新 pid，kickstart -k 换 pid，bootout 停掉。 */
function fake(o: { files?: Record<string, string>; loaded?: boolean; pid?: number | null; holder?: Holder; startsOk?: boolean; env?: Record<string, string>; slowExit?: number; foreground?: boolean; kickstartFails?: boolean } = {}) {
  const files: Record<string, string> = { ...o.files };
  const calls: string[] = [];
  const out: string[] = [];
  const opened: string[] = [];
  let loaded = o.loaded ?? false;
  let pid: number | null = o.pid ?? null;
  let nextPid = 500;
  // bootout 返回后，launchd 还要列着这个服务几次 print（进程在退出清理）
  let exiting = 0;
  const startsOk = o.startsOk ?? true;
  const spawn = () => (pid = startsOk ? nextPid++ : null);
  const deps: ServiceDeps = {
    label: SERVICE_LABEL,
    uid: 501,
    home: HOME,
    program: [BIN],
    env: o.env ?? {},
    exec: async (cmd, args) => {
      calls.push([cmd, ...args].join(" "));
      assert.equal(cmd, "/bin/launchctl");
      const [sub] = args;
      if (sub === "print") {
        if (exiting > 0) {
          exiting--;
          if (exiting === 0) loaded = false;
          return { code: 0, stdout: `gui/501/${SERVICE_LABEL} = {\n\tstate = running\n\tpid = 499\n}\n`, stderr: "" };
        }
        if (!loaded) return { code: 113, stdout: "", stderr: "Could not find service" };
        return { code: 0, stdout: `gui/501/${SERVICE_LABEL} = {\n\tstate = ${pid ? "running" : "not running"}\n${pid ? `\tpid = ${pid}\n` : ""}\tenvironment = {\n\t\tstate = nested\n\t}\n}\n`, stderr: "" };
      }
      if (sub === "bootstrap") {
        if (loaded) return { code: 5, stdout: "", stderr: "Bootstrap failed: 5: Input/output error" };
        assert.ok(files[args[2]], "bootstrap 前 plist 要写好");
        loaded = true;
        spawn();
        return { code: 0, stdout: "", stderr: "" };
      }
      if (sub === "kickstart") {
        if (o.kickstartFails) return { code: 37, stdout: "", stderr: "Operation already in progress" };
        spawn();
        return { code: 0, stdout: "", stderr: "" };
      }
      if (sub === "bootout") {
        pid = null;
        if (o.slowExit) exiting = o.slowExit;
        else loaded = false;
        return { code: 0, stdout: "", stderr: "" };
      }
      throw new Error(`没想到的 launchctl 调用：${args.join(" ")}`);
    },
    readFile: async (p) => files[p] ?? null,
    writeFile: async (p, s) => void (files[p] = s),
    mkdir: async () => {},
    rm: async (p) => void delete files[p],
    holder: async () => o.holder ?? null,
    // foreground：端口上应答的是一个前台运行的 droidpier，不是 launchd 拉起的那个
    health: async () => (o.foreground ? { version: "x", service: false, pid: 42 } : pid ? { version: "2026-11-13T00:00:00.000Z", service: true, pid } : null),
    open: (url) => void opened.push(url),
    sleep: async () => {},
    log: (s) => void out.push(s),
    waitMs: 2000,
  };
  return { deps, files, calls, out, opened, state: () => ({ loaded, pid }) };
}

test("plistXml：开机启动、崩溃后重启、正常退出不重启，日志和 PATH 都写进去", () => {
  const xml = plistXml({ label: SERVICE_LABEL, program: [BIN], args: ["--port", "7310"], logPath: LOG, env: { ANDROID_HOME: "/sdk & co" } });
  assert.match(xml, /<key>Label<\/key>\s*<string>dev\.devpier\.droidpier<\/string>/);
  assert.match(xml, /<key>ProgramArguments<\/key>\s*<array>\s*<string>\/Users\/someone\/\.local\/bin\/droidpier<\/string>\s*<string>--service<\/string>\s*<string>--port<\/string>\s*<string>7310<\/string>\s*<\/array>/);
  assert.match(xml, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(xml, /<key>KeepAlive<\/key>\s*<dict>\s*<key>SuccessfulExit<\/key>\s*<false\/>\s*<\/dict>/);
  assert.match(xml, /<key>ThrottleInterval<\/key>\s*<integer>10<\/integer>/);
  assert.match(xml, new RegExp(`<key>StandardOutPath</key>\\s*<string>${LOG}</string>`));
  assert.match(xml, new RegExp(`<key>StandardErrorPath</key>\\s*<string>${LOG}</string>`));
  assert.match(xml, /<key>PATH<\/key>\s*<string>\/usr\/bin:\/bin:\/usr\/sbin:\/sbin<\/string>/);
  assert.match(xml, /<key>ANDROID_HOME<\/key>\s*<string>\/sdk &amp; co<\/string>/);
});

test("argsFromPlist：读回 --service 后面的用户参数", () => {
  const xml = plistXml({ label: SERVICE_LABEL, program: ["/usr/bin/node", "/a&b/main.ts"], args: ["--port", "7310", "--local"], logPath: LOG, env: {} });
  assert.deepEqual(argsFromPlist(xml), ["--port", "7310", "--local"]);
  assert.deepEqual(argsFromPlist("<plist/>"), []);
});

test("start：第一次写 plist、bootstrap，等网关应答后打开页面，说明关闭终端不影响", async () => {
  const f = fake();
  assert.equal(await serviceStart(f.deps, { args: [], noOpen: false }), 0);
  assert.ok(f.files[PLIST]);
  assert.deepEqual(argsFromPlist(f.files[PLIST]), []);
  assert.ok(f.calls.includes(`/bin/launchctl bootstrap gui/501 ${PLIST}`));
  assert.equal(f.state().loaded, true);
  assert.deepEqual(f.opened, ["https://droid.devpier.dev/app/"]);
  const text = f.out.join("\n");
  assert.match(text, /已在后台运行，关闭终端不影响；开机后自动启动/);
  assert.match(text, /停止：droidpier stop/);
  assert.match(text, /查看状态：droidpier status/);
  assert.ok(text.includes(LOG));
});

test("start：参数写进 plist；--no-open 不打开浏览器，也不写进 plist", async () => {
  const f = fake();
  assert.equal(await serviceStart(f.deps, { args: ["--port", "7310"], noOpen: true }), 0);
  assert.deepEqual(argsFromPlist(f.files[PLIST]), ["--port", "7310"]);
  assert.deepEqual(f.opened, []);
  assert.match(f.out.join("\n"), /#port=7310/);
});

test("start：shell 里设了 ANDROID_HOME / ANDROID_AVD_HOME 时带进 plist（launchd 不读 shell 配置）", async () => {
  const f = fake({ env: { ANDROID_HOME: "/opt/sdk", ANDROID_AVD_HOME: "/opt/avd" } });
  await serviceStart(f.deps, { args: [], noOpen: true });
  assert.match(f.files[PLIST], /<key>ANDROID_HOME<\/key>\s*<string>\/opt\/sdk<\/string>/);
  assert.match(f.files[PLIST], /<key>ANDROID_AVD_HOME<\/key>\s*<string>\/opt\/avd<\/string>/);
});

test("start：已在运行且配置没变时 kickstart -k 重启（更新后换上新文件）", async () => {
  const f = fake();
  await serviceStart(f.deps, { args: ["--port", "7310"], noOpen: true });
  const before = f.state().pid;
  f.calls.length = 0;
  assert.equal(await serviceStart(f.deps, { args: [], noOpen: true }), 0);
  assert.ok(f.calls.includes(`/bin/launchctl kickstart -k gui/501/${SERVICE_LABEL}`));
  assert.ok(!f.calls.some((c) => c.includes("bootout")));
  assert.notEqual(f.state().pid, before);
  assert.deepEqual(argsFromPlist(f.files[PLIST]), ["--port", "7310"], "不带参数时沿用上次的参数");
});

test("start：已在运行但参数变了时先 bootout 再 bootstrap，换上新 plist", async () => {
  const f = fake();
  await serviceStart(f.deps, { args: [], noOpen: true });
  f.calls.length = 0;
  assert.equal(await serviceStart(f.deps, { args: ["--port", "7311"], noOpen: true }), 0);
  const i = f.calls.indexOf(`/bin/launchctl bootout gui/501/${SERVICE_LABEL}`);
  assert.ok(i >= 0);
  assert.ok(f.calls.indexOf(`/bin/launchctl bootstrap gui/501 ${PLIST}`) > i);
  assert.deepEqual(argsFromPlist(f.files[PLIST]), ["--port", "7311"]);
});

test("start：端口上已有前台运行的 droidpier 时说明先停掉它，不写 plist", async () => {
  const f = fake({ holder: { kind: "droidpier", version: null } });
  assert.equal(await serviceStart(f.deps, { args: [], noOpen: false }), 1);
  assert.equal(f.files[PLIST], undefined);
  assert.ok(!f.calls.some((c) => c.includes("bootstrap")));
  assert.match(f.out.join("\n"), /端口 7300 上已经有一个 droidpier 在运行/);
  assert.match(f.out.join("\n"), /Ctrl\+C/);
  assert.deepEqual(f.opened, []);
});

test("start：端口被别的程序占着时建议换端口，不写 plist", async () => {
  const f = fake({ holder: { kind: "other" } });
  assert.equal(await serviceStart(f.deps, { args: [], noOpen: true }), 1);
  assert.equal(f.files[PLIST], undefined);
  assert.match(f.out.join("\n"), /droidpier start --port 7301/);
});

test("start：等不到网关应答时报失败，给出日志位置和最后几行", async () => {
  const f = fake({ startsOk: false, files: { [LOG]: "第一行\n找不到模拟器\n" } });
  assert.equal(await serviceStart(f.deps, { args: [], noOpen: false }), 1);
  const text = f.out.join("\n");
  assert.match(text, /没有启动起来/);
  assert.ok(text.includes(LOG));
  assert.match(text, /找不到模拟器/);
  assert.deepEqual(f.opened, []);
});

test("start：保存过的参数不合法时报错，不动 launchd", async () => {
  const f = fake();
  assert.equal(await serviceStart(f.deps, { args: ["--port", "abc"], noOpen: true }), 1);
  assert.deepEqual(f.calls, []);
});

test("stop：bootout 并删掉 plist（开机不再启动）", async () => {
  const f = fake();
  await serviceStart(f.deps, { args: [], noOpen: true });
  f.out.length = 0;
  assert.equal(await serviceStop(f.deps), 0);
  assert.ok(f.calls.includes(`/bin/launchctl bootout gui/501/${SERVICE_LABEL}`));
  assert.equal(f.files[PLIST], undefined);
  assert.equal(f.state().loaded, false);
  assert.match(f.out.join("\n"), /已停止/);
  assert.match(f.out.join("\n"), /droidpier start/);
});

test("stop：bootout 返回后等 launchd 真正放掉这个服务再说已停止", async () => {
  const f = fake({ slowExit: 3 });
  await serviceStart(f.deps, { args: [], noOpen: true });
  assert.equal(await serviceStop(f.deps), 0);
  assert.equal(f.state().loaded, false);
  f.out.length = 0;
  assert.equal(await serviceStatus(f.deps), 1);
  assert.match(f.out.join("\n"), /没有在后台运行/);
});

test("stop：没在后台运行时只说明一下，不报错", async () => {
  const f = fake();
  assert.equal(await serviceStop(f.deps), 0);
  assert.ok(!f.calls.some((c) => c.includes("bootout")));
  assert.match(f.out.join("\n"), /没有在后台运行/);
});

test("status：运行中报 pid、端口、版本、页面和日志位置", async () => {
  const f = fake();
  await serviceStart(f.deps, { args: ["--port", "7310"], noOpen: true });
  f.out.length = 0;
  assert.equal(await serviceStatus(f.deps), 0);
  const text = f.out.join("\n");
  assert.match(text, /正在后台运行/);
  assert.match(text, new RegExp(`pid：${f.state().pid}`));
  assert.match(text, /端口：7310/);
  assert.match(text, /版本：2026-11-13T00:00:00\.000Z/);
  assert.ok(text.includes(LOG));
});

test("status：没在后台运行时退出码 1；端口上有前台运行的 droidpier 时说明一下", async () => {
  const f = fake({ holder: { kind: "droidpier", version: "x" } });
  assert.equal(await serviceStatus(f.deps), 1);
  const text = f.out.join("\n");
  assert.match(text, /没有在后台运行/);
  assert.match(text, /droidpier start/);
  assert.match(text, /前台/);
});

test("status：设置了开机启动但进程没在跑（启动失败）时指向日志", async () => {
  const f = fake({ loaded: true, pid: null, files: { [PLIST]: plistXml({ label: SERVICE_LABEL, program: [BIN], args: [], logPath: LOG, env: {} }) } });
  assert.equal(await serviceStatus(f.deps), 1);
  assert.match(f.out.join("\n"), /droidpier logs/);
});

test("logs：打印日志位置和最后的几行；没有日志时说明", async () => {
  const lines = Array.from({ length: 80 }, (_, i) => `line ${i}`).join("\n") + "\n";
  const f = fake({ files: { [LOG]: lines } });
  assert.equal(await serviceLogs(f.deps), 0);
  assert.ok(f.out[0].includes(LOG));
  const text = f.out.join("\n");
  assert.match(text, /line 79/);
  assert.doesNotMatch(text, /line 9\n/);
  const g = fake();
  assert.equal(await serviceLogs(g.deps), 0);
  assert.match(g.out.join("\n"), /还没有日志/);
});

test("测试用的 label 换日志文件名，不碰正式服务的日志", async () => {
  const f = fake();
  f.deps.label = "dev.devpier.droidpier.test";
  await serviceStart(f.deps, { args: [], noOpen: true });
  assert.ok(f.files[`${HOME}/Library/LaunchAgents/dev.devpier.droidpier.test.plist`]);
  assert.match(f.files[`${HOME}/Library/LaunchAgents/dev.devpier.droidpier.test.plist`], /Droidpier\/dev\.devpier\.droidpier\.test\.log/);
  // 后台进程自己要知道 label，才能找到自己的日志去轮转
  assert.match(f.files[`${HOME}/Library/LaunchAgents/dev.devpier.droidpier.test.plist`], /<key>DROIDPIER_SERVICE_LABEL<\/key>\s*<string>dev\.devpier\.droidpier\.test<\/string>/);
});

test("start：/healthz 应答的不是 launchd 拉起的那个进程（前台的 droidpier）时不算启动成功", async () => {
  const f = fake({ foreground: true });
  assert.equal(await serviceStart(f.deps, { args: [], noOpen: false }), 1);
  assert.match(f.out.join("\n"), /没有启动起来/);
  assert.deepEqual(f.opened, []);
});

test("start：换端口时也先看新端口有没有被占", async () => {
  const f = fake();
  await serviceStart(f.deps, { args: [], noOpen: true });
  const before = f.files[PLIST];
  f.deps.holder = async () => ({ kind: "other" });
  assert.equal(await serviceStart(f.deps, { args: ["--port", "7311"], noOpen: true }), 1);
  assert.equal(f.files[PLIST], before);
  assert.match(f.out.join("\n"), /端口 7311 被别的程序占用/);
});

test("start：kickstart 失败时报出 launchctl 的错误，退出码 1", async () => {
  const f = fake({ kickstartFails: true });
  await serviceStart(f.deps, { args: [], noOpen: true });
  f.out.length = 0;
  assert.equal(await serviceStart(f.deps, { args: [], noOpen: true }), 1);
  assert.match(f.out.join("\n"), /launchctl kickstart 失败：Operation already in progress/);
});

test("start：这次没设 ANDROID_HOME 时沿用 plist 里上次的值；JAVA_HOME 也带上", async () => {
  const f = fake({ env: { ANDROID_HOME: "/opt/sdk", JAVA_HOME: "/opt/jdk" } });
  await serviceStart(f.deps, { args: [], noOpen: true });
  f.deps.env = {};
  await serviceStart(f.deps, { args: [], noOpen: true });
  assert.match(f.files[PLIST], /<key>ANDROID_HOME<\/key>\s*<string>\/opt\/sdk<\/string>/);
  assert.match(f.files[PLIST], /<key>JAVA_HOME<\/key>\s*<string>\/opt\/jdk<\/string>/);
  f.deps.env = { ANDROID_HOME: "/new/sdk" };
  await serviceStart(f.deps, { args: [], noOpen: true });
  assert.match(f.files[PLIST], /<key>ANDROID_HOME<\/key>\s*<string>\/new\/sdk<\/string>/);
});

test("start：可执行文件换了位置时说一句后台服务改为运行新位置的文件", async () => {
  const f = fake({ files: { [PLIST]: plistXml({ label: SERVICE_LABEL, program: ["/old/place/droidpier"], args: [], logPath: LOG, env: {} }) } });
  assert.equal(await serviceStart(f.deps, { args: [], noOpen: true }), 0);
  assert.ok(f.out.some((l) => l.includes(`后台服务改为运行 ${BIN}`)));
  const g = fake();
  await serviceStart(g.deps, { args: [], noOpen: true });
  g.out.length = 0;
  await serviceStart(g.deps, { args: [], noOpen: true });
  assert.ok(!g.out.some((l) => l.includes("后台服务改为运行")));
});

test("stop：等过了还在退出时不说已停止，让用户稍后看 status", async () => {
  const f = fake({ slowExit: 1_000_000 });
  await serviceStart(f.deps, { args: [], noOpen: true });
  f.out.length = 0;
  assert.equal(await serviceStop(f.deps), 0);
  const text = f.out.join("\n");
  assert.doesNotMatch(text, /已停止/);
  assert.match(text, /还在退出，稍后用 droidpier status 查看/);
});

test("serviceLabel：默认用正式 label；测试 label 只许字母、数字、点和减号", () => {
  assert.deepEqual(serviceLabel({}), { label: SERVICE_LABEL });
  assert.deepEqual(serviceLabel({ DROIDPIER_SERVICE_LABEL: "dev.devpier.droidpier.test-1" }), { label: "dev.devpier.droidpier.test-1" });
  for (const bad of ["../x", "a b", "a/b", "a<b"]) assert.ok("error" in serviceLabel({ DROIDPIER_SERVICE_LABEL: bad }), bad);
});

test("rotateLog：超过上限时把日志复制成 .1（覆盖旧的）并清空原文件；没超过或没有日志时不动", async () => {
  const files: Record<string, string> = { "/l/droidpier.log": "x".repeat(11), "/l/droidpier.log.1": "old" };
  const io = {
    size: async (p: string) => (p in files ? files[p].length : null),
    copy: async (a: string, b: string) => void (files[b] = files[a]),
    truncate: async (p: string) => void (files[p] = ""),
  };
  assert.equal(await rotateLog("/l/droidpier.log", io, 10), true);
  assert.deepEqual(files, { "/l/droidpier.log": "", "/l/droidpier.log.1": "x".repeat(11) });
  files["/l/droidpier.log"] = "short";
  assert.equal(await rotateLog("/l/droidpier.log", io, 10), false);
  assert.equal(files["/l/droidpier.log"], "short");
  assert.equal(await rotateLog("/l/missing.log", io, 10), false);
});
