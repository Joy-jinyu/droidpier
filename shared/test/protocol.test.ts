import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GATEWAY_LEVEL,
  LOGCAT_READ_MAX,
  BIN_FRAME,
  BIN_SCREENSHOT,
  BIN_VIDEO,
  encodeVideoHeader,
  decodeVideoHeader,
  FRAME_HEADER_BYTES,
  encodeFrameHeader,
  decodeFrameHeader,
  binKind,
  parseClientMsg,
  compatibility,
} from "../protocol.ts";

test("encodeFrameHeader 结果长度为 20，前 4 字节是 BIN_FRAME", () => {
  const buf = encodeFrameHeader({ seq: 7, width: 1080, height: 2340, tsMs: 123 });
  assert.equal(buf.length, FRAME_HEADER_BYTES);
  assert.equal(FRAME_HEADER_BYTES, 20);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  assert.equal(view.getUint32(0, true), BIN_FRAME);
  assert.equal(BIN_FRAME, 1);
});

test("帧头往返：decodeFrameHeader(encodeFrameHeader(...)) 深等于原对象", () => {
  const h = { seq: 7, width: 1080, height: 2340, tsMs: 123 };
  assert.deepEqual(decodeFrameHeader(encodeFrameHeader(h)), h);
});

test("binKind 读出帧类型为 1", () => {
  const buf = encodeFrameHeader({ seq: 1, width: 100, height: 200, tsMs: 0 });
  assert.equal(binKind(buf), 1);
});

test("binKind 读出其他值原样返回", () => {
  const buf = new Uint8Array(20);
  const view = new DataView(buf.buffer);
  view.setUint32(0, 42, true);
  assert.equal(binKind(buf), 42);
});

test("parseClientMsg 解析合法 touch 消息", () => {
  const msg = parseClientMsg('{"t":"touch","x":1,"y":2,"down":true}');
  assert.deepEqual(msg, { t: "touch", x: 1, y: 2, down: true });
});

test("parseClientMsg 非法 JSON 返回 null", () => {
  assert.equal(parseClientMsg("not json"), null);
});

test("parseClientMsg 未知 t 返回 null", () => {
  assert.equal(parseClientMsg('{"t":"rm -rf"}'), null);
});

test("parseClientMsg 字段类型不对返回 null", () => {
  assert.equal(parseClientMsg('{"t":"touch","x":"1","y":2,"down":true}'), null);
});

test("parseClientMsg 解析设备管理消息", () => {
  assert.deepEqual(parseClientMsg('{"t":"avds"}'), { t: "avds" });
  assert.deepEqual(parseClientMsg('{"t":"start","name":"Pixel"}'), { t: "start", name: "Pixel" });
  assert.deepEqual(parseClientMsg('{"t":"stop"}'), { t: "stop" });
  assert.deepEqual(parseClientMsg('{"t":"use","name":"Pixel"}'), { t: "use", name: "Pixel" });
});

test("parseClientMsg start / use 缺 name 或 name 不是字符串返回 null", () => {
  assert.equal(parseClientMsg('{"t":"start"}'), null);
  assert.equal(parseClientMsg('{"t":"use","name":1}'), null);
});

test("parseClientMsg 解析 rotate", () => {
  assert.deepEqual(parseClientMsg('{"t":"rotate"}'), { t: "rotate" });
});

test("parseClientMsg 解析 rotate 的方向，认不出的方向返回 null", () => {
  assert.deepEqual(parseClientMsg('{"t":"rotate","dir":"left"}'), { t: "rotate", dir: "left" });
  assert.deepEqual(parseClientMsg('{"t":"rotate","dir":"right"}'), { t: "rotate", dir: "right" });
  assert.equal(parseClientMsg('{"t":"rotate","dir":"up"}'), null);
  assert.equal(parseClientMsg('{"t":"rotate","dir":1}'), null);
});

test("BIN_SCREENSHOT 值为 2", () => {
  assert.equal(BIN_SCREENSHOT, 2);
});

test("binKind 对截图二进制消息返回 BIN_SCREENSHOT（2）", () => {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, BIN_SCREENSHOT, true);
  assert.equal(binKind(buf), BIN_SCREENSHOT);
});

test("parseClientMsg 解析 screenshot", () => {
  assert.deepEqual(parseClientMsg('{"t":"screenshot"}'), { t: "screenshot" });
});

test("parseClientMsg 解析 clip，text 不是字符串返回 null", () => {
  assert.deepEqual(parseClientMsg('{"t":"clip","text":"中文"}'), { t: "clip", text: "中文" });
  assert.equal(parseClientMsg('{"t":"clip","text":1}'), null);
});

test("parseClientMsg 解析 pause / resume", () => {
  assert.deepEqual(parseClientMsg('{"t":"pause"}'), { t: "pause" });
  assert.deepEqual(parseClientMsg('{"t":"resume"}'), { t: "resume" });
});

test("parseClientMsg 解析 webviews / inspect / navigate", () => {
  assert.deepEqual(parseClientMsg('{"t":"webviews","rid":1}'), { t: "webviews", rid: 1 });
  assert.deepEqual(parseClientMsg('{"t":"inspect","rid":2,"socket":"s","id":"p"}'), { t: "inspect", rid: 2, socket: "s", id: "p" });
  assert.deepEqual(
    parseClientMsg('{"t":"navigate","rid":3,"socket":"s","id":"p","address":"localhost:5173"}'),
    { t: "navigate", rid: 3, socket: "s", id: "p", address: "localhost:5173" },
  );
});

test("parseClientMsg webviews / inspect / navigate 字段缺失或类型不对返回 null", () => {
  assert.equal(parseClientMsg('{"t":"webviews"}'), null);
  assert.equal(parseClientMsg('{"t":"webviews","rid":"1"}'), null);
  assert.equal(parseClientMsg('{"t":"inspect","rid":1,"socket":"s"}'), null);
  assert.equal(parseClientMsg('{"t":"inspect","rid":1,"socket":2,"id":"p"}'), null);
  assert.equal(parseClientMsg('{"t":"inspect","socket":"s","id":"p"}'), null);
  assert.equal(parseClientMsg('{"t":"navigate","rid":1,"socket":"s","id":"p"}'), null);
  assert.equal(parseClientMsg('{"t":"navigate","rid":1,"socket":"s","id":"p","address":5173}'), null);
  assert.equal(parseClientMsg('{"t":"navigate","rid":1,"socket":"s","id":3,"address":"x"}'), null);
});

test("compatibility：相等返回 ok，页面版本更高返回 gateway-outdated，网关版本更高返回 page-outdated", () => {
  assert.equal(compatibility(1, 1), "ok");
  assert.equal(compatibility(2, 1), "gateway-outdated");
  assert.equal(compatibility(1, 2), "page-outdated");
});

test("hello 带上 token；token 不是字符串时整条不合法", () => {
  assert.deepEqual(parseClientMsg('{"t":"hello","version":1,"width":540,"height":1170,"token":"abc"}'), { t: "hello", version: 1, width: 540, height: 1170, token: "abc" });
  assert.equal(parseClientMsg('{"t":"hello","version":1,"width":540,"height":1170,"token":1}'), null);
});

test("parseClientMsg 认识 reboot", () => {
  assert.deepEqual(parseClientMsg(JSON.stringify({ t: "reboot" })), { t: "reboot" });
});

test("parseClientMsg 解析 renameAvd，字段不对时返回 null", () => {
  assert.deepEqual(parseClientMsg('{"t":"renameAvd","rid":3,"name":"A","displayName":"测试机","extra":1}'), { t: "renameAvd", rid: 3, name: "A", displayName: "测试机" });
  assert.equal(parseClientMsg('{"t":"renameAvd","rid":3,"name":"A"}'), null);
});

test("parseClientMsg 解析 deleteAvd；rid、name 不对或 name 不合 AVD 名规则时返回 null", () => {
  assert.deepEqual(parseClientMsg('{"t":"deleteAvd","rid":4,"name":"Pixel_5_API_34","extra":1}'), { t: "deleteAvd", rid: 4, name: "Pixel_5_API_34" });
  assert.equal(parseClientMsg('{"t":"deleteAvd","name":"A"}'), null);
  assert.equal(parseClientMsg('{"t":"deleteAvd","rid":4}'), null);
  for (const name of ["", "../A", "a/b", "-list", "a b", ".hidden"]) {
    assert.equal(parseClientMsg(JSON.stringify({ t: "deleteAvd", rid: 4, name })), null, name);
  }
});

test("parseClientMsg：inspectPointer 只认 move/down/up 和数字坐标", () => {
  assert.deepEqual(parseClientMsg('{"t":"inspectPointer","kind":"move","x":1,"y":2,"extra":1}'), { t: "inspectPointer", kind: "move", x: 1, y: 2 });
  assert.equal(parseClientMsg('{"t":"inspectPointer","kind":"click","x":1,"y":2}'), null);
  assert.equal(parseClientMsg('{"t":"inspectPointer","kind":"up","x":"1","y":2}'), null);
});

test("parseClientMsg 解析 stopAvd；rid、name 不对或 name 不合 AVD 名规则时返回 null", () => {
  assert.deepEqual(parseClientMsg('{"t":"stopAvd","rid":5,"name":"Pixel_5_API_34","extra":1}'), { t: "stopAvd", rid: 5, name: "Pixel_5_API_34" });
  assert.equal(parseClientMsg('{"t":"stopAvd","name":"A"}'), null);
  assert.equal(parseClientMsg('{"t":"stopAvd","rid":5}'), null);
  assert.equal(parseClientMsg(JSON.stringify({ t: "stopAvd", rid: 5, name: "../x" })), null);
});

test("parseClientMsg：deleteAvd 只在 stop 为 true 时带上 stop（运行中先停止再删）", () => {
  assert.deepEqual(parseClientMsg('{"t":"deleteAvd","rid":4,"name":"A","stop":true}'), { t: "deleteAvd", rid: 4, name: "A", stop: true });
  assert.deepEqual(parseClientMsg('{"t":"deleteAvd","rid":4,"name":"A","stop":"yes"}'), { t: "deleteAvd", rid: 4, name: "A" });
});

test("encodeVideoHeader / decodeVideoHeader 往返；kind 是 BIN_VIDEO，头 20 字节", () => {
  const h = { seq: 7, config: false, key: true, width: 864, height: 1920 };
  const buf = encodeVideoHeader(h);
  assert.equal(buf.byteLength, 20);
  assert.equal(binKind(buf), BIN_VIDEO);
  assert.deepEqual(decodeVideoHeader(buf), h);
  assert.deepEqual(decodeVideoHeader(encodeVideoHeader({ ...h, config: true, key: false })), { ...h, config: true, key: false });
});

test("parseClientMsg：scroll 只收四个有限数，多余字段丢掉", () => {
  assert.deepEqual(parseClientMsg('{"t":"scroll","x":1,"y":2,"dx":0,"dy":-120,"z":1}'), { t: "scroll", x: 1, y: 2, dx: 0, dy: -120 });
  assert.equal(parseClientMsg('{"t":"scroll","x":1,"y":2,"dy":3}'), null);
  assert.equal(parseClientMsg('{"t":"scroll","x":"1","y":2,"dx":0,"dy":3}'), null);
});

test("parseClientMsg：logcatOpen / logcatFilter 校验过滤条件", () => {
  assert.deepEqual(parseClientMsg('{"t":"logcatOpen","filter":{"pkg":"com.a.b","level":"W","text":"x","z":1}}'),
    { t: "logcatOpen", filter: { pkg: "com.a.b", level: "W", text: "x" } });
  assert.deepEqual(parseClientMsg('{"t":"logcatFilter","filter":{"pkg":null,"level":"V","text":""}}'),
    { t: "logcatFilter", filter: { pkg: null, level: "V", text: "" } });
  assert.equal(parseClientMsg('{"t":"logcatOpen","filter":{"pkg":"../x","level":"V","text":""}}'), null);
  assert.equal(parseClientMsg('{"t":"logcatOpen","filter":{"pkg":null,"level":"Q","text":""}}'), null);
  assert.equal(parseClientMsg('{"t":"logcatOpen"}'), null);
  assert.equal((parseClientMsg(JSON.stringify({ t: "logcatFilter", filter: { pkg: null, level: "V", text: "a".repeat(500) } })) as any).filter.text.length, 200);
});

test("parseClientMsg：logcatClose、logcatApps", () => {
  assert.deepEqual(parseClientMsg('{"t":"logcatClose"}'), { t: "logcatClose" });
  assert.deepEqual(parseClientMsg('{"t":"logcatApps","rid":3}'), { t: "logcatApps", rid: 3 });
  assert.equal(parseClientMsg('{"t":"logcatApps"}'), null);
});

test("parseClientMsg：logcatRead 校验 rid、filter、limit", () => {
  const filter = { pkg: "com.a", level: "E", text: "" };
  assert.deepEqual(parseClientMsg(JSON.stringify({ t: "logcatRead", rid: 1, filter, limit: 50 })), { t: "logcatRead", rid: 1, filter, limit: 50 });
  assert.equal(parseClientMsg(JSON.stringify({ t: "logcatRead", rid: 1, filter, limit: 0 })), null);
  assert.equal(parseClientMsg(JSON.stringify({ t: "logcatRead", rid: 1, filter, limit: LOGCAT_READ_MAX + 1 })), null);
  assert.equal(parseClientMsg(JSON.stringify({ t: "logcatRead", rid: 1, filter, limit: 1.5 })), null);
  assert.equal(parseClientMsg(JSON.stringify({ t: "logcatRead", rid: 1, filter: { pkg: "a b", level: "E", text: "" }, limit: 5 })), null);
});

test("GATEWAY_LEVEL 是 6（iOS 模拟器列表和开关机）", () => assert.equal(GATEWAY_LEVEL, 6));

test("parseClientMsg 解析 iosSimOpen / iosSimClose；udid 不是 UUID 写法时返回 null（它会交给 simctl）", () => {
  const u = "0A67FFC2-A5BD-43AB-9AA9-6E22B5511D40";
  assert.deepEqual(parseClientMsg(`{"t":"iosSimOpen","udid":"${u}","extra":1}`), { t: "iosSimOpen", udid: u });
  assert.deepEqual(parseClientMsg(`{"t":"iosSimClose","udid":"${u}"}`), { t: "iosSimClose", udid: u });
  for (const bad of ['{"t":"iosSimOpen"}', '{"t":"iosSimOpen","udid":"booted"}', '{"t":"iosSimClose","udid":"--set /tmp"}', `{"t":"iosSimOpen","udid":"${u.toLowerCase()}"}`, '{"t":"iosSimOpen","udid":1}']) {
    assert.equal(parseClientMsg(bad), null, bad);
  }
});

test("parseClientMsg 解析 mumuLaunch（多余字段丢掉）", () => {
  assert.deepEqual(parseClientMsg('{"t":"mumuLaunch","app":"/bin/sh"}'), { t: "mumuLaunch" });
});

test("parseClientMsg 解析 mumuOpen / mumuClose；index 不是非负整数时返回 null", () => {
  assert.deepEqual(parseClientMsg('{"t":"mumuOpen","index":0,"extra":1}'), { t: "mumuOpen", index: 0 });
  assert.deepEqual(parseClientMsg('{"t":"mumuClose","index":2}'), { t: "mumuClose", index: 2 });
  for (const bad of ['{"t":"mumuOpen"}', '{"t":"mumuOpen","index":-1}', '{"t":"mumuOpen","index":1.5}', '{"t":"mumuClose","index":"0"}', '{"t":"mumuOpen","index":"all"}']) {
    assert.equal(parseClientMsg(bad), null, bad);
  }
});

test("parseClientMsg 解析 iosCatalog / createIosSim；名字为空、太长、带换行，机型和版本不是 simctl 标识时返回 null", () => {
  const dt = "com.apple.CoreSimulator.SimDeviceType.iPhone-16";
  const rt = "com.apple.CoreSimulator.SimRuntime.iOS-18-3";
  assert.deepEqual(parseClientMsg('{"t":"iosCatalog","rid":1}'), { t: "iosCatalog", rid: 1 });
  assert.deepEqual(parseClientMsg(JSON.stringify({ t: "createIosSim", rid: 2, name: " 我的 iPhone ", deviceType: dt, runtime: rt })), { t: "createIosSim", rid: 2, name: "我的 iPhone", deviceType: dt, runtime: rt });
  for (const bad of [
    { name: "", deviceType: dt, runtime: rt },
    { name: "a".repeat(65), deviceType: dt, runtime: rt },
    { name: "a\nb", deviceType: dt, runtime: rt },
    { name: "a", deviceType: "--set /tmp", runtime: rt },
    { name: "a", deviceType: dt, runtime: "iOS 18.3" },
    { name: "--help", deviceType: dt, runtime: rt },
  ]) assert.equal(parseClientMsg(JSON.stringify({ t: "createIosSim", rid: 3, ...bad })), null, JSON.stringify(bad));
});
