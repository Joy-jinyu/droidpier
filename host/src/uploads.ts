import type { ClientMsg, ServerMsg, UploadState } from "../../shared/protocol.ts";
import { canSendChunk, encodeUploadChunk, fileKind, nextChunk, UPLOAD_MAX_BYTES } from "../../shared/upload.ts";

/** 页面上显示的一个文件。received 是网关已收下的字节。 */
export type UploadItem = {
  id: number;
  name: string;
  size: number;
  kind: "apk" | "file";
  state: "waiting" | UploadState;
  received: number;
  error?: string;
};

type Active = { item: UploadItem; file: File; sent: number; reading: boolean; timer: ReturnType<typeof setTimeout> | null };

/** 拖进来的文件排队，一次传一个；按网关的确认控制发送窗口，页面同一时间只读一个窗口的数据。 */
export function createUploads(opts: {
  send: (m: ClientMsg) => boolean;
  sendBinary: (b: Uint8Array) => boolean;
  onChange: (list: UploadItem[]) => void;
  onNotice: (text: string) => void;
  /** 发出 upload 后多久没回就当网关不支持。 */
  replyTimeoutMs: number;
}) {
  let nextId = 1;
  let items: UploadItem[] = [];
  const files = new Map<number, File>();
  let active: Active | null = null;

  const changed = () => opts.onChange(items.map((i) => ({ ...i })));
  const isEnded = (i: UploadItem) => i.state === "done" || i.state === "failed";
  const fail = (item: UploadItem, error: string) => {
    item.state = "failed";
    item.error = error;
    files.delete(item.id);
  };
  const finishActive = () => {
    if (active?.timer) clearTimeout(active.timer);
    active = null;
  };

  const fill = async () => {
    const a = active;
    if (!a || a.reading || a.item.state !== "uploading") return;
    while (active === a && canSendChunk({ sent: a.sent, acked: a.item.received, size: a.item.size })) {
      const { start, end } = nextChunk(a.sent, a.item.size);
      a.reading = true;
      let data: Uint8Array;
      try {
        data = new Uint8Array(await a.file.slice(start, end).arrayBuffer());
      } catch (e) {
        a.reading = false;
        if (active !== a) return;
        fail(a.item, `读文件失败：${(e as Error).message}`);
        finishActive();
        changed();
        return pump();
      }
      a.reading = false;
      if (active !== a || a.item.state !== "uploading") return;
      if (!opts.sendBinary(encodeUploadChunk(a.item.id, data))) return;
      a.sent = end;
    }
  };

  const pump = () => {
    if (active) return;
    const item = items.find((i) => i.state === "waiting");
    if (!item) return;
    const file = files.get(item.id)!;
    if (!opts.send({ t: "upload", id: item.id, name: item.name, size: item.size })) {
      fail(item, "没有连上网关");
      changed();
      return pump();
    }
    item.state = "uploading";
    const a: Active = { item, file, sent: 0, reading: false, timer: null };
    a.timer = setTimeout(() => {
      if (active !== a || a.timer === null) return;
      fail(item, "网关没有回应：可能要升级网关（重新运行安装命令）");
      finishActive();
      changed();
      pump();
    }, opts.replyTimeoutMs);
    active = a;
    changed();
  };

  return {
    /** 加进队列；格式不支持、太大的直接标失败。 */
    add(list: File[]) {
      for (const f of list) {
        const k = fileKind(f.name);
        const item: UploadItem = { id: nextId++, name: f.name, size: f.size, kind: k.kind === "apk" ? "apk" : "file", state: "waiting", received: 0 };
        items.push(item);
        if (k.kind === "unsupported") fail(item, `暂不支持 ${k.ext}，请提供 .apk`);
        else if (f.size > UPLOAD_MAX_BYTES) fail(item, "文件太大：最大 2 GB");
        else files.set(item.id, f);
      }
      changed();
      pump();
    },
    onMsg(m: Extract<ServerMsg, { t: "upload" }>) {
      const a = active;
      if (!a || a.item.id !== m.id) return;
      if (a.timer) {
        clearTimeout(a.timer);
        a.timer = null;
      }
      const item = a.item;
      if (m.state === "uploading") {
        item.received = m.received ?? item.received;
        changed();
        void fill();
        return;
      }
      item.state = m.state;
      if (m.state === "failed") fail(item, m.error ?? "未知原因");
      if (isEnded(item)) {
        files.delete(item.id);
        finishActive();
        if (item.state === "done" && item.kind === "file") opts.onNotice(`${item.name} 已放到 下载 文件夹`);
      }
      changed();
      pump();
    },
    /** 和网关断开：网关那边已经删了临时文件，进行中和排队的都作废。 */
    disconnected() {
      let any = false;
      for (const i of items) {
        if (isEnded(i)) continue;
        fail(i, "与网关断开");
        any = true;
      }
      finishActive();
      if (any) changed();
    },
    /** 收起结束了的。 */
    clear() {
      items = items.filter((i) => !isEnded(i));
      changed();
    },
    list: () => items.map((i) => ({ ...i })),
  };
}
