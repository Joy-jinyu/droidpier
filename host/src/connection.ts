import {
  BIN_FRAME,
  BIN_SCREENSHOT,
  binKind,
  CLOSE_NO_EMULATOR,
  decodeFrameHeader,
  FRAME_HEADER_BYTES,
  INSTALL_CMD,
  PROTOCOL_VERSION,
  type AvdCatalog,
  type AvdInfo,
  type ClientMsg,
  type EnvReport,
  type InstallProgress,
  type Licence,
  type FrameHeader,
  type Rotation,
  type ServerMsg,
} from "../../shared/protocol.ts";
import { classifyFailure, refineLocalFailure, type LocalPermission } from "./launch.ts";
import { createPending } from "./pending.ts";

/**
 * 页面看到的连接状态。bad-origin 之后不再重连；
 * lna-denied（本地网络权限被拒）、lna-prompt（权限框还没点）、no-gateway（本机网关没开）、refused（网关在，但没接受这条 WebSocket）照常每秒探测，连上就恢复。
 */
export type ConnState =
  | "connecting" | "connected" | "no-emulator" | "emulator-closed" | "booting" | "rebooting" | "disconnected"
  | "lna-denied" | "lna-prompt" | "bad-origin" | "no-gateway" | "refused";

/** 协议版本不兼容时的错误码。 */
export type VersionErrorCode = "gateway-outdated" | "page-outdated";

/** 开机进度，同 ServerMsg boot。 */
export type BootMsg = { name: string; progress: string; error?: string };

const RETRY_MS = 1000;
// 权限框没人点时 WebSocket 既不连上也不失败（Chrome 157 实测挂了 25 秒以上），过这么久还没连上就去查权限
const PROMPT_CHECK_MS = 3000;
const REQUEST_TIMEOUT_MS = 15000;

type RidMsg = Extract<ClientMsg, { rid: number }>;
/** 带 rid 的请求，rid 由连接分配。 */
export type Request = RidMsg extends infer M ? (M extends RidMsg ? Omit<M, "rid"> : never) : never;
/** 带 rid 请求的回复。 */
export type Reply = Extract<ServerMsg, { rid: number }>;

// 公网页面连 127.0.0.1 要声明目标是本机（Chrome 的本地网络访问）；不认识这个参数的版本会把它当子协议、抛 SyntaxError（Chrome 157 实测），
// 抛过一次就记住，之后直接不带参数
let addressSpaceOption = true;
function openSocket(url: string): WebSocket {
  if (addressSpaceOption) {
    try {
      return new WebSocket(url, { targetAddressSpace: "loopback" } as unknown as string);
    } catch {
      addressSpaceOption = false;
    }
  }
  return new WebSocket(url);
}

/** 到网关的 WebSocket 连接：连上先发 hello，断开后每秒重连。 */
export function createConnection(opts: {
  url: string;
  /** 页面不是本机地址打开的：连续连不上时按本地网络权限被拒处理。 */
  pageIsPublic: boolean;
  /** 查本地网络权限，用来细分 lna-denied；不给就不细分。 */
  localPermission?: () => Promise<LocalPermission>;
  /** WebSocket 没连上时问网关的 HTTP 有没有回应（launch.ts 的 gatewayAnswers），有回应就是 refused；不给就不分。 */
  gatewayAnswers?: () => Promise<boolean>;
  /** 标签页在后台时为真：这时断开了不重连，等 wake()。 */
  hidden: () => boolean;
  size: () => { width: number; height: number };
  onState: (s: ConnState) => void;
  onReady: (device: { width: number; height: number }, serial: number) => void;
  onOrientation: (rotation: Rotation) => void;
  onFrame: (h: FrameHeader, pixels: Uint8Array) => void;
  /** 收到截图 PNG 时回调（4 字节 kind 之后的 PNG 数据）。 */
  onScreenshot?: (name: string, png: Uint8Array) => void;
  /** 设备里复制了新内容。 */
  onClip?: (text: string) => void;
  onAvds?: (list: AvdInfo[]) => void;
  onBoot?: (b: BootMsg) => void;
  onEnv?: (env: EnvReport) => void;
  onInstall?: (p: InstallProgress) => void;
  /** 许可证正文；null 表示不再等用户同意。 */
  onLicenses?: (licence: Licence | null) => void;
  /** 创建设备对话框的目录。 */
  onCatalog?: (catalog: AvdCatalog) => void;
  onError?: (message: string) => void;
  /** 设备里的 adb 没有响应（比如粘贴中文时）。 */
  onAdbStuck?: (message: string) => void;
  /** 重启结束。 */
  onReboot?: (result: "done" | "adb-down" | "failed", error?: string) => void;
  /** 协议版本不匹配（或是还要口令的旧网关）时调用：停止重连，不再调用 onState。 */
  onVersionError?: (code: VersionErrorCode, upgrade: string) => void;
  /** hello 发出之后调用：补发页面当前的 pause 等状态。 */
  onOpen?: () => void;
  /** 传文件的进度和结果。 */
  onUpload?: (m: Extract<ServerMsg, { t: "upload" }>) => void;
  /** 打开过的连接断开了。 */
  onClose?: () => void;
}): {
  /** 发输入类消息：只在已接上设备时发。 */
  send(m: ClientMsg): boolean;
  /** 发设备管理 / pause 这类消息：连接打开就发，不要求已接上设备。 */
  control(m: ClientMsg): boolean;
  /** 发二进制消息（传文件的分片）：连接打开就发。 */
  sendBinary(b: Uint8Array): boolean;
  /** 发带 rid 的请求，等同 rid 的回复；没连上、15 秒没回、连接断开都以失败结束。 */
  request<T extends Reply["t"]>(m: Request & { t: T }): Promise<Extract<Reply, { t: T }>>;
  /** 标签页回到前台时调用：后台期间停下的重连马上接着做。 */
  wake(): void;
} {
  let ws: WebSocket | null = null;
  let state: ConnState | null = null;
  let stopped = false;
  let everOpened = false;
  // 后台时该重连了就先记下，回到前台再连
  let waitingVisible = false;
  // 上次连上之后连续失败的次数
  let attempts = 0;
  // 收到版本不兼容错误时暂存，close 事件里用
  let pendingVersionError: { code: VersionErrorCode; upgrade: string } | null = null;
  // 等待截图二进制帧时暂存元信息（文本消息先到，二进制后到）
  let pendingScreenshot: string | null = null;
  const pending = createPending<Reply>(REQUEST_TIMEOUT_MS);
  const setState = (s: ConnState) => {
    if (s === state) return;
    state = s;
    opts.onState(s);
  };

  const reconnect = () => {
    if (stopped) return;
    if (opts.hidden()) waitingVisible = true;
    else connect();
  };

  const connect = () => {
    let opened = false;
    const sock = openSocket(opts.url);
    ws = sock;
    sock.binaryType = "arraybuffer";
    if (opts.pageIsPublic && !everOpened && opts.localPermission) {
      const check = opts.localPermission;
      setTimeout(() => {
        if (ws !== sock || sock.readyState !== WebSocket.CONNECTING) return;
        check().then((p) => { if (p === "prompt" && ws === sock && sock.readyState === WebSocket.CONNECTING) setState("lna-prompt"); });
      }, PROMPT_CHECK_MS);
    }
    sock.onopen = () => {
      opened = true;
      everOpened = true;
      attempts = 0;
      pendingScreenshot = null;
      const { width, height } = opts.size();
      sock.send(JSON.stringify({ t: "hello", version: PROTOCOL_VERSION, width, height } satisfies ClientMsg));
      opts.onOpen?.();
    };
    sock.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        const kind = binKind(e.data);
        if (kind === BIN_FRAME) {
          if (e.data.byteLength < FRAME_HEADER_BYTES) return;
          opts.onFrame(decodeFrameHeader(e.data), new Uint8Array(e.data, FRAME_HEADER_BYTES));
        } else if (kind === BIN_SCREENSHOT && pendingScreenshot) {
          const name = pendingScreenshot;
          pendingScreenshot = null;
          opts.onScreenshot?.(name, new Uint8Array(e.data, 4));
        }
        return;
      }
      let m: ServerMsg;
      try {
        m = JSON.parse(e.data as string) as ServerMsg;
      } catch {
        console.warn("[emu] 丢弃无法解析的网关消息", String(e.data).slice(0, 200));
        return;
      }
      if (m.t === "ready") {
        opts.onReady(m.device, m.serial);
        setState("connected");
      } else if (m.t === "status") {
        // 模拟器关掉后，重连时网关会回 no-emulator；继续显示"已关闭"，直到重新连上
        if (!(m.state === "no-emulator" && state === "emulator-closed")) setState(m.state);
      } else if (m.t === "orientation") {
        opts.onOrientation(m.rotation);
      } else if (m.t === "screenshot") {
        pendingScreenshot = m.name;
      } else if (m.t === "clip") {
        opts.onClip?.(m.text);
      } else if (m.t === "avds") {
        opts.onAvds?.(m.list);
      } else if (m.t === "boot") {
        opts.onBoot?.({ name: m.name, progress: m.progress, ...(m.error ? { error: m.error } : {}) });
      } else if (m.t === "env") {
        const { t: _, ...env } = m;
        opts.onEnv?.(env);
      } else if (m.t === "install") {
        opts.onInstall?.(m.progress);
      } else if (m.t === "licenses") {
        opts.onLicenses?.(m.licence);
      } else if (m.t === "catalog") {
        opts.onCatalog?.(m.catalog);
      } else if (m.t === "upload") {
        opts.onUpload?.(m);
      } else if (m.t === "reboot") {
        opts.onReboot?.(m.result, m.error);
      } else if (m.t === "webviews" || m.t === "inspect" || m.t === "navigate" || m.t === "renameAvd" || m.t === "deleteAvd") {
        pending.settle(m.rid, m);
      } else if (m.t === "error") {
        if ("code" in m) {
          if (m.code === "adb-unresponsive") opts.onAdbStuck?.(m.message);
          else if (m.code === "gateway-outdated" || m.code === "page-outdated") {
            pendingVersionError = { code: m.code, upgrade: m.upgrade };
          }
          return;
        }
        console.warn("[emu] 网关报错", m.message);
        opts.onError?.(m.message);
      }
    };
    sock.onclose = (e) => {
      if (ws === sock) ws = null;
      pending.failAll("与网关断开");
      if (opened) opts.onClose?.();
      if (pendingVersionError) {
        const { code, upgrade } = pendingVersionError;
        pendingVersionError = null;
        stopped = true;
        opts.onVersionError?.(code, upgrade);
        return;
      }
      if (stopped) return;
      attempts++;
      // 网关在、只是拒绝了这条 WebSocket：显示 refused，照常重连
      if (!opened && opts.gatewayAnswers) {
        void opts.gatewayAnswers().then((up) => {
          // 结果回来时已经重新连上（attempts 清零）就不再改状态
          if (stopped || attempts === 0) return;
          if (up) setState("refused");
          else classify(e.code);
        });
        setTimeout(reconnect, RETRY_MS);
        return;
      }
      classify(e.code);
      setTimeout(reconnect, RETRY_MS);
    };
    const classify = (closeCode: number) => {
      const f = classifyFailure({ opened, closeCode, pageIsPublic: opts.pageIsPublic, attempts });
      if (f === "old-gateway") {
        stopped = true;
        opts.onVersionError?.("gateway-outdated", INSTALL_CMD);
        return;
      }
      if (f === "bad-origin" || f === "outdated") {
        stopped = true;
        if (f !== "outdated") setState(f);
        return;
      }
      if (f === "lna-denied" && opts.localPermission) {
        // 查询是异步的：结果回来时已经重新连上（attempts 清零）就不再改状态
        opts.localPermission().then((p) => { if (attempts > 0 && !stopped) setState(refineLocalFailure(f, p)); });
      } else if (f !== "retry") setState(f);
      // 4004 前网关已发过 status（没有模拟器 / 模拟器已关闭），保留它；还没连上过就继续显示连接中
      else if (everOpened && closeCode !== CLOSE_NO_EMULATOR) setState("disconnected");
    };
  };

  setState("connecting");
  connect();

  const raw = (m: ClientMsg) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(m));
    return true;
  };
  return {
    send: (m) => state === "connected" && raw(m),
    control: raw,
    sendBinary: (b) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      ws.send(b);
      return true;
    },
    request: (m) => pending.request((rid) => raw({ ...m, rid } as ClientMsg)) as never,
    wake: () => {
      if (!waitingVisible) return;
      waitingVisible = false;
      reconnect();
    },
  };
}
