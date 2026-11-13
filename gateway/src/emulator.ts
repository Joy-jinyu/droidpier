import { open, rm, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pidAlive, type Running } from "./discovery.ts";
import { loadController } from "./sdk.ts";
import { adb, emulatorId } from "./adb.ts";
import type { FrameHeader, RotateDir, Rotation } from "../../shared/protocol.ts";

type Size = { width: number; height: number };

/** 一台已连上的模拟器：订阅画面、注入输入、感知退出。 */
export interface EmulatorSession {
  device: Size;
  /** 设备 id：adb 里的设备名，模拟器是 emulator-<serial>。 */
  id: string;
  /** 控制台端口，只有模拟器有。 */
  serial: number;
  /** AVD 名称（来自发现文件，见 discoveryAvdName），未知时为 undefined。 */
  avdName?: string;
  /** 设备顺时针转过的角度。 */
  rotation: Rotation;
  frames(size: Size, onFrame: (h: FrameHeader, data: Buffer) => void): () => void;
  touch(x: number, y: number, down: boolean): Promise<void>;
  key(key: string, eventType: "keydown" | "keyup" | "keypress"): Promise<void>;
  text(text: string): Promise<void>;
  /** 转 90°（缺省顺时针），返回新的方向。 */
  rotate(dir?: RotateDir): Promise<Rotation>;
  /** 只写设备剪贴板，不粘贴。 */
  setClipboard(text: string): Promise<void>;
  getClipboard(): Promise<string>;
  /** 设备里复制了新内容时回调；setClipboard 写入的不会回调。 */
  onClipboard(cb: (text: string) => void): void;
  /** 经 gRPC 重启模拟器系统（setVmState RESET），不经过 adb。 */
  reboot(): Promise<void>;
  /** 截图并返回 PNG Buffer。 */
  screenshot(): Promise<Buffer>;
  /** 方向变了时回调，不管是 rotate() 转的，还是在别处（模拟器窗口、其他 gRPC 客户端）转的。 */
  onRotation(cb: (r: Rotation) => void): void;
  onClosed(cb: () => void): void;
  close(): void;
}

let mmapSeq = 0;

// 方向模型的 z 轴角度和设备顺时针角度互为相反数（实测：z=-90 时 Android 是 ROTATION_270、画面是顺时针转过的横屏）
/** 方向模型 z 轴角度 → 设备顺时针角度。 */
export function rotationFromZ(z: number): Rotation {
  return ((((Math.round(-z / 90) % 4) + 4) % 4) * 90) as Rotation;
}

/** 设备顺时针角度 → 方向模型 z 轴角度，落在 (-180, 180]。 */
export function zForRotation(r: Rotation): number {
  return r === 0 ? 0 : r === 90 ? -90 : r === 180 ? 180 : 90;
}

/** 从 r 往 dir 方向转 90° 后的方向。 */
export function turn(r: Rotation, dir: RotateDir): Rotation {
  return ((r + (dir === "left" ? 270 : 90)) % 360) as Rotation;
}

// 帧里的 SkinRotation 是模拟器按机身方向给的：LANDSCAPE 对应 z=90（Android ROTATION_90），
// 即设备逆时针转了 90°，等于顺时针 270°；REVERSE_LANDSCAPE 对应 z=-90，顺时针 90°。见 input-map.test.ts 的角点表
const SKIN: Record<string, Rotation> = { PORTRAIT: 0, REVERSE_LANDSCAPE: 90, REVERSE_PORTRAIT: 180, LANDSCAPE: 270 };

/** 帧里的 SkinRotation 名称 → 设备顺时针角度；认不出返回 null。 */
export function rotationFromSkin(name: string | undefined): Rotation | null {
  return name !== undefined && name in SKIN ? SKIN[name] : null;
}

type ClipStream = {
  on(ev: "data", cb: (c: { text?: string }) => void): unknown;
  on(ev: "error", cb: (e: { code?: number; message: string }) => void): unknown;
  on(ev: "end", cb: () => void): unknown;
  cancel(): void;
};

/**
 * 订阅设备剪贴板：每次订阅后的第一条是当前内容，跳过；流出错或结束就隔 retryMs 重开。返回停止函数。
 */
export function watchClipboard(
  open: () => ClipStream,
  onText: (text: string) => void,
  opts: { retryMs?: number; log?: (s: string) => void } = {},
): () => void {
  const log = opts.log ?? ((s: string) => console.error(s));
  let stopped = false;
  let call: ClipStream | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const start = () => {
    timer = undefined;
    if (stopped) return;
    let first = true;
    let over = false;
    const s = open();
    call = s;
    const retry = () => {
      if (over) return;
      over = true;
      if (call === s) call = undefined;
      if (!stopped) timer = setTimeout(start, opts.retryMs ?? 1000);
    };
    s.on("data", (c) => {
      if (first) {
        first = false;
        return;
      }
      onText(c.text ?? "");
    });
    s.on("error", (e) => {
      if (stopped) return;
      log(`剪贴板流出错：${e.message}`);
      retry();
    });
    s.on("end", retry);
  };
  start();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    call?.cancel();
  };
}

/** 连接发现到的模拟器；getStatus 在 timeoutMs 内不通就 reject。 */
export async function connectEmulator(running: Running, timeoutMs = 3000): Promise<EmulatorSession> {
  const client = loadController(running.grpcPort, running.token);
  const unary = <T = any>(m: string, req: object, deadlineMs?: number) =>
    new Promise<T>((res, rej) => {
      const opts = deadlineMs ? { deadline: Date.now() + deadlineMs } : {};
      client[m](req, opts, (e: Error | null, r: T) => (e ? rej(e) : res(r)));
    });

  let status: any;
  try {
    status = await unary("getStatus", {}, timeoutMs);
  } catch (e) {
    client.close();
    throw new Error(`连不上模拟器 gRPC 127.0.0.1:${running.grpcPort}：${(e as Error).message}`);
  }
  const hw = new Map<string, string>((status.hardwareConfig?.entry ?? []).map((e: any) => [e.key, e.value]));
  const device = { width: Number(hw.get("hw.lcd.width")), height: Number(hw.get("hw.lcd.height")) };
  const readModel = async (): Promise<number[]> => {
    const m = await unary("getPhysicalModel", { target: "ROTATION" }, timeoutMs);
    return m.value?.data ?? [];
  };
  const initial = await readModel().catch(() => []);

  const cancels = new Set<() => void>();
  const closedCbs: Array<() => void> = [];
  const rotationCbs: Array<(r: Rotation) => void> = [];
  const clipCbs: Array<(text: string) => void> = [];
  let stopClip: (() => void) | undefined;
  const setRotation = (r: Rotation) => {
    if (r === session.rotation) return;
    session.rotation = r;
    for (const cb of rotationCbs) cb(r);
  };
  let closed = false;
  const markClosed = () => {
    if (closed) return;
    session.close();
    for (const cb of closedCbs) cb();
  };
  // 模拟器进程退出时 gRPC 不一定立刻报错，按 pid 轮询兜底
  const watch = setInterval(() => {
    if (!pidAlive(running.pid)) markClosed();
  }, 1000);
  watch.unref();

  const session: EmulatorSession = {
    device,
    id: emulatorId(running.serial),
    serial: running.serial,
    avdName: running.avdName,
    rotation: rotationFromZ(initial[2] ?? 0),

    frames(size, onFrame) {
      const bytes = size.width * size.height * 4;
      const path = join(tmpdir(), `emu-web-${process.pid}-${++mmapSeq}.raw`);
      let cancelled = false;
      let fh: FileHandle | undefined;
      let call: any;
      // 读文件是异步的：同一时间只读一次，其间到达的通知只保留最新一个
      let pending: any = null;
      let reading = false;
      const drain = async () => {
        if (reading) return;
        reading = true;
        try {
          while (pending && !cancelled) {
            const img = pending;
            pending = null;
            const w = img.format?.width || size.width;
            const h = img.format?.height || size.height;
            const r = rotationFromSkin(img.format?.rotation?.rotation);
            if (r !== null) setRotation(r);
            const buf = Buffer.allocUnsafe(w * h * 4);
            await fh!.read(buf, 0, buf.length, 0);
            if (cancelled) break;
            onFrame({ seq: img.seq, width: w, height: h, tsMs: Math.floor(img.timestampUs / 1000) % 2 ** 32 }, buf);
          }
        } catch (e) {
          if (!cancelled) console.error("读取画面失败", (e as Error).message);
        } finally {
          reading = false;
        }
      };
      const cleanup = async () => {
        // FileHandle.close 会等进行中的 read 结束
        await fh?.close().catch(() => {});
        await rm(path, { force: true });
      };

      (async () => {
        fh = await open(path, "w+");
        await fh.truncate(bytes);
        if (cancelled) return cleanup();
        call = client.streamScreenshot({
          format: "RGBA8888",
          width: size.width,
          height: size.height,
          transport: { channel: "MMAP", handle: `file://${path}` },
        });
        call.on("data", (img: any) => {
          pending = img;
          drain();
        });
        call.on("error", (e: any) => {
          if (e.code === 1) return; // CANCELLED，自己取消的
          console.error("画面流出错", e.message);
          if (e.code === 14) markClosed(); // UNAVAILABLE，模拟器没了
        });
      })().catch((e) => {
        if (!cancelled) console.error("订阅画面失败", (e as Error).message);
      });

      const cancel = () => {
        if (cancelled) return;
        cancelled = true;
        cancels.delete(cancel);
        call?.cancel();
        if (fh) cleanup();
      };
      cancels.add(cancel);
      return cancel;
    },

    async touch(x, y, down) {
      await unary("sendTouch", { touches: [{ x: Math.round(x), y: Math.round(y), identifier: 0, pressure: down ? 1 : 0 }] });
    },

    async key(key, eventType) {
      await unary("sendKey", { key, eventType });
    },

    // 非 ASCII 走剪贴板。粘贴键实测（模拟器 32.1.14，Google 搜索框）：
    // sendKey({key:"Paste"}) 不生效；adb `input keyevent 279`（KEYCODE_PASTE）生效，所以用 adb。
    async text(text) {
      await session.setClipboard(text);
      await adb.device(emulatorId(running.serial))(["shell", "input", "keyevent", "279"]);
    },

    // gRPC setPhysicalModel 在 32.1.14 上实测生效，不需要退到 adb emu rotate；保留 x、y 两轴的倾角
    async rotate(dir = "right") {
      const [x = 0, y = 0, z = 0] = await readModel();
      const next = turn(rotationFromZ(z), dir);
      await unary("setPhysicalModel", { target: "ROTATION", value: { data: [x, y, zForRotation(next)] } });
      setRotation(next);
      return next;
    },

    async setClipboard(text) {
      await unary("setClipboard", { text });
    },

    async getClipboard() {
      const r = await unary("getClipboard", {}, timeoutMs);
      return r.text ?? "";
    },

    onClipboard(cb) {
      clipCbs.push(cb);
      stopClip ??= watchClipboard(() => client.streamClipboard({}), (text) => {
        for (const f of clipCbs) f(text);
      });
    },

    async reboot() {
      await unary("setVmState", { state: "RESET" }, timeoutMs);
    },

    async screenshot() {
      const res = await unary("getScreenshot", { format: "PNG" }, timeoutMs);
      // image 字段是 Uint8Array；转为 Buffer 返回
      const data: Uint8Array = res.image ?? new Uint8Array(0);
      return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    },

    onRotation(cb) {
      rotationCbs.push(cb);
    },

    onClosed(cb) {
      closedCbs.push(cb);
    },

    close() {
      if (closed) return;
      closed = true;
      clearInterval(watch);
      for (const c of [...cancels]) c();
      stopClip?.();
      client.close();
    },
  };
  return session;
}
