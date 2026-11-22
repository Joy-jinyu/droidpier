import { test } from "node:test";
import assert from "node:assert/strict";
import { decode, encode } from "../src/bplist.ts";

test("bplist：dict、array、ASCII 和中文字符串、整数、负数、浮点、bool、null、data 往返不变", () => {
  const v = { __selector: "_rpc_forwardSocketData:", __argument: { WIRPageIdentifierKey: 1, n: -5, f: 1.5, ok: true, no: false, none: null, list: ["a", 2], title: "你好 Example", WIRSocketDataKey: Buffer.from('{"id":1}') } };
  const back = decode(encode(v)) as typeof v;
  assert.deepEqual({ ...back, __argument: { ...back.__argument, WIRSocketDataKey: back.__argument.WIRSocketDataKey.toString() } }, { ...v, __argument: { ...v.__argument, WIRSocketDataKey: '{"id":1}' } });
});

test("bplist：长字符串、长数组（长度超过 14 用扩展长度）、对象多到要 2 字节引用", () => {
  const long = "x".repeat(300);
  const arr = Array.from({ length: 300 }, (_, i) => `k${i}`);
  assert.deepEqual(decode(encode({ long, arr })), { long, arr });
});

test("bplist：不是 bplist00 开头的直接报错", () => {
  assert.throws(() => decode(Buffer.from("not a plist at all, definitely not one; padding padding")), /不是二进制 plist/);
});
