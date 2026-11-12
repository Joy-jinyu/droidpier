// 第 0 阶段测速网关（试验代码）：按 mode 订阅模拟器画面并经 WebSocket 推给页面
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import sharp from "sharp";
import { findRunning } from "./discovery.ts";
import { loadController } from "./sdk.ts";
import { discoveryDir } from "./platform.ts";
import { LatestFrame } from "./latest-frame.ts";

const PORT = 8765;
const DEBUG = !!process.env.DEBUG;

const emu = await findRunning();
if (!emu) {
  console.error(`没有找到带 gRPC 的运行中模拟器（${discoveryDir()}）`);
  process.exit(1);
}
const ctl = loadController(emu.grpcPort, emu.token);
const unary = (m: string, req: object) =>
  new Promise<any>((res, rej) => ctl[m](req, (e: Error | null, r: any) => (e ? rej(e) : res(r))));

type Mode = "rgba" | "rgba-mmap" | "jpeg" | "png";
type Frame = { seq: number; recvMs: number; data: Buffer };

/** 16 字节头：seq、width、height、网关收帧时刻（ms），均为 u32 小端。 */
function pack(f: Frame, W: number, H: number): Buffer {
  const head = Buffer.alloc(16);
  head.writeUInt32LE(f.seq >>> 0, 0);
  head.writeUInt32LE(W, 4);
  head.writeUInt32LE(H, 8);
  head.writeUInt32LE(Math.floor(f.recvMs) >>> 0, 12);
  return Buffer.concat([head, f.data]);
}

async function serve(ws: WebSocket, mode: Mode, W: number, H: number) {
  const slot = new LatestFrame<Frame>();
  const stats = { recv: 0, sent: 0, bytes: 0, lagMs: 0 };
  let mmap: FileHandle | undefined;
  let mmapPath = "";
  const fmt: any = { format: mode === "png" ? "PNG" : "RGBA8888", width: W, height: H };
  if (mode === "rgba-mmap") {
    mmapPath = join(tmpdir(), `emu-frame-${process.pid}-${Date.now()}.raw`);
    mmap = await open(mmapPath, "w+");
    await mmap.truncate(W * H * 4);
    fmt.transport = { channel: "MMAP", handle: `file://${mmapPath}` };
  }
  const mmapBuf = Buffer.alloc(W * H * 4);
  let encoding = false;

  const flush = () => {
    if (ws.readyState !== ws.OPEN || ws.bufferedAmount > 0) return;
    const f = slot.take();
    if (!f) return;
    ws.send(pack(f, W, H));
    stats.sent++;
    stats.bytes += f.data.length;
  };
  // ws 没有“发送缓冲清空”事件，用短间隔轮询；只在有帧积压时才有事做
  const pump = setInterval(flush, 2);

  const call = ctl.streamScreenshot(fmt);
  // mmap 读文件和 jpeg 编码是异步的：同一时间只做一次，期间到达的通知只保留最新一个，做完再处理它
  let pendingImg: any = null;
  const process1 = async () => {
    if (encoding) return;
    encoding = true;
    while (pendingImg) {
      const img = pendingImg;
      pendingImg = null;
      const recvMs = performance.now();
      let data: Buffer;
      if (mode === "rgba-mmap") {
        await mmap!.read(mmapBuf, 0, mmapBuf.length, 0);
        data = Buffer.from(mmapBuf);
      } else {
        data = await sharp(img.image, { raw: { width: W, height: H, channels: 4 } }).jpeg({ quality: 80 }).toBuffer();
      }
      slot.put({ seq: img.seq, recvMs, data });
      flush();
    }
    encoding = false;
  };
  call.on("data", (img: any) => {
    stats.recv++;
    stats.lagMs += Date.now() - img.timestampUs / 1000;
    if (mode === "rgba-mmap" || mode === "jpeg") {
      pendingImg = img;
      process1();
      return;
    }
    slot.put({ seq: img.seq, recvMs: performance.now(), data: img.image });
    flush();
  });
  call.on("error", (e: any) => {
    if (e.code !== 1) console.error("stream error", e.message); // 1 = CANCELLED，自己取消的不报
  });

  const tick = setInterval(() => {
    if (DEBUG)
      console.log(
        `[${mode}] recv/s=${stats.recv} sent/s=${stats.sent} dropped=${slot.dropped} avgBytes=${stats.sent ? Math.round(stats.bytes / stats.sent) : 0} emu→gw=${stats.recv ? (stats.lagMs / stats.recv).toFixed(1) : "-"}ms`,
      );
    stats.recv = stats.sent = stats.bytes = stats.lagMs = 0;
    slot.dropped = 0;
  }, 1000);

  ws.on("message", (raw, isBinary) => {
    if (isBinary) return;
    const m = JSON.parse(raw.toString());
    if (m.t === "touch") {
      unary("sendTouch", { touches: [{ x: m.x, y: m.y, identifier: 0, pressure: m.down ? 1 : 0 }] }).catch((e) => console.error("touch", e.message));
    } else if (m.t === "key") {
      unary("sendKey", { eventType: "keypress", key: m.key }).catch((e) => console.error("key", e.message));
    }
  });

  ws.on("close", async () => {
    call.cancel();
    clearInterval(pump);
    clearInterval(tick);
    if (mmap) await mmap.close();
    console.log(`[${mode}] client closed, stream cancelled`);
  });
}

const benchHtml = new URL("../../spike/bench.html", import.meta.url);
const http = createServer((req, res) => {
  if (req.url === "/" || req.url?.startsWith("/?")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(readFileSync(benchHtml));
  } else {
    res.writeHead(404).end();
  }
});
const wss = new WebSocketServer({ server: http });
wss.on("connection", (ws, req) => {
  const mode = (new URL(req.url ?? "/", "http://x").searchParams.get("mode") ?? "rgba") as Mode;
  const q = new URL(req.url ?? "/", "http://x").searchParams;
  const W = Number(q.get("w") ?? 540), H = Number(q.get("h") ?? 1170);
  console.log(`[${mode}] client connected ${W}x${H}`);
  serve(ws, mode, W, H).catch((e) => {
    console.error(e);
    ws.close();
  });
});
http.listen(PORT, "127.0.0.1", () => console.log(`bench: http://127.0.0.1:${PORT}/  (emulator-${emu.serial}, grpc ${emu.grpcPort})`));
