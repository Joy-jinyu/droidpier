import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingHttpHeaders } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import { startServer } from "../src/server.ts";
import { CLOSE_UNKNOWN_SOCKET, DEVTOOLS_FRONTEND_ORIGIN, frontendFileUrl, inspectUrl, localFrontendUrl, parseDevtoolsPath, proxyDevtools, type DevtoolsSession } from "../src/devtools-proxy.ts";
import type { WebViewPage } from "../src/webviews.ts";
import { createTickets, type Tickets } from "../src/auth.ts";
import { CLOSE_BAD_TOKEN } from "../../shared/protocol.ts";

const SOCKET = "webview_devtools_remote_6642";
const APPSPOT = DEVTOOLS_FRONTEND_ORIGIN;
const LOCAL = "http://127.0.0.1:7309";

/** 假的上游：模拟 adb forward 后的 WebView DevTools 端口，记录握手请求头和收到的消息。 */
async function fakeUpstream(t: import("node:test").TestContext) {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise((r) => wss.once("listening", r));
  const up = {
    port: (wss.address() as { port: number }).port,
    paths: [] as string[],
    headers: [] as IncomingHttpHeaders[],
    got: [] as Array<{ data: string; isBinary: boolean }>,
    socks: [] as WebSocket[],
  };
  wss.on("connection", (ws, req) => {
    up.paths.push(req.url ?? "");
    up.headers.push(req.headers);
    up.socks.push(ws);
    ws.on("message", (data, isBinary) => up.got.push({ data: data.toString(), isBinary }));
  });
  t.after(() => new Promise<void>((r) => { for (const s of wss.clients) s.terminate(); wss.close(() => r()); }));
  return up;
}

async function gateway(t: import("node:test").TestContext, portOf?: (socket: string) => number | undefined, tickets: Tickets = createTickets()) {
  const staticDir = await mkdtemp(join(tmpdir(), "emu-static-"));
  await writeFile(join(staticDir, "index.html"), "<p>hi</p>");
  const srv = await startServer({
    port: 0, allowedOrigins: [LOCAL], tickets, staticDir, getSession: async () => null, pollMs: 20, portOf, log: () => {},
    // 测试里的 DevTools 前端是 node 的 ws，不是浏览器
    peer: { allowAnyWsClient: true },
  });
  t.after(() => srv.close());
  /** 签一张票，返回 DevTools 前端会连的地址。 */
  const dt = (socket = SOCKET, id = "AB") => `ws://127.0.0.1:${srv.port}/devtools/${socket}/${id}/${tickets.issue(socket, id)}`;
  return { ...srv, dt };
}

function connect(t: import("node:test").TestContext, url: string, headers: Record<string, string> = { Origin: APPSPOT }) {
  const ws = new WebSocket(url, { headers });
  const c = {
    ws,
    msgs: [] as Array<{ data: string; isBinary: boolean }>,
    closed: new Promise<number>((r) => ws.on("close", (code) => r(code))),
  };
  ws.on("message", (data, isBinary) => c.msgs.push({ data: data.toString(), isBinary }));
  ws.on("error", () => {});
  t.after(() => ws.terminate());
  return c;
}

const until = async (cond: () => boolean, ms = 1000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
};

test("双向转发：文本和二进制原样到达另一端，上游路径是 /devtools/page/<pageId>", async (t) => {
  const up = await fakeUpstream(t);
  const srv = await gateway(t, (s) => (s === SOCKET ? up.port : undefined));
  const c = connect(t, srv.dt());
  await new Promise((r) => c.ws.once("open", r));
  c.ws.send('{"id":1}');
  c.ws.send(Buffer.from("bin"));
  await until(() => up.got.length === 2);
  assert.deepEqual(up.got, [{ data: '{"id":1}', isBinary: false }, { data: "bin", isBinary: true }]);
  assert.deepEqual(up.paths, ["/devtools/page/AB"]);
  up.socks[0].send('{"id":1,"result":{}}');
  up.socks[0].send(Buffer.from("bin2"));
  await until(() => c.msgs.length === 2);
  assert.deepEqual(c.msgs, [{ data: '{"id":1,"result":{}}', isBinary: false }, { data: "bin2", isBinary: true }]);
});

test("客户端连上后立刻发的消息不会丢（上游还没连上时先排队）", async (t) => {
  const up = await fakeUpstream(t);
  const srv = await gateway(t, () => up.port);
  const c = connect(t, srv.dt());
  c.ws.once("open", () => {
    for (let i = 0; i < 5; i++) c.ws.send(`{"id":${i}}`);
  });
  await until(() => up.got.length === 5);
  assert.deepEqual(up.got.map((m) => m.data), [0, 1, 2, 3, 4].map((i) => `{"id":${i}}`));
});

test("上游握手不带 Origin", async (t) => {
  const up = await fakeUpstream(t);
  const srv = await gateway(t, () => up.port);
  const c = connect(t, srv.dt());
  await new Promise((r) => c.ws.once("open", r));
  await until(() => up.headers.length === 1);
  assert.equal(up.headers[0].origin, undefined);
});

test("上游关闭 → 客户端关闭", async (t) => {
  const up = await fakeUpstream(t);
  const srv = await gateway(t, () => up.port);
  const c = connect(t, srv.dt());
  await until(() => up.socks.length === 1);
  up.socks[0].close();
  await c.closed;
});

test("客户端关闭 → 上游关闭", async (t) => {
  const up = await fakeUpstream(t);
  const srv = await gateway(t, () => up.port);
  const c = connect(t, srv.dt());
  await until(() => up.socks.length === 1);
  const upClosed = new Promise((r) => up.socks[0].once("close", r));
  c.ws.close();
  await upClosed;
});

test("上游连不上 → 客户端关闭", async (t) => {
  const up = await fakeUpstream(t);
  const srv = await gateway(t, () => 1);
  const c = connect(t, srv.dt());
  await c.closed;
  assert.equal(up.socks.length, 0);
});

test("未知 socket → 4404", async (t) => {
  const srv = await gateway(t, () => undefined);
  const c = connect(t, srv.dt("webview_devtools_remote_1"));
  assert.equal(await c.closed, CLOSE_UNKNOWN_SOCKET);
  assert.equal(CLOSE_UNKNOWN_SOCKET, 4404);
});

test("没有注入 portOf → 4404", async (t) => {
  const srv = await gateway(t);
  const c = connect(t, srv.dt());
  assert.equal(await c.closed, 4404);
});

test("非 /devtools/ 路径仍走模拟器协议：不发 hello 先发 touch → 4000", async (t) => {
  const srv = await gateway(t, () => 1);
  const c = connect(t, `ws://127.0.0.1:${srv.port}/`, { Origin: LOCAL });
  await new Promise((r) => c.ws.once("open", r));
  c.ws.send(JSON.stringify({ t: "touch", x: 1, y: 2, down: true }));
  assert.equal(await c.closed, 4000);
});

test("票据过期 → 4001", async (t) => {
  let now = 1_000_000;
  const srv = await gateway(t, () => 1, createTickets({ now: () => now }));
  const url = srv.dt();
  now += 60_001;
  const c = connect(t, url);
  assert.equal(await c.closed, CLOSE_BAD_TOKEN);
});

test("parseDevtoolsPath：/devtools/<socket>/<pageId>/<票据>，票据缺省时为 undefined", () => {
  assert.deepEqual(parseDevtoolsPath("/devtools/s%20x/p%2F1/tk"), { socket: "s x", pageId: "p/1", ticket: "tk" });
  assert.deepEqual(parseDevtoolsPath("/devtools/s/p"), { socket: "s", pageId: "p", ticket: undefined });
  for (const bad of ["/", "/devtools/s", "/devtools/s/p/t/x", "/devtools//p/t", "/devtools/%E0%A4%A/p/t"]) assert.equal(parseDevtoolsPath(bad), null, bad);
});

test("inspectUrl 替换 ws= 参数，并把 inspector.html 换成不带画面镜像的 devtools_app.html", () => {
  const page: WebViewPage = {
    socket: SOCKET,
    id: "AB",
    title: "Demo Page",
    url: "https://example.com/",
    visible: true,
    frontendUrl: "https://chrome-devtools-frontend.appspot.com/serve_rev/@abc/inspector.html?ws=127.0.0.1:9300/devtools/page/AB&x=1",
  };
  assert.equal(
    inspectUrl(page, 7300, "TK_1-x"),
    "https://chrome-devtools-frontend.appspot.com/serve_rev/@abc/devtools_app.html?ws=127.0.0.1:7300/devtools/webview_devtools_remote_6642/AB/TK_1-x&x=1",
  );
});

test("inspectUrl 只认 appspot 上带 ws= 的 https 前端，其他一律不给地址", () => {
  const page = (frontendUrl: string): WebViewPage => ({ socket: SOCKET, id: "AB", title: "t", url: "https://example.com/", visible: true, frontendUrl });
  for (const bad of [
    "javascript:alert(1)//chrome-devtools-frontend.appspot.com/?ws=x",
    "http://chrome-devtools-frontend.appspot.com/serve_rev/@abc/inspector.html?ws=127.0.0.1:9300/devtools/page/AB",
    "http://evil.example/inspector.html?ws=127.0.0.1:9300/devtools/page/AB",
    "https://evil.example/inspector.html?ws=127.0.0.1:9300/devtools/page/AB",
    "https://chrome-devtools-frontend.appspot.com.evil.example/inspector.html?ws=127.0.0.1:9300/devtools/page/AB",
    "https://chrome-devtools-frontend.appspot.com/serve_rev/@abc/inspector.html",
    "https://chrome-devtools-frontend.appspot.com/serve_rev/@abc/inspector.html?wss=127.0.0.1:9300/devtools/page/AB",
    "https://chrome-devtools-frontend.appspot.com/serve_rev/@abc/inspector.html#ws=127.0.0.1:9300/devtools/page/AB",
    "not a url",
  ]) assert.equal(inspectUrl(page(bad), 7300, "TK"), undefined, bad);
});

test("inspectUrl 对 socket 和页面 id 做 URL 编码，不能借 id 改写参数", () => {
  const p: WebViewPage = {
    socket: SOCKET, id: "A&x=1#y", title: "t", url: "https://example.com/", visible: true,
    frontendUrl: "https://chrome-devtools-frontend.appspot.com/serve_rev/@abc/inspector.html?ws=127.0.0.1:9300/devtools/page/AB",
  };
  assert.equal(
    inspectUrl(p, 7300, "TK"),
    `https://chrome-devtools-frontend.appspot.com/serve_rev/@abc/devtools_app.html?ws=127.0.0.1:7300/devtools/${SOCKET}/A%26x%3D1%23y/TK`,
  );
});

/** 不经网关，直接把一对 ws 接到 proxyDevtools 上。 */
async function directProxy(t: import("node:test").TestContext) {
  const up = await fakeUpstream(t);
  const front = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise((r) => front.once("listening", r));
  t.after(() => new Promise<void>((r) => { for (const s of front.clients) s.terminate(); front.close(() => r()); }));
  const modes: boolean[] = [];
  const highlights: unknown[] = [];
  const session = new Promise<DevtoolsSession>((res) => front.on("connection", (ws) => res(proxyDevtools(ws, `ws://127.0.0.1:${up.port}/devtools/page/AB`, { onInspectMode: (on) => modes.push(on), onHighlight: (h) => highlights.push(h) }))));
  const c = connect(t, `ws://127.0.0.1:${(front.address() as { port: number }).port}`);
  await new Promise((r) => c.ws.once("open", r));
  return { up, c, modes, highlights, session: await session };
}

test("选择元素模式：前端发 setInspectMode 时报开/关，页面发 inspectModeCanceled 时报关，消息照常转发", async (t) => {
  const { up, c, modes } = await directProxy(t);
  await until(() => up.socks.length === 1);
  c.ws.send(JSON.stringify({ id: 3, method: "Overlay.setInspectMode", params: { mode: "searchForNode", highlightConfig: {} } }));
  await until(() => modes.length === 1);
  c.ws.send(JSON.stringify({ id: 4, method: "Overlay.setInspectMode", params: { mode: "none", highlightConfig: {} } }));
  await until(() => modes.length === 2);
  c.ws.send(JSON.stringify({ id: 5, method: "Overlay.setInspectMode", params: { mode: "searchForNode", highlightConfig: {} } }));
  await until(() => modes.length === 3);
  up.socks[0].send(JSON.stringify({ method: "Overlay.inspectModeCanceled", params: {} }));
  await until(() => modes.length === 4 && c.msgs.length === 1);
  assert.deepEqual(modes, [true, false, true, false]);
  assert.equal(up.got.length, 3);
});

test("选择元素模式开着时连接断了，按关报一次", async (t) => {
  const { up, c, modes } = await directProxy(t);
  await until(() => up.socks.length === 1);
  c.ws.send(JSON.stringify({ id: 3, method: "Overlay.setInspectMode", params: { mode: "searchForNode" } }));
  await until(() => modes.length === 1);
  c.ws.close();
  await until(() => modes.length === 2);
  assert.deepEqual(modes, [true, false]);
});

test("网关插进会话的命令：编号不和前端的撞，回复只给网关、不转给前端；页面的事件照常给前端", async (t) => {
  const { up, c, session } = await directProxy(t);
  await until(() => up.socks.length === 1);
  const r = session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 2 });
  await until(() => up.got.length === 1);
  const sent = JSON.parse(up.got[0].data);
  assert.ok(sent.id >= 1_000_000_000);
  assert.deepEqual([sent.method, sent.params], ["Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 2 }]);
  up.socks[0].send(JSON.stringify({ method: "Overlay.inspectNodeRequested", params: { backendNodeId: 9 } }));
  up.socks[0].send(JSON.stringify({ id: sent.id, result: { ok: 1 } }));
  assert.deepEqual(await r, { ok: 1 });
  await until(() => c.msgs.length === 1);
  await new Promise((res) => setTimeout(res, 30));
  assert.deepEqual(c.msgs.map((m) => JSON.parse(m.data).method), ["Overlay.inspectNodeRequested"]);
});

test("网关的命令在会话关了之后 reject", async (t) => {
  const { up, c, session } = await directProxy(t);
  await until(() => up.socks.length === 1);
  const r = session.send("Runtime.evaluate", { expression: "1" });
  c.ws.close();
  await assert.rejects(r, /已关闭/);
  await assert.rejects(session.send("Runtime.evaluate", {}), /已关闭/);
});

test("和模式、网关命令无关的消息原样转发：坏 JSON、像网关编号但不是网关在等的回复", async (t) => {
  const { up, c, modes } = await directProxy(t);
  await until(() => up.socks.length === 1);
  const front = ['not json "Overlay.setInspectMode"', '{"id":2,"method":"Overlay.highlightNode","params":{"mode":"searchForNode"}}'];
  for (const m of front) c.ws.send(m);
  const back = ['{"id":1000000123,"result":{}}', '{"method":"Overlay.inspectNodeRequested","params":{}}', "{bad"];
  for (const m of back) up.socks[0].send(m);
  await until(() => up.got.length === 2 && c.msgs.length === 3);
  assert.deepEqual(up.got.map((m) => m.data), front);
  assert.deepEqual(c.msgs.map((m) => m.data), back);
  assert.deepEqual(modes, []);
});

test("高亮：前端发 highlightNode 时报节点和配置，hideHighlight 时报 null，消息照常转发", async (t) => {
  const { up, c, highlights } = await directProxy(t);
  await until(() => up.socks.length === 1);
  const config = { showInfo: true, contentColor: { r: 1, g: 2, b: 3, a: 0.5 } };
  c.ws.send(JSON.stringify({ id: 7, method: "Overlay.highlightNode", params: { highlightConfig: config, nodeId: 5 } }));
  c.ws.send(JSON.stringify({ id: 8, method: "Overlay.highlightNode", params: { highlightConfig: config, backendNodeId: 9 } }));
  c.ws.send(JSON.stringify({ id: 9, method: "Overlay.hideHighlight", params: {} }));
  await until(() => highlights.length === 3 && up.got.length === 3);
  assert.deepEqual(highlights, [{ nodeId: 5, config }, { backendNodeId: 9, config }, null]);
});

test("localFrontendUrl：appspot 地址换成网关代理的同一路径，查询串（ws=）不变", () => {
  const u = "https://chrome-devtools-frontend.appspot.com/serve_rev/@abc123/devtools_app.html?ws=127.0.0.1:7300/devtools/s/p/tk";
  assert.equal(localFrontendUrl(u, 7300), "http://127.0.0.1:7300/devtools-frontend/serve_rev/@abc123/devtools_app.html?ws=127.0.0.1:7300/devtools/s/p/tk");
});

test("frontendFileUrl：只认 serve_rev / serve_file / serve_internal_file 下带版本号的文件", () => {
  assert.equal(frontendFileUrl("serve_internal_file/@36220c8b/devtools-frontend/front_end/entrypoints/main/main.js"), "https://chrome-devtools-frontend.appspot.com/serve_internal_file/@36220c8b/devtools-frontend/front_end/entrypoints/main/main.js");
  assert.equal(frontendFileUrl("serve_rev/@abc123/x/../../etc"), null);
  assert.equal(frontendFileUrl("other/@abc123/x.js"), null);
  assert.equal(frontendFileUrl("serve_rev/abc123/x.js"), null);
});
