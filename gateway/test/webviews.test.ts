import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDevtoolsSockets, createWebViews, createFreePortAllocator } from "../src/webviews.ts";

// /proc/net/unix 的典型格式（abstract socket 名前缀 @）
const PROC_NET_UNIX = `
Num       RefCount Protocol Flags    Type St Inode Path
0000000000000000: 00000003 00000000 00000000 0001 03 11111 @webview_devtools_remote_6642
0000000000000000: 00000003 00000000 00000000 0001 03 11112 @webview_devtools_remote_6642
0000000000000000: 00000003 00000000 00000000 0001 03 22222 @chrome_devtools_remote
0000000000000000: 00000002 00000000 00000000 0001 03 33333 @some_other_socket
0000000000000000: 00000002 00000000 00000000 0001 03 44444 /tmp/not_abstract
`.trim();

test("parseDevtoolsSockets 返回去重后的 devtools socket 名", () => {
  assert.deepEqual(parseDevtoolsSockets(PROC_NET_UNIX), [
    "webview_devtools_remote_6642",
    "chrome_devtools_remote",
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

  const exec = async (args: string[]): Promise<string> => {
    execLog.push(args);
    if (args[0] === "shell" && args[1] === "cat" && args[2] === "/proc/net/unix") {
      listCallCount++;
      if (listCallCount === 1) return opts.procNetUnix ?? PROC_NET_UNIX;
      return opts.procNetUnixSecond ?? opts.procNetUnix ?? PROC_NET_UNIX;
    }
    if (args[0] === "forward" && args[1]?.startsWith("tcp:")) return "";
    if (args[0] === "forward" && args[1] === "--remove") return "";
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

  return { exec, execLog, fetchJson, freePort };
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
  assert.deepEqual(removed.sort(), ["tcp:9300", "tcp:9301"]);
  assert.deepEqual(released.sort(), [9300, 9301]);
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
