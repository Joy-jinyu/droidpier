import { avdNameError } from "./avd-spec.ts";
import type { LogFilter, LogLevel, LogLine } from "./logcat.ts";

/** 协议版本号。 */
export const PROTOCOL_VERSION = 1;

/**
 * 网关功能级别：网关加了页面要用、旧网关不认的消息时加一。网关在 hello 之后的 gateway 消息里报出来，
 * 页面拿它和自己的比，网关旧了就提示更新（后台服务会自己更新）。和 PROTOCOL_VERSION 不同，级别不同照常连接。
 * 不发 gateway 消息的旧网关算 0。
 * 1：gateway、update 消息；renameAvd、deleteAvd 一定支持。
 * 2：stopAvd；deleteAvd 的 stop（运行中先停止再删）。
 * 3：日志面板（logcatOpen / logcatFilter / logcatClose / logcatApps）。
 * 4：logcatRead（WebMCP 读日志）。
 * 5：mumu 列表、mumuOpen / mumuClose（从页面开关 MuMu 模拟器）。
 * 6：iosSims 列表、iosSimOpen / iosSimClose、iosCatalog / createIosSim（iOS 模拟器）；use 认 iOS 模拟器的 UDID；caps.logs。
 */
export const GATEWAY_LEVEL = 6;

/** logcatRead 一次最多要多少行（WebMCP 的 droidpier_read_logcat）。 */
export const LOGCAT_READ_MAX = 1000;

/**
 * 网关自动更新一次检查的结果。off：不是后台服务或关了自动更新，不会自己更新；deferred：有新版本，等手上的操作结束
 * （message 是 busy 的原因）；failed：message 是 UpdateFailure，只给类别，不带路径和原始错误。
 */
export type UpdateState = "checking" | "latest" | "restarting" | "deferred" | "failed" | "off";

/** 自动更新失败的类别，和给用户看的话（页面和 droidpier status 共用）。 */
export const UPDATE_FAILURES = {
  network: "连不上下载站",
  manifest: "下载站上的版本信息不对",
  unsigned: "下载站上的版本没有签名",
  signature: "下载站上的版本签名不对",
  checksum: "下载的文件校验不通过",
  unpack: "解压失败",
  "bad-binary": "新版本运行不起来",
  "not-writable": "没有权限写入安装目录",
  install: "替换文件失败",
} as const;
export type UpdateFailure = keyof typeof UPDATE_FAILURES;

/** failed 的 message 转成给人看的话；不认识的类别（更新的网关加的）原样给出。 */
export const updateFailureText = (m: string | undefined) => (m && m in UPDATE_FAILURES ? UPDATE_FAILURES[m as UpdateFailure] : m ?? "未知原因");

/** 官方公网页面的来源。部署自己的一套时，构建用环境变量 PUBLIC_ORIGIN 换掉它（docs/deploy.md）。 */
export const OFFICIAL_ORIGIN = "https://droid.devpier.dev";

/** 从 origin 安装（或升级）并启动网关的命令。 */
export function installCmd(origin: string): string {
  return `curl -fsSL ${origin}/install.sh | sh`;
}

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
/** 二进制消息 kind：真机的 H.264 视频包，20 字节头（encodeVideoHeader）+ Annex B 数据。旧页面忽略。 */
export const BIN_VIDEO = 3;

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

/** 真机视频包头。没有时间戳：手机时钟和电脑不同，真机不算延迟。 */
export type VideoHeader = { seq: number; config: boolean; key: boolean; width: number; height: number };

/** 视频包头编码为 20 字节（5 个 u32 小端：kind=BIN_VIDEO、seq、flags、width、height；flags 第 0 位配置包、第 1 位关键帧）。 */
export function encodeVideoHeader(h: VideoHeader): Uint8Array {
  const buf = new Uint8Array(FRAME_HEADER_BYTES);
  const view = new DataView(buf.buffer);
  view.setUint32(0, BIN_VIDEO, true);
  view.setUint32(4, h.seq >>> 0, true);
  view.setUint32(8, (h.config ? 1 : 0) | (h.key ? 2 : 0), true);
  view.setUint32(12, h.width >>> 0, true);
  view.setUint32(16, h.height >>> 0, true);
  return buf;
}

/** 解码视频包头。 */
export function decodeVideoHeader(buf: ArrayBuffer | Uint8Array): VideoHeader {
  const ab = buf instanceof Uint8Array ? buf.buffer : buf;
  const offset = buf instanceof Uint8Array ? buf.byteOffset : 0;
  const view = new DataView(ab, offset);
  const flags = view.getUint32(8, true);
  return { seq: view.getUint32(4, true), config: (flags & 1) !== 0, key: (flags & 2) !== 0, width: view.getUint32(12, true), height: view.getUint32(16, true) };
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

/** 一台 USB / 无线连着的真机。state：device 可用，unauthorized 没在手机上允许 USB 调试，offline 其他（离线、recovery 等）。 */
/** 这台设备支持什么，页面和 WebMCP 只看它决定显示哪些操作（docs/superpowers/specs/2026-11-13-real-device-design.md 6.1）。 */
/** scroll：能收原生滚动（scroll 消息）；没有时页面用滑动模拟滚轮。 */
/** adb：设备走 adb，能用 H5 调试、日志、装 APK、传文件；只有 false 时才没有（iOS 模拟器），旧网关不发。 */
/** logs：不走 adb 也有日志面板（iOS 模拟器的 log stream）；走 adb 的设备不带这一项也有。 */
export type DeviceCaps = { rotate: boolean; reboot: boolean; stop: boolean; clipboard: boolean; input: boolean; scroll: boolean; adb?: boolean; logs?: boolean };

/** emulator：第三方模拟器，mumu 是 MuMu 模拟器（侧栏单独一组）；真机没有这个字段，旧网关也不发。 */
/**
 * 一台 MuMu 模拟器（mumutool info 读到的）。index 是 MuMu 的设备编号；adbId 只在运行中且知道 adb 端口时有，
 * 是它在 adb 里的设备 id（127.0.0.1:<端口>），和 PhoneInfo.id 对得上。
 */
export type MumuInfo = { index: number; name: string; state: "stopped" | "starting" | "running" | "stopping"; adbId?: string };

/** 一台 iOS 模拟器（xcrun simctl list 读到的）。udid 也是 use 消息里的设备名；runtime 是系统版本，如「iOS 27.0」。 */
/** iOS 模拟器的 UDID（大写 UUID）：simctl 的设备名，也用来区分 use 里的 iOS 模拟器。 */
export function isIosSimUdid(s: string): boolean {
  return /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(s);
}

export type IosSimInfo = { udid: string; name: string; runtime: string; state: "shutdown" | "booting" | "booted" | "shutting-down" };

/** 创建 iOS 模拟器对话框的目录：装了的 iOS 系统版本（新的在前），每个版本能用的机型。 */
export type IosCatalog = { runtimes: Array<{ id: string; name: string; devices: Array<{ id: string; name: string }> }> };

/** simctl 的机型、系统版本标识（会作为参数交给 simctl）。 */
export const IOS_DEVICE_TYPE_RE = /^com\.apple\.CoreSimulator\.SimDeviceType\.[\w.-]+$/;
export const IOS_RUNTIME_RE = /^com\.apple\.CoreSimulator\.SimRuntime\.[\w.-]+$/;

export type PhoneInfo = { id: string; state: "device" | "unauthorized" | "offline"; manufacturer?: string; model?: string; android?: string; emulator?: "mumu" };

/**
 * 环境检查的一个缺失项。command 只有旧网关会带（sdkmanager / avdmanager 的手动命令），sizeMb 是大致下载量，
 * auto 表示用户确认后网关能自动装。
 */
export type EnvMissing = {
  id: EnvItemId;
  detail: string;
  /** system-image：要装的镜像包路径，如 system-images;android-34;google_apis;arm64-v8a。 */
  pkg?: string;
  sizeMb?: number;
  /** 装好后大约占多少磁盘（MB）；avd 是模拟器第一次启动时要求的空闲空间。 */
  diskMb?: number;
  command?: string;
  auto: boolean;
};

/**
 * 缺失项 id 的固定顺序，也是安装顺序：设备要在系统镜像之后建。
 * 旧网关还会发 java、sdk、cmdline-tools，页面按不认识的项显示；它们发来的 install 新网关会滤掉。
 */
export const ENV_ITEM_IDS = ["emulator", "platform-tools", "system-image", "avd"] as const;
export type EnvItemId = (typeof ENV_ITEM_IDS)[number];
/** 网关能自动装的项，按安装顺序。 */
export const INSTALL_IDS = ENV_ITEM_IDS;

/** 一份等用户同意的许可证：name 是清单里的许可证 id（如 android-sdk-license），text 是全文。id 每份递增，页面回答时原样带回。 */
export type Licence = { id: number; name: string; text: string };

/** 创建设备对话框里的一个机型（网关内置的手机表）。 */
export type DeviceModel = { id: string; name: string; oem: string };

/**
 * 一个 arm64-v8a 系统镜像。pkg 是 SDK 仓库清单里的包路径；api 是路径里的级别（如 "34"、"36.1"），apiLevel 是它的整数部分。
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

/** 创建设备对话框用的目录。existing：已有的 AVD 名字。 */
export type AvdCatalog = {
  devices: DeviceModel[];
  images: SystemImage[];
  existing: string[];
  defaultDevice: string | null;
  defaultImage: string | null;
  imagesError?: string;
};

/** 网关建一台 AVD 用的参数，由 createAvd 消息和目录算出。 */
export type AvdSpec = { name: string; device: string; image: string; ramMb: number };

/**
 * 设备画面上要画的 DevTools 高亮（gateway/src/inspect.ts 的 highlightBox）。
 * quads 从外到内是 margin、border、padding、content 四层（没颜色的层是透明色，仍用来给外面一层挖空），points 是 4 个角的竖屏面板坐标（和 touch 同一套）。
 * label 形如 p#id.cls，不要标注时为 null；size 形如「328 × 225」（CSS 像素）。
 */
export type HighlightBox = { quads: Array<{ points: number[]; color: string }>; label: string | null; size: string };

/** 环境检查结果；sdkRoot / avdHome 是会装进去的目录，页面确认框里要写明。 */
export type EnvReport = {
  ok: boolean;
  missing: EnvMissing[];
  sdkRoot: string;
  avdHome: string;
  /** sdkRoot 所在磁盘的剩余空间（MB）。 */
  freeMb: number;
  /** avdHome 所在磁盘的剩余空间（MB），sameDisk 时和 freeMb 是同一块盘。 */
  avdFreeMb: number;
  sameDisk: boolean;
  /** 检查本身出错（不是缺东西）：ok 为 false，页面显示这段文字。 */
  error?: string;
  /** AVD 目录里能读到镜像配置的设备数（不管镜像在不在）。没装模拟器程序时设备列表是空的，页面靠它认出模拟器用户；旧网关没有这个字段。 */
  avds?: number;
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
  /** WebView 在屏幕上的位置（设备像素，按当前显示方向）；浏览器标签页没有。 */
  rect?: { x: number; y: number; width: number; height: number };
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
  /** 真机原生滚动：x、y 同 touch，dx、dy 是滚轮的 CSS 像素位移（往下滚 dy 为正）。只在 caps.scroll 为 true 时发，旧网关不认识。 */
  | { t: "scroll"; x: number; y: number; dx: number; dy: number }
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
  /** DevTools 选择元素模式下（收到 inspectMode on 且 mapped）代替触摸发：坐标同 touch，move 高亮、down + up 选中。 */
  | { t: "inspectPointer"; kind: "move" | "down" | "up"; x: number; y: number }
  /** 改 AVD 的显示名（name 是 id）；回复同 rid 的 renameAvd，成功后网关给所有页面发新的 avds。 */
  | { t: "renameAvd"; rid: number; name: string; displayName: string }
  /** 用户在确认框里确认过才发：删掉这台 AVD 的 .ini 和数据目录（系统镜像不动）；运行中、启动中的拒绝，带 stop 时先停止再删。回复同 rid 的 deleteAvd，成功后网关给所有页面发新的 avds。 */
  | { t: "deleteAvd"; rid: number; name: string; stop?: true }
  /** 用户点了“停止运行”：关掉这台 AVD（开机中的也算），不管是不是当前设备；等它真的停了才回复，回复同 rid 的 stopAvd，成功后网关给所有页面发新的 avds。 */
  | { t: "stopAvd"; rid: number; name: string }
  /** 用户点了 MuMu 设备的“启动”：网关执行 mumutool open，状态变化随 mumu 列表推给所有页面；失败回 error。 */
  | { t: "mumuOpen"; index: number }
  /** 用户确认关机：网关执行 mumutool close，同上。 */
  | { t: "mumuClose"; index: number }
  /** MuMuPlayer 没打开（mumu 消息带 appClosed）时用户点了“打开 MuMu”：网关打开播放器，之后的列表随 mumu 消息来；失败回 error。 */
  | { t: "mumuLaunch" }
  /** 用户点了 iOS 模拟器的“启动”：网关执行 simctl boot，状态变化随 iosSims 列表推给所有页面；失败回 error。 */
  | { t: "iosSimOpen"; udid: string }
  /** 用户确认关机：网关执行 simctl shutdown，同上。 */
  | { t: "iosSimClose"; udid: string }
  /** 创建 iOS 模拟器对话框要的目录；回复同 rid 的 iosCatalog。 */
  | { t: "iosCatalog"; rid: number }
  /** 用户在对话框里点了创建：simctl create，回复同 rid 的 createIosSim（带新模拟器的 udid），新列表随 iosSims 推给所有页面。 */
  | { t: "createIosSim"; rid: number; name: string; deviceType: string; runtime: string }
  /** 打开日志面板：网关按 filter 先回放最近的日志（logcat 的 reset），之后合批推新行。 */
  | { t: "logcatOpen"; filter: LogFilter }
  | { t: "logcatFilter"; filter: LogFilter }
  | { t: "logcatClose" }
  /** 日志面板的包名下拉：回复同 rid 的 logcatApps。 */
  | { t: "logcatApps"; rid: number }
  | { t: "logcatRead"; rid: number; filter: LogFilter; limit: number }
  /** 用户在页面确认框里确认过才发；ids 是要装的缺失项。 */
  | { t: "install"; ids: EnvItemId[] }
  /** 页面发现网关比自己旧（gateway 消息里的 level）时发：后台服务马上检查一次更新。不带参数，下载地址只在网关里。 */
  | { t: "update" }
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
  /** serial：当前会话的模拟器串口号，对应 AvdInfo.serial。deviceId：adb 里的设备名（emulator-5554、真机序列号），旧网关不发。 */
  | { t: "ready"; version: number; device: { width: number; height: number }; serial: number; deviceId?: string; kind?: "emulator" | "phone"; caps?: DeviceCaps }
  /** rebooting：模拟器系统正在重启，结束后回到 connected。phone-closed：真机断开了（拔线、取消授权），插回后网关会自动重连。 */
  | { t: "status"; state: "connected" | "no-emulator" | "emulator-closed" | "phone-closed" | "booting" | "rebooting" }
  | { t: "avds"; list: AvdInfo[] }
  /** 真机列表：hello 后发一次、之后有变化就发；没收到过就当网关不支持真机（旧网关）。 */
  | { t: "phones"; list: PhoneInfo[] }
  /**
   * MuMu 模拟器列表：本机装了 MuMu 时 hello 后发一次、之后有变化就发；没收到过就当没装或网关太旧。
   * appClosed：装了但 MuMuPlayer 没打开（列表为空），页面给“打开 MuMu”；不带这个字段的旧网关不支持 mumuLaunch。
   */
  | { t: "mumu"; list: MumuInfo[]; appClosed?: true }
  /** iOS 模拟器列表：本机装了 Xcode 时 hello 后发一次、之后有变化就发；没收到过就当没装或网关太旧。 */
  | { t: "iosSims"; list: IosSimInfo[] }
  | { t: "iosCatalog"; rid: number; catalog?: IosCatalog; error?: string }
  | { t: "createIosSim"; rid: number; udid?: string; error?: string }
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
  /**
   * 这个页面打开的 DevTools 进入、退出“选择元素”模式时发（gateway/src/inspect.ts）。
   * mapped：网关知道页面在屏幕上的位置（WebView 和浏览器标签页都算），页面这时不发触摸、改发 inspectPointer；算不出时为 false，照常发触摸。
   */
  | { t: "inspectMode"; on: boolean; mapped: boolean }
  /** DevTools 要高亮的元素，页面画在设备画面上（null 清掉）；网关在 DevTools 发 Overlay.highlightNode、选择元素模式下鼠标移动时发。 */
  | { t: "highlight"; box: HighlightBox | null }
  | { t: "stopAvd"; rid: number; ok: boolean; error?: string }
  /** reset 为 true 时页面先清空再放这些行；dropped 是因为页面连接积压而没发的行数。 */
  | { t: "logcat"; lines: LogLine[]; reset: boolean; dropped?: number }
  | { t: "logcatApps"; rid: number; foreground: string | null; apps: string[] }
  | { t: "logcatRead"; rid: number; lines: LogLine[]; error?: string }
  /** hello 通过后最先发。level 见 GATEWAY_LEVEL；version 是构建时间（从源码运行时为空）；autoUpdate：后台服务且没关自动更新。 */
  | { t: "gateway"; level: number; version: string; service: boolean; autoUpdate: boolean }
  /** 回复 update；换上新版本、马上重启时（restarting）发给所有页面。message 是 deferred 的原因或 failed 的错误。 */
  | { t: "update"; state: UpdateState; message?: string }
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
    case "scroll":
      if (!isNum(o.x) || !isNum(o.y) || !isNum(o.dx) || !isNum(o.dy)) return null;
      return { t: "scroll", x: o.x, y: o.y, dx: o.dx, dy: o.dy };
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
    case "update":
      return { t: "update" };
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
    case "inspectPointer":
      if (!["move", "down", "up"].includes(o.kind as string) || !isNum(o.x) || !isNum(o.y)) return null;
      return { t: "inspectPointer", kind: o.kind as "move" | "down" | "up", x: o.x, y: o.y };
    case "renameAvd":
      if (!isNum(o.rid) || !isStr(o.name) || !isStr(o.displayName)) return null;
      return { t: "renameAvd", rid: o.rid, name: o.name, displayName: o.displayName };
    case "deleteAvd":
      // name 拼进文件路径和 avdmanager 参数：不合 AVD 名规则的（../、- 开头）整条丢掉
      if (!isNum(o.rid) || !isStr(o.name) || avdNameError(o.name, []) !== null) return null;
      return { t: "deleteAvd", rid: o.rid, name: o.name, ...(o.stop === true ? { stop: true as const } : {}) };
    case "mumuLaunch":
      return { t: "mumuLaunch" };
    case "mumuOpen":
    case "mumuClose":
      if (!Number.isInteger(o.index) || (o.index as number) < 0) return null;
      return { t: o.t, index: o.index as number };
    case "iosCatalog":
      return isNum(o.rid) ? { t: "iosCatalog", rid: o.rid } : null;
    case "createIosSim":
      // 都作为参数交给 simctl（不经 shell）：名字限长、不许换行、不许 - 开头（simctl 会当成选项），机型和版本只收 simctl 标识的写法
      if (!isNum(o.rid) || !isStr(o.name) || !isStr(o.deviceType) || !isStr(o.runtime)) return null;
      if (!o.name.trim() || o.name.length > 64 || /[\r\n]/.test(o.name) || o.name.trim().startsWith("-") || !IOS_DEVICE_TYPE_RE.test(o.deviceType) || !IOS_RUNTIME_RE.test(o.runtime)) return null;
      return { t: "createIosSim", rid: o.rid, name: o.name.trim(), deviceType: o.deviceType, runtime: o.runtime };
    case "iosSimOpen":
    case "iosSimClose":
      // udid 会作为参数交给 simctl：只收 UUID 的写法
      if (!isStr(o.udid) || !isIosSimUdid(o.udid)) return null;
      return { t: o.t, udid: o.udid };
    case "stopAvd":
      if (!isNum(o.rid) || !isStr(o.name) || avdNameError(o.name, []) !== null) return null;
      return { t: "stopAvd", rid: o.rid, name: o.name };
    case "logcatOpen":
    case "logcatFilter": {
      const filter = parseLogFilter(o.filter);
      return filter ? { t: o.t, filter } : null;
    }
    case "logcatClose":
      return { t: "logcatClose" };
    case "logcatApps":
      return isNum(o.rid) ? { t: "logcatApps", rid: o.rid } : null;
    case "logcatRead": {
      const filter = parseLogFilter(o.filter);
      const ok = isNum(o.rid) && filter && Number.isInteger(o.limit) && (o.limit as number) >= 1 && (o.limit as number) <= LOGCAT_READ_MAX;
      return ok ? { t: "logcatRead", rid: o.rid as number, filter, limit: o.limit as number } : null;
    }
    default:
      return null;
  }
}

const LOG_LEVELS: readonly LogLevel[] = ["V", "D", "I", "W", "E", "F"];

/** 包名只认 Android 包名的字符；text 截到 200 字符。 */
/** 校验页面发来的日志过滤条件（WebMCP 工具发请求前也用它，免得发出网关会丢掉的消息）。 */
export function parseLogFilter(v: unknown): LogFilter | null {
  if (typeof v !== "object" || v === null) return null;
  const f = v as Record<string, unknown>;
  const pkg = f.pkg === null ? null : isStr(f.pkg) && f.pkg.length <= 200 && /^[A-Za-z][\w.]*$/.test(f.pkg) ? f.pkg : undefined;
  if (pkg === undefined || !LOG_LEVELS.includes(f.level as LogLevel) || !isStr(f.text)) return null;
  return { pkg, level: f.level as LogLevel, text: f.text.slice(0, 200) };
}
