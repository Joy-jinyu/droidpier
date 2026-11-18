import { test } from "node:test";
import assert from "node:assert/strict";
import { activeBanners, addNotice, currentNotice, dropNotice, NO_NOTICES, noticeTimeoutMs, pickBanner, timedNotice, waitingShown, type Notices } from "../../ui/banners.ts";

const err = (text: string) => ({ text, error: true });
const info = (text: string) => ({ text });
const banners = (over: Partial<Parameters<typeof activeBanners>[0]> = {}) =>
  activeBanners({ adbStuck: false, state: "connected", notices: NO_NOTICES, gateway: false, clip: false, ...over });

test("pickBanner：没有提示时什么都不显示", () => {
  assert.deepEqual(pickBanner([]), { shown: null, waiting: 0 });
});

test("pickBanner：同时有几条时只显示最要紧的一条，其余算排着", () => {
  assert.deepEqual(pickBanner(["info", "clip", "gateway", "adb"]), { shown: "adb", waiting: 3 });
  assert.deepEqual(pickBanner(["gateway", "error"]), { shown: "error", waiting: 1 });
  assert.deepEqual(pickBanner(["info", "clip"]), { shown: "clip", waiting: 1 });
  assert.deepEqual(pickBanner(["error", "error", "info"]), { shown: "error", waiting: 2 });
});

test("pickBanner：几秒就收起的一般消息排在一直挂着的网关更新前面", () => {
  assert.deepEqual(pickBanner(["gateway", "info"]), { shown: "info", waiting: 1 });
});

test("noticeTimeoutMs：一般消息自己收起，错误和要留着的不收", () => {
  assert.equal(noticeTimeoutMs({}), 4000);
  assert.equal(noticeTimeoutMs({ error: true }), null);
  assert.equal(noticeTimeoutMs({ sticky: true }), null);
});

test("通知：后来的一般消息不顶掉还没关的错误，错误关掉后它才出来", () => {
  let q: Notices = addNotice(NO_NOTICES, err("启动失败"));
  q = addNotice(q, info("已复制"));
  assert.equal(currentNotice(q)?.text, "启动失败");
  q = dropNotice(q, currentNotice(q)!);
  assert.equal(currentNotice(q)?.text, "已复制");
});

test("通知：后来的错误先显示，前一条错误关掉这条后还在", () => {
  let q = addNotice(NO_NOTICES, err("第一条"));
  q = addNotice(q, err("第二条"));
  assert.equal(currentNotice(q)?.text, "第二条");
  assert.deepEqual(pickBanner(banners({ notices: q })), { shown: "error", waiting: 1 });
  q = dropNotice(q, currentNotice(q)!);
  assert.equal(currentNotice(q)?.text, "第一条");
  q = dropNotice(q, currentNotice(q)!);
  assert.equal(currentNotice(q), null);
});

test("通知：同样的错误再来一次不重复排，只挪到最新", () => {
  let q = addNotice(NO_NOTICES, err("没有连上网关"));
  q = addNotice(q, err("别的错"));
  q = addNotice(q, err("没有连上网关"));
  assert.deepEqual(q.kept.map((n) => n.text), ["别的错", "没有连上网关"]);
});

test("通知：一般消息之间新的换掉旧的", () => {
  const q = addNotice(addNotice(NO_NOTICES, info("旧")), info("新"));
  assert.equal(currentNotice(q)?.text, "新");
  assert.equal(pickBanner(banners({ notices: q })).waiting, 0);
});

test("activeBanners：adb 卡住只在连着设备时算；网关提示、剪贴板各算一条", () => {
  assert.deepEqual(banners({ adbStuck: true, state: "rebooting" }), []);
  assert.deepEqual(banners({ adbStuck: true, gateway: true, clip: true }).sort(), ["adb", "clip", "gateway"]);
});

test("一般消息只在显示出来时倒计时：被剪贴板提示挡着时不算", () => {
  const q = addNotice(NO_NOTICES, info("已复制"));
  assert.equal(timedNotice(pickBanner(banners({ notices: q, clip: true })).shown, q), null);
  assert.equal(timedNotice(pickBanner(banners({ notices: q })).shown, q)?.text, "已复制");
});

test("「关掉这条后还有 N 条」只写在能关掉的提示下面", () => {
  const q = addNotice(NO_NOTICES, info("已复制"));
  // 网关正在自动更新（关不掉）盖在什么上面都不写；要运行命令的那种能关，写
  assert.equal(waitingShown({ shown: "gateway", waiting: 1 }, false), false);
  assert.equal(waitingShown({ shown: "gateway", waiting: 1 }, true), true);
  // 一般消息自己收起，没有关闭
  assert.equal(waitingShown(pickBanner(banners({ notices: q, gateway: true })), false), false);
  assert.equal(waitingShown(pickBanner(banners({ clip: true, gateway: true })), false), true);
  assert.equal(waitingShown({ shown: "error", waiting: 0 }, false), false);
});
