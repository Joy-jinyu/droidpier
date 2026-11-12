/** 二进制消息类型：页面发给网关的文件分片（4 字节 kind + 4 字节传输 id + 数据）。 */
export const BIN_UPLOAD = 3;
export const UPLOAD_HEADER_BYTES = 8;
export const UPLOAD_CHUNK_BYTES = 256 * 1024;
/** 页面最多领先网关确认这么多字节：页面和网关手上压着的数据都不超过它。 */
export const UPLOAD_WINDOW_BYTES = 4 * UPLOAD_CHUNK_BYTES;
export const UPLOAD_MAX_BYTES = 2 * 1024 ** 3;
/** 非 APK 文件放到这里（设备里的「下载」文件夹）。 */
export const PUSH_DIR = "/sdcard/Download";

// Android 文件系统单个文件名上限 255 字节，留些余量
const NAME_MAX_BYTES = 200;
const UNSUPPORTED = [".xapk", ".apks", ".aab", ".apkm"];

/** 页面给的文件名只留最后一段，去掉控制字符、换掉 Android 存储不认的字符、限制长度；用不了时返回 null。 */
export function sanitizeFileName(raw: string): string | null {
  const base = raw.split(/[\\/]/).pop() ?? "";
  let name = base.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[:*?"<>|]/g, "_").trim();
  if (!name || /^\.+$/.test(name)) return null;
  if (utf8Bytes(name) > NAME_MAX_BYTES) {
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : "";
    name = cutToBytes(name.slice(0, name.length - ext.length), NAME_MAX_BYTES - utf8Bytes(ext)) + ext;
  }
  return name;
}

const utf8Bytes = (s: string) => new TextEncoder().encode(s).byteLength;

// 按码点截，不会拆开代理对
function cutToBytes(s: string, max: number): string {
  let out = "";
  let bytes = 0;
  for (const ch of s) {
    const b = utf8Bytes(ch);
    if (bytes + b > max) break;
    out += ch;
    bytes += b;
  }
  return out;
}

export type FileKind = { kind: "apk" } | { kind: "file" } | { kind: "unsupported"; ext: string };

/** 按扩展名分：.apk 安装，几种 APK 包格式暂不支持，其他文件放进下载文件夹。 */
export function fileKind(name: string): FileKind {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot).toLowerCase() : "";
  if (ext === ".apk") return { kind: "apk" };
  if (UNSUPPORTED.includes(ext)) return { kind: "unsupported", ext };
  return { kind: "file" };
}

const HINT: Record<string, string> = {
  INSTALL_FAILED_VERSION_DOWNGRADE: "设备上已装了更高的版本，先卸载再装",
  INSTALL_FAILED_UPDATE_INCOMPATIBLE: "签名和设备上已装的不同，先卸载再装",
  INSTALL_FAILED_INSUFFICIENT_STORAGE: "模拟器存储空间不足",
  INSTALL_FAILED_NO_MATCHING_ABIS: "APK 不支持 arm64，装不到这台模拟器上",
  INSTALL_FAILED_OLDER_SDK: "APK 要求的 Android 版本比这台模拟器高",
  INSTALL_FAILED_DEPRECATED_SDK_VERSION: "APK 的 targetSdk 低于 23，Android 14 起不让装",
};

/** 把 adb install / push 的失败输出变成一句给人看的话：认得的失败码带中文说明。 */
export function installFailure(output: string): { code?: string; text: string } {
  const code = /\b(INSTALL_(?:PARSE_)?FAILED_[A-Z0-9_]+)/.exec(output)?.[1];
  if (code) {
    const hint = HINT[code] ?? (code.startsWith("INSTALL_PARSE_FAILED_") ? "APK 文件损坏或不是有效的 APK" : undefined);
    return { code, text: hint ? `${code}（${hint}）` : code };
  }
  const last = output.split("\n").map((l) => l.trim()).filter(Boolean).pop();
  return { text: last ? last.slice(0, 300) : "未知原因" };
}

/** 发送方还能不能再发一片：没发完，且领先确认不到一个窗口。 */
export function canSendChunk(t: { sent: number; acked: number; size: number }): boolean {
  return t.sent < t.size && t.sent - t.acked < UPLOAD_WINDOW_BYTES;
}

/** 从 sent 开始的下一片。 */
export function nextChunk(sent: number, size: number): { start: number; end: number } {
  return { start: sent, end: Math.min(size, sent + UPLOAD_CHUNK_BYTES) };
}

export function encodeUploadChunk(id: number, data: Uint8Array): Uint8Array {
  const buf = new Uint8Array(UPLOAD_HEADER_BYTES + data.byteLength);
  const view = new DataView(buf.buffer);
  view.setUint32(0, BIN_UPLOAD, true);
  view.setUint32(4, id >>> 0, true);
  buf.set(data, UPLOAD_HEADER_BYTES);
  return buf;
}

/** 解出分片；太短返回 null。不检查 kind，调用方先用 binKind 分流。 */
export function decodeUploadChunk(buf: Uint8Array): { id: number; data: Uint8Array } | null {
  if (buf.byteLength < UPLOAD_HEADER_BYTES) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return { id: view.getUint32(4, true), data: buf.subarray(UPLOAD_HEADER_BYTES) };
}

/**
 * 网关收到一片时检查：arrived 是已收到（含还没写完）的字节，written 是已写进文件的。
 * 返回拒绝的原因；没问题返回 null。
 */
export function checkChunk(t: { id: number; size: number; arrived: number; written: number }, id: number, len: number): string | null {
  if (id !== t.id) return "传输编号不对";
  if (len === 0) return "空分片";
  if (len > UPLOAD_CHUNK_BYTES) return "分片太大";
  if (t.arrived + len > t.size) return "收到的数据超过了文件大小";
  if (t.arrived - t.written + len > 2 * UPLOAD_WINDOW_BYTES) return "页面发得太快，没有等网关确认";
  return null;
}
