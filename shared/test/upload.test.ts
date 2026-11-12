import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BIN_UPLOAD,
  canSendChunk,
  checkChunk,
  decodeUploadChunk,
  encodeUploadChunk,
  fileKind,
  installFailure,
  nextChunk,
  sanitizeFileName,
  UPLOAD_CHUNK_BYTES,
  UPLOAD_HEADER_BYTES,
  UPLOAD_WINDOW_BYTES,
} from "../upload.ts";
import { parseClientMsg } from "../protocol.ts";

test("文件名只留最后一段，去掉目录和 ..", () => {
  assert.equal(sanitizeFileName("../../etc/passwd"), "passwd");
  assert.equal(sanitizeFileName("C:\\Users\\a\\app-debug.apk"), "app-debug.apk");
  assert.equal(sanitizeFileName("dir/sub/报告 v2.pdf"), "报告 v2.pdf");
});

test("文件名为空、只有点、全是空白时不合法", () => {
  for (const bad of ["", ".", "..", "   ", "a/", "../..", "\u0000\u0001"]) assert.equal(sanitizeFileName(bad), null, JSON.stringify(bad));
});

test("控制字符去掉，Android 存储不认的字符换成下划线，首尾空白去掉", () => {
  assert.equal(sanitizeFileName(" a\u0000b\nc.txt "), "abc.txt");
  assert.equal(sanitizeFileName('a:b*c?"<d>|.txt'), "a_b_c___d__.txt");
});

const utf8 = (s: string) => new TextEncoder().encode(s).byteLength;

test("文件名按 UTF-8 字节截到 200 以内，保留扩展名", () => {
  const name = sanitizeFileName(`${"很".repeat(300)}.apk`)!;
  assert.ok(utf8(name) <= 200, String(utf8(name)));
  assert.ok(utf8(name) > 190, String(utf8(name)));
  assert.ok(name.endsWith(".apk"));
  assert.equal(sanitizeFileName(`${"a".repeat(196)}.apk`), `${"a".repeat(196)}.apk`);
  assert.equal(utf8(sanitizeFileName(`${"a".repeat(197)}.apk`)!), 200);
});

test("截断不拆开 emoji 的代理对", () => {
  for (let pad = 0; pad < 4; pad++) {
    const name = sanitizeFileName(`${"a".repeat(pad)}${"😀".repeat(80)}.txt`)!;
    assert.ok(utf8(name) <= 200);
    assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(name), "落单的代理项");
    assert.ok(name.endsWith(".txt"));
  }
});

test("fileKind：.apk（不分大小写）是 apk；.xapk/.apks/.aab/.apkm 不支持；其他是普通文件", () => {
  assert.deepEqual(fileKind("a.apk"), { kind: "apk" });
  assert.deepEqual(fileKind("A.APK"), { kind: "apk" });
  assert.deepEqual(fileKind("a.xapk"), { kind: "unsupported", ext: ".xapk" });
  assert.deepEqual(fileKind("a.apks"), { kind: "unsupported", ext: ".apks" });
  assert.deepEqual(fileKind("a.AAB"), { kind: "unsupported", ext: ".aab" });
  assert.deepEqual(fileKind("a.apkm"), { kind: "unsupported", ext: ".apkm" });
  assert.deepEqual(fileKind("notes.txt"), { kind: "file" });
  assert.deepEqual(fileKind("README"), { kind: "file" });
  assert.deepEqual(fileKind("apk"), { kind: "file" });
});

test("installFailure：认出 adb 的失败码，常见的配中文说明", () => {
  const out = "Command failed: adb -s emulator-5554 install -r -t /tmp/x/a.apk\nPerforming Streamed Install\nadb: failed to install /tmp/x/a.apk: Failure [INSTALL_FAILED_VERSION_DOWNGRADE: Downgrade detected: Update version code 1 is older than current 2]\n";
  const f = installFailure(out);
  assert.equal(f.code, "INSTALL_FAILED_VERSION_DOWNGRADE");
  assert.match(f.text, /^INSTALL_FAILED_VERSION_DOWNGRADE（.+）$/);
  assert.match(f.text, /版本/);
  assert.match(installFailure("Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Package x signatures do not match]").text, /签名.*卸载/);
  assert.match(installFailure("Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE]").text, /空间/);
  assert.match(installFailure("Failure [INSTALL_FAILED_NO_MATCHING_ABIS: Failed to extract native libraries, res=-113]").text, /arm64/);
  assert.match(installFailure("Failure [INSTALL_FAILED_DEPRECATED_SDK_VERSION: App package must target at least SDK version 23]").text, /targetSdk/);
  const p = installFailure("Failure [INSTALL_PARSE_FAILED_NOT_APK: Failed to parse /data/app/vmdl.tmp/base.apk]");
  assert.equal(p.code, "INSTALL_PARSE_FAILED_NOT_APK");
  assert.match(p.text, /^INSTALL_PARSE_FAILED_NOT_APK（.+）$/);
});

test("installFailure：不认识的失败码原样给出；没有失败码时取最后一行", () => {
  assert.deepEqual(installFailure("Failure [INSTALL_FAILED_SOMETHING_NEW: x]"), { code: "INSTALL_FAILED_SOMETHING_NEW", text: "INSTALL_FAILED_SOMETHING_NEW" });
  assert.deepEqual(installFailure("Command failed: adb push\nadb: error: failed to copy 'x' to '/sdcard/Download/x': remote No space left on device\n"), {
    text: "adb: error: failed to copy 'x' to '/sdcard/Download/x': remote No space left on device",
  });
  assert.deepEqual(installFailure(""), { text: "未知原因" });
});

test("分片：发送方最多领先确认 UPLOAD_WINDOW_BYTES，发完为止", () => {
  const size = UPLOAD_CHUNK_BYTES * 10 + 5;
  assert.equal(canSendChunk({ sent: 0, acked: 0, size }), true);
  assert.equal(canSendChunk({ sent: UPLOAD_WINDOW_BYTES, acked: 0, size }), false);
  assert.equal(canSendChunk({ sent: UPLOAD_WINDOW_BYTES, acked: UPLOAD_CHUNK_BYTES, size }), true);
  assert.equal(canSendChunk({ sent: size, acked: size - 5, size }), false);
  assert.deepEqual(nextChunk(0, size), { start: 0, end: UPLOAD_CHUNK_BYTES });
  assert.deepEqual(nextChunk(UPLOAD_CHUNK_BYTES * 10, size), { start: UPLOAD_CHUNK_BYTES * 10, end: size });
});

test("分片帧往返：kind 是 BIN_UPLOAD，带传输 id 和数据", () => {
  const data = new Uint8Array([1, 2, 3]);
  const buf = encodeUploadChunk(7, data);
  assert.equal(buf.byteLength, UPLOAD_HEADER_BYTES + 3);
  assert.equal(new DataView(buf.buffer).getUint32(0, true), BIN_UPLOAD);
  const d = decodeUploadChunk(buf)!;
  assert.equal(d.id, 7);
  assert.deepEqual([...d.data], [1, 2, 3]);
  assert.equal(decodeUploadChunk(new Uint8Array(4)), null);
});

test("checkChunk：id 不对、超过总大小、分片太大、收下未写的太多都拒绝", () => {
  const t = { id: 3, size: 1000, arrived: 0, written: 0 };
  assert.equal(checkChunk(t, 3, 100), null);
  assert.match(checkChunk(t, 4, 100)!, /传输/);
  assert.match(checkChunk(t, 3, 0)!, /空/);
  assert.match(checkChunk({ ...t, arrived: 950 }, 3, 100)!, /大小/);
  assert.match(checkChunk({ ...t, size: 10 * UPLOAD_CHUNK_BYTES }, 3, UPLOAD_CHUNK_BYTES + 1)!, /分片/);
  const big = { id: 3, size: 100 * UPLOAD_CHUNK_BYTES, arrived: 2 * UPLOAD_WINDOW_BYTES, written: 0 };
  assert.match(checkChunk(big, 3, UPLOAD_CHUNK_BYTES)!, /太快/);
});

test("parseClientMsg：uploadCancel 要有数字 id", () => {
  assert.deepEqual(parseClientMsg(JSON.stringify({ t: "uploadCancel", id: 2 })), { t: "uploadCancel", id: 2 });
  assert.equal(parseClientMsg(JSON.stringify({ t: "uploadCancel" })), null);
  assert.equal(parseClientMsg(JSON.stringify({ t: "uploadCancel", id: "2" })), null);
});

test("parseClientMsg：upload 要有数字 id、字符串 name、非负整数 size", () => {
  assert.deepEqual(parseClientMsg(JSON.stringify({ t: "upload", id: 1, name: "a.apk", size: 10 })), { t: "upload", id: 1, name: "a.apk", size: 10 });
  assert.equal(parseClientMsg(JSON.stringify({ t: "upload", id: "1", name: "a.apk", size: 10 })), null);
  assert.equal(parseClientMsg(JSON.stringify({ t: "upload", id: 1, name: 3, size: 10 })), null);
  assert.equal(parseClientMsg(JSON.stringify({ t: "upload", id: 1, name: "a", size: -1 })), null);
  assert.equal(parseClientMsg(JSON.stringify({ t: "upload", id: 1, name: "a", size: 1.5 })), null);
});
