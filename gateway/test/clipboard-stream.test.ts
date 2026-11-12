import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { watchClipboard } from "../src/emulator.ts";

class FakeStream extends EventEmitter {
  cancelled = false;
  cancel() {
    this.cancelled = true;
    this.emit("error", Object.assign(new Error("Cancelled"), { code: 1 }));
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("流出错后过一会儿重开，重开后的第一条（当前内容）跳过，之后的复制照常送达", async () => {
  const streams: FakeStream[] = [];
  const got: string[] = [];
  const stop = watchClipboard(() => { const s = new FakeStream(); streams.push(s); return s; }, (t) => got.push(t), { retryMs: 20, log: () => {} });
  streams[0].emit("data", { text: "当前" });
  streams[0].emit("data", { text: "A" });
  streams[0].emit("error", Object.assign(new Error("Unavailable"), { code: 14 }));
  await sleep(50);
  assert.equal(streams.length, 2, "应重新订阅一次");
  streams[1].emit("data", { text: "A" });
  streams[1].emit("data", { text: "B" });
  assert.deepEqual(got, ["A", "B"]);
  stop();
});

test("流正常结束也重开", async () => {
  const streams: FakeStream[] = [];
  const stop = watchClipboard(() => { const s = new FakeStream(); streams.push(s); return s; }, () => {}, { retryMs: 20, log: () => {} });
  streams[0].emit("end");
  await sleep(50);
  assert.equal(streams.length, 2);
  stop();
});

test("停止后取消当前流，不再重开", async () => {
  const streams: FakeStream[] = [];
  const stop = watchClipboard(() => { const s = new FakeStream(); streams.push(s); return s; }, () => {}, { retryMs: 20, log: () => {} });
  stop();
  await sleep(50);
  assert.equal(streams.length, 1);
  assert.ok(streams[0].cancelled);
});

test("出错后、重开前停止：不再重开", async () => {
  const streams: FakeStream[] = [];
  const stop = watchClipboard(() => { const s = new FakeStream(); streams.push(s); return s; }, () => {}, { retryMs: 20, log: () => {} });
  streams[0].emit("error", Object.assign(new Error("x"), { code: 14 }));
  stop();
  await sleep(50);
  assert.equal(streams.length, 1);
});
