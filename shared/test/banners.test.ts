import { test } from "node:test";
import assert from "node:assert/strict";
import { noticeTimeoutMs, pickBanner } from "../../ui/banners.ts";

test("pickBanner：没有提示时什么都不显示", () => {
  assert.deepEqual(pickBanner([]), { shown: null, waiting: 0 });
});

test("pickBanner：同时有几条时只显示最要紧的一条，其余算排着", () => {
  assert.deepEqual(pickBanner(["info", "uploads", "clip", "gateway", "adb"]), { shown: "adb", waiting: 4 });
  assert.deepEqual(pickBanner(["uploads", "error"]), { shown: "error", waiting: 1 });
  assert.deepEqual(pickBanner(["info", "clip"]), { shown: "clip", waiting: 1 });
});

test("pickBanner：几秒就收起的一般消息排在一直挂着的网关更新、传文件进度前面，不会没人看见就过期", () => {
  assert.deepEqual(pickBanner(["gateway", "uploads", "info"]), { shown: "info", waiting: 2 });
});

test("pickBanner：前一条没了，后一条接着出来", () => {
  assert.deepEqual(pickBanner(["uploads"]), { shown: "uploads", waiting: 0 });
});

test("noticeTimeoutMs：一般消息自己收起，错误和要留着的不收", () => {
  assert.equal(noticeTimeoutMs({}), 4000);
  assert.equal(noticeTimeoutMs({ error: true }), null);
  assert.equal(noticeTimeoutMs({ sticky: true }), null);
});
