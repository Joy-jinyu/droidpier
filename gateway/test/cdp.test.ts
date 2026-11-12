import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocketServer } from "ws";
import type { WebSocket as WsType } from "ws";
import { connectCdp, navigateAndCheck } from "../src/cdp.ts";

/** 启动假 CDP 服务器，每条消息调用 handler；handler 返回非 undefined 时回复给客户端。 */
async function fakeCdpServer(
  t: import("node:test").TestContext,
  handler: (msg: any, ws: WsType) => any,
) {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((r) => wss.once("listening", r));
  const { port } = wss.address() as { port: number };
  wss.on("connection", (ws) => {
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      const reply = handler(msg, ws);
      if (reply !== undefined) ws.send(JSON.stringify(reply));
    });
  });
  t.after(() => new Promise<void>((r) => { for (const s of wss.clients) s.terminate(); wss.close(() => r()); }));
  return { port, wss };
}

test("navigate 成功后返回 href、title、bridge=true", async (t) => {
  const { port } = await fakeCdpServer(t, (msg, ws) => {
    if (msg.method === "Page.enable") return { id: msg.id, result: {} };
    if (msg.method === "Page.navigate") {
      // 先回 navigate 结果，再推 loadEventFired
      setTimeout(() => ws.send(JSON.stringify({ method: "Page.loadEventFired", params: { timestamp: 1 } })), 5);
      return { id: msg.id, result: { frameId: "1" } };
    }
    if (msg.method === "Runtime.evaluate") {
      const expr: string = msg.params.expression;
      if (expr.includes("location.href")) return { id: msg.id, result: { result: { value: "http://localhost:5173/" } } };
      if (expr.includes("document.title")) return { id: msg.id, result: { result: { value: "My App" } } };
      if (expr.includes("_dsbridge")) return { id: msg.id, result: { result: { value: "object" } } };
    }
    return undefined;
  });

  const cdp = await connectCdp(`ws://127.0.0.1:${port}`);
  t.after(() => cdp.close());
  const result = await navigateAndCheck(cdp, "http://localhost:5173/");
  assert.ok(result.ok === true);
  if (result.ok) {
    assert.equal(result.href, "http://localhost:5173/");
    assert.equal(result.title, "My App");
    assert.equal(result.bridge, true);
  }
});

test("errorText ERR_CLEARTEXT_NOT_PERMITTED 映射成中文提示", async (t) => {
  const { port } = await fakeCdpServer(t, (msg) => {
    if (msg.method === "Page.enable") return { id: msg.id, result: {} };
    if (msg.method === "Page.navigate") {
      return { id: msg.id, result: { frameId: "1", errorText: "net::ERR_CLEARTEXT_NOT_PERMITTED" } };
    }
    return undefined;
  });

  const cdp = await connectCdp(`ws://127.0.0.1:${port}`);
  t.after(() => cdp.close());
  const result = await navigateAndCheck(cdp, "http://localhost:5173/");
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.error.includes("禁止明文"));
});

// Review Focus 4：loadEventFired 不来时不能挂死，要在超时后 resolve {ok:false}
test("loadEventFired 不来时 100ms 超时 → {ok:false,error:超时}", async (t) => {
  const { port } = await fakeCdpServer(t, (msg) => {
    if (msg.method === "Page.enable") return { id: msg.id, result: {} };
    // 只回 navigate 结果，不发 loadEventFired
    if (msg.method === "Page.navigate") return { id: msg.id, result: { frameId: "1" } };
    return undefined;
  });

  const cdp = await connectCdp(`ws://127.0.0.1:${port}`);
  t.after(() => cdp.close());
  const result = await navigateAndCheck(cdp, "http://localhost:5173/", 100);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.error.includes("超时"));
});

// 修复竞态：服务端在同一 tick 回 navigate 结果并推 loadEventFired（无 setTimeout），不能丢失事件
test("navigate 结果与 loadEventFired 同 tick 到达 → ok:true", async (t) => {
  const { port } = await fakeCdpServer(t, (msg, ws) => {
    if (msg.method === "Page.enable") return { id: msg.id, result: {} };
    if (msg.method === "Page.navigate") {
      // 同一 tick：先发 navigate 结果，再立即发 loadEventFired，不加 setTimeout
      ws.send(JSON.stringify({ id: msg.id, result: { frameId: "1" } }));
      ws.send(JSON.stringify({ method: "Page.loadEventFired", params: { timestamp: 1 } }));
      return undefined; // 已手动发送，不再通过 return 发
    }
    if (msg.method === "Runtime.evaluate") {
      const expr: string = msg.params.expression;
      if (expr.includes("location.href")) return { id: msg.id, result: { result: { value: "http://localhost:5173/" } } };
      if (expr.includes("document.title")) return { id: msg.id, result: { result: { value: "My App" } } };
      if (expr.includes("_dsbridge")) return { id: msg.id, result: { result: { value: "object" } } };
    }
    return undefined;
  });

  const cdp = await connectCdp(`ws://127.0.0.1:${port}`);
  t.after(() => cdp.close());
  const result = await navigateAndCheck(cdp, "http://localhost:5173/", 500);
  assert.ok(result.ok === true, `期望 ok:true，实际：${JSON.stringify(result)}`);
});

// Review Focus 4：CDP socket 中途关闭 → resolve {ok:false}，不能挂死
test("CDP socket 中途关闭 → {ok:false}", async (t) => {
  const { port } = await fakeCdpServer(t, (msg, ws) => {
    if (msg.method === "Page.enable") return { id: msg.id, result: {} };
    if (msg.method === "Page.navigate") {
      // 发完 navigate 结果就关掉连接
      setImmediate(() => ws.close());
      return { id: msg.id, result: { frameId: "1" } };
    }
    return undefined;
  });

  const cdp = await connectCdp(`ws://127.0.0.1:${port}`);
  t.after(() => cdp.close());
  // 超时设大，确保是 socket 关闭触发的，不是超时
  const result = await navigateAndCheck(cdp, "http://localhost:5173/", 5000);
  assert.equal(result.ok, false);
});
