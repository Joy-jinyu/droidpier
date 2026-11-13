import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BIN_FRAME,
  BIN_SCREENSHOT,
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
