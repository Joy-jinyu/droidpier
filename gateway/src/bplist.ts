// 最小的二进制 plist（bplist00）编解码：只够 iOS 模拟器 webinspectord 的消息用（gateway/src/ios-inspector.ts）。
// 支持 dict、array、string（ASCII / UTF-16）、整数、浮点、bool、null、data；不支持 set、uid 以外的少见类型

export type Plist = null | boolean | number | string | Buffer | Plist[] | { [k: string]: Plist };

export function decode(buf: Buffer): Plist {
  if (buf.length < 40 || buf.toString("latin1", 0, 8) !== "bplist00") throw new Error("不是二进制 plist");
  const trailer = buf.subarray(buf.length - 32);
  const offSize = trailer[6];
  const refSize = trailer[7];
  const numObjects = Number(trailer.readBigUInt64BE(8));
  const top = Number(trailer.readBigUInt64BE(16));
  const tableOff = Number(trailer.readBigUInt64BE(24));
  const readUInt = (pos: number, n: number) => {
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 256 + buf[pos + i];
    return v;
  };
  const offsets: number[] = [];
  for (let i = 0; i < numObjects; i++) offsets.push(readUInt(tableOff + i * offSize, offSize));
  const obj = (idx: number, depth: number): Plist => {
    if (depth > 64) throw new Error("plist 嵌套太深");
    const p = offsets[idx];
    if (p === undefined) throw new Error("plist 引用越界");
    const marker = buf[p];
    const type = marker >> 4;
    const info = marker & 0xf;
    const len = (): [number, number] => {
      if (info !== 0xf) return [info, p + 1];
      const n = 1 << (buf[p + 1] & 0xf);
      return [readUInt(p + 2, n), p + 2 + n];
    };
    switch (type) {
      case 0x0:
        return info === 0x8 ? false : info === 0x9 ? true : null;
      case 0x1: {
        const n = 1 << info;
        return n === 8 ? Number(buf.readBigInt64BE(p + 1)) : readUInt(p + 1, n);
      }
      case 0x2:
        return info === 2 ? buf.readFloatBE(p + 1) : buf.readDoubleBE(p + 1);
      // 日期：转成秒数（2001-01-01 起），这里用不到
      case 0x3:
        return buf.readDoubleBE(p + 1);
      case 0x4: {
        const [n, s] = len();
        return Buffer.from(buf.subarray(s, s + n));
      }
      case 0x5: {
        const [n, s] = len();
        return buf.toString("latin1", s, s + n);
      }
      case 0x6: {
        const [n, s] = len();
        const b = Buffer.from(buf.subarray(s, s + n * 2));
        b.swap16();
        return b.toString("utf16le");
      }
      case 0x8:
        return readUInt(p + 1, info + 1);
      case 0xa: {
        const [n, s] = len();
        const a: Plist[] = [];
        for (let i = 0; i < n; i++) a.push(obj(readUInt(s + i * refSize, refSize), depth + 1));
        return a;
      }
      case 0xd: {
        const [n, s] = len();
        const o: { [k: string]: Plist } = {};
        for (let i = 0; i < n; i++) o[String(obj(readUInt(s + i * refSize, refSize), depth + 1))] = obj(readUInt(s + (n + i) * refSize, refSize), depth + 1);
        return o;
      }
      default:
        throw new Error(`plist 不认识的类型 0x${type.toString(16)}`);
    }
  };
  return obj(top, 0);
}

function lenHeader(type: number, n: number): Buffer {
  if (n < 15) return Buffer.from([(type << 4) | n]);
  const b = Buffer.alloc(10);
  b[0] = (type << 4) | 0xf;
  b[1] = 0x13;
  b.writeBigUInt64BE(BigInt(n), 2);
  return b;
}

export function encode(root: Plist): Buffer {
  type Enc = { bytes: Buffer } | { kind: 0xa | 0xd; refs: number[]; n: number };
  const objects: Enc[] = [];
  const add = (v: Plist | undefined): number => {
    const i = objects.length;
    objects.push({ bytes: Buffer.alloc(0) });
    let enc: Enc;
    if (v === null || v === undefined) enc = { bytes: Buffer.from([0x00]) };
    else if (typeof v === "boolean") enc = { bytes: Buffer.from([v ? 0x09 : 0x08]) };
    else if (typeof v === "number" && Number.isInteger(v)) {
      const b = Buffer.alloc(9);
      b[0] = 0x13;
      b.writeBigInt64BE(BigInt(v), 1);
      enc = { bytes: b };
    } else if (typeof v === "number") {
      const b = Buffer.alloc(9);
      b[0] = 0x23;
      b.writeDoubleBE(v, 1);
      enc = { bytes: b };
    } else if (typeof v === "string") {
      const ascii = /^[\x00-\x7f]*$/.test(v);
      let body: Buffer;
      if (ascii) body = Buffer.from(v, "latin1");
      else {
        body = Buffer.from(v, "utf16le");
        body.swap16();
      }
      enc = { bytes: Buffer.concat([lenHeader(ascii ? 0x5 : 0x6, ascii ? body.length : body.length / 2), body]) };
    } else if (Buffer.isBuffer(v)) enc = { bytes: Buffer.concat([lenHeader(0x4, v.length), v]) };
    else if (Array.isArray(v)) enc = { kind: 0xa, refs: v.map(add), n: v.length };
    else {
      const ks = Object.keys(v);
      enc = { kind: 0xd, refs: [...ks.map((k) => add(k)), ...ks.map((k) => add(v[k]))], n: ks.length };
    }
    objects[i] = enc;
    return i;
  };
  add(root);
  const refSize = objects.length < 256 ? 1 : objects.length < 65536 ? 2 : 4;
  const ref = (r: number) => {
    const b = Buffer.alloc(refSize);
    b.writeUIntBE(r, 0, refSize);
    return b;
  };
  const bodies = objects.map((o) => ("bytes" in o ? o.bytes : Buffer.concat([lenHeader(o.kind, o.n), ...o.refs.map(ref)])));
  const head = Buffer.from("bplist00", "latin1");
  const offsets: number[] = [];
  let pos = head.length;
  for (const b of bodies) {
    offsets.push(pos);
    pos += b.length;
  }
  const offSize = pos < 256 ? 1 : pos < 65536 ? 2 : 4;
  const table = Buffer.concat(offsets.map((o) => {
    const b = Buffer.alloc(offSize);
    b.writeUIntBE(o, 0, offSize);
    return b;
  }));
  const trailer = Buffer.alloc(32);
  trailer[6] = offSize;
  trailer[7] = refSize;
  trailer.writeBigUInt64BE(BigInt(objects.length), 8);
  trailer.writeBigUInt64BE(0n, 16);
  trailer.writeBigUInt64BE(BigInt(pos), 24);
  return Buffer.concat([head, ...bodies, table, trailer]);
}
