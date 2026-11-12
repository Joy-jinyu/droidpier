import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createPending } from "../../host/src/pending.ts";

test("按 rid 把回复交给对应的请求", async () => {
  const p = createPending<string>(15000);
  const rids: number[] = [];
  const a = p.request((rid) => (rids.push(rid), true));
  const b = p.request((rid) => (rids.push(rid), true));
  assert.notEqual(rids[0], rids[1]);
  p.settle(rids[1], "B");
  p.settle(rids[0], "A");
  assert.deepEqual(await Promise.all([a, b]), ["A", "B"]);
});

test("发不出去时立即失败", async () => {
  const p = createPending<string>(15000);
  await assert.rejects(p.request(() => false), /没有连上网关/);
});

test("15 秒没回复以超时失败，之后到的回复被忽略", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const p = createPending<string>(15000);
    let rid = 0;
    const r = p.request((n) => ((rid = n), true));
    mock.timers.tick(14999);
    let done = false;
    r.catch(() => {}).finally(() => (done = true));
    await Promise.resolve();
    assert.equal(done, false);
    mock.timers.tick(1);
    await assert.rejects(r, /15 秒没有回应/);
    assert.equal(p.settle(rid, "late"), false);
  } finally {
    mock.timers.reset();
  }
});

test("连接断开时所有等待中的请求立即失败", async () => {
  const p = createPending<string>(15000);
  const a = p.request(() => true);
  const b = p.request(() => true);
  p.failAll("与网关断开");
  await assert.rejects(a, /与网关断开/);
  await assert.rejects(b, /与网关断开/);
  const c = p.request(() => true);
  p.failAll("x");
  await assert.rejects(c, /x/);
});
