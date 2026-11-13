import { avdNameError } from "./avd-spec.ts";

/** 协议版本号。 */
export const PROTOCOL_VERSION = 1;

/** 升级网关的安装命令。 */
export const INSTALL_CMD = "curl -fsSL https://droid.devpier.dev/install.sh | sh";

/** 设备里的 adb 没有响应时，页面上统一显示的话。 */
export const ADB_UNRESPONSIVE = "模拟器里的 adb 没有响应（常见于模拟器长时间运行后）。可以点「重启模拟器」恢复。";

/**
 * 判断客户端（页面）版本与网关版本是否兼容。
 * 页面更新时网关需要升级；网关更新时页面需要刷新。
 */
export function compatibility(client: number, gateway: number): "ok" | "gateway-outdated" | "page-outdated" {
  if (client === gateway) return "ok";
  return client > gateway ? "gateway-outdated" : "page-outdated";
}

/** 二进制帧头字节数。 */
export const FRAME_HEADER_BYTES = 20;

/** WebSocket 关闭码：第一条消息不是 hello。 */
export const CLOSE_NO_HELLO = 4000;
/** WebSocket 关闭码：/devtools/ 的票据不对、过期、用过。旧网关也用它拒绝口令不对的 hello，不要挪作他用。 */
export const CLOSE_BAD_TOKEN = 4001;
/** WebSocket 关闭码：协议版本不匹配（第 3 阶段）。 */
export const CLOSE_VERSION = 4002;
/** WebSocket 关闭码：Origin 不在白名单。 */
export const CLOSE_ORIGIN = 4003;
/** WebSocket 关闭码：没有可用模拟器（第 1 阶段用法）。第 2 阶段起网关不再因此断开，只发 status 并保持连接。 */
export const CLOSE_NO_EMULATOR = 4004;

/** 二进制消息类型：截图帧。 */
export const BIN_FRAME = 1;
/** 二进制消息类型：截图 PNG（由 screenshot 请求触发，只发给请求方）。 */
export const BIN_SCREENSHOT = 2;

/** 帧头字段（来自 emulator 的 streamScreenshot 响应）。 */
export type FrameHeader = {
  seq: number;
  width: number;
  height: number;
  /** 时间戳毫秒，取 timestampUs/1000 的低 32 位。 */
  tsMs: number;
};

/** 把帧头编码为 20 字节 Uint8Array（5 个 u32 小端：kind、seq、width、height、tsMs）。 */
export function encodeFrameHeader(h: FrameHeader): Uint8Array {
  const buf = new Uint8Array(FRAME_HEADER_BYTES);
  const view = new DataView(buf.buffer);
  view.setUint32(0, BIN_FRAME, true);
  view.setUint32(4, h.seq >>> 0, true);
  view.setUint32(8, h.width >>> 0, true);
  view.setUint32(12, h.height >>> 0, true);
  view.setUint32(16, h.tsMs >>> 0, true);
  return buf;
}

/** 读取二进制消息的 kind 字段（第一个 u32 小端）。 */
export function binKind(buf: ArrayBuffer | Uint8Array): number {
  const ab = buf instanceof Uint8Array ? buf.buffer : buf;
  const offset = buf instanceof Uint8Array ? buf.byteOffset : 0;
  return new DataView(ab, offset).getUint32(0, true);
}

/** 解码帧头。 */
export function decodeFrameHeader(buf: ArrayBuffer | Uint8Array): FrameHeader {
  const ab = buf instanceof Uint8Array ? buf.buffer : buf;
  const offset = buf instanceof Uint8Array ? buf.byteOffset : 0;
  const view = new DataView(ab, offset);
  return {
    seq: view.getUint32(4, true),
    width: view.getUint32(8, true),
    height: view.getUint32(12, true),
    tsMs: view.getUint32(16, true),
  };
}

/** 一台 AVD 及其运行状态。running：no 未运行，grpc 运行中可接管，no-grpc 运行中但没开 gRPC。 */
export type AvdInfo = {
  /** AVD id：emulator -list-avds 列出的名字。 */
  name: string;
  /** 显示名（config.ini 的 avd.ini.displayname），没设时没有这一项。 */
  displayName?: string;
  width?: number;
  height?: number;
  ramMb?: number;
  apiLevel?: number;
  abi?: string;
  running: "no" | "grpc" | "no-grpc";
  serial?: number;
  grpcPort?: number;
};

/** 环境检查的一个缺失项。command 是手动安装命令，sizeMb 是大致下载量，auto 表示用户确认后网关能自动装。 */
export type EnvMissing = {
  id: EnvItemId;
  detail: string;
  sizeMb?: number;
  /** 装好后大约占多少磁盘（MB）；avd 是模拟器第一次启动时要求的空闲空间。 */
  diskMb?: number;
  command?: string;
  auto: boolean;
};

/** 缺失项 id 的固定顺序，也是安装顺序：后面的依赖前面的。 */
export const ENV_ITEM_IDS = ["java", "sdk", "cmdline-tools", "emulator", "platform-tools", "system-image", "avd"] as const;
export type EnvItemId = (typeof ENV_ITEM_IDS)[number];
/** 网关能自动装的项，按安装顺序；java 只能用户自己装。 */
export const INSTALL_IDS = ENV_ITEM_IDS.filter((id) => id !== "java");

/** 装这些项要跑 sdkmanager 或 avdmanager，也就要 Java。 */
export const NEEDS_JAVA: readonly EnvItemId[] = ["emulator", "platform-tools", "system-image", "avd"];

/** 一份等用户同意的许可证。id 每份递增，页面回答时原样带回。 */
export type Licence = { id: number; name: string; text: string };

/** 环境检查里手动建设备命令用的名字和机型。 */
export const DEFAULT_AVD = { name: "emu_web_default", device: "pixel_5" } as const;

/** avdmanager list device 里的一个机型。 */
export type DeviceModel = { id: string; name: string; oem: string };

/**
 * 一个 arm64-v8a 系统镜像。pkg 是 sdkmanager / avdmanager 用的包路径；api 是路径里的级别（如 "34"、"36.1"），apiLevel 是它的整数部分。
 * 没安装的带 sizeMb（下载大小）和 diskMb（安装后大约占用）。
 */
export type SystemImage = {
  pkg: string;
  api: string;
  apiLevel: number;
  tag: string;
  installed: boolean;
  /** 如 "Android 14"；不认识的级别没有。 */
  version?: string;
  sizeMb?: number;
  diskMb?: number;
};

/** 创建设备对话框用的目录。needTools：没有 avdmanager，要先装命令行工具；existing：已有的 AVD 名字。 */
export type AvdCatalog = {
  devices: DeviceModel[];
  images: SystemImage[];
  existing: string[];
  defaultDevice: string | null;
  defaultImage: string | null;
  needTools: boolean;
  devicesError?: string;
  imagesError?: string;
};

/** 网关建一台 AVD 用的参数，由 createAvd 消息和目录算出。 */
export type AvdSpec = { name: string; device: string; image: string; ramMb: number };

/** 环境检查结果；sdkRoot / avdHome 是会装进去的目录，页面确认框里要写明。 */
export type EnvReport = {
  ok: boolean;
  missing: EnvMissing[];
  sdkRoot: string;
  avdHome: string;
  /** 已有的 cmdline-tools 是 23 及以上：sdkmanager 换成了 Android CLI，可能不问就接受许可证。 */
  androidCli: boolean;
  /** 找到的 Java（sdkmanager / avdmanager 要用）；没找到为 null，缺失项里会有 java。 */
  javaHome: string | null;
  /** sdkRoot 所在磁盘的剩余空间（MB）。 */
  freeMb: number;
  /** avdHome 所在磁盘的剩余空间（MB），sameDisk 时和 freeMb 是同一块盘。 */
  avdFreeMb: number;
  sameDisk: boolean;
  /** 检查本身出错（不是缺东西）：ok 为 false，页面显示这段文字。 */
  error?: string;
};

/** 一项安装的进度。license：在等页面上的用户同意许可证。 */
export type InstallProgress = {
  id: string;
  phase: "download" | "unpack" | "license" | "install" | "done" | "failed";
  pct?: number;
  logTail: string;
};

/** 一个可调试的 WebView 页面。visible 来自 /json 的 description，表示页面是否在前台。 */
export type WebViewPage = {
  socket: string;
  pid?: number;
  pkg?: string;
  id: string;
  title: string;
  url: string;
  visible: boolean;
  frontendUrl?: string;
};

/** 设备顺时针转过的角度。 */
export type Rotation = 0 | 90 | 180 | 270;

/** 旋转方向：left 逆时针、right 顺时针转 90°。 */
export type RotateDir = "left" | "right";

/** 回复里标出“adb 没有响应”这类失败。 */
export type AdbErrorCode = "adb-unresponsive";

/** 客户端发给服务端的消息。 */
export type ClientMsg =
  /** token：旧页面还会带上网关启动口令，网关不再看它。 */
  | { t: "hello"; version: number; width: number; height: number; token?: string }
  | { t: "touch"; x: number; y: number; down: boolean }
  | { t: "key"; key: string; eventType: "keydown" | "keyup" | "keypress" }
  | { t: "text"; text: string }
  /** 只写设备剪贴板，不粘贴。 */
  | { t: "clip"; text: string }
  | { t: "resize"; width: number; height: number }
  | { t: "avds" }
  | { t: "start"; name: string }
  | { t: "stop" }
  | { t: "use"; name: string }
  /** 不带 dir 时顺时针（旧页面不带）。 */
  | { t: "rotate"; dir?: RotateDir }
  | { t: "screenshot" }
  /** 页面转到后台：停推画面，直到 resume。 */
  | { t: "pause" }
  | { t: "resume" }
  /** 下面几条带请求编号 rid，回复原样带回。 */
  | { t: "webviews"; rid: number }
  | { t: "inspect"; rid: number; socket: string; id: string }
  | { t: "navigate"; rid: number; socket: string; id: string; address: string }
  /** 改 AVD 的显示名（name 是 id）；回复同 rid 的 renameAvd，成功后网关给所有页面发新的 avds。 */
  | { t: "renameAvd"; rid: number; name: string; displayName: string }
  /** 用户在确认框里确认过才发：删掉这台 AVD 的 .ini 和数据目录（系统镜像不动）；运行中、启动中的拒绝。回复同 rid 的 deleteAvd，成功后网关给所有页面发新的 avds。 */
  | { t: "deleteAvd"; rid: number; name: string }
  /** 用户在页面确认框里确认过才发；ids 是要装的缺失项。 */
  | { t: "install"; ids: EnvItemId[] }
  /** 要创建设备对话框的目录。 */
  | { t: "catalog" }
  /** 用户在确认框里确认过才发：建一台 AVD，镜像没装时先装镜像。image 是目录里的 pkg。 */
  | { t: "createAvd"; name: string; device: string; image: string }
  /** 用户在许可证页面点了“同意” / “不同意”。 */
  | { t: "acceptLicenses"; id: number }
  | { t: "rejectLicenses"; id: number }
  /** 用户在确认框里确认过才发：经 gRPC 重启模拟器系统，不依赖 adb。 */
  | { t: "reboot" }
  /** 开始传一个文件，之后按 shared/upload.ts 的格式发二进制分片；同一连接同一时间只传一个。 */
  | { t: "upload"; id: number; name: string; size: number }
  /** 页面放弃了这个文件（读文件失败、等不到确认、文件变了）：网关删掉临时文件、让出位置。 */
  | { t: "uploadCancel"; id: number };

/** 服务端发给客户端的消息。 */
export type ServerMsg =
  /** serial：当前会话的模拟器串口号，对应 AvdInfo.serial。 */
  | { t: "ready"; version: number; device: { width: number; height: number }; serial: number }
  /** rebooting：模拟器系统正在重启，结束后回到 connected。 */
  | { t: "status"; state: "connected" | "no-emulator" | "emulator-closed" | "booting" | "rebooting" }
  | { t: "avds"; list: AvdInfo[] }
  | { t: "boot"; name: string; progress: string; error?: string }
  | { t: "error"; message: string }
  /** 紧接着以 CLOSE_VERSION 关闭连接。upgrade 是升级网关的命令。 */
  | { t: "error"; code: "gateway-outdated" | "page-outdated"; gatewayVersion: number; upgrade: string }
  /** 设备里的 adb 没有响应（比如粘贴中文时），message 是 ADB_UNRESPONSIVE。 */
  | { t: "error"; code: "adb-unresponsive"; message: string }
  /** 重启结束：done 开机完成；adb-down 等满了 adb 还不通，以画面为准；failed 重启指令没发成。 */
  | { t: "reboot"; result: "done" | "adb-down" | "failed"; error?: string }
  /** ready 之后和每次旋转后发。 */
  | { t: "orientation"; rotation: Rotation }
  /** 截图完成：先发文本元信息，紧接着发 BIN_SCREENSHOT 二进制。 */
  | { t: "screenshot"; name: string; size: number }
  /** 设备里复制了新内容。 */
  | { t: "clip"; text: string }
  /** error：没读到列表，list 为空不代表没有页面。 */
  /** code 为 adb-unresponsive 时 error 是 ADB_UNRESPONSIVE，页面就地给出重启按钮。 */
  | { t: "webviews"; rid: number; list: WebViewPage[]; error?: string; code?: AdbErrorCode }
  /** url：经网关代理的 DevTools 前端地址；没有前端地址时给 hint；页面不在了给 error。 */
  | { t: "inspect"; rid: number; url: string }
  | { t: "inspect"; rid: number; hint: string }
  | { t: "inspect"; rid: number; error: string; code?: AdbErrorCode }
  | { t: "navigate"; rid: number; ok: boolean; href?: string; title?: string; bridge?: boolean; error?: string; code?: AdbErrorCode }
  | { t: "renameAvd"; rid: number; ok: boolean; error?: string }
  | { t: "deleteAvd"; rid: number; ok: boolean; error?: string }
  /** hello 通过后（ready 之前）发一次，每次安装结束后再广播。 */
  | ({ t: "env" } & EnvReport)
  /** 每次安装进度更新都广播。 */
  | { t: "install"; progress: InstallProgress }
  /** 许可证正文，等用户同意；null 表示不再等（已同意、已拒绝或安装结束）。 */
  | { t: "licenses"; licence: Licence | null }
  /** 回复 catalog。 */
  | { t: "catalog"; catalog: AvdCatalog }
  /** 只发给传文件的连接。uploading 每写完一片发一次；received 是已写进网关临时文件的字节。 */
  | { t: "upload"; id: number; state: UploadState; received?: number; error?: string };

/** 传文件的阶段：uploading 传到网关，installing 装 APK，pushing 放进下载文件夹。 */
export type UploadState = "uploading" | "installing" | "pushing" | "done" | "failed";

function isNum(v: unknown): v is number { return typeof v === "number"; }
function isStr(v: unknown): v is string { return typeof v === "string"; }
function isBool(v: unknown): v is boolean { return typeof v === "boolean"; }

/** 解析客户端消息字符串；非法 JSON 或未知 t 返回 null。 */
export function parseClientMsg(raw: string): ClientMsg | null {
  let o: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    o = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  switch (o.t) {
    case "hello":
      if (!isNum(o.version) || !isNum(o.width) || !isNum(o.height)) return null;
      if (o.token !== undefined && !isStr(o.token)) return null;
      return o as ClientMsg;
    case "touch":
      if (!isNum(o.x) || !isNum(o.y) || !isBool(o.down)) return null;
      return o as ClientMsg;
    case "key":
      if (!isStr(o.key) || !["keydown", "keyup", "keypress"].includes(o.eventType as string)) return null;
      return o as ClientMsg;
    case "text":
    case "clip":
      if (!isStr(o.text)) return null;
      return o as ClientMsg;
    case "resize":
      if (!isNum(o.width) || !isNum(o.height)) return null;
      return o as ClientMsg;
    case "install":
      if (!Array.isArray(o.ids) || !o.ids.every((id) => isStr(id))) return null;
      return { t: "install", ids: (o.ids as string[]).filter((id): id is EnvItemId => (INSTALL_IDS as readonly string[]).includes(id)) };
    case "acceptLicenses":
    case "rejectLicenses":
      if (!isNum(o.id)) return null;
      return o as ClientMsg;
    case "catalog":
      return { t: "catalog" };
    case "createAvd":
      if (!isStr(o.name) || !isStr(o.device) || !isStr(o.image)) return null;
      return { t: "createAvd", name: o.name, device: o.device, image: o.image };
    case "rotate":
      if (o.dir === undefined) return { t: "rotate" };
      if (o.dir !== "left" && o.dir !== "right") return null;
      return { t: "rotate", dir: o.dir };
    case "avds":
    case "stop":
    case "screenshot":
    case "pause":
    case "resume":
      return o as ClientMsg;
    case "reboot":
      return { t: "reboot" };
    case "upload":
      if (!isNum(o.id) || !isStr(o.name) || !Number.isInteger(o.size) || (o.size as number) < 0) return null;
      return { t: "upload", id: o.id, name: o.name, size: o.size as number };
    case "uploadCancel":
      if (!isNum(o.id)) return null;
      return { t: "uploadCancel", id: o.id };
    case "start":
    case "use":
      if (!isStr(o.name)) return null;
      return o as ClientMsg;
    case "webviews":
      if (!isNum(o.rid)) return null;
      return o as ClientMsg;
    case "inspect":
      if (!isNum(o.rid) || !isStr(o.socket) || !isStr(o.id)) return null;
      return o as ClientMsg;
    case "navigate":
      if (!isNum(o.rid) || !isStr(o.socket) || !isStr(o.id) || !isStr(o.address)) return null;
      return o as ClientMsg;
    case "renameAvd":
      if (!isNum(o.rid) || !isStr(o.name) || !isStr(o.displayName)) return null;
      return { t: "renameAvd", rid: o.rid, name: o.name, displayName: o.displayName };
    case "deleteAvd":
      // name 拼进文件路径和 avdmanager 参数：不合 AVD 名规则的（../、- 开头）整条丢掉
      if (!isNum(o.rid) || !isStr(o.name) || avdNameError(o.name, []) !== null) return null;
      return { t: "deleteAvd", rid: o.rid, name: o.name };
    default:
      return null;
  }
}
