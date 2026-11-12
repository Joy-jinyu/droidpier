import { test } from "node:test";
import assert from "node:assert/strict";
import { createUploads, type UploadItem } from "../../host/src/uploads.ts";
import { decodeUploadChunk, UPLOAD_CHUNK_BYTES, UPLOAD_MAX_BYTES, UPLOAD_WINDOW_BYTES } from "../upload.ts";
import type { ClientMsg } from "../protocol.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function harness(opts: { connected?: boolean; replyTimeoutMs?: number } = {}) {
  const h = {
    msgs: [] as ClientMsg[],
    chunks: [] as Array<{ id: number; len: number }>,
    lists: [] as UploadItem[][],
    notices: [] as string[],
    connected: opts.connected ?? true,
  };
  const u = createUploads({
    send: (m) => (h.connected ? (h.msgs.push(m), true) : false),
    sendBinary: (b) => {
      const c = decodeUploadChunk(b)!;
      h.chunks.push({ id: c.id, len: c.data.byteLength });
      return true;
    },
    onChange: (list) => h.lists.push(list),
    onNotice: (t) => h.notices.push(t),
    replyTimeoutMs: opts.replyTimeoutMs ?? 10_000,
  });
  const last = () => h.lists.at(-1) ?? [];
  return { h, u, last };
}

const file = (name: string, size: number) => new File([new Uint8Array(size)], name);
const fakeBig = (name: string, size: number) => ({ name, size, slice: () => new Blob([]) }) as unknown as File;

test("一次只传一个：第二个等第一个结束；收到 uploading 确认才开始发分片", async () => {
  const { h, u, last } = harness();
  u.add([file("a.apk", 10), file("b.txt", 5)]);
  assert.deepEqual(h.msgs, [{ t: "upload", id: 1, name: "a.apk", size: 10 }]);
  assert.deepEqual(last().map((i) => i.state), ["uploading", "waiting"]);
  await sleep(5);
  assert.equal(h.chunks.length, 0);
  u.onMsg({ t: "upload", id: 1, state: "uploading", received: 0 });
  await sleep(5);
  assert.deepEqual(h.chunks, [{ id: 1, len: 10 }]);
  u.onMsg({ t: "upload", id: 1, state: "uploading", received: 10 });
  u.onMsg({ t: "upload", id: 1, state: "installing" });
  assert.equal(last()[0].state, "installing");
  assert.equal(h.msgs.length, 1);
  u.onMsg({ t: "upload", id: 1, state: "done" });
  assert.deepEqual(h.msgs.at(-1), { t: "upload", id: 2, name: "b.txt", size: 5 });
});

test("发送窗口：未确认的不超过 UPLOAD_WINDOW_BYTES，确认一片再发一片", async () => {
  const { h, u } = harness();
  const size = UPLOAD_CHUNK_BYTES * 8;
  u.add([file("big.apk", size)]);
  u.onMsg({ t: "upload", id: 1, state: "uploading", received: 0 });
  await sleep(20);
  assert.equal(h.chunks.length, UPLOAD_WINDOW_BYTES / UPLOAD_CHUNK_BYTES);
  u.onMsg({ t: "upload", id: 1, state: "uploading", received: UPLOAD_CHUNK_BYTES });
  await sleep(20);
  assert.equal(h.chunks.length, UPLOAD_WINDOW_BYTES / UPLOAD_CHUNK_BYTES + 1);
});

test("不支持的格式和超过 2 GB 的在页面上就标失败，不发给网关", () => {
  const { h, u, last } = harness();
  u.add([file("x.xapk", 1), fakeBig("huge.apk", UPLOAD_MAX_BYTES + 1)]);
  assert.equal(h.msgs.length, 0);
  assert.deepEqual(last().map((i) => [i.state, i.error]), [
    ["failed", "暂不支持 .xapk，请提供 .apk"],
    ["failed", "文件太大：最大 2 GB"],
  ]);
});

test("网关回 failed：标失败，接着传下一个", () => {
  const { h, u, last } = harness();
  u.add([file("a.apk", 1), file("b.apk", 1)]);
  u.onMsg({ t: "upload", id: 1, state: "failed", error: "INSTALL_FAILED_X" });
  assert.equal(last()[0].error, "INSTALL_FAILED_X");
  assert.deepEqual(h.msgs.at(-1), { t: "upload", id: 2, name: "b.apk", size: 1 });
});

test("非 APK 放好后给一句提示", () => {
  const { h, u } = harness();
  u.add([file("n.txt", 0)]);
  u.onMsg({ t: "upload", id: 1, state: "uploading", received: 0 });
  u.onMsg({ t: "upload", id: 1, state: "pushing" });
  u.onMsg({ t: "upload", id: 1, state: "done" });
  assert.deepEqual(h.notices, ["n.txt 已放到 下载 文件夹"]);
});

test("网关一直不回（旧网关不认识 upload）：超时后标失败", async () => {
  const { u, last } = harness({ replyTimeoutMs: 20 });
  u.add([file("a.apk", 1)]);
  await sleep(40);
  assert.equal(last()[0].state, "failed");
  assert.match(last()[0].error!, /升级/);
});

test("连接断开：进行中和排队的都标失败；没连上时添加直接失败", () => {
  const { h, u, last } = harness();
  u.add([file("a.apk", 1), file("b.apk", 1)]);
  u.disconnected();
  assert.deepEqual(last().map((i) => i.state), ["failed", "failed"]);
  h.connected = false;
  u.add([file("c.apk", 1)]);
  assert.equal(last()[2].state, "failed");
});

test("clear 只清掉结束了的", () => {
  const { u, last } = harness();
  u.add([file("x.xapk", 1), file("a.apk", 1)]);
  u.clear();
  assert.deepEqual(last().map((i) => i.name), ["a.apk"]);
});

test("等不到确认而放弃时，告诉网关取消，接着传下一个", async () => {
  const { h, u, last } = harness({ replyTimeoutMs: 20 });
  u.add([file("a.apk", 1), file("b.apk", 1)]);
  await sleep(40);
  assert.equal(last()[0].state, "failed");
  assert.deepEqual(h.msgs.slice(1, 3), [{ t: "uploadCancel", id: 1 }, { t: "upload", id: 2, name: "b.apk", size: 1 }]);
});

test("读文件失败：标失败并告诉网关取消", async () => {
  const { h, u, last } = harness();
  const bad = { name: "a.apk", size: 10, slice: () => ({ arrayBuffer: () => Promise.reject(new Error("权限没了")) }) } as unknown as File;
  u.add([bad]);
  u.onMsg({ t: "upload", id: 1, state: "uploading", received: 0 });
  await sleep(10);
  assert.equal(last()[0].state, "failed");
  assert.match(last()[0].error!, /读文件失败/);
  assert.deepEqual(h.msgs.at(-1), { t: "uploadCancel", id: 1 });
});

test("文件在传的过程中变小了：标失败并取消，不发残缺的分片", async () => {
  const { h, u, last } = harness();
  const shrunk = { name: "a.apk", size: 10, slice: () => new Blob([new Uint8Array(4)]) } as unknown as File;
  u.add([shrunk]);
  u.onMsg({ t: "upload", id: 1, state: "uploading", received: 0 });
  await sleep(10);
  assert.equal(h.chunks.length, 0);
  assert.equal(last()[0].state, "failed");
  assert.match(last()[0].error!, /变/);
  assert.deepEqual(h.msgs.at(-1), { t: "uploadCancel", id: 1 });
});
