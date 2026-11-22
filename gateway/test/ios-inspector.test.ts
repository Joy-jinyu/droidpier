import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { appInForeground, createIosInspector, createWirParser, legacyProtocolVersion, wirFrame } from "../src/ios-inspector.ts";

test("appInForeground：只有 2 是前台；刚回到主屏的 1、挂起的 0 都不是；没这个键的旧系统当前台", () => {
  assert.equal(appInForeground({ WIRIsApplicationActiveKey: 2 }), true);
  assert.equal(appInForeground({ WIRIsApplicationActiveKey: 1 }), false);
  assert.equal(appInForeground({ WIRIsApplicationActiveKey: 0 }), false);
  assert.equal(appInForeground({}), true);
});

test("legacyProtocolVersion：取不超过模拟器版本的最大命令表；比所有都旧时为 null", () => {
  const have = ["13.0", "17.4", "18.0", "18.2", "18.4", "26.0", "27.0"];
  assert.equal(legacyProtocolVersion("iOS 18.3", have), "18.2");
  assert.equal(legacyProtocolVersion("iOS 27.1", have), "27.0");
  assert.equal(legacyProtocolVersion("iOS 27.0", have), "27.0");
  assert.equal(legacyProtocolVersion("iOS 12.4", have), null);
  assert.equal(legacyProtocolVersion("", have), null);
});

async function until(ok: () => boolean) {
  for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(ok());
}

/** 假的 webinspectord：收到请求按选择子回话。 */
function fakeDaemon(script: (selector: string, arg: Record<string, unknown>, reply: (s: string, a: Record<string, unknown>) => void) => void) {
  const toGateway = new PassThrough();
  const fromGateway = new PassThrough();
  const sent: Array<{ selector: string; arg: Record<string, unknown> }> = [];
  const push = toGateway.write.bind(toGateway);
  const reply = (s: string, a: Record<string, unknown>) => push(wirFrame(s, a as never));
  fromGateway.on("data", createWirParser((selector, arg) => {
    sent.push({ selector, arg });
    script(selector, arg, reply);
  }));
  // 网关读 toGateway、写 fromGateway：拼成一个 Duplex
  const sock = Object.assign(toGateway, { write: (c: Buffer) => fromGateway.write(c) }) as unknown as import("node:stream").Duplex;
  return { sock, sent, reply };
}

/** 假页面的调试回话：建通道时报 page 目标，问 document.visibilityState 时按 vis 回答（不在表里的页面不回话）。 */
function answerProbe(vis: Record<number, string>) {
  const senders = new Map<string, number>();
  return (s: string, a: Record<string, unknown>, reply: (s: string, a: Record<string, unknown>) => void) => {
    const page = a.WIRPageIdentifierKey as number;
    const dest = a.WIRSenderKey as string;
    const data = (m: unknown) => reply("_rpc_applicationSentData:", { WIRDestinationKey: dest, WIRMessageDataKey: Buffer.from(JSON.stringify(m)) });
    if (s === "_rpc_forwardSocketSetup:" && page in vis) {
      senders.set(dest, page);
      data({ method: "Target.targetCreated", params: { targetInfo: { targetId: `page-${page}`, type: "page" } } });
    }
    if (s === "_rpc_forwardSocketData:" && senders.has(dest)) {
      const outer = JSON.parse(Buffer.from(a.WIRSocketDataKey as Buffer).toString("utf8"));
      const inner = JSON.parse(outer.params.message);
      if (inner.params?.expression === "document.visibilityState") {
        data({ method: "Target.dispatchMessageFromTarget", params: { targetId: outer.params.targetId, message: JSON.stringify({ id: inner.id, result: { result: { type: "string", value: vis[page] } } }) } });
      }
    }
  };
}

test("list：报身份、取应用、按应用取页面；只要网页，socket 是应用 id、id 是页面编号；可见性按应用前后台和页面自己的 visibilityState", async () => {
  const probe = answerProbe({ 1: "visible", 3: "hidden" });
  const d = fakeDaemon((s, a, reply) => {
    if (s === "_rpc_getConnectedApplications:") reply("_rpc_reportConnectedApplicationList:", { WIRApplicationDictionaryKey: {
      "PID:1": { WIRApplicationIdentifierKey: "PID:1", WIRApplicationBundleIdentifierKey: "com.apple.mobilesafari", WIRIsApplicationActiveKey: 2 },
      "PID:9": { WIRApplicationIdentifierKey: "PID:9", WIRApplicationBundleIdentifierKey: "com.example.bg", WIRIsApplicationActiveKey: 0 },
    } });
    if (s === "_rpc_forwardGetListing:" && a.WIRApplicationIdentifierKey === "PID:1") {
      reply("_rpc_applicationSentListing:", { WIRApplicationIdentifierKey: "PID:1", WIRListingKey: {
        "1": { WIRPageIdentifierKey: 1, WIRTitleKey: "Example", WIRURLKey: "https://example.com/", WIRTypeKey: "WIRTypeWebPage" },
        "2": { WIRPageIdentifierKey: 2, WIRTitleKey: "ctx", WIRURLKey: "", WIRTypeKey: "WIRTypeJavaScript" },
        "3": { WIRPageIdentifierKey: 3, WIRTitleKey: "Tab", WIRURLKey: "https://example.org/", WIRTypeKey: "WIRTypeWebPage" },
      } });
    }
    if (s === "_rpc_forwardGetListing:" && a.WIRApplicationIdentifierKey === "PID:9") {
      reply("_rpc_applicationSentListing:", { WIRApplicationIdentifierKey: "PID:9", WIRListingKey: {
        "7": { WIRPageIdentifierKey: 7, WIRTitleKey: "", WIRURLKey: "about:blank", WIRTypeKey: "WIRTypeWebPage" },
      } });
    }
    probe(s, a, reply);
  });
  const insp = createIosInspector({ connect: async () => d.sock });
  const pages = await insp.list();
  const byId = Object.fromEntries(pages.map((p) => [p.id, p]));
  assert.deepEqual(byId["1"], { socket: "PID:1", id: "1", title: "Example", url: "https://example.com/", pkg: "com.apple.mobilesafari", visible: true });
  assert.equal(byId["3"].visible, false, "Safari 的后台标签");
  assert.equal(byId["7"].visible, false, "后台应用的页面不去问");
  assert.equal(pages.length, 3);
  // 问完都关掉，后台应用的页面没连过
  const setups = d.sent.filter((m) => m.selector === "_rpc_forwardSocketSetup:").map((m) => m.arg.WIRPageIdentifierKey).sort();
  assert.deepEqual(setups, [1, 3]);
  assert.equal(d.sent.filter((m) => m.selector === "_rpc_forwardDidClose:").length, 2);
  insp.close();
});

test("list：页面不回话（正被调试着）时当可见", async () => {
  const d = fakeDaemon((s, a, reply) => {
    if (s === "_rpc_getConnectedApplications:") reply("_rpc_reportConnectedApplicationList:", { WIRApplicationDictionaryKey: { "PID:1": { WIRApplicationIdentifierKey: "PID:1", WIRIsApplicationActiveKey: 2 } } });
    if (s === "_rpc_forwardGetListing:") reply("_rpc_applicationSentListing:", { WIRApplicationIdentifierKey: "PID:1", WIRListingKey: { "1": { WIRPageIdentifierKey: 1, WIRTitleKey: "A", WIRURLKey: "https://a/", WIRTypeKey: "WIRTypeWebPage" } } });
  });
  const insp = createIosInspector({ connect: async () => d.sock });
  assert.equal((await insp.list())[0].visible, true);
  insp.close();
});

test("list：正在调试的页面不再临时去连（会把调试连接顶掉），当可见", async () => {
  const probe = answerProbe({ 1: "hidden" });
  const d = fakeDaemon((s, a, reply) => {
    if (s === "_rpc_getConnectedApplications:") reply("_rpc_reportConnectedApplicationList:", { WIRApplicationDictionaryKey: { "PID:1": { WIRApplicationIdentifierKey: "PID:1", WIRIsApplicationActiveKey: 2 } } });
    if (s === "_rpc_forwardGetListing:") reply("_rpc_applicationSentListing:", { WIRApplicationIdentifierKey: "PID:1", WIRListingKey: { "1": { WIRPageIdentifierKey: 1, WIRTitleKey: "A", WIRURLKey: "https://a/", WIRTypeKey: "WIRTypeWebPage" } } });
    probe(s, a, reply);
  });
  const insp = createIosInspector({ connect: async () => d.sock });
  const ch = await insp.open("PID:1", "1");
  const before = d.sent.filter((m) => m.selector === "_rpc_forwardSocketSetup:").length;
  assert.equal((await insp.list())[0].visible, true);
  assert.equal(d.sent.filter((m) => m.selector === "_rpc_forwardSocketSetup:").length, before);
  assert.equal(d.sent.filter((m) => m.selector === "_rpc_forwardDidClose:").length, 0);
  ch.close();
  insp.close();
});

/** 一个前台应用、一个页面的假守护进程；page 里可以带额外的列表字段。 */
function onePage(extra: Record<string, unknown>, probe?: ReturnType<typeof answerProbe>) {
  return fakeDaemon((s, a, reply) => {
    if (s === "_rpc_getConnectedApplications:") reply("_rpc_reportConnectedApplicationList:", { WIRApplicationDictionaryKey: { "PID:1": { WIRApplicationIdentifierKey: "PID:1", WIRIsApplicationActiveKey: 2 } } });
    if (s === "_rpc_forwardGetListing:") reply("_rpc_applicationSentListing:", { WIRApplicationIdentifierKey: "PID:1", WIRListingKey: { "1": { WIRPageIdentifierKey: 1, WIRTitleKey: "A", WIRURLKey: "https://a/", WIRTypeKey: "WIRTypeWebPage", ...extra } } });
    probe?.(s, a, reply);
  });
}

test("list：两次同时调用共用一次，后台页面不会因为对方的探测通道被当成可见", async () => {
  const d = onePage({}, answerProbe({ 1: "hidden" }));
  const insp = createIosInspector({ connect: async () => d.sock });
  const [a, b] = await Promise.all([insp.list(), insp.list()]);
  assert.equal(a[0].visible, false);
  assert.equal(b[0].visible, false);
  assert.equal(d.sent.filter((m) => m.selector === "_rpc_getConnectedApplications:").length, 1);
  insp.close();
});

test("list：别人（Mac 上的 Safari 调试器）正连着的页面不去探测", async () => {
  const d = onePage({ WIRConnectionIdentifierKey: "SOMEONE-ELSE" }, answerProbe({ 1: "hidden" }));
  const insp = createIosInspector({ connect: async () => d.sock });
  assert.equal((await insp.list())[0].visible, true);
  assert.equal(d.sent.filter((m) => m.selector === "_rpc_forwardSocketSetup:").length, 0);
  insp.close();
});

test("open：同一页面正在探测时，先关掉探测通道再建前端的通道；之后探测结束不再发 DidClose", async () => {
  // 页面不回答可见性：探测一直挂着，直到被 open 关掉
  const d = onePage({});
  const insp = createIosInspector({ connect: async () => d.sock });
  const listed = insp.list();
  await until(() => d.sent.some((m) => m.selector === "_rpc_forwardSocketSetup:"));
  const ch = await insp.open("PID:1", "1");
  await new Promise((r) => setImmediate(r));
  const order = d.sent.filter((m) => m.selector === "_rpc_forwardSocketSetup:" || m.selector === "_rpc_forwardDidClose:").map((m) => `${m.selector}${m.arg.WIRSenderKey}`);
  const [probeSetup, probeClose, consoleSetup] = order;
  assert.equal(order.length, 3);
  assert.ok(probeSetup.startsWith("_rpc_forwardSocketSetup:") && probeClose.startsWith("_rpc_forwardDidClose:") && consoleSetup.startsWith("_rpc_forwardSocketSetup:"));
  assert.equal(probeSetup.slice("_rpc_forwardSocketSetup:".length), probeClose.slice("_rpc_forwardDidClose:".length), "关的是探测通道");
  assert.equal((await listed)[0].visible, true);
  assert.equal(d.sent.filter((m) => m.selector === "_rpc_forwardDidClose:").length, 1, "探测结束后没有再关一次");
  ch.close();
  insp.close();
});

test("open：建通道、前端消息转成 forwardSocketData；页面数据按 WIRDestinationKey 交给对应通道，onMessage 之前到的先存着", async () => {
  const d = fakeDaemon(() => {});
  const insp = createIosInspector({ connect: async () => d.sock });
  const ch = await insp.open("PID:1", "1");
  await new Promise((r) => setImmediate(r));
  const setup = d.sent.find((m) => m.selector === "_rpc_forwardSocketSetup:")!;
  const sender = setup.arg.WIRSenderKey as string;
  assert.equal(setup.arg.WIRPageIdentifierKey, 1);
  d.reply("_rpc_applicationSentData:", { WIRDestinationKey: sender, WIRMessageDataKey: Buffer.from('{"method":"Target.targetCreated"}') });
  d.reply("_rpc_applicationSentData:", { WIRDestinationKey: "someone-else", WIRMessageDataKey: Buffer.from("x") });
  await new Promise((r) => setImmediate(r));
  const got: string[] = [];
  ch.onMessage((m) => got.push(m));
  assert.deepEqual(got, ['{"method":"Target.targetCreated"}']);
  ch.send('{"id":1,"method":"Target.sendMessageToTarget"}');
  await new Promise((r) => setImmediate(r));
  const data = d.sent.find((m) => m.selector === "_rpc_forwardSocketData:")!;
  assert.equal((data.arg.WIRSocketDataKey as Buffer).toString(), '{"id":1,"method":"Target.sendMessageToTarget"}');
  let closed = 0;
  ch.onClose(() => closed++);
  d.reply("_rpc_applicationDisconnected:", { WIRApplicationIdentifierKey: "PID:2" });
  await new Promise((r) => setImmediate(r));
  assert.equal(closed, 0);
  d.reply("_rpc_applicationDisconnected:", { WIRApplicationIdentifierKey: "PID:1" });
  await new Promise((r) => setImmediate(r));
  assert.equal(closed, 1);
});
