import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDevtoolsSockets, createWebViews, createFreePortAllocator, parseResumedPkg, browserPkgFromSocket, parseAppBounds, pickShownTab } from "../src/webviews.ts";

// /proc/net/unix 的典型格式（abstract socket 名前缀 @）
const PROC_NET_UNIX = `
Num       RefCount Protocol Flags    Type St Inode Path
0000000000000000: 00000003 00000000 00000000 0001 03 11111 @webview_devtools_remote_6642
0000000000000000: 00000003 00000000 00000000 0001 03 11112 @webview_devtools_remote_6642
0000000000000000: 00000003 00000000 00000000 0001 03 22222 @chrome_devtools_remote
0000000000000000: 00000003 00000000 00000000 0001 03 22223 @com.example.browser_devtools_remote
0000000000000000: 00000003 00000000 00000000 0001 03 22224 @stetho_com.example.app_devtools_remote
0000000000000000: 00000002 00000000 00000000 0001 03 33333 @some_other_socket
0000000000000000: 00000002 00000000 00000000 0001 03 44444 /tmp/not_abstract
`.trim();

test("parseDevtoolsSockets 返回去重后的 devtools socket 名", () => {
  assert.deepEqual(parseDevtoolsSockets(PROC_NET_UNIX), [
    "webview_devtools_remote_6642",
    "chrome_devtools_remote",
    "com.example.browser_devtools_remote",
  ]);
});

// 两个页面：Demo Page visible:true，data: 页面 visible:false
const PAGES_JSON = [
  {
    id: "page-1",
    title: "Demo Page",
    url: "https://example.com/help",
    devtoolsFrontendUrl: "devtools://...",
    description: JSON.stringify({ visible: true }),
  },
  {
    id: "page-2",
    title: "data:",
    url: "data:,",
    devtoolsFrontendUrl: "",
    description: JSON.stringify({ visible: false }),
  },
];

/** 构造最小化的 deps，freePort 从 9300 开始递增。 */
function makeDeps(opts: {
  procNetUnix?: string;
  pagesJson?: any[];
  pkgName?: string;
  pagesJsonSecond?: any[];
  procNetUnixSecond?: string;
}) {
  const execLog: string[][] = [];
  let callCount = 0;
  let listCallCount = 0;
  let portCounter = 9300;
  // 假 adb server 上的转发：本机端 → 设备端
  const forwards = new Map<string, string>();

  const exec = async (args: string[]): Promise<string> => {
    execLog.push(args);
    if (args[0] === "shell" && args[1] === "cat" && args[2] === "/proc/net/unix") {
      listCallCount++;
      if (listCallCount === 1) return opts.procNetUnix ?? PROC_NET_UNIX;
      return opts.procNetUnixSecond ?? opts.procNetUnix ?? PROC_NET_UNIX;
    }
    if (args[0] === "forward" && args[1]?.startsWith("tcp:")) return (forwards.set(args[1], args[2]), "");
    if (args[0] === "forward" && args[1] === "--remove") return (forwards.delete(args[2]), "");
    if (args[0] === "forward" && args[1] === "--list") return [...forwards].map(([l, r]) => `emulator-5554 ${l} ${r}\n`).join("");
    if (args[0] === "shell" && args[1] === "ps") {
      return (opts.pkgName ?? "com.example.app.debug") + "\n";
    }
    return "";
  };

  const fetchJson = async (_port: number): Promise<any[]> => {
    callCount++;
    if (callCount === 1) return opts.pagesJson ?? PAGES_JSON;
    return opts.pagesJsonSecond ?? opts.pagesJson ?? PAGES_JSON;
  };

  const freePort = async (): Promise<number> => portCounter++;

  return { exec, execLog, fetchJson, freePort, forwards };
}

test("列表按 visible 排序并带上包名", async () => {
  const { exec, execLog, fetchJson, freePort } = makeDeps({
    procNetUnix: `
0000000000000000: 00000003 00000000 00000000 0001 03 11111 @webview_devtools_remote_6642
`.trim(),
    pagesJson: PAGES_JSON,
    pkgName: "com.example.app.debug",
  });

  const wv = createWebViews({ exec, fetchJson, freePort });
  const pages = await wv.list();

  assert.equal(pages.length, 2);
  // visible:true 的 Demo Page 排第一
  assert.equal(pages[0].title, "Demo Page");
  assert.equal(pages[0].visible, true);
  assert.equal(pages[0].pkg, "com.example.app.debug");
  assert.equal(pages[0].pid, 6642);
  // visible:false 的 data: 页面排第二
  assert.equal(pages[1].visible, false);

  // 确认发了 forward 命令
  const forwardCall = execLog.find((a) => a[0] === "forward" && a[1]?.startsWith("tcp:"));
  assert.ok(forwardCall, "应该执行过 adb forward");

  await wv.close();
});

test("socket 消失后移除转发", async () => {
  // 第一次 list：有 webview_devtools_remote_6642
  // 第二次 list：socket 不见了
  const { exec, execLog, fetchJson, freePort } = makeDeps({
    procNetUnix: `0000000000000000: 00000003 00000000 00000000 0001 03 11111 @webview_devtools_remote_6642`,
    procNetUnixSecond: "",
    pagesJson: PAGES_JSON,
    pagesJsonSecond: [],
  });

  const wv = createWebViews({ exec, fetchJson, freePort });
  await wv.list();
  const pages2 = await wv.list();

  assert.equal(pages2.length, 0);
  // 应该有 forward --remove
  const removeCall = execLog.find((a) => a[0] === "forward" && a[1] === "--remove");
  assert.ok(removeCall, "socket 消失后应该执行 adb forward --remove");
  // 格式：['forward', '--remove', 'tcp:<port>']
  assert.match(removeCall![2], /^tcp:\d+$/);

  await wv.close();
});

test("同一个 socket 只 forward 一次", async () => {
  const { exec, execLog, fetchJson, freePort } = makeDeps({
    procNetUnix: `0000000000000000: 00000003 00000000 00000000 0001 03 11111 @webview_devtools_remote_6642`,
    pagesJson: PAGES_JSON,
  });

  const wv = createWebViews({ exec, fetchJson, freePort });
  await wv.list();
  await wv.list();

  const forwardCalls = execLog.filter((a) => a[0] === "forward" && a[1]?.startsWith("tcp:"));
  assert.equal(forwardCalls.length, 1, "同一 socket 应该只建立一次转发");

  await wv.close();
});

test("close 移除全部转发", async () => {
  const { exec, execLog, fetchJson, freePort } = makeDeps({
    procNetUnix: `0000000000000000: 00000003 00000000 00000000 0001 03 11111 @webview_devtools_remote_6642`,
    pagesJson: PAGES_JSON,
  });

  const wv = createWebViews({ exec, fetchJson, freePort });
  await wv.list();
  await wv.close();

  const removeCalls = execLog.filter((a) => a[0] === "forward" && a[1] === "--remove");
  assert.ok(removeCalls.length > 0, "close 应该移除所有转发");

  await wv.close();
});

test("description 非法 JSON 时 visible 按 false 处理不抛错", async () => {
  const { exec, fetchJson, freePort } = makeDeps({
    procNetUnix: `0000000000000000: 00000003 00000000 00000000 0001 03 11111 @webview_devtools_remote_6642`,
    pagesJson: [
      {
        id: "page-bad",
        title: "Bad Desc",
        url: "https://example.com",
        devtoolsFrontendUrl: "",
        description: "not valid json {{",
      },
    ],
  });

  const wv = createWebViews({ exec, fetchJson, freePort });
  await assert.doesNotReject(() => wv.list());
  const pages = await wv.list();
  assert.equal(pages[0].visible, false);

  await wv.close();
});

test("forward --list 里的端口即使 probe 说空闲也跳过", async () => {
  // forward --list 显示 tcp:9300 已被占用
  const fakeListForwards = async () => "emulator-5554 tcp:9300 localabstract:some_socket\n";
  // probe 对所有端口返回"空闲"
  const fakeProbe = async (_port: number) => true;

  const allocator = createFreePortAllocator(fakeListForwards, fakeProbe);
  const port = await allocator.acquire();

  assert.notEqual(port, 9300, "9300 在 forward --list 中，不应被选中");
  assert.ok(port >= 9301, `实际端口 ${port} 应 >= 9301`);

  allocator.release(port);
});

test("两次并发 freePort() 返回不同端口", async () => {
  const fakeListForwards = async () => "";
  const fakeProbe = async (_port: number) => true;

  const allocator = createFreePortAllocator(fakeListForwards, fakeProbe);
  const [p1, p2] = await Promise.all([allocator.acquire(), allocator.acquire()]);

  assert.notEqual(p1, p2, "并发调用应返回不同端口");

  allocator.release(p1);
  allocator.release(p2);
});

test("close 中某个转发移除失败：其余转发照样移除、端口照样释放，最后报出失败", async () => {
  const execLog: string[][] = [];
  const released: number[] = [];
  let port = 9300;
  const exec = async (args: string[]): Promise<string> => {
    execLog.push(args);
    if (args[0] === "shell" && args[2] === "/proc/net/unix") return PROC_NET_UNIX;
    if (args[0] === "forward" && args[1] === "--remove" && args[2] === "tcp:9300") throw new Error("device offline");
    if (args[0] === "shell" && args[1] === "ps") return "com.example.app\n";
    return "";
  };
  const wv = createWebViews({ exec, fetchJson: async () => [], freePort: async () => port++, releasePort: (p) => void released.push(p) });
  await wv.list();
  await assert.rejects(() => wv.close(), /9300.*device offline/);
  const removed = execLog.filter((a) => a[0] === "forward" && a[1] === "--remove").map((a) => a[2]);
  assert.deepEqual(removed.sort(), ["tcp:9300", "tcp:9301", "tcp:9302"]);
  assert.deepEqual(released.sort(), [9300, 9301, 9302]);
  assert.equal(wv.portOf("webview_devtools_remote_6642"), undefined);
  assert.equal(wv.portOf("chrome_devtools_remote"), undefined);
});

test("socket 还在但这次 /json 没答上来：沿用上一次的页面，不让页面从列表里消失", async () => {
  const { exec, freePort } = makeDeps({
    procNetUnix: `
0000000000000000: 00000003 00000000 00000000 0001 03 11111 @webview_devtools_remote_6642
`.trim(),
  });
  let n = 0;
  const fetchJson = async (): Promise<any[]> => {
    if (++n === 2) throw new Error("timeout");
    return PAGES_JSON;
  };
  const wv = createWebViews({ exec, fetchJson, freePort });
  const first = await wv.list();
  const second = await wv.list();
  assert.deepEqual(second.map((p) => p.id), first.map((p) => p.id));
  await wv.close();
});

// Fix 1: never_attached:true 或 empty:true 时 visible 应为 false
test("description 含 never_attached:true 或 empty:true 时即便 visible:true 也视为不可见", async () => {
  const { exec, fetchJson, freePort } = makeDeps({
    procNetUnix: `0000000000000000: 00000003 00000000 00000000 0001 03 11111 @webview_devtools_remote_6642`,
    pagesJson: [
      {
        id: "normal-page",
        title: "Demo Page",
        url: "https://help.example.com/",
        devtoolsFrontendUrl: "devtools://...",
        description: JSON.stringify({ visible: true }),
      },
      {
        id: "data-page",
        title: "data:",
        url: "data:text/html,<html>",
        devtoolsFrontendUrl: "",
        // 实际 DevTools 在 data: 页面上报的 description
        description: JSON.stringify({ attached: false, empty: true, never_attached: true, visible: true }),
      },
    ],
  });
  const wv = createWebViews({ exec, fetchJson, freePort });
  const pages = await wv.list();
  assert.equal(pages.length, 2);
  const normal = pages.find((p) => p.id === "normal-page");
  const data = pages.find((p) => p.id === "data-page");
  assert.ok(normal, "normal-page 应存在");
  assert.ok(data, "data-page 应存在");
  assert.equal(normal!.visible, true, "normal-page 应可见");
  assert.equal(data!.visible, false, "data: 页面含 empty/never_attached 应视为不可见");
  // visible:true 的 normal-page 应排在 data-page 之前
  assert.ok(pages.indexOf(normal!) < pages.indexOf(data!), "visible 页排在前");
  await wv.close();
});

// Fix 3: forward 失败时 releasePort 被调用，端口可被下次分配
test("adb forward 失败：端口被释放，下次 freePort 可重用该端口", async () => {
  const released: number[] = [];
  let portCounter = 9300;
  let forwardCallCount = 0;

  const exec = async (args: string[]): Promise<string> => {
    if (args[0] === "shell" && args[2] === "/proc/net/unix") {
      return `0000000000000000: 00000003 00000000 00000000 0001 03 11111 @webview_devtools_remote_6642`;
    }
    if (args[0] === "forward" && args[1]?.startsWith("tcp:")) {
      forwardCallCount++;
      if (forwardCallCount === 1) throw new Error("adb: device offline");
      return "";
    }
    if (args[0] === "shell" && args[1] === "ps") return "com.example.app\n";
    return "";
  };

  const freePort = async () => portCounter++;
  const releasePort = (p: number) => released.push(p);
  const fetchJson = async () => [] as any[];

  const wv = createWebViews({ exec, fetchJson, freePort, releasePort });
  // 第一次 list 应抛出（forward 失败）
  await assert.rejects(() => wv.list());
  // 被分配的第一个端口（9300）应该被 release
  assert.ok(released.includes(9300), `9300 应被释放，实际：${JSON.stringify(released)}`);
});

// Fix 4: 连续失败时退避，不再调用 adb
test("连续 list 失败时退避：第一次失败后短时间内不再调用 adb shell", async () => {
  let execCallCount = 0;
  const exec = async (args: string[]): Promise<string> => {
    if (args[0] === "shell" && args[2] === "/proc/net/unix") {
      execCallCount++;
      throw new Error("adb: device offline");
    }
    return "";
  };
  let portCounter = 9300;
  // 注入短退避序列（200ms），方便测试
  const wv = createWebViews({
    exec,
    fetchJson: async () => [],
    freePort: async () => portCounter++,
    backoffMs: [200, 400, 800, 30000],
  });

  // 第一次：exec 被调用，失败
  await assert.rejects(() => wv.list());
  assert.equal(execCallCount, 1, "第一次应调用 adb");
  // 立刻第二次：退避窗口内，不应再调用 adb
  await assert.rejects(() => wv.list());
  assert.equal(execCallCount, 1, "退避窗口内不应再调用 adb");
});

test("browserPkgFromSocket：chrome_devtools_remote 是 Chrome，<包名>_devtools_remote 取前面的包名，WebView 的不算", () => {
  assert.equal(browserPkgFromSocket("chrome_devtools_remote"), "com.android.chrome");
  assert.equal(browserPkgFromSocket("com.example.browser_devtools_remote"), "com.example.browser");
  assert.equal(browserPkgFromSocket("webview_devtools_remote_6642"), undefined);
});

test("parseResumedPkg 从 dumpsys 的 topResumedActivity 行取前台包名，读不出时为 null", () => {
  assert.equal(parseResumedPkg("    topResumedActivity=ActivityRecord{91909ce u0 com.android.chrome/org.chromium.chrome.browser.ChromeTabbedActivity t83}\n"), "com.android.chrome");
  assert.equal(parseResumedPkg("  mResumedActivity: ActivityRecord{1a2b u0 com.example.app/.MainActivity t5}"), "com.example.app");
  assert.equal(parseResumedPkg(""), null);
});

// Chrome 的 /json 按最近用过排序，第一个 page 就是当前标签页；description 是空的
const TABS_JSON = [
  { id: "29", type: "page", title: "Example Domain", url: "https://example.com/", devtoolsFrontendUrl: "https://chrome-devtools-frontend.appspot.com/serve_internal_file/@abc/inspector.html?ws=127.0.0.1:1/devtools/page/29", description: "" },
  { id: "4", type: "page", title: "Other", url: "https://example.org/", description: "" },
];

function browserDeps(fg: string | Error) {
  const execLog: string[][] = [];
  let port = 9300;
  const forwards = new Map<string, string>();
  const exec = async (args: string[]): Promise<string> => {
    execLog.push(args);
    if (args[0] === "forward" && args[1]?.startsWith("tcp:")) return (forwards.set(args[1], args[2]), "");
    if (args[0] === "forward" && args[1] === "--remove") return (forwards.delete(args[2]), "");
    if (args[0] === "forward" && args[1] === "--list") return [...forwards].map(([l, r]) => `emulator-5554 ${l} ${r}\n`).join("");
    if (args[0] === "shell" && args[2] === "/proc/net/unix") return "0000000000000000: 00000003 00000000 00000000 0001 03 22222 @chrome_devtools_remote";
    if (args[0] === "shell" && args.join(" ").includes("dumpsys activity")) {
      if (fg instanceof Error) throw fg;
      return `  topResumedActivity=ActivityRecord{1 u0 ${fg}/.Main t1}`;
    }
    return "";
  };
  return { exec, execLog, fetchJson: async () => TABS_JSON, freePort: async () => port++ };
}

test("浏览器在前台：当前标签页（/json 里第一个 page）可见，包名来自 /json/version 的 Android-Package", async () => {
  const d = browserDeps("com.android.chrome");
  const versions: number[] = [];
  const wv = createWebViews({ ...d, fetchVersion: async (p) => { versions.push(p); return { "Android-Package": "com.android.chrome" }; } });
  const pages = await wv.list();
  assert.deepEqual(pages.map((p) => [p.id, p.visible, p.pkg]), [["29", true, "com.android.chrome"], ["4", false, "com.android.chrome"]]);
  assert.equal(pages[0].pid, undefined);
  // 包名只问一次
  await wv.list();
  assert.equal(versions.length, 1);
  await wv.close();
});

test("浏览器不在前台：它的标签页都不可见", async () => {
  const d = browserDeps("com.example.app");
  const wv = createWebViews({ ...d, fetchVersion: async () => ({ "Android-Package": "com.android.chrome" }) });
  const pages = await wv.list();
  assert.ok(pages.every((p) => !p.visible));
  await wv.close();
});

test("/json/version 读不到时按 socket 名推包名；读前台失败时浏览器标签页按不可见，不让整个列表失败", async () => {
  const d = browserDeps(new Error("dumpsys failed"));
  const wv = createWebViews({ ...d, fetchVersion: async () => { throw new Error("timeout"); } });
  const pages = await wv.list();
  assert.equal(pages[0].pkg, "com.android.chrome");
  assert.ok(pages.every((p) => !p.visible));
  await wv.close();
});

test("只有 WebView 的 socket 时不查前台 App", async () => {
  const { exec, execLog, fetchJson, freePort } = makeDeps({ procNetUnix: "0000000000000000: 00000003 00000000 00000000 0001 03 11111 @webview_devtools_remote_6642" });
  const wv = createWebViews({ exec, fetchJson, freePort });
  await wv.list();
  assert.ok(!execLog.some((a) => a.join(" ").includes("dumpsys")));
  await wv.close();
});

test("WebView 的 description 带 screenX/screenY/width/height 时给出页面在屏幕上的位置（设备像素）", async () => {
  const { exec, fetchJson, freePort } = makeDeps({
    procNetUnix: "0000000000000000: 00000003 00000000 00000000 0001 03 11111 @webview_devtools_remote_6642",
    pagesJson: [
      { id: "a", title: "A", url: "https://example.com/", description: JSON.stringify({ attached: true, visible: true, screenX: 0, screenY: 258, width: 1080, height: 2016 }) },
      { id: "b", title: "B", url: "https://example.com/b", description: JSON.stringify({ visible: true, never_attached: true, screenX: 0, screenY: 0 }) },
    ],
  });
  const wv = createWebViews({ exec, fetchJson, freePort });
  const pages = await wv.list();
  assert.deepEqual(pages.find((p) => p.id === "a")!.rect, { x: 0, y: 258, width: 1080, height: 2016 });
  assert.equal(pages.find((p) => p.id === "b")!.rect, undefined);
  await wv.close();
});

const dumpsysCalls = (log: string[][]) => log.filter((a) => a.join(" ").includes("dumpsys")).length;

test("parseDevtoolsSockets 不收 Stetho 的 stetho_*_devtools_remote（不是网页）", () => {
  assert.ok(!parseDevtoolsSockets(PROC_NET_UNIX).some((s) => s.startsWith("stetho_")));
});

test("浏览器没有 page 标签页时不查前台 App", async () => {
  const d = browserDeps("com.android.chrome");
  const wv = createWebViews({ ...d, fetchJson: async () => [{ id: "sw", type: "service_worker", url: "https://example.com/sw.js" }] });
  await wv.list();
  assert.equal(dumpsysCalls(d.execLog), 0);
  await wv.close();
});

test("前台 App 缓存 10 秒：socket 和当前标签页都没变时不再查；当前标签页变了、过了 10 秒再查", async () => {
  const d = browserDeps("com.android.chrome");
  let t = 1000;
  let tabs = TABS_JSON;
  const wv = createWebViews({ ...d, fetchJson: async () => tabs, now: () => t });
  await wv.list();
  t += 5000;
  const again = await wv.list();
  assert.equal(dumpsysCalls(d.execLog), 1);
  assert.equal(again[0].visible, true);
  tabs = [TABS_JSON[1], TABS_JSON[0]];
  await wv.list();
  assert.equal(dumpsysCalls(d.execLog), 2);
  t += 10_001;
  await wv.list();
  assert.equal(dumpsysCalls(d.execLog), 3);
  await wv.close();
});

test("parseAppBounds 取指定包名窗口的 mAppBounds，别的窗口和读不出时为 null", () => {
  const out = [
    "WINDOW MANAGER WINDOWS (dumpsys window windows)",
    "  Window #8 Window{1a2b u0 StatusBar}:",
    "    mFullConfiguration={ winConfig={ mBounds=Rect(0, 0 - 1080, 2340) mAppBounds=Rect(0, 0 - 1080, 136) } }",
    "  Window #9 Window{8bb91e3 u0 com.android.chrome/com.google.android.apps.chrome.Main}:",
    "    mFullConfiguration={1.3 winConfig={ mBounds=Rect(0, 0 - 1080, 2340) mAppBounds=Rect(0, 136 - 1080, 2274) mMaxBounds=Rect(0, 0 - 1080, 2340) } }",
    "  Window #10 Window{92d6066 u0 Acetone}:",
  ].join("\n");
  assert.deepEqual(parseAppBounds(out, "com.android.chrome"), { x: 0, y: 136, width: 1080, height: 2138 });
  assert.equal(parseAppBounds(out, "com.example"), null);
  assert.equal(parseAppBounds("  Window #9 Window{8bb91e3 u0 com.android.chrome/x}:\n    mAppBounds=null", "com.android.chrome"), null);
});

// 后台被冻结的 App 不再接收 DevTools 连接上的请求：每轮都新开连接、超时再丢下，会在手机的 adbd 上越积越多，
// 叠加真机画面的负载时把整条 USB 连接堵死（2026-11-16 SM-G9910 / Android 12 复现）
const ONE_WEBVIEW = `
0000000000000000: 00000003 00000000 00000000 0001 03 11111 @webview_devtools_remote_6642
`.trim();

test("/json 一直没回应：list 等一会儿就沿用上次的页面，之后不再对这个 socket 发新请求", async () => {
  const { exec, freePort } = makeDeps({ procNetUnix: ONE_WEBVIEW });
  let requests = 0;
  const fetchJson = (): Promise<any[]> => (++requests === 1 ? Promise.resolve(PAGES_JSON) : new Promise(() => {}));
  const wv = createWebViews({ exec, fetchJson, freePort, jsonWaitMs: 20 });
  const first = await wv.list();
  const second = await wv.list();
  const third = await wv.list();
  assert.deepEqual(second.map((p) => p.id), first.map((p) => p.id));
  assert.deepEqual(third.map((p) => p.id), first.map((p) => p.id));
  assert.equal(requests, 2);
  await wv.close();
});

test("迟到的 /json 回来后：下一轮用它的结果，之后照常每轮请求", async () => {
  const { exec, freePort } = makeDeps({ procNetUnix: ONE_WEBVIEW });
  let requests = 0;
  let answerLate!: (v: any[]) => void;
  const later = [{ ...PAGES_JSON[0], id: "late" }];
  const fetchJson = (): Promise<any[]> => {
    requests++;
    if (requests === 2) return new Promise((r) => (answerLate = r));
    return Promise.resolve(requests === 1 ? PAGES_JSON : later);
  };
  const wv = createWebViews({ exec, fetchJson, freePort, jsonWaitMs: 20 });
  await wv.list();
  await wv.list();
  answerLate(later);
  await new Promise((r) => setImmediate(r));
  const third = await wv.list();
  assert.equal(third[0].id, "late");
  assert.equal(requests, 3);
  await wv.close();
});

test("forget：adb 重连后转发已被撤掉，下次 list 重新建转发，不去移除已经没了的", async () => {
  const { exec, execLog, fetchJson, freePort } = makeDeps({
    procNetUnix: `0000000000000000: 00000003 00000000 00000000 0001 03 11111 @webview_devtools_remote_6642`,
    pagesJson: PAGES_JSON,
  });
  const released: number[] = [];
  const wv = createWebViews({ exec, fetchJson, freePort, releasePort: (p) => released.push(p) });
  await wv.list();
  const forwards = () => execLog.filter((a) => a[0] === "forward" && a[1] !== "--remove" && a[1] !== "--list").length;
  const before = forwards();
  assert.ok(wv.portOf("webview_devtools_remote_6642"));
  wv.forget();
  assert.equal(wv.portOf("webview_devtools_remote_6642"), undefined);
  assert.equal(released.length, 1);
  await wv.list();
  assert.equal(forwards(), before + 1, "重新建了转发");
  const removesBefore = execLog.filter((a) => a[1] === "--remove").length;
  await wv.close();
  assert.equal(execLog.filter((a) => a[1] === "--remove").length, removesBefore + 1, "只移除新建的那个");
});

test("转发被 adb 撤掉了：下一轮对 forward --list 发现没了，重新建", async () => {
  const deps = makeDeps({
    procNetUnix: `0000000000000000: 00000003 00000000 00000000 0001 03 11111 @webview_devtools_remote_6642`,
    pagesJson: PAGES_JSON,
  });
  const released: number[] = [];
  const wv = createWebViews({ exec: deps.exec, fetchJson: deps.fetchJson, freePort: deps.freePort, releasePort: (p) => released.push(p) });
  await wv.list();
  const first = wv.portOf("webview_devtools_remote_6642");
  assert.ok(first);
  await wv.list();
  assert.equal(wv.portOf("webview_devtools_remote_6642"), first, "转发还在时不动");
  deps.forwards.clear(); // 模拟器重启、adb 重连
  await wv.list();
  const second = wv.portOf("webview_devtools_remote_6642");
  assert.ok(second);
  assert.equal(deps.forwards.get(`tcp:${second}`), "localabstract:webview_devtools_remote_6642", "重新建了转发");
  assert.deepEqual(released, [first]);
});

test("forward --list 读失败时这一轮不核对，列表照常返回，转发不动", async () => {
  const deps = makeDeps({
    procNetUnix: `0000000000000000: 00000003 00000000 00000000 0001 03 11111 @webview_devtools_remote_6642`,
    pagesJson: PAGES_JSON,
  });
  let failList = false;
  const exec = async (args: string[]) => {
    if (failList && args[0] === "forward" && args[1] === "--list") throw new Error("adb: error");
    return deps.exec(args);
  };
  const wv = createWebViews({ exec, fetchJson: deps.fetchJson, freePort: deps.freePort });
  await wv.list();
  const port = wv.portOf("webview_devtools_remote_6642");
  failList = true;
  const pages = await wv.list();
  assert.ok(pages.length > 0);
  assert.equal(wv.portOf("webview_devtools_remote_6642"), port);
});

test("浏览器在前台：按标签页自己回答的 visibilityState 定当前标签，不看 /json 的顺序；都不回话时还按第一个", async () => {
  const d = browserDeps("com.android.chrome");
  const asked: string[] = [];
  const wv = createWebViews({ ...d, fetchVersion: async () => ({ "Android-Package": "com.android.chrome" }), tabVisibility: async (_port, id) => (asked.push(id), id === "4" ? "visible" : "hidden") });
  const pages = await wv.list();
  assert.deepEqual(pages.map((p) => [p.id, p.visible]), [["4", true], ["29", false]]);
  assert.deepEqual(asked.sort(), ["29", "4"]);
  await wv.close();

  const silent = createWebViews({ ...browserDeps("com.android.chrome"), fetchVersion: async () => ({ "Android-Package": "com.android.chrome" }), tabVisibility: async () => null });
  assert.deepEqual((await silent.list()).map((p) => [p.id, p.visible]), [["29", true], ["4", false]]);
  await silent.close();
});

test("浏览器不在前台时不去问标签页", async () => {
  const asked: string[] = [];
  const wv = createWebViews({ ...browserDeps("com.example.app"), fetchVersion: async () => ({ "Android-Package": "com.android.chrome" }), tabVisibility: async (_p, id) => (asked.push(id), "visible") });
  const pages = await wv.list();
  assert.ok(pages.every((p) => !p.visible));
  assert.deepEqual(asked, []);
  await wv.close();
});

test("pickShownTab：有一个回答 visible 就不等别的；都 hidden 时没有；都不回话交给老办法；断点上不回话的上次那个还算", async () => {
  const tabs = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const never = new Promise<null>(() => {});
  assert.equal(await pickShownTab(tabs, (t) => (t.id === "b" ? Promise.resolve("visible") : never)), tabs[1]);
  assert.equal(await pickShownTab(tabs, async () => "hidden"), null);
  assert.equal(await pickShownTab(tabs, async () => null), undefined);
  assert.equal(await pickShownTab(tabs, async (t) => (t.id === "a" ? "hidden" : null), "c"), tabs[2]);
  assert.equal(await pickShownTab(tabs, async (t) => (t.id === "a" ? "hidden" : null)), tabs[1]);
  assert.equal(await pickShownTab([], async () => "visible"), undefined);
});

test("浏览器在前台、标签页都回答 hidden（开着标签切换器）：没有标签页可见", async () => {
  const wv = createWebViews({ ...browserDeps("com.android.chrome"), fetchVersion: async () => ({ "Android-Package": "com.android.chrome" }), tabVisibility: async () => "hidden" });
  assert.ok((await wv.list()).every((p) => !p.visible));
  await wv.close();
});
