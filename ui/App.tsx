import { type ViewRef, cleanup, createMotion, effect, host, Image, type JSX, keymap, LayoutAnimation, List, type ListRef, mount, openUrl, reduceMotion, Scroll, setColorScheme, signal, Text, token, View, windowSize } from "nsh";
import { Button, Collapsible, ContextMenu, Dialog, Input, Menu, MenuItem, MenuSeparator, Radio, RadioGroup, Select, Tab, Tabs, Toggle, Toolbar, ToolbarGroup, Tooltip } from "nsh/base";
import { fitMiddle, middleEllipsis, noBreak } from "./ellipsis";
import { gatewayDown } from "./gateway-state";
import { activeBanners, addNotice, currentNotice, dropNotice, NO_NOTICES, noticeTimeoutMs, pickBanner, timedNotice, waitingShown, type BannerKind, type Notice, type Notices } from "./banners";
import { isStopping, STOP_IDLE, stopStep, type StopEvent, type StopFlow } from "./stop-flow";
import { PENDING_MS, pendingAfter, type Pending, type PendingEvent } from "./start-pending";
import { failText } from "../shared/fail-text";
import { logCells } from "./log-columns";
import { isStaleStatus } from "./status-rev";
import { gbText, spaceCheck } from "../shared/disk-space";
import { AVD_DISK_MB, avdNameError, createItems, defaultAvdName, displayNameError, ramMbFor } from "../shared/avd-spec";
import { ADB_UNRESPONSIVE, OFFICIAL_ORIGIN, type DeviceCaps, type MumuInfo, type PhoneInfo, type Rotation } from "../shared/protocol";
import { parseTheme, type Theme } from "../shared/theme";
import { deviceFrame } from "../shared/screen";
import { glideFrames, poseAt, REST, startPose, turnAngle, type Glide } from "./device-motion";
import { parseZoom, stepZoom, ZOOM_STEPS } from "../shared/zoom";
import { searchSidebar } from "./device-search";
import { canPick, currentPhoneOf, phoneDetail, phoneLabel, phoneStatus, showPhones, splitPhones, mumuRows, mumuRowStatus, mumuRowTitle, type MumuRow, phoneTitle } from "./phones";
import { h5PollMs } from "./h5-poll";
import { shouldCloseConsole, type ConsoleEvent } from "./console-gone";
import { activePage, foregroundPkg, h5KeyShown, pickPage, visibleTitle } from "./h5-pages";
import { AUTO_START, autoOpen } from "./console-auto";
import { addressEdit, addressShown, addressSubmit, type AddressDraft } from "./address-field";
import { emulatorButtonShown, missingEmulatorItems, setupCardShown, setupNeeded } from "./setup-card";
import { deviceLive } from "./avd-delete";
import { applyBatch, levelColor, logEmptyText, type LogRow } from "./log-store";
import type { LogFilter, LogLevel, LogLine } from "../shared/logcat";

type State =
  | "connecting" | "connected" | "no-emulator" | "emulator-closed" | "phone-closed" | "booting" | "rebooting" | "disconnected"
  | "gateway-outdated" | "page-outdated"
  | "unsupported-browser" | "lna-denied" | "lna-prompt" | "bad-origin" | "no-gateway" | "refused";
type Avd = { name: string; displayName?: string; width?: number; height?: number; apiLevel?: number; running: "no" | "grpc" | "no-grpc"; serial?: number };
type Boot = { name: string; progress: string; error?: string; seconds: number };
type Page = { socket: string; pkg?: string; id: string; title: string; url: string; visible: boolean };
type InspectResult = { opened: true } | { cancelled: true } | { hint: string } | { error: string; adbStuck?: boolean };
type Inspected = { key: string; title: string; device: string };
type NavigateResult = { ok: boolean; title?: string; bridge?: boolean; error?: string; adbStuck?: boolean };
type WebViewsResult = { list: Page[]; error?: string; adbStuck?: boolean };
type Msg = { text: string; error?: boolean; adbStuck?: boolean };
/** 网关比页面旧时画面上方的提示（host/src/gateway-update.ts）。 */
type GatewayBanner = { kind: "updating" | "manual"; text: string; command?: string };
type EnvId = "emulator" | "platform-tools" | "system-image" | "avd";
type Missing = { id: EnvId; detail: string; pkg?: string; sizeMb?: number; diskMb?: number; command?: string; auto: boolean };
type Env = {
  ok: boolean; missing: Missing[]; sdkRoot: string; avdHome: string;
  freeMb: number; avdFreeMb: number; sameDisk: boolean; error?: string;
};
type Licence = { id: number; name: string; text: string };
type InstallProgress = { id: string; phase: "download" | "unpack" | "license" | "install" | "done" | "failed"; pct?: number; logTail: string };
type Setup = { env: Env | null; installs: InstallProgress[]; license: Licence | null; rev: number };
type DeviceModel = { id: string; name: string; oem: string };
type SystemImage = { pkg: string; api: string; apiLevel: number; tag: string; installed: boolean; version?: string; sizeMb?: number; diskMb?: number };
type Catalog = {
  devices: DeviceModel[]; images: SystemImage[]; existing: string[]; defaultDevice: string | null; defaultImage: string | null;
  imagesError?: string;
};
type NewAvd = { name: string; device: DeviceModel; image: SystemImage };
type Upload = {
  id: number; name: string; size: number; kind: "apk" | "file";
  state: "waiting" | "uploading" | "installing" | "pushing" | "done" | "failed"; received: number; error?: string;
};
type Confirm = { kind: "install"; ids: EnvId[] } | { kind: "avd"; avd: NewAvd };

// 菜单里回官网的链接；官网的来源由 host 给（emu.site：公网页面自己的来源，本机网关托管的页面用官方的）
const DOCS_PATH = "/docs/getting-started/install/";

/**
 * 颜色都在 ui/theme.json（nsh.json 的 "theme"，shadcn/ui 的 cssVars；颜色取自官网 site/src/styles/theme.css 的青色品牌色和带青的灰阶，两边一起改），这里只按角色用 token()，
 * 外观切换时 token() 自己换值；读的地方都要在 JSX 表达式或函数里，存进普通变量就只读一次。
 * 选中和开着用两种颜色：列表、分段控件、标签页里选中的一项用中性的 accent 底（或 foreground 指示条）；
 * 品牌青（primary）只给主操作按钮和开着的开关（工具栏的 H5、日志），和官网「强调色只给主按钮、选中态」一致。
 * shadcn 角色之外的：field 输入框和触发器的底，border-subtle / border-strong 比 border 淡一档、深一档，
 * toolbar-foreground 工具栏图标，primary-soft / primary-text 中性底上的品牌色底和品牌色字，primary-hover 主按钮悬停，
 * warning / success 状态色，overlay 画面上的浮层提示，drag-shade 拖文件时盖在画面上的底，scrim 对话框后面的遮罩，
 * selection 输入框的选区，device-bezel 机身。
 * 对比度（2026-11-18 按 WCAG 相对亮度公式算）：次要文字 muted-foreground 在各层底色上浅色 ≥5.83:1、深色 ≥6.03:1；
 * 主按钮上的字浅色 6.14:1、深色 6.95:1。浅色的 success / warning / destructive 比官网没有的状态色深一档（#166534、#a3460a、#c81e1e），
 * 压在灰色填充 muted 上也过 4.5:1。
 */

/** 输入框的占位符、光标和选区颜色：nsh/base 的 Input 不设就是浏览器默认（选区是系统蓝）。 */
const inputColors = () => ({ placeholderColor: token("muted-foreground"), caretColor: token("foreground"), selectionColor: token("selection") });

/**
 * 尺寸体系，页面按角色取值，不再写数字。圆角在 ui/theme.json（radius-sm 列表和菜单里的行、radius 控件、
 * radius-lg 弹层、对话框、工具组、提示条、radius-xl 侧栏），用 token() 读；其余在下面。
 * 嵌套的圆角同心：外层 = 内层 + 两层之间的距离（工具组 radius-lg 10 = 按钮 radius 8 + 内边距 1 + 边框 1）。
 */
/** 间距：按关系选档。 */
const SPACE = {
  /** 叠着的两行之间（名字和状态）、按钮组里的按钮之间、列表行之间 */
  hair: 2,
  /** 一个控件里的零件之间（图标和字）、弹层的内边距 */
  part: 4,
  /** 并排的控件之间、行里图标和文字之间、行的内边距 */
  item: 8,
  /** 文字控件的左右内边距；卡片、提示条、面板工具栏的内边距 */
  inset: 12,
  /** 对话框的内边距和里面分段之间、页面边距、侧栏里分组之间 */
  group: 16,
  /** 空状态的留白、画面上方的留白 */
  section: 24,
} as const;
/** 控件高度：sm 嵌在输入框里的按钮、弹层和菜单里的行；md 按钮、输入框、下拉框；group 工具组的外框（md + 两边各 1 内边距 + 1 边框）。 */
const CONTROL = { sm: 28, md: 32, group: 36 } as const;
/** 图标：md 按钮和行里的；sm 输入框、下拉框里跟着一行字的；hero 只给空状态的大图。 */
const ICON = { sm: 14, md: 16, hero: 40 } as const;
/**
 * 字号和行高绑在一起：caption 状态行、说明、分组标签；body 正文和控件；title 对话框、卡片和空状态的标题；
 * heading 页面标题（当前设备）。code 是日志、安装输出这类密排的等宽字，唯一小于 12 的一档。
 */
const TYPE = {
  caption: { fontSize: 12, lineHeight: 18 },
  body: { fontSize: 13, lineHeight: 20 },
  title: { fontSize: 15, lineHeight: 22, fontWeight: "600" },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: "600" },
  code: { fontSize: 11, lineHeight: 17 },
} as const;
/** 字重：medium 按钮和标签页的字，strong 名字和需要强调的一行（标题的字重在 TYPE 里）。 */
const WEIGHT = { medium: "500", strong: "600" } as const;
/** 动效时长：fast 悬停、焦点、按下、弹层进出；normal 外观切换和布局变化。按下统一缩到 PRESS。 */
const MOTION = { fast: 120, normal: 200 } as const;
const PRESS = 0.97;
/** 不能点的控件的不透明度。 */
const DISABLED = 0.4;

const LABEL: Record<State, string> = {
  connecting: "连接中…",
  connected: "已连接",
  "no-emulator": "没有运行中的模拟器",
  "emulator-closed": "模拟器已停止",
  "phone-closed": "手机已断开",
  booting: "启动中…",
  rebooting: "重启中…",
  disconnected: "和网关断开了，正在重连…",
  "gateway-outdated": "网关版本过旧",
  "page-outdated": "页面版本过旧：按 ⌘⇧R 强制刷新",
  "unsupported-browser": "不支持这个浏览器",
  "lna-denied": "无法访问本机",
  "lna-prompt": "等待允许访问本机",
  "bad-origin": "来源未被允许",
  "no-gateway": "还没连上网关",
  refused: "网关没有接受这个浏览器的连接",
};

// 连不上时画面上方的说明；带命令的两种（gateway-outdated、no-gateway）命令由 host 在 upgrade 里给
const PROBLEM: Partial<Record<State, string>> = {
  "phone-closed": "重新插上手机后会自动恢复。",
  "gateway-outdated": "网关版本过旧，请运行：",
  "page-outdated": "页面版本过旧：按 ⌘⇧R 强制刷新。",
  "unsupported-browser": "请用 Chrome 或 Edge 打开。",
  "lna-denied": "Chrome 阻止了访问本机：请在 Chrome 的「设置 → 隐私和安全 → 网站设置」里允许本站访问本地网络，然后刷新。",
  "lna-prompt": "Chrome 正在询问是否允许本站访问本机：请在地址栏旁的权限框里点「允许」。",
  // 网关在升级时就拒绝了，页面问不到它信任哪个来源
  "bad-origin": "这个页面地址不在网关允许的来源里：请打开你安装网关的那个网站上的 /app/。",
  // 页面看不出装没装网关；同一条命令没装时先装、装了直接启动
  "no-gateway": "还没连上网关",
  // 网关只收 Chrome / Edge 直接发起的连接（gateway/src/peer.ts）
  refused: "网关没有接受这个浏览器的连接：请直接用 Chrome 或 Edge 打开，不要经过本机代理。正在重试…",
};

// 旧网关还会报 java、sdk、cmdline-tools，查不到时直接显示 id
const ENV_NAME: Record<string, string> = {
  emulator: "模拟器程序（emulator）",
  "platform-tools": "adb (platform-tools)",
  "system-image": "系统镜像",
  avd: "模拟器设备",
};
const envName = (id: string) => ENV_NAME[id] ?? id;
// 手动安装：不用页面时在 Android Studio 里怎么装（Settings → Languages & Frameworks → Android SDK 就是 SDK Manager），以及装到哪里
const manualHint = (m: Missing, env: Env): string | null => {
  if (m.id === "emulator") return `在 Android Studio 的 SDK Manager → SDK Tools 里勾选 Android Emulator，点 Apply。装在 ${env.sdkRoot}/emulator`;
  if (m.id === "platform-tools") return `在 Android Studio 的 SDK Manager → SDK Tools 里勾选 Android SDK Platform-Tools，点 Apply。装在 ${env.sdkRoot}/platform-tools`;
  if (m.id === "system-image") {
    const pkg = m.pkg ?? "需要的系统镜像";
    return `在 Android Studio 的 SDK Manager → SDK Platforms 里勾选 Show Package Details，再勾选 ${pkg}，点 Apply。装在 ${env.sdkRoot}/${m.pkg ? m.pkg.split(";").join("/") : "system-images"}`;
  }
  if (m.id === "avd") return `在 Android Studio 的 Device Manager 里点 +（Create Virtual Device），选一个手机机型和已装的系统镜像。设备放在 ${env.avdHome}`;
  return null;
};
const PHASE: Record<InstallProgress["phase"], string> = {
  download: "下载中…",
  unpack: "解压中…",
  license: "等你同意许可证",
  install: "安装中…",
  done: "完成",
  failed: "失败",
};
const uploadText = (u: Upload) => {
  if (u.state === "waiting") return "等待中…";
  if (u.state === "uploading") return `上传 ${u.size ? Math.floor((u.received / u.size) * 100) : 100}%`;
  if (u.state === "installing") return "安装中…";
  if (u.state === "pushing") return "放进「下载」文件夹…";
  if (u.state === "done") return u.kind === "apk" ? "已安装" : "已放进「下载」文件夹";
  return failText("失败", u.error);
};
const uploadEnded = (u: Upload) => u.state === "done" || u.state === "failed";
const isActive = (p: InstallProgress) => p.phase !== "done" && p.phase !== "failed";
const sizeText = (mb: number) => (mb >= 1024 ? `约 ${(mb / 1024).toFixed(1)} GB` : `约 ${mb} MB`);

// API 级别对应的 Android 版本号（developer.android.com 的版本表）
const ANDROID: Record<number, string> = {
  23: "6.0", 24: "7.0", 25: "7.1", 26: "8.0", 27: "8.1", 28: "9", 29: "10", 30: "11",
  31: "12", 32: "12L", 33: "13", 34: "14", 35: "15", 36: "16",
};

/**
 * 交互状态（悬停、焦点、选中、按下、外观切换）的过渡，style 里展开用；用户要求减少动态效果时不过渡。
 * nsh 的样式过渡不看这个设置（docs/animation.md「Reduce motion」），所以这里自己判断。
 */
const ease = (speed: keyof typeof MOTION = "fast", property: "colors, opacity, transform" | "colors" = "colors, opacity, transform") =>
  reduceMotion() ? {} : ({ transitionProperty: property, transitionDuration: MOTION[speed], transitionTimingFunction: "ease-out" } as const);
/** 按下时轻微缩小（activeStyle 用）。 */
const pressed = () => (reduceMotion() ? {} : { transform: [{ scale: PRESS }] });
/**
 * 弹出层（菜单、提示）出现前和消失后的样子：透明、略小、往触发它的那一侧（trigger）偏一点；配合 ease() 淡入淡出。
 * 从哪个角长出来由弹层自己的 transformOrigin 定（menuPopup）。
 */
const popOut = (trigger: "above" | "below") => (reduceMotion() ? {} : { opacity: 0, transform: [{ translateY: trigger === "above" ? -SPACE.part : SPACE.part }, { scale: 0.98 }] });
/** 弹层（菜单、下拉框、提示）的投影：它们常盖在 DevTools 的 iframe 上，只靠 1 像素边线分不开。 */
const popupShadow = () => [
  { x: 0, y: 1, blur: 2, color: token("popup-shadow") },
  { x: 0, y: 8, blur: 24, spread: -4, color: token("popup-shadow") },
];
/**
 * 下一次界面变化里新出现的视图淡入、其余挪位置的滑过去；在改状态之前调用。
 * 不给 delete 阶段：nsh 网页端做完 delete 的淡出后不移除视图，透明的旧视图留在原处占位置、挡点击（2026-11-13 实测，侧栏收起后宽 264、opacity 0）。
 */
const LAYOUT_EASE = { duration: MOTION.normal, create: { type: "easeInEaseOut", property: "opacity" }, update: { type: "easeInEaseOut" } } as const;
const animateNext = () => {
  if (!reduceMotion()) LayoutAnimation.configureNext(LAYOUT_EASE);
};

// 机身边框：内边距 + 1 像素描边
const BEZEL = 11;
// 侧栏宽度；窗口窄于 SIDEBAR_AUTO_HIDE 时自动收起。960 时减去侧栏和外边距（272）还剩 688，放得下下面两个最小宽度（280 + 360）
const SIDEBAR_W = 264;
const SIDEBAR_AUTO_HIDE = 960;
// 设备区和右侧面板（H5 控制台、日志）并排时各自的最小宽度：设备区再窄机身就小得看不清，面板再窄地址栏和 DevTools 都挤不下（估的，没有实测）
const DEVICE_MIN_W = 280;
const PANEL_MIN_W = 360;
// 侧栏里行外的文字（分组标题、空列表的说明）的左右内缩：行自己有 1 像素透明边框（焦点环用），多缩 1 才和行里的内容对齐
const ROW_X = SPACE.item + 1;
// 机身缩放、转向的过渡时长和曲线（Material 的 standard easing：起步不拖、收尾减速）
const ZOOM_MS = 260;
const TURN_MS = 340;
const GLIDE_EASE = [0.4, 0, 0.2, 1] as const;
const H5_EMPTY = "没有可调试的 H5 页面。只有 debug 包或开启了 WebView 调试的 App 才能调试；先在 App 里打开一个 H5 页面。";
// 下拉框里没有标题的页面，地址大约放得下的字符数
const URL_CHARS = 28;
const pageKey = (p: Page) => `${p.socket}/${p.id}`;
const call = <T,>(name: string, args: object) => host.call(name, args) as Promise<unknown> as Promise<T>;

/** 设备在页面上叫什么：有显示名用显示名，没有用 id。 */
const avdLabel = (a: Avd) => a.displayName ?? a.name;
const isBooting = (b: Boot | undefined) => !!b && (b.progress === "spawning" || b.progress === "booting");

// ---- ui 层：每种控件只有这一份实现，尺寸和颜色都从上面的尺度和 token 来；页面只组合它们，不再给控件写样式 ----

const ICON_PATHS = {
  rotate: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  rotateLeft: '<path d="M20 9V7a2 2 0 0 0-2-2h-6"/><path d="m15 2-3 3 3 3"/><path d="M20 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/>',
  rotateRight: '<path d="M12 5H6a2 2 0 0 0-2 2v3"/><path d="m9 8 3-3-3-3"/><path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  reboot: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
  volUp: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M19 9v6"/><path d="M16 12h6"/>',
  volDown: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M16 12h6"/>',
  back: '<path d="M15 6 8 12l7 6z"/>',
  home: '<circle cx="12" cy="12" r="6"/>',
  recents: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  pencil: '<path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/><path d="m15 5 4 4"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  minus: '<path d="M5 12h14"/>',
  smartphone: '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  panelLeft: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  book: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  chevronUp: '<path d="m18 15-6-6-6 6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  logs: '<path d="M15 12h-5"/><path d="M15 8h-5"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/>',
  pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  toEnd: '<path d="M12 17V3"/><path d="m6 11 6 6 6-6"/><path d="M19 21H5"/>',
};
type IconName = keyof typeof ICON_PATHS;
const iconSrc = (name: IconName) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name]}</svg>`)}`;

/** 线条图标（24 格的 SVG，按 tint 着色）。只是装饰：意思由旁边的字或按钮的名字说，读屏跳过它。 */
function Icon(props: { name: IconName; size: number; tint: string }) {
  return <Image src={iconSrc(props.name)} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={{ pointerEvents: "none", width: props.size, height: props.size, tintColor: props.tint }} />;
}

/** 不能点的控件为什么不能点：悬停提示给这句，读屏的名字后面也带上（nsh 的 Button 不收 accessibilityHint）。 */
const whyTip = (disabled: boolean | undefined, why: string | undefined) => (disabled && why ? <Tip label={why} /> : undefined);
const withWhy = (label: string, disabled: boolean | undefined, why: string | undefined) => (disabled && why ? `${label}（${why}）` : label);
/** 菜单开着时触发器是按下的样子：nsh 的 Button 不收 expandedStyle，用 aria-expanded: 类（颜色是主题 token）。 */
const EXPANDED = "aria-expanded:bg-accent";

/** 文字按钮：默认是次要按钮；primary 是一屏一个的主操作（品牌青），danger 是破坏性操作。why：禁用时说明原因。 */
/** a11y：读屏读的名字，不给时读 label（行尾的“启动”要带上是哪台，否则一排都叫“启动”）。 */
function Btn(props: { label: string; onPress: () => void; kind?: "danger" | "primary"; disabled?: boolean; why?: string; a11y?: string }) {
  const primary = () => props.kind === "primary";
  return (
    <Button onPress={props.onPress} accessibilityLabel={withWhy(props.a11y ?? props.label, props.disabled, props.why)} disabled={props.disabled}
      tooltip={whyTip(props.disabled, props.why)}
      hoverStyle={{ backgroundColor: primary() ? token("primary-hover") : token("accent") }} focusStyle={{ borderColor: token("ring") }}
      activeStyle={pressed()} disabledStyle={{ opacity: DISABLED }}
      style={{
        height: CONTROL.md, justifyContent: "center", paddingHorizontal: SPACE.inset, borderRadius: token("radius"), borderWidth: 1,
        backgroundColor: primary() ? token("primary") : token("secondary"), borderColor: primary() ? token("primary") : token("border"), ...ease(),
      }}>
      <Text style={{ ...TYPE.body, fontWeight: WEIGHT.medium, color: props.kind === "danger" ? token("destructive") : primary() ? token("primary-foreground") : token("foreground") }}>{props.label}</Text>
    </Button>
  );
}

/** 只有图标的按钮的方块：md 用在工具栏、面板和侧栏；sm 嵌在输入框里（外框的边框加 1 的空隙，圆角退一档才同心）。 */
const iconSquare = (size: "sm" | "md" = "md") =>
  ({
    height: CONTROL[size], minWidth: CONTROL[size], alignItems: "center", justifyContent: "center",
    borderRadius: size === "sm" ? token("radius-sm") : token("radius"), borderWidth: 1, borderColor: "transparent",
  }) as const;

/**
 * 只有图标的按钮：名字给读屏和悬停提示，tip（快捷键）带在后面；禁用时悬停提示换成 why（为什么不能点）。
 * toolbar 是顶栏和导航条里的（图标深一档），ghost 是面板和侧栏里的。
 * 没有 onPress 时是菜单的触发器，按下由菜单处理；菜单开着时是按下的样子（expandedStyle）。
 */
function IconButton(props: {
  icon: IconName; label: string; onPress?: () => void; disabled?: boolean; why?: string; tip?: string; variant?: "ghost" | "toolbar"; size?: "sm" | "md";
}) {
  const tipLabel = () => (props.disabled && props.why ? `${props.label}：${props.why}` : props.tip ? `${props.label}（${props.tip}）` : props.label);
  return (
    <Button onPress={props.onPress} disabled={props.disabled} accessibilityLabel={withWhy(props.tip ? `${props.label}：${props.tip}` : props.label, props.disabled, props.why)}
      tooltip={<Tip label={tipLabel()} />} class={EXPANDED}
      hoverStyle={{ backgroundColor: token("accent") }} focusStyle={{ borderColor: token("ring") }} disabledStyle={{ opacity: DISABLED }} activeStyle={pressed()}
      style={{ ...iconSquare(props.size), ...ease() }}>
      <Icon name={props.icon} size={ICON.md} tint={props.variant === "toolbar" ? token("toolbar-foreground") : token("muted-foreground")} />
    </Button>
  );
}

/** 悬停提示：在控件下方，从靠控件的上边长出来。 */
function Tip(props: { label: string }) {
  return (
    <Tooltip placement="bottom" style={{ ...ease(), transformOrigin: "top" }} startingStyle={popOut("above")} endingStyle={popOut("above")}>
      <View style={{ paddingVertical: SPACE.part, paddingHorizontal: SPACE.item, borderRadius: token("radius-sm"), borderWidth: 1, borderColor: token("border"), backgroundColor: token("popover"), boxShadow: popupShadow() }}>
        <Text style={{ ...TYPE.caption, color: token("foreground") }}>{props.label}</Text>
      </View>
    </Tooltip>
  );
}

/** 工具组的底板（顶栏的各组、系统导航条）：md 的按钮加上下各 1 内边距和 1 边框正好是 CONTROL.group 高；radius-lg 和里面按钮的 radius 同心。 */
const groupStyle = () =>
  ({
    flexDirection: "row", alignItems: "center", gap: SPACE.hair, padding: (CONTROL.group - CONTROL.md) / 2 - 1,
    borderRadius: token("radius-lg"), borderWidth: 1, borderColor: token("border-subtle"), backgroundColor: token("card"),
  }) as const;

/** 工具栏里的一组按钮，共用一块底板。 */
function ToolGroup(props: { label: string; children: JSX.Element }) {
  return <ToolbarGroup accessibilityLabel={props.label} style={{ ...groupStyle(), ...ease("normal") }}>{props.children}</ToolbarGroup>;
}

/** 右侧面板（H5 控制台、日志）顶上的工具栏和提示条：左右都内缩 SPACE.inset，起始边对齐。 */
const panelBar = () =>
  ({ flexDirection: "row", alignItems: "center", gap: SPACE.item, paddingVertical: SPACE.item, paddingHorizontal: SPACE.inset, borderBottomWidth: 1, borderColor: token("border-subtle") }) as const;

/** 开关按钮（工具栏的 H5 调试、日志，日志面板的暂停、跟随最新）：开着时是品牌色；名字固定，开没开由 pressed 告诉读屏。 */
function ToolToggle(props: { icon: IconName; label: string; tip: string; on: boolean; onChange: () => void; variant?: "ghost" | "toolbar" }) {
  return (
    <Toggle pressed={props.on} onChange={props.onChange} accessibilityLabel={props.label} tooltip={<Tip label={props.tip} />}
      hoverStyle={{ backgroundColor: token("accent") }} focusStyle={{ borderColor: token("ring") }} pressedStyle={{ backgroundColor: token("primary-soft") }} activeStyle={pressed()}
      style={{ ...iconSquare(), ...ease() }}>
      <Icon name={props.icon} size={ICON.md} tint={props.on ? token("primary-text") : props.variant === "ghost" ? token("muted-foreground") : token("toolbar-foreground")} />
    </Toggle>
  );
}

/**
 * 菜单里的一项：可带图标；trail 是右侧的短标记（比如 ↗ 表示打开新页面）；danger 是删除这类破坏性操作。
 * 行的文字从弹层边上 1 + 4 + 8 = 13 开始，和下拉框触发器里的字（1 + 12）对齐。
 */
function Item(props: { label: string; onSelect: () => void; disabled?: boolean; danger?: boolean; icon?: IconName; trail?: string }) {
  return (
    <MenuItem onSelect={props.onSelect} disabled={props.disabled}
      hoverStyle={{ backgroundColor: token("accent") }} focusStyle={{ backgroundColor: token("accent") }} disabledStyle={{ opacity: DISABLED }}
      style={{ flexDirection: "row", alignItems: "center", gap: SPACE.item, height: CONTROL.sm, paddingHorizontal: SPACE.item, borderRadius: token("radius-sm"), ...ease() }}>
      <If when={props.icon}>{(i) => <Icon name={i()} size={ICON.md} tint={token("muted-foreground")} />}</If>
      <Text style={{ ...TYPE.body, flex: 1, color: props.danger ? token("destructive") : token("foreground") }}>{props.label}</Text>
      <If when={props.trail}>{(t) => <Text style={{ ...TYPE.caption, color: token("muted-foreground") }}>{t()}</Text>}</If>
    </MenuItem>
  );
}

/** 菜单里的分隔线，左右和菜单项的文字对齐。 */
function MenuLine() {
  return <MenuSeparator style={{ height: 1, marginVertical: SPACE.part, marginHorizontal: SPACE.item, backgroundColor: token("border") }} />;
}

/** 菜单的弹层；origin 是离触发它的地方最近的角，弹出时从那里长出来。 */
const menuPopup = (origin: string) => ({
  minWidth: 168, padding: SPACE.part, borderRadius: token("radius-lg"), borderWidth: 1, borderColor: token("border"), backgroundColor: token("popover"),
  boxShadow: popupShadow(), transformOrigin: origin, ...ease(),
});

/**
 * 下拉框：触发器、弹层、每一行只在这里定义。label 是触发器上的字，muted 时浅色（还没有可选的）；
 * style 定触发器的宽度和伸缩（下拉框外面那层），触发器撑满它。search 给了就带搜索框，是它的占位文字。
 */
function AppSelect(props: {
  items: Array<{ value: string; title: string }>; value: string | undefined; label: string; muted?: boolean; accessibilityLabel: string;
  onChange: (value: string) => void; disabled?: boolean; search?: string; onOpen?: () => void;
  /** 搜索没有匹配时列表里说的话。 */
  empty?: string;
  style: { width: number; flexShrink?: number; minWidth?: number };
}) {
  // 触发器上字的宽度：放不下时按它中间省略；标题、地址、包名里常有放不下的一长段，用 noBreak 按字截断兜底（见 ui/ellipsis.ts）
  const labelWidth = signal(0);
  return (
    <Select items={props.items} value={props.value} accessibilityLabel={props.accessibilityLabel} disabled={props.disabled} style={props.style}
      popupStyle={{ backgroundColor: token("popover"), borderRadius: token("radius-lg"), borderWidth: 1, borderColor: token("border"), padding: SPACE.part, minWidth: 220, maxHeight: 360, boxShadow: popupShadow() }}
      itemClass={SELECT_ITEM}
      renderItem={(item) => (
        <View style={{ height: CONTROL.sm, justifyContent: "center", paddingHorizontal: SPACE.item }}>
          <Text class={SELECT_ITEM_TEXT} style={{ ...TYPE.body, numberOfLines: 1 }}>{noBreak(item.title)}</Text>
        </View>
      )}
      searchable={props.search !== undefined} searchPlaceholder={props.search} searchAccessibilityLabel={props.search}
      empty={props.empty ? <Text style={{ ...TYPE.caption, padding: SPACE.item, color: token("muted-foreground") }}>{props.empty}</Text> : undefined}
      searchStyle={{
        height: CONTROL.sm, marginBottom: SPACE.part, paddingHorizontal: SPACE.item, borderRadius: token("radius-sm"), borderWidth: 1, borderColor: token("input"),
        backgroundColor: token("field"), color: token("foreground"), fontSize: TYPE.body.fontSize, ...inputColors(),
      }}
      onOpenChange={({ open }) => { if (open) props.onOpen?.(); }}
      onChange={({ value }) => { if (value !== null) props.onChange(value); }}
      trigger={
        <View style={{ height: CONTROL.md, flexDirection: "row", alignItems: "center", gap: SPACE.part, paddingLeft: SPACE.inset, paddingRight: SPACE.item, borderRadius: token("radius"), borderWidth: 1, borderColor: token("input"), backgroundColor: token("field") }}
          hoverStyle={{ borderColor: token("border-strong") }} focusStyle={{ borderColor: token("ring") }} expandedStyle={{ borderColor: token("ring") }}>
          <Text onLayout={({ bounds }) => labelWidth.set(bounds.size.width)}
            style={{ ...TYPE.body, flex: 1, color: props.muted ? token("muted-foreground") : token("foreground"), numberOfLines: 1 }}>
            {noBreak(fitMiddle(props.label, labelWidth(), TYPE.body.fontSize))}
          </Text>
          <Icon name="chevron" size={ICON.sm} tint={token("muted-foreground")} />
        </View>
      } />
  );
}

/**
 * 输入框的外框：图标、输入框、嵌在框里的按钮只在这里排。icon 在左边；trailing 是框里右边的紧凑按钮（IconButton size="sm"）；
 * focused、error 换边框颜色；label 给了就是读屏的一组。里面的 Input 用 fieldText() 的样式。
 */
function FieldBox(props: {
  icon?: IconName; trailing?: JSX.Element; focused?: boolean; error?: boolean; label?: string; children: JSX.Element;
  style?: { flex?: number; minWidth?: number; opacity?: number };
}) {
  return (
    <View role={props.label ? "group" : undefined} accessibilityLabel={props.label}
      style={{
        height: CONTROL.md, flexDirection: "row", alignItems: "center", gap: SPACE.part,
        paddingLeft: props.icon ? SPACE.item : SPACE.inset, paddingRight: props.trailing ? (CONTROL.md - 2 - CONTROL.sm) / 2 : SPACE.inset,
        borderRadius: token("radius"), borderWidth: 1, backgroundColor: token("field"),
        borderColor: props.error ? token("destructive") : props.focused ? token("ring") : token("input"), ...props.style,
      }}
      focusWithinStyle={props.error ? undefined : { borderColor: token("ring") }}>
      <If when={props.icon}>{(i) => <Icon name={i()} size={ICON.sm} tint={token("muted-foreground")} />}</If>
      {props.children}
      {props.trailing}
    </View>
  );
}
/** FieldBox 里 Input 的样式：撑满框里剩下的地方；mono 用等宽字（地址、设备 id）。 */
const fieldText = (mono?: boolean) => ({
  flex: 1, minWidth: 0, alignSelf: "stretch", borderWidth: 0, backgroundColor: "transparent", color: token("foreground"),
  fontSize: TYPE.body.fontSize, fontFamily: mono ? "monospace" : undefined, ...inputColors(),
}) as const;

/** 对话框的宽度：sm 确认和单个输入，lg 要从列表里选、要读长文的。 */
const DIALOG_W = { sm: 440, lg: 720 } as const;

/**
 * 右侧两块面板（H5 调试、日志）都开着时，没选中的那块留在页面里（DevTools 的 iframe 挪动会重新加载），这样藏起来。
 * 只写 display: none 不够：nsh 0.4.0 把 display: none 子树里的视图都排成 0×0，却不更新输入框的内容框
 * （nsh-core 的 emit_frames_in 在 hidden 分支不发 InputContent），原生 <input> 按原来的大小画在面板左上角，
 * 盖住标签条、吞掉点击（2026-11-17 用最小的 nsh 应用在 Chrome 里复现）。overflow hidden 把它裁掉，pointerEvents 让点击穿过去。
 */
const panelShown = (shown: boolean) => (shown ? ({ display: "flex" }) as const : ({ display: "none", overflow: "hidden", pointerEvents: "none" }) as const);
/** 对话框离窗口顶边：窗口高的 10%（1440×900 下 90，和原来大对话框的 86 差不多），窗口很矮时至少留 SPACE.group。 */
const dialogTop = () => Math.max(SPACE.group, Math.round(windowSize().height * 0.1));

/**
 * 对话框的外壳：宽度、边距、外观只在这里定义；高度不超过窗口，正文在 DialogContent 里滚动，按钮一直看得见。
 * 没有 onClose 的（许可证）Esc 和点背景都关不掉。
 */
function AppDialog(props: { open: boolean; size: keyof typeof DIALOG_W; onClose?: () => void; children: JSX.Element }) {
  return (
    <Dialog open={props.open} animation={reduceMotion() ? "none" : "fade"} closeOnEscape={!!props.onClose} closeOnBackdropPress={!!props.onClose}
      onOpenChange={({ open }) => { if (!open) props.onClose?.(); }}
      backdropStyle={{ backgroundColor: token("scrim") }}
      style={{
        marginHorizontal: "auto", marginTop: dialogTop(), width: DIALOG_W[props.size],
        maxWidth: windowSize().width - 2 * SPACE.group, maxHeight: windowSize().height - dialogTop() - SPACE.group,
        padding: SPACE.group, backgroundColor: token("card"), borderRadius: token("radius-lg"), borderWidth: 1, borderColor: token("border"),
      }}>
      {props.children}
    </Dialog>
  );
}

/**
 * 对话框里的内容：标题和说明一组、正文、按钮行，三段之间隔 SPACE.group。正文放不下时滚动；
 * scroll 为 false 时正文不套滚动，由里面会缩的那块自己滚（许可证全文：flexShrink 1、minHeight 0）。
 */
function DialogContent(props: { title: string; description?: string; scroll?: boolean; footer: JSX.Element; children: JSX.Element }) {
  const body = { flexShrink: 1, minHeight: 0, gap: SPACE.item } as const;
  // 滚动区本身跟着对话框缩；里面的内容不缩，超出的部分才滚得出来
  // 读屏听不到 dialog 角色：nsh 0.4.0 的 Dialog 不收 role 和名字（网页端只给外层写 aria-modal），AccessibilityRole
  // （nsh-core props.rs）也没有 dialog、alertdialog，写了也不会进 DOM（2026-11-18 实测）。这里只能把内容标成以标题命名的一组
  return (
    <View role="group" accessibilityLabel={props.title} accessibilityHint={props.description}
      style={{ flexShrink: 1, minHeight: 0, gap: SPACE.group }}>
      <View style={{ gap: SPACE.part }}>
        <Text role="header" style={{ ...TYPE.title, color: token("foreground") }}>{props.title}</Text>
        <If when={props.description}>{(d) => <Text style={{ ...TYPE.caption, color: token("muted-foreground") }}>{d()}</Text>}</If>
      </View>
      {props.scroll === false
        ? <View style={body}>{props.children}</View>
        : <Scroll style={{ flexShrink: 1, minHeight: 0 }} contentStyle={{ gap: SPACE.item }}>{props.children}</Scroll>}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: SPACE.item }}>{props.footer}</View>
    </View>
  );
}

// ---- ui 层结束 ----

// 实时播报（ARIA 的 status）在 nsh 的 AccessibilityRole 里叫 "summary"：nsh 网页端把它写成 role="status"（nsh.js 的 ARIA_ROLES）

/** 重启命令的名字（菜单项、adb 卡住时的按钮、确认框标题都用它）。 */
const rebootLabel = (phone: boolean) => (phone ? "重启手机" : "重启模拟器");

/** adb 没有响应时的说明和就地的重启按钮（按钮先弹确认框）；手机上说手机。 */
function AdbStuck(props: { onReboot: () => void; phone?: boolean }) {
  return (
    <View role="alert" style={{ gap: SPACE.item }}>
      <Text style={{ color: token("destructive"), ...TYPE.caption }}>{props.phone ? "手机里的 adb 没有响应：可以重新插拔手机，或点「重启手机」。" : ADB_UNRESPONSIVE}</Text>
      <View style={{ flexDirection: "row" }}>
        <Btn label={`${rebootLabel(!!props.phone)}…`} onPress={props.onReboot} />
      </View>
    </View>
  );
}

/** 一行结果或报错；adb 无响应时换成带重启按钮的说明。 */
function MsgLine(props: { msg: Msg; onReboot: () => void; phone?: boolean }) {
  return (
    <If when={!props.msg.adbStuck} else={<AdbStuck onReboot={props.onReboot} phone={props.phone} />}>
      <Text role={props.msg.error ? "alert" : "text"} style={{ color: props.msg.error ? token("destructive") : token("success"), ...TYPE.caption }}>{props.msg.text}</Text>
    </If>
  );
}

/**
 * 下拉框的一行：focus: 是方向键或指针所在的那行（高亮），selected: 是当前选中的那项（加粗；选中用中性色，见颜色的说明）。
 * renderItem 拿不到行的状态，字的颜色靠行上的 group 和 group-selected:；所以字的颜色写在 class 里，不能写在 style 里（style 比 class 优先）。
 */
const SELECT_ITEM = "group rounded-(--radius-sm) focus:bg-accent";
const SELECT_ITEM_TEXT = "text-foreground group-selected:font-semibold";

const LOG_LEVELS: Array<{ value: LogLevel; title: string }> = [
  { value: "V", title: "全部级别" },
  { value: "D", title: "调试及以上" },
  { value: "I", title: "信息及以上" },
  { value: "W", title: "警告及以上" },
  { value: "E", title: "错误及以上" },
  { value: "F", title: "只看严重" },
];
const ALL_APPS = "\u0000all";
/** 日志级别的颜色角色（ui/log-store.ts 的 levelColor）对应的主题 token。 */
const LEVEL_TOKEN = { muted: "muted-foreground", text: "foreground", warn: "warning", danger: "destructive" } as const;
/** 日志一行的高度：固定行高、一行显示不下就截断。换行的话虚拟列表按估计高度摆放，测出实际高度前行会叠在一起（2026-11-16 实测）。 */
const LOG_ROW_H = TYPE.code.lineHeight;

/** 一行日志：时间、pid、级别、tag、内容；前几列补成固定字数（ui/log-columns.ts），内容在每行都从同一处开始；级别和 tag 按级别上色。 */
function LogRowView(props: { row: () => LogRow }) {
  return (
    <If when={!("skipped" in props.row())} else={
      <Text style={{ ...TYPE.code, height: LOG_ROW_H, paddingHorizontal: SPACE.inset, color: token("muted-foreground"), fontStyle: "italic", numberOfLines: 1 }}>{`省略了 ${(props.row() as { skipped: number }).skipped} 行（页面跟不上）`}</Text>
    }>
      {(() => {
        const l = () => props.row() as LogLine;
        const cells = () => logCells(l());
        const color = () => token(LEVEL_TOKEN[levelColor(l().level)]);
        const cell = { ...TYPE.code, fontFamily: "monospace", numberOfLines: 1 } as const;
        return (
          <View style={{ height: LOG_ROW_H, flexDirection: "row", gap: SPACE.item, paddingHorizontal: SPACE.inset }}>
            <Text style={{ ...cell, flexShrink: 0, color: token("muted-foreground") }}>{cells().head}</Text>
            <Text style={{ ...cell, flexShrink: 0, color: color(), fontWeight: WEIGHT.strong }}>{cells().tag}</Text>
            <Text style={{ ...cell, flex: 1, minWidth: 0, color: l().level === "E" || l().level === "F" ? token("destructive") : token("foreground") }}>{l().msg}</Text>
          </View>
        );
      })()}
    </If>
  );
}

/** 日志面板：网关按过滤条件推 logcat（gateway/src/logcat.ts）；暂停、清空、跟随都在页面做（plans/2026-11-16-real-device-pr5-logcat.md 取舍 5）。
 * open：打开或重新打开订阅（换设备、网关重连时由 App 调）；sink 收网关推来的批次。 */
function LogPanel(props: { device: () => string; live: () => boolean; onClose: () => void; sink: (fn: ((b: { lines: LogLine[]; reset: boolean; dropped: number }) => void) | null) => void }) {
  const rows = signal<LogRow[]>([]);
  const held = signal<LogRow[]>([]);
  const paused = signal(false);
  const follow = signal(true);
  const pkg = signal<string | null>(null);
  const level = signal<LogLevel>("V");
  const text = signal("");
  const apps = signal<{ foreground: string | null; apps: string[] }>({ foreground: null, apps: [] });
  // 订阅或改过滤条件没有发出去（没连着网关）时的说明
  const sendError = signal<string | null>(null);
  let list: ListRef | undefined;
  const filter = (): LogFilter => ({ pkg: pkg(), level: level(), text: text() });
  const filtered = () => pkg() !== null || level() !== "V" || text().trim() !== "";
  const sent = (r: unknown) => sendError.set((r as { ok?: boolean } | null)?.ok === false ? "没有连上网关，日志没有更新。网关重新连上后会自动再打开。" : null);

  props.sink((b) => {
    if (paused()) held.set(applyBatch(b.reset ? [] : held(), b));
    else rows.set(applyBatch(rows(), b));
    if (b.reset && paused()) rows.set([]);
  });
  // 面板关掉后，还没回来的 logcatApps 不能再去订阅，否则网关里的 logcat 没人看也一直跑
  let disposed = false;
  cleanup(() => {
    disposed = true;
    props.sink(null);
    void host.call("emu.logcatClose", {});
  });

  const loadApps = () => call<{ foreground: string | null; apps: string[] }>("emu.logcatApps", {}).then((a) => apps.set(a), () => {});
  // 换设备或重新连上时：先查前台 App 当默认，再按条件订阅
  effect(() => {
    const d = props.device();
    if (!d || !props.live()) return;
    void loadApps().then(() => {
      if (disposed || props.device() !== d) return;
      pkg.set(apps().foreground);
      void host.call("emu.logcatOpen", { filter: filter() }).then(sent);
    });
  });
  const refilter = () => void host.call("emu.logcatFilter", { filter: filter() }).then(sent);
  const clearFilter = () => {
    pkg.set(null);
    level.set("V");
    text.set("");
    clearTimeout(textTimer);
    refilter();
  };
  let textTimer: ReturnType<typeof setTimeout> | undefined;
  cleanup(() => clearTimeout(textTimer));

  effect(() => {
    rows();
    if (follow()) list?.scrollToEnd({ animated: false });
  });

  const appItems = () => [
    { value: ALL_APPS, title: "全部 App" },
    ...[...new Set([...(apps().foreground ? [apps().foreground!] : []), ...apps().apps])].map((a) => ({ value: a, title: a === apps().foreground ? `${a}（前台）` : a })),
  ];
  return (
    <View role="region" accessibilityLabel="日志" style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
      {/* 过滤条件放不下时在左边折行，右边的按钮一直在第一行 */}
      <View role="toolbar" style={{ ...panelBar(), alignItems: "flex-start" }}>
        <View style={{ flex: 1, minWidth: 0, flexDirection: "row", flexWrap: "wrap", gap: SPACE.item }}>
          <AppSelect items={appItems()} value={pkg() ?? ALL_APPS} label={pkg() ?? "全部 App"} accessibilityLabel="按 App 过滤" search="搜包名" empty="没有匹配的 App"
            style={{ width: 190, flexShrink: 1, minWidth: 120 }} onOpen={() => void loadApps()}
            onChange={(value) => { pkg.set(value === ALL_APPS ? null : value); refilter(); }} />
          <AppSelect items={LOG_LEVELS} value={level()} label={LOG_LEVELS.find((l) => l.value === level())!.title} accessibilityLabel="最低级别"
            style={{ width: 120 }} onChange={(value) => { level.set(value as LogLevel); refilter(); }} />
          <FieldBox icon="search" style={{ flex: 1, minWidth: 140 }}>
            <Input value={text()} placeholder="搜 tag 或内容" accessibilityLabel="搜 tag 或内容" autoCapitalize="none" autoCorrect={false}
              onChange={({ value }) => {
                text.set(value);
                clearTimeout(textTimer);
                textTimer = setTimeout(refilter, 300);
              }}
              style={fieldText()} />
          </FieldBox>
        </View>
        <ToolToggle variant="ghost" icon="pause" label="暂停" tip={paused() ? "暂停中，再点一下继续" : "暂停"} on={paused()} onChange={() => {
          if (paused()) {
            rows.set(applyBatch(rows(), { lines: held().filter((r): r is LogLine => !("skipped" in r)), reset: false, dropped: 0 }));
            held.set([]);
          }
          paused.set(!paused());
        }} />
        <IconButton icon="trash" label="清空" onPress={() => { rows.set([]); held.set([]); }} />
        <ToolToggle variant="ghost" icon="toEnd" label="跟随最新" tip="跟随最新：新日志来了自动滚到底" on={follow()} onChange={() => {
          follow.set(!follow());
          if (follow()) list?.scrollToEnd({ animated: false });
        }} />
        <IconButton icon="close" label="关闭日志" onPress={props.onClose} />
      </View>
      <If when={sendError() || (!props.live() && rows().length > 0)}>
        <View style={panelBar()}>
          <Text role={sendError() ? "alert" : "summary"} style={{ flex: 1, color: sendError() ? token("destructive") : token("muted-foreground"), ...TYPE.caption }}>
            {sendError() ?? "设备已断开，下面是断开前的日志。"}
          </Text>
        </View>
      </If>
      <List each={rows()} keyExtractor={(r) => String(r.n)} estimatedItemSize={LOG_ROW_H} style={{ flex: 1, minHeight: 0, backgroundColor: token("background") }}
        ref={(r) => (list = r)} scrollEventThrottle={100}
        onScroll={(e) => {
          // 往上翻离开底部就不再跟随；滚回底部又自动跟随
          const atEnd = e.offset.y + e.size.height >= e.contentSize.height - 40;
          if (atEnd !== follow()) follow.set(atEnd);
        }}
        empty={
          <View style={{ padding: SPACE.inset, gap: SPACE.item, alignItems: "flex-start" }}>
            <Text style={{ color: token("muted-foreground"), ...TYPE.caption }}>{logEmptyText({ live: props.live(), paused: paused(), filtered: filtered() })}</Text>
            <If when={props.live() && !paused() && filtered()}>
              <Btn label="清除过滤" onPress={clearFilter} />
            </If>
          </View>
        }>
        {(row) => <LogRowView row={row} />}
      </List>
    </View>
  );
}

/** H5 调试：页面列表由 App 轮询后传进来（pages 为 null 表示还没读到）；refresh 让 App 立刻再读一次。
 * 只看前台页面所在的 App；还没在审查时自动审查它的前台页面，下拉框切到同一 App 的其他页面。
 * onInspect：控制台已在页面里打开。 */
function H5Console(props: {
  pages: () => Page[] | null; listError: () => Msg | null; refresh: () => void; inspected: () => Inspected | null; onReboot: () => void;
  onInspect: (key: string, title: string) => void; onClose: () => void; onCopy: (url: string) => void;
  /** DevTools 的选择元素模式开着，画面上的鼠标在 WebView 里高亮、选中。 */
  picking: () => boolean;
  /** 画面上是手机：adb 卡住时说手机。 */
  phone: () => boolean;
}) {
  const pages = props.pages;
  const listError = props.listError;
  const selected = signal<string | null>(null);
  // 地址栏里改过、还没提交的内容；null 时显示页面当前的地址（ui/address-field.ts）
  const draft = signal<AddressDraft>(null);
  const navigating = signal(false);
  const inspecting = signal(false);
  const result = signal<Msg | null>(null);
  const inspectMsg = signal<Msg | null>(null);
  effect(() => {
    const list = pages();
    if (list && selected() && !list.some((p) => pageKey(p) === selected())) selected.set(null);
  });

  const currentPkg = () => foregroundPkg(pages() ?? []);
  const appPages = () => (pages() ?? []).filter((p) => (p.pkg ?? null) === currentPkg());
  const activeKey = () => props.inspected()?.key ?? selected();
  const activePage = () => appPages().find((p) => pageKey(p) === activeKey());

  const inspect = (p: Page) => {
    inspectMsg.set(null);
    selected.set(pageKey(p));
    inspecting.set(true);
    call<InspectResult>("emu.inspect", { socket: p.socket, id: p.id }).then(
      (r: InspectResult) => {
        if ("opened" in r) props.onInspect(pageKey(p), visibleTitle(p.title) || p.url);
        else if ("cancelled" in r) return;
        else if ("hint" in r) inspectMsg.set({ text: r.hint });
        else inspectMsg.set({ text: r.error, error: true, adbStuck: r.adbStuck });
      },
      (e: Error) => inspectMsg.set({ text: e.message, error: true }),
    ).finally(() => inspecting.set(false));
  };
  // 没在审查时自动审查前台页面；同一个页面只自动试一次，失败的说明留在原处
  let autoTried: string | null = null;
  effect(() => {
    if (props.inspected() || inspecting()) return;
    const p = pickPage(appPages());
    if (!p || autoTried === pageKey(p)) return;
    autoTried = pageKey(p);
    inspect(p);
  });

  const currentUrl = () => activePage()?.url;
  // 换了审查的页面：改了一半的地址作废
  let draftKey: string | null = null;
  effect(() => {
    const k = activeKey();
    if (k !== draftKey) {
      draftKey = k;
      draft.set(null);
    }
  });
  // 回车跳转：成功后地址栏回到跟着页面走；失败时留着改的内容，好改了再试
  const navigate = () => {
    const p = activePage();
    const address = addressSubmit(draft());
    if (!p || !address || navigating()) return;
    navigating.set(true);
    result.set(null);
    call<NavigateResult>("emu.navigate", { socket: p.socket, id: p.id, address }).then(
      (r: NavigateResult) => {
        if (r.ok) draft.set(null);
        result.set(r.ok
          ? { text: `已打开 ${r.title || "页面"} · ${r.bridge ? "JSBridge 可用" : "没有 JSBridge"}` }
          : { text: r.error ?? "跳转失败", error: true, adbStuck: r.adbStuck });
      },
      (e: Error) => result.set({ text: e.message, error: true }),
    ).finally(() => {
      navigating.set(false);
      props.refresh();
    });
  };

  const addressFocused = signal(false);
  // 地址栏有焦点时 Escape 放弃修改（输入框自己不报 Escape）
  effect(() => {
    if (!addressFocused()) return;
    cleanup(keymap.bind("escape", () => draft.set(null), { when: "always" }));
  });

  // 标题只有空白（网页的 <title> 里常带换行）时也用地址
  const pageTitle = (p: Page) => `${visibleTitle(p.title) || middleEllipsis(p.url, URL_CHARS)}${p.visible ? "" : "（后台）"}`;
  const items = () => appPages().map((p) => ({ value: pageKey(p), title: pageTitle(p) }));
  // DevTools 还没打开时盖在占位区上的说明；打开被取消、失败了（原因在上面的提示条里）时给下一步
  const placeholder = () => {
    if (pages() === null) return "正在读取 H5 页面…";
    if (appPages().length === 0) return H5_EMPTY;
    return inspecting() ? "正在打开 DevTools…" : "从上面的下拉框选一个页面开始调试。";
  };

  return (
    <View role="region" accessibilityLabel="H5 调试" style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
      {/* 不折行：窄的时候下拉框和地址栏先缩，两个按钮一直在同一行 */}
      <View role="toolbar" style={panelBar()}>
        <AppSelect items={items()} value={activeKey() ?? undefined} label={activePage() ? pageTitle(activePage()!) : "没有页面"} muted={!activePage()}
          accessibilityLabel="调试页面" disabled={items().length === 0} style={{ width: 160, flexShrink: 1, minWidth: 96 }}
          onChange={(value) => {
            const p = appPages().find((x) => pageKey(x) === value);
            if (p) inspect(p);
          }} />
        {/* 当前页面的地址：改了按回车跳转（localhost 自动 adb reverse），Escape 放弃修改 */}
        <FieldBox icon="link" label="页面地址" focused={addressFocused()} style={{ flex: 1, minWidth: 96, opacity: navigating() ? 0.6 : 1 }}
          trailing={<IconButton icon="copy" label="复制地址" size="sm" disabled={!currentUrl()} why="还没有页面地址" onPress={() => props.onCopy(currentUrl()!)} />}>
          <Input value={addressShown(draft(), currentUrl())} onChange={({ value }) => draft.set(addressEdit(currentUrl(), value))} onSubmit={navigate}
            submitBehavior="submit" readonly={!activePage() || navigating()}
            onFocus={() => addressFocused.set(true)} onBlur={() => addressFocused.set(false)}
            placeholder="localhost:5173/path" accessibilityLabel="页面地址，改了按回车跳转" autoCapitalize="none" autoCorrect={false}
            style={fieldText(true)} />
        </FieldBox>
        <IconButton icon="rotate" label="重新加载 DevTools" disabled={!props.inspected()} why="还没有打开 DevTools" onPress={() => host.call("emu.devtoolsReload", {})} />
        <IconButton icon="close" label="关闭 H5 调试" onPress={props.onClose} />
      </View>
      <If when={inspectMsg() || listError() || result() || props.picking()}>
        <View style={{ ...panelBar(), flexDirection: "column", alignItems: "stretch", gap: SPACE.part }}>
          <If when={props.picking()}>
            <Text role="summary" style={{ color: token("foreground"), ...TYPE.caption }}>选择元素：在画面上移动鼠标高亮，点一下选中；点在网页以外的地方不起作用</Text>
          </If>
          <If when={inspectMsg()}>
            {(m) => (
              <If when={!m().adbStuck} else={<AdbStuck onReboot={props.onReboot} phone={props.phone()} />}>
                <Text role={m().error ? "alert" : "text"} style={{ color: m().error ? token("destructive") : token("foreground"), ...TYPE.caption }}>{m().text}</Text>
              </If>
            )}
          </If>
          <If when={listError()}>{(e) => <MsgLine msg={e()} onReboot={props.onReboot} phone={props.phone()} />}</If>
          <If when={result()}>{(r) => <MsgLine msg={r()} onReboot={props.onReboot} phone={props.phone()} />}</If>
        </View>
      </If>
      <View style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <View testID="devtools" style={{ flex: 1, minHeight: 0, position: "relative" }} />
        <If when={!props.inspected()}>
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", padding: SPACE.section, backgroundColor: token("background") }}>
            <Text style={{ maxWidth: 360, color: token("muted-foreground"), ...TYPE.body, textAlign: "center" }}>{placeholder()}</Text>
          </View>
        </If>
      </View>
    </View>
  );
}

/** 设备画面缩放：缩小、当前比例（点一下回到适应窗口）、放大。 */
function ZoomControl(props: { zoom: number; onZoom: (z: number) => void }) {
  const percent = () => `${Math.round(props.zoom * 100)}%`;
  return (
    <ToolGroup label="画面缩放">
      <IconButton icon="minus" label="缩小" variant="toolbar" disabled={props.zoom === ZOOM_STEPS[0]} why="已经是最小" onPress={() => props.onZoom(stepZoom(props.zoom, -1))} />
      {/* 46 放得下最宽的“200%”，比例变了组的宽度不跳 */}
      <Button onPress={() => props.onZoom(1)} accessibilityLabel={`缩放 ${percent()}，适应窗口`} tooltip={<Tip label="适应窗口" />}
        hoverStyle={{ backgroundColor: token("accent") }} focusStyle={{ borderColor: token("ring") }} activeStyle={pressed()} style={{ ...iconSquare(), minWidth: 46, paddingHorizontal: SPACE.part, ...ease() }}>
        <Text style={{ color: token("toolbar-foreground"), ...TYPE.caption }}>{percent()}</Text>
      </Button>
      <IconButton icon="plus" label="放大" variant="toolbar" disabled={props.zoom === ZOOM_STEPS[ZOOM_STEPS.length - 1]} why="已经是最大" onPress={() => props.onZoom(stepZoom(props.zoom, 1))} />
    </ToolGroup>
  );
}

const THEME_OPTIONS: { theme: Theme; icon: IconName; label: string }[] = [
  { theme: "system", icon: "monitor", label: "跟随系统" },
  { theme: "light", icon: "sun", label: "浅色" },
  { theme: "dark", icon: "moon", label: "深色" },
];

/**
 * 页面外观三选一（跟随系统、浅色、深色）的分段控件，放在菜单里：每格是 menuitemradio，
 * 菜单的方向键能走到、读屏念得出选中；选了不关菜单。选中的一格浮起来。
 */
function ThemePicker(props: { value: Theme; onPick: (t: Theme) => void }) {
  return (
    <View role="group" accessibilityLabel="外观" style={{ flexDirection: "row", gap: SPACE.hair, padding: SPACE.hair, borderRadius: token("radius"), backgroundColor: token("muted") }}>
      <Each of={THEME_OPTIONS} key={(o) => o.theme}>{(o) => (
        <MenuItem role="menuitemradio" checked={props.value === o().theme} closeOnSelect={false} onSelect={() => props.onPick(o().theme)}
          accessibilityLabel={`外观：${o().label}`}
          style={{ width: CONTROL.sm, height: CONTROL.sm - 2 * SPACE.hair, alignItems: "center", justifyContent: "center", borderRadius: token("radius-sm"), borderWidth: 1, borderColor: "transparent", ...ease() }}
          checkedStyle={{ backgroundColor: token("background"), borderColor: token("border") }} focusStyle={{ borderColor: token("ring") }}>
          <Icon name={o().icon} size={ICON.sm} tint={props.value === o().theme ? token("foreground") : token("muted-foreground")} />
        </MenuItem>
      )}</Each>
    </View>
  );
}

/** Droidpier 的标记：圆底上一个 D，菜单顶部和侧栏底部的按钮都用它。 */
function Mark(props: { size: number }) {
  return (
    <View style={{ width: props.size, height: props.size, borderRadius: props.size / 2, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: token("primary-soft"), backgroundColor: token("primary-soft") }}>
      <Text style={{ color: token("primary-text"), fontSize: Math.round(props.size * 0.42), fontWeight: WEIGHT.strong }}>D</Text>
    </View>
  );
}

/**
 * 菜单打开时让键盘焦点离开 DevTools 的 iframe 和画面（host 的 emu.releaseFocus）：nsh 的按钮被鼠标按下时不拿焦点，
 * 焦点留在原处，接着按的 Escape 落到 iframe 或画面里，关不掉菜单（2026-11-17 走查实测）。不把焦点放到触发器上：
 * 工具栏里的按钮除了 Tab 停的那一个都不收 focus()（nsh.js 的 focusPressable 只认 tabIndex 0），焦点就落在 body 上；
 * 焦点在 body 上时 Escape 照样关得掉菜单（2026-11-18 用最小的 nsh 应用实测）。
 */
const releaseOnOpen = (e: { open: boolean }) => {
  if (e.open) void host.call("emu.releaseFocus", {});
};

/**
 * 侧栏底部的按钮：点开向上的菜单，里面是官网、文档和外观。
 * setup：环境还缺东西、环境检查卡片被关掉了时，菜单里给一项把它重新打开（文字是项的名字）。
 */
function AppMenu(props: { site: string; theme: Theme; onTheme: (t: Theme) => void; setup: string | null; onSetup: () => void }) {
  return (
    <Menu placement="top" offset={SPACE.item} popupStyle={{ ...menuPopup("bottom left"), minWidth: 248 }} popupStartingStyle={popOut("below")} popupEndingStyle={popOut("below")}
      onOpenChange={releaseOnOpen} trigger={
      <Button accessibilityLabel="Droidpier 菜单" class={EXPANDED} hoverStyle={{ backgroundColor: token("accent") }} focusStyle={{ borderColor: token("ring") }}
        style={{ flexDirection: "row", alignItems: "center", gap: SPACE.item, paddingVertical: SPACE.part, paddingHorizontal: SPACE.item, borderRadius: token("radius"), borderWidth: 1, borderColor: "transparent", ...ease() }}>
        <Mark size={28} />
        <Text style={{ flex: 1, color: token("foreground"), ...TYPE.body, fontWeight: WEIGHT.strong }}>Droidpier</Text>
        <Icon name="chevronUp" size={ICON.sm} tint={token("muted-foreground")} />
      </Button>
    }>
      {/* 顶上这块、菜单项、外观一行的左边都从 SPACE.item 开始，和菜单项（Item）对齐 */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.item, paddingVertical: SPACE.item, paddingHorizontal: SPACE.item }}>
        <Mark size={36} />
        <View style={{ gap: SPACE.hair }}>
          <Text style={{ color: token("foreground"), ...TYPE.body, fontWeight: WEIGHT.strong }}>Droidpier</Text>
          <Text style={{ color: token("muted-foreground"), ...TYPE.caption }}>{props.site.replace(/^https?:\/\//, "")}</Text>
        </View>
      </View>
      <MenuLine />
      <Item icon="globe" label="官网" trail="↗" onSelect={() => void openUrl(`${props.site}/`)} />
      <Item icon="book" label="使用文档" trail="↗" onSelect={() => void openUrl(props.site + DOCS_PATH)} />
      <If when={props.setup}>{(label) => <Item icon="monitor" label={label()} onSelect={props.onSetup} />}</If>
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.item, paddingVertical: SPACE.part, paddingLeft: SPACE.item, paddingRight: SPACE.part }}>
        <Icon name="sun" size={ICON.md} tint={token("muted-foreground")} />
        <Text style={{ flex: 1, color: token("foreground"), ...TYPE.body }}>外观</Text>
        <ThemePicker value={props.theme} onPick={props.onTheme} />
      </View>
    </Menu>
  );
}

/** 复制命令的按钮，结果就地显示。 */
function CopyCmd(props: { cmd: string }) {
  const result = signal<"ok" | "fail" | null>(null);
  let timer: number | undefined;
  const copy = () => host.call("emu.copy", { text: props.cmd }).then(
    () => result.set("ok"),
    () => result.set("fail"),
  ).finally(() => {
    clearTimeout(timer);
    timer = setTimeout(() => result.set(null), 2500);
  });
  cleanup(() => clearTimeout(timer));
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.item, flexWrap: "wrap" }}>
      <Text style={{ flexShrink: 1, color: token("foreground"), ...TYPE.caption, fontFamily: "monospace", userSelect: "text" }}>{props.cmd}</Text>
      <Btn label="复制命令" onPress={copy} />
      <If when={result() !== null}>
        <Text style={{ color: result() === "ok" ? token("success") : token("destructive"), ...TYPE.caption }}>{result() === "ok" ? "已复制" : "复制失败，请手动选中复制"}</Text>
      </If>
    </View>
  );
}

/** 画面上方的环境检查卡片：缺什么、多大、手动命令，以及安装进度。安装只在确认框里确认后才开始。 */
function SetupCard(props: { env: Env; installs: InstallProgress[]; onInstall: (c: Confirm) => void; onCreate: () => void; onDismiss: () => void; sidebarShown: boolean }) {
  const busy = () => props.installs.some(isActive);
  // 设备要在「创建设备」对话框里选机型和系统版本，不在「全部安装」里
  const installable = () => props.env.missing.filter((m) => m.auto && m.id !== "avd");
  const total = () => installable().reduce((n, m) => n + (m.sizeMb ?? 0), 0);
  // 展开了「手动安装」的项；默认都收起
  const manualOpen = signal<string[]>([]);
  const toggleManual = (id: string) => manualOpen.set(manualOpen().includes(id) ? manualOpen().filter((x) => x !== id) : [...manualOpen(), id]);
  // 一张卡片：缺的每一项和安装进度是卡片里 muted 底色的一段，不再套边框
  const section = () => ({ gap: SPACE.part, padding: SPACE.inset, borderRadius: token("radius"), backgroundColor: token("muted") }) as const;
  return (
    <View role="region" accessibilityLabel="环境检查"
      style={{ width: 560, maxWidth: "100%", gap: SPACE.inset, backgroundColor: token("overlay"), borderRadius: token("radius-lg"), padding: SPACE.inset, borderWidth: 1, borderColor: token("warning") }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: SPACE.item }}>
        <Text role="header" style={{ color: token("foreground"), ...TYPE.title }}>环境检查</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.item }}>
          <If when={installable().length > 1}>
            <Btn label={`全部安装（${sizeText(total())}）…`} disabled={busy()} why="正在安装，装完再点" onPress={() => props.onInstall({ ids: installable().map((m) => m.id), kind: "install" })} />
          </If>
          <If when={!busy()}>
            <Btn label="关闭" onPress={props.onDismiss} />
          </If>
        </View>
      </View>
      <Text style={{ color: token("muted-foreground"), ...TYPE.caption }}>
        {props.env.missing.length > 0
          ? `还不能启动设备，缺 ${props.env.missing.length} 项。点「安装…」会先让你确认要下载什么、装到哪里。${props.sidebarShown ? "关掉后可以从左下角的 Droidpier 菜单重新打开。" : "关掉后可以展开侧栏，从左下角的 Droidpier 菜单重新打开。"}`
          : props.env.error ? "" : "环境已经齐全。"}
      </Text>
      <If when={props.env.error}>
        {(e) => <Text role="alert" style={{ color: token("destructive"), ...TYPE.body }}>{`${e()}。请重新运行网关后再打开页面。`}</Text>}
      </If>
      <Scroll style={{ maxHeight: 460 }} contentStyle={{ gap: SPACE.item }}>
        <Each of={props.env.missing} key={(m) => m.id}>
          {(m) => (
            <View style={section()}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.item }}>
                <Text style={{ flex: 1, color: token("foreground"), ...TYPE.body, fontWeight: WEIGHT.strong }}>
                  {`${envName(m().id)}${m().sizeMb ? ` · ${sizeText(m().sizeMb!)}` : ""}`}
                </Text>
                <If when={m().auto}>
                  <If when={m().id === "avd"} else={
                    <Btn label="安装…" disabled={busy()} why="正在安装，装完再点" onPress={() => props.onInstall({ ids: [m().id], kind: "install" })} />
                  }>
                    <Btn label="创建设备…" disabled={busy()} why="正在安装，装完再点" onPress={props.onCreate} />
                  </If>
                </If>
              </View>
              <Text style={{ color: token("muted-foreground"), ...TYPE.caption }}>{m().detail}</Text>
              <If when={manualHint(m(), props.env) !== null || !!m().command}>
                <Collapsible open={manualOpen().includes(m().id)} reveal content={
                  <View style={{ gap: SPACE.item, paddingTop: SPACE.part }}>
                    <If when={manualHint(m(), props.env)}>{(h) => <Text style={{ color: token("muted-foreground"), ...TYPE.caption, userSelect: "text" }}>{h()}</Text>}</If>
                    {/* 旧网关给的 sdkmanager / avdmanager 命令 */}
                    <If when={m().command}>{(cmd) => <CopyCmd cmd={cmd()} />}</If>
                  </View>
                }>
                  {/* 触发器按 nsh 文档（elements/collapsible.md）用 role="button" 的 View：Button 不收 accessibilityState，读屏要听到展开没有 */}
                  <View onPress={() => toggleManual(m().id)} role="button" accessibilityLabel="手动安装" accessibilityState={{ expanded: manualOpen().includes(m().id) }}
                    hoverStyle={{ opacity: 0.8 }} focusStyle={{ backgroundColor: token("accent") }}
                    style={{ flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: SPACE.part, borderRadius: token("radius-sm"), ...ease() }}>
                    <View style={{ transform: [{ rotate: manualOpen().includes(m().id) ? "0deg" : "-90deg" }], ...ease() }}>
                      <Icon name="chevron" size={ICON.sm} tint={token("muted-foreground")} />
                    </View>
                    <Text style={{ color: token("muted-foreground"), ...TYPE.caption }}>手动安装</Text>
                  </View>
                </Collapsible>
              </If>
            </View>
          )}
        </Each>
        <If when={props.installs.length > 0}>
          <View role="list" accessibilityLabel="安装进度" style={{ ...section(), gap: SPACE.item }}>
            <Text style={{ color: token("muted-foreground"), ...TYPE.caption, fontWeight: WEIGHT.strong }}>安装进度</Text>
            <Each of={props.installs} key={(p) => p.id}>
              {(p) => (
                <View style={{ gap: SPACE.hair }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.item }}>
                    <Text style={{ flex: 1, color: token("foreground"), ...TYPE.body }}>{envName(p().id)}</Text>
                    <Text style={{ color: p().phase === "failed" ? token("destructive") : p().phase === "done" ? token("success") : token("warning"), ...TYPE.caption }}>
                      {`${PHASE[p().phase]}${p().pct !== undefined && p().phase === "download" ? ` ${p().pct}%` : ""}`}
                    </Text>
                  </View>
                  <If when={p().logTail}>
                    {(log) => <Text style={{ color: token("muted-foreground"), ...TYPE.code, fontFamily: "monospace", userSelect: "text" }}>{log()}</Text>}
                  </If>
                </View>
              )}
            </Each>
          </View>
        </If>
      </Scroll>
    </View>
  );
}

// nsh 没有导出 ScrollRef 类型，从 Scroll 的 ref 取
type Scroller = Exclude<NonNullable<Parameters<typeof Scroll>[0]["ref"]>, (node: never) => void>;

/** 一行单选项（nsh 的 Radio：方向键在组内移动、Space 选中）：左边名字，右边说明；选中时底色变亮。 */
function Choice(props: { label: string; detail: string; detailColor?: string; checked: boolean; onPress: () => void; ref: (r: ViewRef) => void }) {
  return (
    <Radio checked={props.checked} onChange={props.onPress} accessibilityLabel={`${props.label}，${props.detail}`} ref={props.ref}
      style={{
        flexDirection: "row", alignItems: "center", gap: SPACE.item, paddingVertical: SPACE.part, paddingHorizontal: SPACE.item, borderRadius: token("radius-sm"), borderWidth: 1,
        borderColor: "transparent", backgroundColor: "transparent", ...ease(),
      }}
      checkedStyle={{ borderColor: token("border-strong"), backgroundColor: token("accent") }}
      focusStyle={{ borderColor: token("ring") }}>
      <Text style={{ flex: 1, color: token("foreground"), ...TYPE.body }}>{props.label}</Text>
      <Text style={{ color: props.detailColor ?? token("muted-foreground"), ...TYPE.caption }}>{props.detail}</Text>
    </Radio>
  );
}

/** 把选中的那项滚到列表可见处（列表刚挂上，还在顶部）；focus 为真时再把键盘焦点放上去。 */
const reveal = async (scroller: Scroller | undefined, item: ViewRef | undefined, focus: boolean) => {
  if (!item) return;
  const [m, s] = await Promise.all([item.measure(), scroller?.measure()]);
  if (m && s && scroller) scroller.scrollTo({ y: Math.max(0, m.pagePosition.y - s.pagePosition.y - 4), animated: false });
  if (focus) item.focus();
};

const ID_RULE = "只能用英文字母、数字、点、下划线和短横线，创建后不能改；列表里显示的名称以后可以用「重命名…」改。";
const imageLabel = (i: SystemImage) => `${i.version ?? "Android"}（API ${i.api}）`;

/** 创建设备对话框的内容：目录由 App 在打开时向网关要，选好后点「下一步」交给确认框。 */
function CreateAvd(props: { catalog: Catalog | null; loadError: string | null; onCancel: () => void; onNext: (a: NewAvd) => void }) {
  const catalog = () => props.catalog;
  const device = signal<string | null>(null);
  const image = signal<string | null>(null);
  // 用户改过名字后不再跟着机型和版本变
  const customName = signal<string | null>(null);

  const pickedDevice = () => {
    const c = catalog();
    const id = device() ?? c?.defaultDevice;
    return c?.devices.find((d) => d.id === id) ?? null;
  };
  const pickedImage = () => {
    const c = catalog();
    const pkg = image() ?? c?.defaultImage;
    return c?.images.find((i) => i.pkg === pkg) ?? null;
  };
  const name = () => {
    const d = pickedDevice();
    const i = pickedImage();
    return customName() ?? (d && i ? defaultAvdName(d.name, i.api, catalog()?.existing) : "");
  };
  // 目录第一次到达（每次打开对话框一次）：把默认选中的机型和版本滚进可见处，焦点放在机型上
  const deviceRefs = new Map<string, ViewRef>();
  const imageRefs = new Map<string, ViewRef>();
  let deviceScroll: Scroller | undefined;
  let imageScroll: Scroller | undefined;
  let revealed = false;
  effect(() => {
    const c = catalog();
    if (!c || revealed) return;
    revealed = true;
    setTimeout(() => {
      const d = pickedDevice();
      const i = pickedImage();
      reveal(imageScroll, i ? imageRefs.get(i.pkg) : undefined, !d);
      reveal(deviceScroll, d ? deviceRefs.get(d.id) : undefined, true);
    }, 0);
  });
  const nameError = () => avdNameError(name(), catalog()?.existing ?? []);
  const canNext = () => !!pickedDevice() && !!pickedImage() && nameError() === null;
  const next = () => {
    const d = pickedDevice();
    const i = pickedImage();
    if (d && i && canNext()) props.onNext({ name: name(), device: d, image: i });
  };

  return (
    <DialogContent title="创建设备" footer={<>
      <Btn label="取消" onPress={props.onCancel} />
      <Btn label="下一步" kind="primary" disabled={!canNext()} onPress={next} />
    </>}>
      <If when={props.loadError}>{(e) => <Text role="alert" style={{ color: token("destructive"), ...TYPE.body }}>{e()}</Text>}</If>
      <If when={catalog()} else={<Text style={{ color: token("muted-foreground"), ...TYPE.body }}>正在读取机型和系统版本…</Text>}>
        {(c) => (
          <View style={{ gap: SPACE.group }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACE.group }}>
              <View style={{ flex: 1, minWidth: 240, gap: SPACE.item }}>
                <Text style={{ color: token("muted-foreground"), ...TYPE.caption }}>{pickedDevice() ? `机型：${pickedDevice()!.name}` : "机型"}</Text>
                <Scroll ref={(r) => (deviceScroll = r)} style={{ height: 248, padding: SPACE.part, borderRadius: token("radius-lg"), borderWidth: 1, borderColor: token("border"), backgroundColor: token("background") }}>
                  <RadioGroup style={{ gap: SPACE.hair }}>
                    <Each of={c().devices} key={(d) => d.id}>
                      {(d) => (
                        <Choice label={d().name} detail={d().oem} checked={pickedDevice()?.id === d().id} onPress={() => device.set(d().id)}
                          ref={(r) => deviceRefs.set(d().id, r)} />
                      )}
                    </Each>
                  </RadioGroup>
                </Scroll>
              </View>
              <View style={{ flex: 1, minWidth: 240, gap: SPACE.item }}>
                <Text style={{ color: token("muted-foreground"), ...TYPE.caption }}>{pickedImage() ? `系统版本：${imageLabel(pickedImage()!)}` : "系统版本"}</Text>
                <If when={c().imagesError}>{(e) => <Text role="alert" style={{ color: token("warning"), ...TYPE.caption }}>{`${e()}，只列出已安装的`}</Text>}</If>
                <Scroll ref={(r) => (imageScroll = r)} style={{ height: 248, padding: SPACE.part, borderRadius: token("radius-lg"), borderWidth: 1, borderColor: token("border"), backgroundColor: token("background") }}>
                  <RadioGroup style={{ gap: SPACE.hair }}>
                    <Each of={c().images} key={(i) => i.pkg}>
                      {(i) => (
                        <Choice label={imageLabel(i())} checked={pickedImage()?.pkg === i().pkg} onPress={() => image.set(i().pkg)}
                          detail={i().installed ? (i().tag === "google_apis" ? "已安装" : `已安装 · ${i().tag}`) : `下载${sizeText(i().sizeMb ?? 0)}`}
                          detailColor={i().installed ? token("success") : token("muted-foreground")} ref={(r) => imageRefs.set(i().pkg, r)} />
                      )}
                    </Each>
                  </RadioGroup>
                </Scroll>
              </View>
            </View>
            <View style={{ gap: SPACE.item }}>
              {/* 这一栏是 AVD 的 id（文件夹名），和重命名对话框里的「显示名称」不是一回事 */}
              <Text style={{ color: token("muted-foreground"), ...TYPE.caption }}>设备 ID</Text>
              <FieldBox error={!!nameError() && name() !== ""}>
                <Input value={name()} onChange={({ value }) => customName.set(value)} onSubmit={next}
                  accessibilityLabel="设备 ID" autoCapitalize="none" autoCorrect={false} style={fieldText(true)} />
              </FieldBox>
              <Text style={{ color: token("muted-foreground"), ...TYPE.caption }}>{ID_RULE}</Text>
              <If when={pickedDevice() ? nameError() : null}>{(e) => <Text role="alert" style={{ color: token("destructive"), ...TYPE.caption }}>{e()}</Text>}</If>
            </View>
          </View>
        )}
      </If>
    </DialogContent>
  );
}

function App() {
  // 外观：先按系统，读到这台浏览器存的选择后换过去
  const theme = signal<Theme>("system");
  // 存着的选择读回来之前用户已经选过：以用户这次选的为准
  let picked = false;
  const pickTheme = (t: Theme) => {
    picked = true;
    theme.set(t);
    setColorScheme(t);
    host.call("emu.setTheme", { theme: t });
  };
  host.call("emu.theme", {}).then((t: unknown) => {
    if (picked) return;
    theme.set(parseTheme(t));
    setColorScheme(theme());
  });
  const site = signal(OFFICIAL_ORIGIN);
  host.call("emu.site", {}).then((o: unknown) => {
    if (typeof o === "string") site.set(o);
  });
  const state = signal<State>("connecting");
  const serial = signal(0);
  const fps = signal(0);
  const latency = signal(0);
  const avds = signal<Avd[] | null>(null);
  // null：网关没发过真机列表（旧网关），不显示「真机」分组
  const phones = signal<PhoneInfo[] | null>(null);
  // MuMu 自己的设备列表（网关用 mumutool 读的）；没装 MuMu 或旧网关时一直是 null
  const mumu = signal<MumuInfo[] | null>(null);
  // 等用户确认关机的那台 MuMu
  const mumuCloseAsk = signal<MumuInfo | null>(null);
  // 刚点了“启动”、列表还没变成启动中的那台：按钮先显示启动中并禁用，免得连点（网关每 5 秒读一次列表）
  const mumuStarting = signal<number | null>(null);
  // 当前设备的身份和能力（ready 带来）：真机的 serial 是 0，按 deviceId 认设备；deviceSize 是 ready.device，真机不在 AVD 列表里，设备框比例靠它
  const deviceId = signal("");
  const kind = signal<"emulator" | "phone">("emulator");
  const caps = signal<DeviceCaps | null>(null);
  // 连上后画出过第一帧没有（host 的 painted）
  const painted = signal(true);
  const deviceSize = signal({ width: 0, height: 0 });
  const boots = signal<Record<string, Boot>>({});
  // 画面上方的通知（ui/banners.ts 的 Notices）：错误留着等用户关，一般消息显示出来后几秒收起
  const notices = signal<Notices>(NO_NOTICES);
  const notice = () => currentNotice(notices());
  const upgrade = signal<string | null>(null);
  const gatewayNote = signal<GatewayBanner | null>(null);
  // 用户关掉的那条网关提示（按文字记）：同一条不再出现，换了内容再出现
  const gatewayDismissed = signal<string | null>(null);
  let gatewayRev = -1;
  host.on("emu.gateway", (p: { banner: GatewayBanner | null; rev: number }) => {
    if (isStaleStatus(p.rev, gatewayRev)) return;
    gatewayRev = p.rev;
    gatewayNote.set(p.banner);
  });
  // 协议版本不对时上面已经有拦着的提示和命令
  const gatewayShown = () => {
    const b = gatewayNote();
    return b && b.text !== gatewayDismissed() && state() !== "gateway-outdated" && state() !== "page-outdated" ? b : null;
  };
  const h5Open = signal(false);
  // 日志面板（网关级别 ≥ 3 才有）；和 H5 控制台都开着时右侧用标签页切换，隐藏的那个留在页面里（DevTools 的 iframe 挪动会重新加载）
  const logOpen = signal(false);
  const logcatOk = signal(false);
  const sideTab = signal<"h5" | "log">("h5");
  let logSink: ((b: { lines: LogLine[]; reset: boolean; dropped: number }) => void) | null = null;
  host.on("emu.logcat", (b: { lines: LogLine[]; reset: boolean; dropped: number }) => logSink?.(b));
  const toggleLog = () => {
    logOpen.set(!logOpen());
    if (logOpen()) sideTab.set("log");
  };
  const rotation = signal(0);
  const env = signal<Env | null>(null);
  const installs = signal<InstallProgress[]>([]);
  const license = signal<Licence | null>(null);
  // 已经回答过的许可证 id：网关发来下一份之前，两个按钮都不可点
  const answered = signal<number | null>(null);
  const answer = (fn: "emu.acceptLicenses" | "emu.rejectLicenses") => {
    const l = license();
    if (!l || answered() === l.id) return;
    answered.set(l.id);
    gw(host.call(fn, { id: l.id }));
  };
  const confirm = signal<Confirm | null>(null);
  // 创建设备对话框和它的目录；目录每次打开对话框、环境变了时重新要
  const createOpen = signal(false);
  const catalog = signal<Catalog | null>(null);
  const catalogError = signal<string | null>(null);
  let catalogRev = -1;
  const applyCatalog = (c: Catalog | null, rev: number) => {
    if (!c || isStaleStatus(rev, catalogRev)) return;
    catalogRev = rev;
    catalog.set(c);
  };
  host.on("emu.catalog", (p: { catalog: Catalog; rev: number }) => applyCatalog(p.catalog, p.rev));
  const loadCatalog = () => (host.call("emu.catalog", {}) as Promise<{ ok: boolean; catalog: Catalog | null; rev: number }>).then((r) => {
    catalogError.set(r.ok ? null : "没有连上网关，读不到机型和系统版本。网关重新连上后会自动再读。");
    applyCatalog(r.catalog, r.rev);
  });
  const openCreate = () => createOpen.set(true);
  // 每次打开对话框要一次；开着时环境变了（比如刚装好命令行工具）再要一次
  effect(() => {
    env();
    if (createOpen()) loadCatalog();
  });
  const setupDismissed = signal(false);
  // 用户点了「安装模拟器」：卡片本来不该自己弹出（ui/setup-card.ts 的 setupNeeded）时也显示
  const setupWanted = signal(false);
  let setupRev = -1;
  const applySetup = (p: Setup) => {
    if (isStaleStatus(p.rev, setupRev)) return;
    setupRev = p.rev;
    env.set(p.env);
    installs.set(p.installs);
    license.set(p.license);
  };
  host.on("emu.setup", applySetup);
  // 拖进来的文件：状态在 host，这里只显示
  const uploads = signal<Upload[]>([]);
  let uploadsRev = -1;
  const applyUploads = (list: Upload[] | undefined, rev: number) => {
    if (!list || isStaleStatus(rev, uploadsRev)) return;
    uploadsRev = rev;
    uploads.set(list);
  };
  host.on("emu.uploads", (p: { list: Upload[]; rev: number }) => applyUploads(p.list, p.rev));
  const drag = signal<{ active: boolean; blocked: string | null }>({ active: false, blocked: null });
  host.on("emu.drag", (p: { active: boolean; blocked: string | null }) => drag.set(p));
  const inspected = signal<Inspected | null>(null);
  const picking = signal(false);
  host.on("emu.inspectMode", (p: { on: boolean }) => picking.set(p.on));
  const pageHidden = signal(false);
  host.on("emu.visibility", (p: { hidden: boolean }) => pageHidden.set(p.hidden));
  const closeDevtools = () => {
    inspected.set(null);
    host.call("emu.devtoolsClose", {});
  };
  // 被审查的页面没了（返回退出 H5、App 退出、设备换了或重启）：和点关闭按钮一样收起控制台，再提示一句
  const closeIfGone = (ev: ConsoleEvent) => {
    if (!shouldCloseConsole(inspected(), ev)) return;
    closeDevtools();
    h5Open.set(false);
    showNotice({ text: "H5 页面已关闭，H5 调试已收起" });
  };
  // 重启：确认框；adb 无响应的提示条（输入或读 H5 列表时发现的）
  const rebootAsk = signal(false);
  const adbStuck = signal(false);
  host.on("emu.adbStuck", () => adbStuck.set(true));
  const reboot = () => {
    rebootAsk.set(false);
    adbStuck.set(false);
    act(host.call("emu.reboot", {}));
  };
  const showNotice = (n: Notice) => notices.set(addNotice(notices(), n));

  // H5 页面列表：连着设备时一直轮询（3 秒一次，连续成功后放宽到 5 秒；标签页隐藏时跳过，回到前台立即刷一次），左侧 H5 键和控制台都用它
  const pages = signal<Page[] | null>(null);
  const listError = signal<Msg | null>(null);
  const listAdbStuck = signal(false);
  const device = () => (state() === "connected" ? deviceId() : "");
  let listDevice = "";
  let loading = false;
  let okStreak = 0;
  const refresh = () => {
    const dev = device();
    if (loading || !dev) return;
    loading = true;
    const failed = (msg: Msg) => {
      okStreak = 0;
      listError.set(msg);
      // 刚发现 adb 卡住时在画面上提示一次（和输入时发现的同一条提示），点了忽略之后一直卡着也不再弹；
      // 别的失败不算恢复，不清这个标记，免得卡住—别的错—又卡住时提示条再弹一次。读成功才清
      if (msg.adbStuck && !listAdbStuck()) adbStuck.set(true);
      if (msg.adbStuck) listAdbStuck.set(true);
      closeIfGone({ kind: "list-failed" });
    };
    call<WebViewsResult>("emu.webviews", {}).then(
      (r: WebViewsResult) => {
        // 读的过程中设备换了：这份列表是旧设备的
        if (dev !== device()) return;
        if (r.error) return failed(r.adbStuck ? { text: r.error, error: true, adbStuck: true } : { text: `读取 H5 列表失败：${r.error}`, error: true });
        okStreak++;
        // 先收起已经没了的页面的控制台，再换列表：新列表里的前台页面才能把控制台自动打开（转屏后 Activity 重建、页面 id 换了时就是这样）
        closeIfGone({ kind: "list", keys: r.list.map(pageKey) });
        pages.set(r.list);
        listError.set(null);
        // adb 又能用了（自动重连好了，或者自己恢复了）：提示条跟着收起
        if (listAdbStuck()) adbStuck.set(false);
        listAdbStuck.set(false);
      },
      (e: Error) => {
        if (dev === device()) failed({ text: `读取 H5 列表失败：${e.message}`, error: true });
      },
    ).finally(() => (loading = false));
  };
  // 设备换了、断开了：旧列表作废；回到前台、连上设备（比如重启结束）时立刻刷一次
  effect(() => {
    const dev = device();
    if (dev !== listDevice) {
      listDevice = dev;
      okStreak = 0;
      pages.set(null);
      listError.set(null);
      // 提示条说的是旧设备：换了设备就收起
      adbStuck.set(false);
      listAdbStuck.set(false);
    }
    if (!pageHidden() && dev) refresh();
  });
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  const tick = () => {
    pollTimer = setTimeout(() => {
      if (!pageHidden()) refresh();
      tick();
    }, h5PollMs(okStreak, inspected() !== null));
  };
  tick();
  cleanup(() => clearTimeout(pollTimer));
  const h5Key = () => h5KeyShown({ connected: device() !== "", adbStuck: listAdbStuck(), consoleOpen: h5Open(), list: pages() });
  // 选中了别的设备、主区不再显示画面上这台：控制台跟着收起
  effect(() => {
    if (h5Open() && !shownIsLive()) {
      closeDevtools();
      h5Open.set(false);
    }
  });
  // 设备断开时控制台没有东西可看，和点关闭一样收起
  effect(() => {
    if (h5Open() && !device()) {
      closeDevtools();
      h5Open.set(false);
      showNotice({ text: "设备已断开，H5 调试已收起" });
    }
  });

  let statusRev = -1;
  type DeviceStatus = { deviceId?: string; kind?: "emulator" | "phone"; caps?: DeviceCaps | null; device?: { width: number; height: number }; logcat?: boolean; painted?: boolean };
  const applyDevice = (p: DeviceStatus) => {
    deviceId.set(p.deviceId ?? "");
    kind.set(p.kind ?? "emulator");
    caps.set(p.caps ?? null);
    if (p.device) deviceSize.set(p.device);
    logcatOk.set(p.logcat === true);
    // 旧宿主模块不报，当作已有画面
    painted.set(p.painted !== false);
  };
  host.on("emu.status", (p: { state: State; serial: number; upgrade: string | null; rev: number } & DeviceStatus) => {
    if (isStaleStatus(p.rev, statusRev)) return;
    statusRev = p.rev;
    closeIfGone({ kind: "status", state: p.state, device: p.deviceId ?? "" });
    state.set(p.state);
    serial.set(p.serial ?? 0);
    applyDevice(p);
    upgrade.set(p.upgrade);
  });
  host.on("emu.stats", (p: { fps: number; latencyMs: number }) => {
    fps.set(p.fps);
    latency.set(p.latencyMs);
  });
  host.on("emu.avds", (p: { list: Avd[] }) => avds.set(p.list));
  host.on("emu.phones", (p: { list: PhoneInfo[] | null }) => phones.set(p.list));
  host.on("emu.mumu", (p: { list: MumuInfo[] | null }) => mumu.set(p.list));
  host.on("emu.boot", (b: Boot) => {
    boots.set({ ...boots(), [b.name]: b });
    pendingEvent({ kind: "boot", name: b.name });
    if (b.progress === "failed") {
      const a = (avds() ?? []).find((x) => x.name === b.name);
      showNotice({ text: `${a ? avdLabel(a) : b.name} 启动失败${b.error ? `：${b.error}` : ""}`, error: true, sticky: true });
    }
  });
  host.on("emu.notice", (n: Notice & { gateway?: boolean }) => {
    if (n.gateway) pendingEvent({ kind: "gateway-error" });
    showNotice({ text: n.text, error: n.error, sticky: n.sticky });
  });
  // 自动写电脑剪贴板失败时带内容来，等用户点一下再写；之后有新内容写成功时带 null 来，收起
  const clip = signal<string | null>(null);
  const copyFailed = signal(false);
  host.on("emu.clip", (p: { text: string | null }) => {
    clip.set(p.text);
    copyFailed.set(false);
  });
  const copyClip = () => {
    const text = clip();
    if (text === null) return;
    host.call("emu.copy", { text }).then(
      () => clip.set(null),
      () => copyFailed.set(true),
    );
  };
  host.call("emu.status", {}).then((s: { state: State; serial: number; rotation: number; fps: number; latencyMs: number; avds: Avd[] | null; phones?: PhoneInfo[] | null; mumu?: MumuInfo[] | null; boots: Boot[]; upgrade: string | null; rev: number; uploads?: Upload[]; gateway?: GatewayBanner | null } & DeviceStatus & Omit<Setup, "rev">) => {
    applySetup({ env: s.env, installs: s.installs, license: s.license, rev: s.rev });
    if (!isStaleStatus(s.rev, gatewayRev)) {
      gatewayRev = s.rev;
      gatewayNote.set(s.gateway ?? null);
    }
    applyUploads(s.uploads, s.rev);
    // 调用和结果之间到了更新的 emu.status 事件时，结果里的状态已过时
    if (!isStaleStatus(s.rev, statusRev)) {
      statusRev = s.rev;
      state.set(s.state);
      upgrade.set(s.upgrade);
      serial.set(s.serial);
      applyDevice(s);
    }
    rotation.set(s.rotation);
    fps.set(s.fps);
    latency.set(s.latencyMs);
    if (s.avds) avds.set(s.avds);
    if (s.phones) phones.set(s.phones);
    if (s.mumu) mumu.set(s.mumu);
    boots.set(Object.fromEntries(s.boots.map((b) => [b.name, b])));
  });

  // 设备上的按钮（按键、旋转、截图、重启）在没连上设备时返回 ok:false，给个提示，不假装成功
  const act = (p: Promise<{ ok: boolean }>) =>
    p.then((r) => { if (!r.ok) showNotice({ text: "还没有连接设备，操作没有发出。等设备连上后再试。", error: true }); });
  const key = (k: string) => act(host.call("emu.key", { key: k }));
  // 只要求连着网关的（启动、切换、安装、许可证）：ok:false 是没连上网关
  const GW_DOWN = "没有连上网关，操作没有发出。等网关重新连上后再试。";
  const gw = (p: Promise<{ ok: boolean }>) =>
    p.then((r) => { if (!r.ok) showNotice({ text: GW_DOWN, error: true }); });
  // 点了「启动」「切换到这台」、结果还没到：按钮换成进行中的字并禁用（什么时候放开见 ui/start-pending.ts）
  const pending = signal<Pending>(null);
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;
  const pendingEvent = (e: PendingEvent) => {
    const next = pendingAfter(pending(), e);
    if (next === pending()) return;
    clearTimeout(pendingTimer);
    pending.set(next);
  };
  cleanup(() => clearTimeout(pendingTimer));
  const begin = (name: string, what: "start" | "use") => {
    if (pending()) return;
    pending.set({ name, what });
    pendingTimer = setTimeout(() => pendingEvent({ kind: "timeout" }), PENDING_MS);
    (host.call(what === "start" ? "emu.start" : "emu.use", { name }) as Promise<{ ok: boolean }>).then((r) => {
      if (r.ok) return;
      pendingEvent({ kind: "not-sent" });
      showNotice({ text: GW_DOWN, error: true });
    });
  };

  const problemColor = () => (state() === "page-outdated" ? token("warning") : token("destructive"));
  const bootingName = () => Object.values(boots()).find(isBooting);
  const currentAvd = () => (avds() ?? []).find((a) => a.running === "grpc" && a.serial === serial());
  // 设备框的宽高比：当前设备的分辨率，横屏时对调；不知道分辨率时按 1080×2340
  // 机身大小：放进按键之间剩下的地方，屏幕区按当前设备转过之后的宽高比；不知道分辨率时按 1080×2340
  // 画面缩放：1 是适应窗口；读到这台浏览器存的值后换过去
  const zoom = signal(1);
  host.call("emu.zoom", {}).then((z: unknown) => zoom.set(parseZoom(z)));
  const deviceArea = signal({ width: 0, height: 0 });
  const frame = () => {
    const a = currentAvd();
    const d = a?.width && a.height ? { width: a.width, height: a.height } : deviceSize().width ? deviceSize() : { width: 1080, height: 2340 };
    return deviceFrame(deviceArea(), d, rotation() as Rotation, BEZEL, zoom());
  };
  // 点缩放、设备转向时机身平滑过渡（ui/device-motion.ts）：只动机身的 transform，画布在机身里跟着一起动，不逐帧排版。
  // 转动中机身不收指针：画布斜着时 getBoundingClientRect 换算出的设备坐标不对。读到存的缩放、换设备时直接换，不做动画
  const motion = createMotion();
  let glide: Glide | null = null;
  const turning = signal(false);
  // 不做动画的变化（减少动态效果、换设备）：正在播的过渡停到原位，免得旧的缩放套在新布局上接着播
  const settle = () => {
    if (!glide) return;
    glide = null;
    motion.reset();
    turning.set(false);
  };
  const glideFrom = (prev: { width: number; height: number }, angle: number) => {
    const next = frame();
    if (reduceMotion() || !prev.width || !next.width) return settle();
    const now = Date.now();
    const from = startPose(prev, glide ? poseAt(glide, now) : REST, next, angle);
    const ms = angle || from.rotate ? TURN_MS : ZOOM_MS;
    // 关键帧按 ease 预先算好（每帧约 16ms 一个，斜着时缩到放得进设备区），播放时相邻两帧之间线性走
    const frames = glideFrames(from, next, deviceArea(), GLIDE_EASE, Math.ceil(ms / 16));
    const g: Glide = { frames, start: now, ms };
    glide = g;
    turning.set(from.rotate !== 0);
    // 先把起点姿态设上，和新布局同一帧生效：play 的第一个值要下一帧才到，中间那帧机身会以新尺寸闪一下
    motion.rotate.set(from.rotate);
    motion.scaleX.set(from.scaleX);
    motion.scaleY.set(from.scaleY);
    motion.play(
      { keyframes: { rotate: frames.map((f) => f.rotate), scaleX: frames.map((f) => f.scaleX), scaleY: frames.map((f) => f.scaleY) }, duration: ms, easing: "linear" },
    ).then(() => {
      if (glide !== g) return;
      glide = null;
      turning.set(false);
    });
  };
  const setZoom = (z: number) => {
    const prev = frame();
    zoom.set(z);
    glideFrom(prev, 0);
    host.call("emu.setZoom", { zoom: z });
  };
  // turned：连着的设备真转了向（连上设备时报的原方向不算，见 host/src/main.ts 的 onOrientation）
  host.on("emu.orientation", (p: { rotation: number; turned?: boolean }) => {
    const prev = frame();
    const angle = turnAngle(rotation() as Rotation, p.rotation as Rotation);
    rotation.set(p.rotation);
    if (!p.turned) settle();
    else if (angle) glideFrom(prev, angle);
  });
  // 主区现在连着的真机（不是真机时为 undefined）；lastPhone 给重启中手机暂时不在列表里时用
  let lastPhone: PhoneInfo | undefined;
  const currentPhone = () => {
    const p = currentPhoneOf(phones(), lastPhone, { kind: kind(), deviceId: deviceId(), state: state() });
    if (p) lastPhone = p;
    return p;
  };
  // 侧栏收起与否：先展开，读到这台浏览器存的值后换过去；读回来之前用户已经点过的，以用户点的为准
  const sidebarHidden = signal(false);
  let sidebarTouched = false;
  const setSidebar = (hidden: boolean) => {
    sidebarTouched = true;
    animateNext();
    sidebarHidden.set(hidden);
    host.call("emu.setSidebar", { hidden });
  };
  host.call("emu.sidebar", {}).then((r: unknown) => {
    if (!sidebarTouched) sidebarHidden.set(!!(r as { hidden?: boolean } | null)?.hidden);
  });
  // 窗口窄于 SIDEBAR_AUTO_HIDE 时侧栏自动收起，存着的选择不动；窄的时候手动展开只在这次有效，窗口宽窄一换就回到默认
  const narrow = () => windowSize().width < SIDEBAR_AUTO_HIDE;
  const narrowSidebar = signal(false);
  let wasNarrow = narrow();
  effect(() => {
    const n = narrow();
    if (n === wasNarrow) return;
    wasNarrow = n;
    narrowSidebar.set(false);
  });
  const sidebarShown = () => (narrow() ? narrowSidebar() : !sidebarHidden());
  const showSidebar = (shown: boolean) => {
    if (!narrow()) return setSidebar(!shown);
    animateNext();
    narrowSidebar.set(shown);
  };
  // 设备区和右侧面板并排放不下各自的最小宽度时，上下叠着放
  const stacked = () => windowSize().width - (sidebarShown() ? SIDEBAR_W + SPACE.item : 0) < DEVICE_MIN_W + PANEL_MIN_W;
  // 页面标题（当前设备名）可用的宽度，按它中间省略
  const titleWidth = signal(0);
  const query = signal("");
  // 搜索对每一组都生效；搜索时没有匹配的组整个不显示（不留空标题、不显示「插上手机」这类提示）
  const search = () => searchSidebar(query(), { avds: avds() ?? [], phones: splitPhones(phones()).phones, mumu: mumuRows(mumu(), phones()) }, {
    avd: (a) => [a.name, a.displayName],
    phone: (p) => [phoneLabel(p), p.id, p.model],
    mumu: (r) => [mumuRowTitle(r)],
  });
  const listed = () => search().avds;
  const searching = () => search().searching;
  const listedPhones = () => search().phones;
  const listedMumu = () => search().mumu;
  const noMatch = () => search().noMatch;
  // 选中的设备：主区显示它。连上的设备换了（启动、切换）就选中那一台；用户点选没在运行的设备时只是选中，不启动
  const selected = signal<string | null>(null);
  let lastCurrent: string | null = null;
  effect(() => {
    const name = state() === "connected" ? (kind() === "phone" ? deviceId() || null : currentAvd()?.name ?? null) : null;
    // 断开、重启、重连时 name 暂时是 null：不算换了设备，回来的还是同一台就不动用户的选择
    if (!name || name === lastCurrent) return;
    lastCurrent = name;
    selected.set(name);
  });
  const isCurrent = (a: Avd) => a.running === "grpc" && a.serial === serial() && (state() === "connected" || state() === "rebooting");
  const shown = () => (avds() ?? []).find((a) => a.name === selected()) ?? currentAvd() ?? null;
  // 主区现在显示的就是画面上这台：没有选中的设备时（列表里没有它），连着就算
  const shownIsLive = () => { const a = shown(); return a ? isCurrent(a) : state() === "connected"; };
  // 画面上连着（或重启中）的模拟器设备；画面上是手机或没有设备时为 null
  const onScreen = () => (shownIsLive() ? shown() : null);
  // 画面上这台重启中不能停：网关停掉它后仍按重启在等 adb，页面会一直显示重启中，约 2 分钟后报一个假的 adb 错误
  const stoppable = (a: Avd | null) =>
    !!a && !gatewayDown(state()) && live(a) && !beingStopped(a) && !beingDeleted(a) && !(isCurrent(a) && state() === "rebooting");
  const switchTo = (a: Avd) => begin(a.name, "use");
  // 切换到的那台到了画面上、和网关断开了：不再等
  effect(() => pendingEvent({ kind: "status", down: gatewayDown(state()), onScreen: state() === "connected" ? currentAvd()?.name ?? null : null }));
  const pendingText = (a: Avd, what: "start" | "use") => (pending()?.name === a.name && pending()!.what === what ? (what === "start" ? "启动中…" : "切换中…") : null);
  const isCurrentPhone = (p: PhoneInfo) => kind() === "phone" && p.id === deviceId() && (state() === "connected" || state() === "rebooting");
  const pickPhone = (p: PhoneInfo) => {
    if (!canPick(p)) return;
    if (p.id !== selected()) animateNext();
    selected.set(p.id);
    // 没连着网关时列表是旧的，只选中，不去切换（同 pickDevice）
    if (!gatewayDown(state()) && !isCurrentPhone(p)) gw(host.call("emu.use", { name: p.id }));
  };
  const copyHref = (url: string) =>
    host.call("emu.copy", { text: url }).then(
      () => showNotice({ text: "已复制 H5 页面地址" }),
      () => showNotice({ text: "复制失败，请手动选中地址复制", error: true }),
    );
  const pickDevice = (a: Avd) => {
    if (a.name !== selected()) animateNext();
    selected.set(a.name);
    // 没连着网关时列表是旧的，只选中，不去切换
    if (!gatewayDown(state()) && a.running === "grpc" && !isCurrent(a) && a.serial !== serial()) switchTo(a);
  };
  const avdStatus = (a: Avd) => {
    if (gatewayDown(state())) return "状态未知";
    if (a.running === "grpc") return isCurrent(a) ? "运行中 · 当前画面" : "运行中";
    if (a.running === "no-grpc") return "运行中但无法接管";
    const b = boots()[a.name];
    return isBooting(b) ? `启动中 ${b!.seconds} 秒` : "未运行";
  };
  const avdTint = (a: Avd) => (gatewayDown(state()) ? token("muted-foreground") : a.running === "grpc" ? token("success") : a.running === "no-grpc" || isBooting(boots()[a.name]) ? token("warning") : token("muted-foreground"));
  const avdSpec = (a: Avd) => {
    const parts: string[] = [];
    if (a.apiLevel) parts.push(ANDROID[a.apiLevel] ? `Android ${ANDROID[a.apiLevel]}` : `API ${a.apiLevel}`);
    if (a.width && a.height) parts.push(`${a.width}×${a.height}`);
    return parts.join(" · ");
  };
  const canStart = (a: Avd) => a.running === "no" && !isBooting(boots()[a.name]);
  // 这台正在删：改名和删除都不能再点
  const beingDeleted = (a: Avd) => deleting() && deleteTarget()?.name === a.name;
  const live = (a: Avd) => deviceLive(a, isBooting(boots()[a.name]));
  // 标题下的状态行分两段：规格放不下时先截它，连接状态（帧率、延迟）留着；两段之间的「·」单独放（见状态行）
  const subtitleSpec = () => { const a = shown(); return a ? avdSpec(a) : ""; };
  const subtitleState = () => { const a = shown(); return !a || shownIsLive() ? statusText() : avdStatus(a); };
  const emptyText = () => {
    const a = shown();
    // 没连着网关：列表是旧的或还没有，不说「没有设备」「运行中」这种可能不对的话；连不上的原因在上面的提示里
    if (gatewayDown(state())) return a ? "连上网关后才知道这台设备现在的状态。" : "连上网关后这里会显示设备。";
    if (!a) {
      if (avds() === null) return "正在读取设备列表…";
      return avds()!.length > 0 ? "在左侧选一台设备。" : "插上手机并打开 USB 调试，或创建一台模拟器设备。";
    }
    if (a.running === "grpc") return "运行中，画面上现在是别的设备。";
    if (a.running === "no-grpc") return "这台设备已在运行，但启动时没有开启 gRPC，网关接管不了。先在 Android Studio 里停止它，再在这里重新启动。";
    const b = boots()[a.name];
    return isBooting(b) ? `启动中 ${b!.seconds} 秒` : "未运行";
  };
  const toggleH5 = () => {
    if (h5Open()) {
      closeDevtools();
      // 用户手动关的：这个 App 的页面不再自动打开，直到出现别的 App 的 H5 页面
      autoState = autoOpen(autoState, { kind: "closed", pkg: livePage()?.pkg ?? null }).state;
    }
    h5Open.set(!h5Open());
    if (h5Open()) sideTab.set("h5");
  };
  // 前台出现 H5 页面时自动打开控制台，每次出现一次（ui/console-auto.ts）
  let autoState = AUTO_START;
  const livePage = () => (shownIsLive() ? activePage(pages() ?? []) : undefined);
  effect(() => {
    const p = livePage();
    const r = autoOpen(autoState, { kind: "active", key: p ? pageKey(p) : null, pkg: p?.pkg ?? null });
    autoState = r.state;
    if (r.open && !h5Open()) h5Open.set(true);
  });
  const statusText = () => {
    const s = state();
    // 真机帧没有时间戳（手机时钟和电脑不同），只显示帧率
    if (s === "connected") return kind() === "phone" ? `已连接 · ${fps()} 帧/秒` : `已连接 · ${fps()} 帧/秒 · 延迟 ${latency()} 毫秒`;
    const b = bootingName();
    if (s === "booting" || b) return b ? `启动中 ${b.seconds} 秒` : LABEL.booting;
    return LABEL[s];
  };

  const setupBusy = () => installs().some(isActive);
  // 不能点的控件为什么不能点（悬停提示和读屏说这句）
  const createWhy = () => (setupBusy() ? "正在安装 SDK 组件，装完再创建" : !env() ? "还没连上网关" : undefined);
  const liveWhy = () => {
    if (shownIsLive()) return undefined;
    if (gatewayDown(state())) return "还没连上网关";
    return state() === "connected" && shown() ? "画面上不是这台设备，先切换到它" : "没有连接设备";
  };
  const inputWhy = () => liveWhy() ?? (caps()?.input === false ? "这台设备不支持" : undefined);
  // 环境还缺东西、卡片又没显示时，Droidpier 菜单里给一项重新打开它
  const setupMenuLabel = () => {
    const e = env();
    return e && !e.ok && !showSetup() ? (e.missing.length > 0 ? `环境检查（缺 ${e.missing.length} 项）` : "环境检查") : null;
  };
  const pickFiles = () =>
    (host.call("emu.pickFiles", {}) as Promise<{ ok: boolean; error?: string }>).then((r) => {
      if (!r.ok) showNotice({ text: r.error ?? "没有连接设备", error: true });
    });
  // 画面上方现在显示哪条提示（ui/banners.ts）
  const banner = () => pickBanner(activeBanners({ adbStuck: adbStuck(), state: state(), notices: notices(), gateway: !!gatewayShown(), clip: clip() !== null }));
  const gatewayManual = () => gatewayShown()?.kind === "manual";
  const bannerBorder = (k: BannerKind) =>
    k === "adb" || (k === "error" && notice()?.error) ? token("destructive") : k === "gateway" && gatewayManual() ? token("warning") : token("border");
  // 一般消息只在真的显示出来时倒计时：被前面的提示挡着时停下，再露出来时重新计（ui/banners.ts 的 timedNotice）
  let timed: Notice | null = null;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  effect(() => {
    const n = timedNotice(banner().shown, notices());
    if (n === timed) return;
    clearTimeout(noticeTimer);
    timed = n;
    const ms = n ? noticeTimeoutMs(n) : null;
    if (n && ms !== null) noticeTimer = setTimeout(() => notices.set(dropNotice(notices(), n)), ms);
  });
  cleanup(() => clearTimeout(noticeTimer));
  // 画面上方的提示卡片（一条提示、传文件进度各一张）
  const bannerCard = () => ({ gap: SPACE.item, backgroundColor: token("overlay"), borderRadius: token("radius-lg"), padding: SPACE.inset, borderWidth: 1, maxWidth: "92%" }) as const;
  // 键盘焦点在不在画面上（host 的 emu.keyboard）：在的时候机身画焦点环，下面说怎么离开。画面上没有在连着的设备时不算
  // （停了、重启中：host 那边也会让出焦点，见 host/src/main.ts 的 onState）
  const keyboardOn = signal(false);
  host.on("emu.keyboard", (p: { on: boolean }) => keyboardOn.set(p.on));
  const keyboardShown = () => keyboardOn() && shownIsLive() && state() === "connected";
  const showSetup = () => {
    const e = env();
    if (!e) return null;
    const failed = installs().some((p) => p.phase === "failed");
    const needed = setupNeeded(e, (avds() ?? []).length);
    return setupCardShown({ ok: e.ok, needed, wanted: setupWanted(), busy: setupBusy(), failed, hasInstalls: installs().length > 0, dismissed: setupDismissed() }) ? e : null;
  };
  const startInstall = () => {
    const c = confirm();
    confirm.set(null);
    if (!c) return;
    setupDismissed.set(false);
    if (c.kind === "install") gw(host.call("emu.install", { ids: c.ids }));
    else gw(host.call("emu.createAvd", { name: c.avd.name, device: c.avd.device.id, image: c.avd.image.pkg }));
  };

  // 重命名对话框：改的是显示名，id 不变
  const renameTarget = signal<Avd | null>(null);
  const renameDraft = signal("");
  const renameError = signal<string | null>(null);
  const renaming = signal(false);
  const openRename = (a: Avd) => {
    renameDraft.set(avdLabel(a));
    renameError.set(null);
    renameTarget.set(a);
  };
  const saveRename = () => {
    const a = renameTarget();
    if (!a || renaming()) return;
    const error = displayNameError(renameDraft());
    if (error) return renameError.set(error);
    if (renameDraft().trim() === avdLabel(a)) return renameTarget.set(null);
    renaming.set(true);
    // 回来时对话框可能已经关了或换成了别的设备：只把结果给发出请求的那一个
    const still = () => renameTarget()?.name === a.name;
    (host.call("emu.renameAvd", { name: a.name, displayName: renameDraft() }) as Promise<{ ok: boolean; error?: string }>).then(
      (r) => {
        if (!still()) return;
        if (r.ok) renameTarget.set(null);
        else renameError.set(failText("没有改成", r.error));
      },
      (e: Error) => { if (still()) renameError.set(failText("没有改成", e.message)); },
    ).finally(() => renaming.set(false));
  };

  // 删除确认框：删的是整台设备的数据，系统镜像不动；失败时留在框里显示原因
  const deleteTarget = signal<Avd | null>(null);
  const deleteError = signal<string | null>(null);
  const deleting = signal(false);
  const openDelete = (a: Avd) => {
    deleteError.set(null);
    deleteTarget.set(a);
  };
  const confirmDelete = () => {
    const a = deleteTarget();
    if (!a || deleting()) return;
    deleting.set(true);
    const still = () => deleteTarget()?.name === a.name;
    // 运行中、开机中的由网关先停掉再删（用户在确认框里看到了提醒）
    (host.call("emu.deleteAvd", { name: a.name, stop: true }) as Promise<{ ok: boolean; error?: string }>).then(
      (r) => {
        if (r.ok) {
          if (still()) deleteTarget.set(null);
          showNotice({ text: `已删除 ${avdLabel(a)}` });
        } else if (still()) deleteError.set(failText("没有删除", r.error));
      },
      (e: Error) => { if (still()) deleteError.set(failText("没有删除", e.message)); },
    ).finally(() => deleting.set(false));
  };
  // 停止设备：顶栏「更多操作」（画面上这台）、侧栏行的右键菜单、主区的按钮都走这里，先确认（正在运行的 App 会被关掉），
  // 确认框里显示「停止中…」，停了才关；失败的原因留在框里（流程在 ui/stop-flow.ts）
  const stop = signal<StopFlow>(STOP_IDLE);
  const beingStopped = (a: Avd) => isStopping(stop(), a.name);
  const stopEvent = (e: StopEvent) => {
    const r = stopStep(stop(), e);
    stop.set(r.flow);
    if (r.notice) showNotice(r.notice);
    const name = r.send;
    if (!name) return;
    (host.call("emu.stopAvd", { name }) as Promise<{ ok: boolean; error?: string }>).then(
      (res) => stopEvent(res.ok ? { kind: "done", name } : { kind: "failed", name, text: failText("没有停止", res.error) }),
      (err: Error) => stopEvent({ kind: "failed", name, text: failText("没有停止", err.message) }),
    );
  };
  const openStop = (a: Avd) => stopEvent({ kind: "open", target: { name: a.name, label: avdLabel(a) } });
  // 列表里已经看到它停了（回复之前）也算停完
  effect(() => {
    const list = avds();
    if (!list) return;
    for (const t of stop().stopping) {
      const a = list.find((x) => x.name === t.name);
      if (!a || !live(a)) stopEvent({ kind: "gone", name: t.name });
    }
  });
  // 许可证要用户回答，盖在别的对话框上会叠两层：先把别的关掉（正在保存、删除、停止的留着，许可证排在它们后面）
  effect(() => {
    if (!license()) return;
    rebootAsk.set(false);
    if (!renaming()) renameTarget.set(null);
    if (!deleting()) deleteTarget.set(null);
    stopEvent({ kind: "cancel" });
  });
  // 回复晚了（页面 15 秒超时）或别的页面删掉了它：新列表里没有这台了，就当删完
  effect(() => {
    const a = deleteTarget();
    const list = avds();
    if (!a || !list || list.some((x) => x.name === a.name)) return;
    deleteTarget.set(null);
    showNotice({ text: `已删除 ${avdLabel(a)}` });
  });

  // 侧栏里设备和真机的一行：同一套几何，圆角 radius 加侧栏的内边距 SPACE.item 正好是侧栏的 radius-xl
  const rowStyle = () =>
    ({ flexDirection: "row", alignItems: "center", gap: SPACE.item, paddingVertical: SPACE.part, paddingHorizontal: SPACE.item, borderRadius: token("radius"), borderWidth: 1, borderColor: "transparent", ...ease() }) as const;
  const avatarStyle = () =>
    ({ width: CONTROL.md, height: CONTROL.md, borderRadius: CONTROL.md / 2, alignItems: "center", justifyContent: "center", backgroundColor: token("background") }) as const;
  // 选中和悬停分开：悬停只有底色，选中再加一圈 border-strong 的边（和对话框里选中的行一样），鼠标停在别的行上时不像两行都选中了
  const rowStates = () => ({
    hoverStyle: { backgroundColor: token("accent") }, selectedStyle: { backgroundColor: token("accent"), borderColor: token("border-strong") },
    focusStyle: { borderColor: token("ring") }, activeStyle: pressed(),
  });
  // 行尾“启动”和右键菜单的“启动”同主区那个按钮（canStart、begin），和 MuMu、iOS 行一样不用先选中再到主区点
  const DeviceRow = (props: { avd: () => Avd }) => {
    const a = props.avd;
    const startable = () => !gatewayDown(state()) && canStart(a()) && !beingDeleted(a());
    const start = () => begin(a().name, "start");
    // “启动”放在右键菜单的触发区外面：在它上面右键不该弹出菜单（同 MumuDeviceRow）
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.hair }}>
      <View style={{ flex: 1, minWidth: 0 }}>
      <ContextMenu offset={SPACE.part} popupStyle={menuPopup("top left")} popupStartingStyle={popOut("above")} popupEndingStyle={popOut("above")}
        onOpenChange={releaseOnOpen} trigger={
        <Button onPress={() => pickDevice(a())} selected={shown()?.name === a().name} accessibilityLabel={`${avdLabel(a())}，${avdStatus(a())}`}
          {...rowStates()}
          style={rowStyle()}>
          <View style={avatarStyle()}>
            <Icon name="smartphone" size={ICON.md} tint={avdTint(a())} />
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: SPACE.hair }}>
            {/* 行尾有“启动”时名字可能放不下：单行省略，不在短横线处折行 */}
            <Text style={{ color: token("foreground"), ...TYPE.body, fontWeight: WEIGHT.strong, numberOfLines: 1 }}>{noBreak(avdLabel(a()))}</Text>
            {/* 没连着网关时状态写的是「状态未知」，不用警告色（同 avdTint） */}
            <Text style={{ color: !gatewayDown(state()) && (a().running === "no-grpc" || isBooting(boots()[a().name])) ? token("warning") : token("muted-foreground"), ...TYPE.caption }}>{avdStatus(a())}</Text>
          </View>
          {/* 没运行的行尾是“启动”，版本号让位（同 MuMu 行） */}
          <If when={!startable()}>
            <Text style={{ color: token("muted-foreground"), ...TYPE.caption }}>{a().apiLevel ? ANDROID[a().apiLevel!] ?? `API ${a().apiLevel}` : ""}</Text>
          </If>
        </Button>
      }>
        <Item label={pendingText(a(), "start") ?? "启动"} disabled={!startable() || !!pending()} onSelect={start} />
        <Item label="重命名…" disabled={beingDeleted(a())} onSelect={() => openRename(a())} />
        <Item label={beingStopped(a()) ? "停止中…" : "停止设备…"} disabled={!stoppable(a())} onSelect={() => openStop(a())} />
        <MenuLine />
        <Item label="删除…" danger disabled={beingDeleted(a())} onSelect={() => openDelete(a())} />
      </ContextMenu>
      </View>
      <If when={startable()}>
        <Btn label={pendingText(a(), "start") ?? "启动"} a11y={`${pendingText(a(), "start") ?? "启动"} ${avdLabel(a())}`} disabled={!!pending()} onPress={start} />
      </If>
      </View>
    );
  };

  // 可用的手机点了切过去；样式跟 DeviceRow 一致。没授权、离线的不禁用：禁用会从 Tab 顺序里拿掉，键盘就读不到行上的说明
  // （「请在手机上允许 USB 调试」），按下由 pickPhone 拦着；也不给悬停底色，免得看着能点
  const PhoneRow = (props: { phone: () => PhoneInfo }) => {
    const p = props.phone;
    return (
      <Button onPress={() => pickPhone(p())} selected={selected() === p().id} accessibilityLabel={`${phoneLabel(p())}，${phoneStatus(p(), isCurrentPhone(p()))}`}
        {...rowStates()} hoverStyle={canPick(p()) ? { backgroundColor: token("accent") } : undefined} activeStyle={canPick(p()) ? pressed() : undefined}
        style={rowStyle()}>
        <View style={avatarStyle()}>
          <Icon name="smartphone" size={ICON.md} tint={!gatewayDown(state()) && p().state === "device" ? token("success") : token("muted-foreground")} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: SPACE.hair }}>
          <Text style={{ color: token("foreground"), ...TYPE.body, fontWeight: WEIGHT.strong }}>{phoneLabel(p())}</Text>
          <Text style={{ color: p().state === "device" ? token("muted-foreground") : token("warning"), ...TYPE.caption }}>{phoneStatus(p(), isCurrentPhone(p()))}</Text>
        </View>
        <Text style={{ color: token("muted-foreground"), ...TYPE.caption }}>{phoneDetail(p())}</Text>
      </Button>
    );
  };

  // MuMu 一行：开着、adb 也连上了的点了切过去（同 PhoneRow）；没开机的行尾有“启动”；开着的右键能关机（先确认）
  const MumuDeviceRow = (props: { row: () => MumuRow }) => {
    const r = props.row;
    const pickable = () => !!r().phone && canPick(r().phone!);
    const current = () => !!r().phone && isCurrentPhone(r().phone!);
    const ok = () => r().mumu ? r().mumu!.state === "running" && pickable() : pickable();
    const startMumu = () => {
      const m = r().mumu;
      if (!m) return;
      mumuStarting.set(m.index);
      // 开机没成功（网关回了错误）时列表不会变：15 秒后（我定的，够网关读几次列表）让按钮回来
      setTimeout(() => { if (mumuStarting() === m.index) mumuStarting.set(null); }, 15_000);
      gw(host.call("emu.mumuOpen", { index: m.index }));
    };
    const starting = () => mumuStarting() === r().mumu?.index;
    // 图标颜色同模拟器行（avdTint）：能用的绿、开关机中黄、其余灰
    const mumuTint = () =>
      gatewayDown(state()) ? token("muted-foreground") : ok() ? token("success")
        : starting() || r().mumu?.state === "starting" || r().mumu?.state === "stopping" ? token("warning") : token("muted-foreground");
    // “启动”放在右键菜单的触发区外面：在它上面右键不该弹出“关机”
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.hair }}>
      <View style={{ flex: 1, minWidth: 0 }}>
      <ContextMenu offset={SPACE.part} popupStyle={menuPopup("top left")} popupStartingStyle={popOut("above")} popupEndingStyle={popOut("above")}
        onOpenChange={releaseOnOpen} trigger={
          <Button onPress={() => { const ph = r().phone; if (ph) pickPhone(ph); }} selected={!!r().phone && selected() === r().phone!.id}
            accessibilityLabel={`${mumuRowTitle(r())}，${mumuRowStatus(r(), current())}`}
            {...rowStates()} hoverStyle={pickable() ? { backgroundColor: token("accent") } : undefined} activeStyle={pickable() ? pressed() : undefined}
            style={rowStyle()}>
            <View style={avatarStyle()}>
              <Icon name="smartphone" size={ICON.md} tint={mumuTint()} />
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: SPACE.hair }}>
              <Text style={{ color: token("foreground"), ...TYPE.body, fontWeight: WEIGHT.strong }}>{mumuRowTitle(r())}</Text>
              <Text style={{ color: !r().mumu && r().phone && r().phone!.state !== "device" ? token("warning") : token("muted-foreground"), ...TYPE.caption }}>{mumuRowStatus(r(), current())}</Text>
            </View>
            <If when={!(r().mumu?.state === "stopped")}>
              <Text style={{ color: token("muted-foreground"), ...TYPE.caption }}>{r().phone ? phoneDetail(r().phone!) : ""}</Text>
            </If>
          </Button>
      }>
        <Item label="关机…" disabled={r().mumu?.state !== "running" || gatewayDown(state())} onSelect={() => { const m = r().mumu; if (m) mumuCloseAsk.set(m); }} />
      </ContextMenu>
      </View>
      <If when={r().mumu?.state === "stopped" && !gatewayDown(state())}>
        <Btn label={starting() ? "启动中…" : "启动"} a11y={`${starting() ? "启动中…" : "启动"} ${mumuRowTitle(r())}`} disabled={starting()} onPress={startMumu} />
      </If>
      </View>
    );
  };
  // 列表里那台已经不是“未运行”了（开始开机）：启动按钮的临时状态交还给列表
  effect(() => {
    const i = mumuStarting();
    if (i !== null && (mumu() ?? []).find((m) => m.index === i)?.state !== "stopped") mumuStarting.set(null);
  });

  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: token("background"), ...ease("normal") }}>
      <If when={sidebarShown()}>
        <View role="navigation" accessibilityLabel="设备列表"
          style={{ width: SIDEBAR_W, margin: SPACE.item, marginRight: 0, padding: SPACE.item, gap: SPACE.part, borderRadius: token("radius-xl"), borderWidth: 1, borderColor: token("border-subtle"), backgroundColor: token("sidebar"), ...ease("normal") }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: SPACE.hair }}>
            <IconButton icon="plus" label="创建设备…" disabled={!!createWhy()} why={createWhy()} onPress={openCreate} />
            <IconButton icon="panelLeft" label="收起侧栏" onPress={() => showSidebar(false)} />
          </View>
          <FieldBox icon="search">
            <Input value={query()} onChange={({ value }) => query.set(value)} placeholder="搜索设备" accessibilityLabel="搜索设备" autoCapitalize="none" autoCorrect={false}
              style={fieldText()} />
          </FieldBox>
          {/* 搜索时只有手机或 MuMu 匹配：模拟器这组的标题也不留 */}
          <If when={!searching() || listed().length > 0 || noMatch()}>
            <Text style={{ color: token("muted-foreground"), ...TYPE.caption, fontWeight: WEIGHT.strong, paddingHorizontal: ROW_X, paddingTop: SPACE.item, paddingBottom: SPACE.hair }}>设备</Text>
          </If>
          <Scroll style={{ flex: 1 }} contentStyle={{ gap: SPACE.hair }}>
            {/* 没连着网关时读不到列表：不说「正在读取」；有断开前的旧列表时说明它可能不是最新的 */}
            <If when={avds() !== null} else={<Text style={{ color: token("muted-foreground"), ...TYPE.body, paddingHorizontal: ROW_X }}>{gatewayDown(state()) ? "连上网关后显示设备" : "正在读取设备列表…"}</Text>}>
              <If when={gatewayDown(state()) && (avds() ?? []).length > 0}>
                <Text role="summary" style={{ color: token("warning"), ...TYPE.caption, paddingHorizontal: ROW_X, paddingBottom: SPACE.part }}>没连着网关，下面是断开前的列表。</Text>
              </If>
              <If when={(avds() ?? []).length > 0} else={
                <View style={{ gap: SPACE.item, paddingHorizontal: ROW_X, alignItems: "flex-start" }}>
                  <Text style={{ color: token("muted-foreground"), ...TYPE.body }}>本机还没有模拟器设备</Text>
                  <Btn label="创建设备…" disabled={!!createWhy()} why={createWhy()} onPress={openCreate} />
                  <If when={env() && emulatorButtonShown(env()!, (avds() ?? []).length, !!showSetup())}>
                    <Btn label={`安装模拟器（缺 ${missingEmulatorItems(env()!)} 项）`} onPress={() => { animateNext(); setupDismissed.set(false); setupWanted.set(true); }} />
                  </If>
                </View>
              }>
                <If when={listed().length > 0} else={noMatch() ? <Text style={{ color: token("muted-foreground"), ...TYPE.body, paddingHorizontal: ROW_X }}>{`没有名字含「${query().trim()}」的设备`}</Text> : null}>
                  <Each of={listed()} key={(a) => a.name}>{(a) => <DeviceRow avd={a} />}</Each>
                </If>
              </If>
            </If>
            <If when={showPhones(phones()) && (!searching() || listedPhones().length > 0)}>
              <Text style={{ color: token("muted-foreground"), ...TYPE.caption, fontWeight: WEIGHT.strong, paddingHorizontal: ROW_X, paddingTop: SPACE.inset, paddingBottom: SPACE.hair }}>手机</Text>
              <If when={listedPhones().length > 0} else={
                <Text style={{ color: token("muted-foreground"), ...TYPE.body, paddingHorizontal: ROW_X }}>
                  {env()?.missing.some((m) => m.id === "platform-tools") ? "先在环境检查里安装 platform-tools（adb），才能看到手机。" : "插上手机并打开 USB 调试。"}
                </Text>
              }>
                <Each of={listedPhones()} key={(p) => p.id}>{(p) => <PhoneRow phone={p} />}</Each>
              </If>
            </If>
            <If when={listedMumu().length > 0}>
              <Text style={{ color: token("muted-foreground"), ...TYPE.caption, fontWeight: WEIGHT.strong, paddingHorizontal: ROW_X, paddingTop: SPACE.inset, paddingBottom: SPACE.hair }}>MuMu 模拟器</Text>
              <Each of={listedMumu()} key={(r) => r.key}>{(r) => <MumuDeviceRow row={r} />}</Each>
            </If>
          </Scroll>
          <View style={{ height: 1, marginHorizontal: ROW_X, backgroundColor: token("border-subtle") }} />
          <AppMenu site={site()} theme={theme()} onTheme={pickTheme} setup={setupMenuLabel()}
            onSetup={() => { animateNext(); setupDismissed.set(false); setupWanted.set(true); }} />
        </View>
      </If>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: SPACE.inset, paddingVertical: SPACE.item, paddingHorizontal: SPACE.group }}>
          <If when={!sidebarShown()}>
            <IconButton icon="panelLeft" label="展开侧栏" onPress={() => showSidebar(true)} />
          </If>
          {/* 220 放得下最长的连接状态（“已连接 · 60 帧/秒 · 延迟 12 毫秒”），状态不被截 */}
          <View style={{ flex: 1, minWidth: 220, gap: SPACE.hair }} onLayout={({ bounds }) => titleWidth.set(bounds.size.width)}>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: SPACE.item }}>
              {/* 设备名先占够自己的宽度，包名只用剩下的；名字本身放不下时中间省略 */}
              <Text role="header" style={{ flexShrink: 1, color: token("foreground"), ...TYPE.heading, numberOfLines: 1 }}>
                {noBreak(fitMiddle(shown() ? avdLabel(shown()!) : currentPhone() ? phoneTitle(currentPhone()!, mumu()) : "没有连接设备", titleWidth(), TYPE.heading.fontSize))}
              </Text>
              <If when={h5Open() ? foregroundPkg(pages() ?? []) : null}>
                {(pkg) => <Text style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, color: token("muted-foreground"), ...TYPE.caption, fontFamily: "monospace", numberOfLines: 1 }}>{noBreak(pkg())}</Text>}
              </If>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.part }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: shownIsLive() && state() === "connected" ? token("success") : shown() ? avdTint(shown()!) : token("warning") }} />
              {/* 规格用不断行空格（noBreak）：按字截断，不在词边界整段断掉留出空白；「·」单独一个，末尾的空格不会被吃掉 */}
              <View style={{ flex: 1, minWidth: 0, flexDirection: "row" }}>
                <If when={subtitleSpec()}>
                  {(spec) => <>
                    <Text style={{ flexShrink: 1, color: token("muted-foreground"), ...TYPE.caption, numberOfLines: 1 }}>{noBreak(spec())}</Text>
                    <Text style={{ marginHorizontal: SPACE.part, color: token("muted-foreground"), ...TYPE.caption }}>·</Text>
                  </>}
                </If>
                <Text style={{ color: token("muted-foreground"), ...TYPE.caption, numberOfLines: 1 }}>{subtitleState()}</Text>
              </View>
            </View>
          </View>
          {/* 能缩：一行放不下时组折到下一行，不把“更多操作”挤出窗口 */}
          <Toolbar accessibilityLabel="设备操作" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: SPACE.item, flexShrink: 1, minWidth: 0 }}>
            <ZoomControl zoom={zoom()} onZoom={setZoom} />
            <ToolGroup label="画面">
              <If when={caps()?.rotate !== false}>
                <IconButton variant="toolbar" icon="rotateLeft" label="向左旋转" tip="点过屏幕后按 ⌘←" disabled={!shownIsLive()} why={liveWhy()} onPress={() => act(host.call("emu.rotate", { dir: "left" }))} />
                <IconButton variant="toolbar" icon="rotateRight" label="向右旋转" tip="点过屏幕后按 ⌘→" disabled={!shownIsLive()} why={liveWhy()} onPress={() => act(host.call("emu.rotate", { dir: "right" }))} />
              </If>
              <IconButton variant="toolbar" icon="camera" label="截图" tip="点过屏幕后按 ⌘S" disabled={!shownIsLive()} why={liveWhy()} onPress={() => act(host.call("emu.screenshot", {}))} />
            </ToolGroup>
            <ToolGroup label="硬件按键">
              <IconButton variant="toolbar" icon="power" label="电源" tip="点过屏幕后按 ⌘P" disabled={!!inputWhy()} why={inputWhy()} onPress={() => key("Power")} />
              <IconButton variant="toolbar" icon="volDown" label="音量−" tip="点过屏幕后按 ⌘-" disabled={!!inputWhy()} why={inputWhy()} onPress={() => key("AudioVolumeDown")} />
              <IconButton variant="toolbar" icon="volUp" label="音量+" tip="点过屏幕后按 ⌘=" disabled={!!inputWhy()} why={inputWhy()} onPress={() => key("AudioVolumeUp")} />
            </ToolGroup>
            <If when={h5Key() && shownIsLive()}>
              <ToolGroup label="H5 调试">
                <ToolToggle icon="code" label="H5 调试" tip="H5 调试" on={h5Open()} onChange={toggleH5} />
              </ToolGroup>
            </If>
            <If when={logcatOk() && device() !== ""}>
              <ToolGroup label="日志">
                <ToolToggle icon="logs" label="日志" tip="日志（logcat）" on={logOpen()} onChange={toggleLog} />
              </ToolGroup>
            </If>
            <ToolGroup label="更多操作">
              <Menu align="end" offset={SPACE.item} popupStyle={menuPopup("top right")} popupStartingStyle={popOut("above")} popupEndingStyle={popOut("above")}
                onOpenChange={releaseOnOpen} trigger={
                <IconButton variant="toolbar" icon="more" label="更多操作" />
              }>
                {/* 和把文件拖到画面上走同一条路（host 的 emu.pickFiles 打开选择文件框） */}
                <Item label="安装 APK 或发送文件…" disabled={!shownIsLive() || state() !== "connected"} onSelect={pickFiles} />
                <If when={caps()?.reboot !== false}>
                  <Item label={state() === "rebooting" ? "重启中…" : `${rebootLabel(kind() === "phone")}…`} disabled={!shownIsLive() || state() !== "connected"} onSelect={() => rebootAsk.set(true)} />
                </If>
                {/* 停止的是画面上这台（同原来的「关闭模拟器」）；别的在运行的设备从侧栏行的右键菜单或主区的按钮停。手机不能从页面停止 */}
                <If when={caps()?.stop !== false}>
                  <Item label={onScreen() && beingStopped(onScreen()!) ? "停止中…" : "停止设备…"}
                    disabled={!stoppable(onScreen())}
                    onSelect={() => { const a = onScreen(); if (a) openStop(a); }} />
                </If>
                <MenuLine />
                <Item label="重命名…" disabled={!shown() || beingDeleted(shown()!)} onSelect={() => { const a = shown(); if (a) openRename(a); }} />
                <Item label="删除…" danger disabled={!shown() || beingDeleted(shown()!)}
                  onSelect={() => { const a = shown(); if (a) openDelete(a); }} />
              </Menu>
            </ToolGroup>
          </Toolbar>
        </View>
        <View style={{ flex: 1, minHeight: 0, flexDirection: stacked() ? "column" : "row" }}>
        <View style={{ flex: 1, minWidth: stacked() ? 0 : DEVICE_MIN_W, minHeight: 0, position: "relative" }}>
          {/* 连不上和环境检查要用户处理：放在设备上方占位置，不盖住画面 */}
          <If when={PROBLEM[state()] || showSetup()}>
            <View style={{ alignItems: "center", gap: SPACE.item, paddingTop: SPACE.inset, paddingHorizontal: SPACE.group }}>
              <If when={PROBLEM[state()]}>
                {(text) => (
                  <View role="alert" style={{ gap: SPACE.item, backgroundColor: token("overlay"), borderRadius: token("radius-lg"), padding: SPACE.inset, borderWidth: 1, borderColor: problemColor(), maxWidth: 520 }}>
                    <Text style={{ color: problemColor(), ...TYPE.body, fontWeight: WEIGHT.strong }}>{text()}</Text>
                    <If when={state() === "no-gateway" ? upgrade() : null}>
                      {(cmd) => (
                        <View style={{ gap: SPACE.item }}>
                          <Text style={{ color: token("foreground"), ...TYPE.body }}>在终端运行下面的命令（第一次会自动安装，之后直接启动；它在后台运行，关闭终端也不影响），这个页面会自动连上。</Text>
                          <CopyCmd cmd={cmd()} />
                        </View>
                      )}
                    </If>
                    <If when={state() === "gateway-outdated" ? upgrade() : null}>{(cmd) => <CopyCmd cmd={cmd()} />}</If>
                  </View>
                )}
              </If>
              <If when={showSetup()}>
                {(e) => <SetupCard env={e()} installs={installs()} onInstall={(c) => confirm.set(c)} onCreate={openCreate} onDismiss={() => { animateNext(); setupDismissed.set(true); setupWanted.set(false); }}
                  sidebarShown={sidebarShown()} />}
              </If>
            </View>
          </If>
          <View style={{ flex: 1, minHeight: 0, alignItems: "center", gap: SPACE.inset, paddingTop: SPACE.section, paddingBottom: SPACE.group, paddingHorizontal: SPACE.group }}>
            <View onLayout={({ bounds }) => deviceArea.set({ width: bounds.size.width, height: bounds.size.height })}
              style={{ flex: 1, minHeight: 0, alignSelf: "stretch", alignItems: "center", justifyContent: "center", position: "relative" }}>
                {/* 键盘焦点在画面上时机身描一圈焦点环（画布自己不画焦点框）。只过渡颜色：transform 由 motion 逐帧写，再套过渡会把起点拉平，缩放、转向时机身先跳到新尺寸再弹回去 */}
                <View style={{ width: frame().width, height: frame().height, flexShrink: 0, padding: BEZEL - 1, borderRadius: 44, borderWidth: 1, borderColor: keyboardShown() ? token("ring") : token("border-strong"), backgroundColor: token("device-bezel"),
                  boxShadow: keyboardShown() ? [{ x: 0, y: 0, blur: 0, spread: 2, color: token("ring") }] : [], transform: motion.transform, pointerEvents: turning() ? "none" : "auto", ...ease("fast", "colors") }}>
                  <View testID="screen" style={{ flex: 1, minHeight: 0, position: "relative", borderRadius: 34, overflow: "hidden" }} />
                  {/* 连上了但第一帧还没到（真机、MuMu 刚开机时要好几秒）：黑屏上说明在等，不挡点按 */}
                  <If when={state() === "connected" && shownIsLive() && !painted()}>
                    {/* 有底色：直接换设备时画布上还留着上一台的最后一帧 */}
                    <View role="status" style={{ position: "absolute", top: BEZEL - 1, left: BEZEL - 1, right: BEZEL - 1, bottom: BEZEL - 1, pointerEvents: "none", alignItems: "center", justifyContent: "center", padding: SPACE.section, borderRadius: 34, backgroundColor: token("device-bezel") }}>
                      <Text style={{ color: token("muted-foreground"), ...TYPE.body, textAlign: "center" }}>正在等待画面…</Text>
                    </View>
                  </If>
                  <If when={drag().active}>
                    <View role="summary" style={{
                      position: "absolute", top: BEZEL - 1, left: BEZEL - 1, right: BEZEL - 1, bottom: BEZEL - 1, pointerEvents: "none",
                      alignItems: "center", justifyContent: "center", gap: SPACE.item, padding: SPACE.section, borderRadius: 34, borderWidth: 2,
                      borderColor: drag().blocked ? token("destructive") : token("primary"), backgroundColor: token("drag-shade"),
                    }}>
                      <Text style={{ color: drag().blocked ? token("destructive") : token("foreground"), ...TYPE.title, textAlign: "center" }}>
                        {drag().blocked ? `不能发送：${drag().blocked}` : `松开以发送到 ${currentAvd() ? avdLabel(currentAvd()!) : currentPhone() ? phoneTitle(currentPhone()!, mumu()) : "这台设备"}`}
                      </Text>
                      <If when={!drag().blocked}>
                        <Text style={{ color: token("muted-foreground"), ...TYPE.caption, textAlign: "center" }}>APK 会直接安装，其他文件放进「下载」文件夹</Text>
                      </If>
                    </View>
                  </If>
                </View>
              {/* 选中的不是画面上这台（没在运行、正在启动、正在切换）：盖住画面，说明它的状态 */}
              <If when={!shownIsLive()}>
                <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", gap: SPACE.item, padding: SPACE.section, backgroundColor: token("background") }}>
                  <Icon name="smartphone" size={ICON.hero} tint={shown() ? avdTint(shown()!) : token("muted-foreground")} />
                  <Text style={{ color: token("foreground"), ...TYPE.title, textAlign: "center" }}>{shown() ? avdLabel(shown()!) : gatewayDown(state()) ? "未连接网关" : "没有连接设备"}</Text>
                  <Text style={{ maxWidth: 360, color: token("muted-foreground"), ...TYPE.body, textAlign: "center" }}>{emptyText()}</Text>
                  {/* 没连着网关时列表是旧的，这些按钮点了必然失败，不给 */}
                  <If when={!gatewayDown(state())}>
                    <If when={shown()?.running === "grpc"}>
                      <View style={{ flexDirection: "row", gap: SPACE.item }}>
                        <Btn label={pendingText(shown()!, "use") ?? "切换到这台"} kind="primary" disabled={!!pending()} onPress={() => { const a = shown(); if (a) switchTo(a); }} />
                        <Btn label={beingStopped(shown()!) ? "停止中…" : "停止设备…"} disabled={!stoppable(shown()) || !!pending()} onPress={() => { const a = shown(); if (a) openStop(a); }} />
                      </View>
                    </If>
                    <If when={shown() && canStart(shown()!)}>
                      <Btn label={pendingText(shown()!, "start") ?? "启动"} kind="primary" disabled={!!pending()} onPress={() => { const a = shown(); if (a) begin(a.name, "start"); }} />
                    </If>
                    <If when={!shown() && (avds() ?? []).length === 0 && avds() !== null}>
                      <Btn label="创建设备…" kind="primary" disabled={!!createWhy()} why={createWhy()} onPress={openCreate} />
                    </If>
                  </If>
                </View>
              </If>
            </View>
            <Toolbar accessibilityLabel="系统导航" style={groupStyle()}>
              <IconButton variant="toolbar" icon="back" label="返回" tip="点过屏幕后按 ⌘⌫" disabled={!!inputWhy()} why={inputWhy()} onPress={() => key("GoBack")} />
              <IconButton variant="toolbar" icon="home" label="主页" tip="点过屏幕后按 ⇧⌘H" disabled={!!inputWhy()} why={inputWhy()} onPress={() => key("GoHome")} />
              <IconButton variant="toolbar" icon="recents" label="最近" tip="点过屏幕后按 ⌘O" disabled={!!inputWhy()} why={inputWhy()} onPress={() => key("AppSwitch")} />
            </Toolbar>
            {/* 一直占着一行，焦点进出时画面不跳 */}
            <Text role="summary" style={{ ...TYPE.caption, color: keyboardShown() ? token("foreground") : token("muted-foreground"), textAlign: "center", minHeight: TYPE.caption.lineHeight }}>
              {keyboardShown() ? "已接管键盘 · Shift+Tab 离开" : shownIsLive() && caps()?.input !== false ? "点屏幕用键盘输入 · 也可以把 APK 或文件拖到画面上" : ""}
            </Text>
          </View>
          {/* 画面上方的提示同一时间只显示一条（ui/banners.ts 的先后），盖住的地方少；后面排着几条写在能关掉的那条里。
              传文件的进度单独一张卡片放在下面，一直看得见 */}
          <View style={{ position: "absolute", top: SPACE.item, left: 0, right: 0, alignItems: "center", gap: SPACE.item, pointerEvents: "box-none" }}>
            <If when={banner().shown}>
              {(k) => (
                <View style={{ ...bannerCard(), borderColor: bannerBorder(k()) }}>
                  <If when={k() === "gateway" ? gatewayShown() : null}>
                    {(b) => (
                      <View role="summary" style={{ gap: SPACE.item }}>
                        <Text style={{ color: b().kind === "manual" ? token("warning") : token("foreground"), ...TYPE.body }}>{b().text}</Text>
                        <If when={b().command}>{(cmd) => <CopyCmd cmd={cmd()} />}</If>
                        <If when={b().kind === "manual"}>
                          <View style={{ flexDirection: "row" }}>
                            <Btn label="关闭" onPress={() => gatewayDismissed.set(b().text)} />
                          </View>
                        </If>
                      </View>
                    )}
                  </If>
                  <If when={k() === "clip"}>
                    <View role="summary" style={{ flexDirection: "row", alignItems: "center", gap: SPACE.item }}>
                      <Text style={{ color: copyFailed() ? token("destructive") : token("foreground"), ...TYPE.body }}>
                        {copyFailed() ? "复制失败，请再点一次。" : `${kind() === "phone" ? "手机" : "模拟器"}里复制了新内容`}
                      </Text>
                      <Btn label="复制到电脑" onPress={copyClip} />
                      <Btn label="关闭" onPress={() => clip.set(null)} />
                    </View>
                  </If>
                  <If when={k() === "adb"}>
                    <AdbStuck onReboot={() => rebootAsk.set(true)} phone={kind() === "phone"} />
                    <View style={{ flexDirection: "row" }}>
                      <Btn label="关闭" onPress={() => adbStuck.set(false)} />
                    </View>
                  </If>
                  <If when={k() === "error" || k() === "info" ? notice() : null}>
                    {(n) => (
                      <View role={n().error ? "alert" : "summary"} style={{ gap: SPACE.item }}>
                        <Text style={{ color: n().error ? token("destructive") : token("foreground"), ...TYPE.body, userSelect: noticeTimeoutMs(n()) === null ? "text" : undefined }}>{n().text}</Text>
                        <If when={noticeTimeoutMs(n()) === null}>
                          <View style={{ flexDirection: "row" }}>
                            <Btn label="关闭" onPress={() => notices.set(dropNotice(notices(), n()))} />
                          </View>
                        </If>
                      </View>
                    )}
                  </If>
                  <If when={waitingShown(banner(), gatewayManual())}>
                    <Text style={{ color: token("muted-foreground"), ...TYPE.caption }}>{`关掉这条后还有 ${banner().waiting} 条提示`}</Text>
                  </If>
                </View>
              )}
            </If>
            <If when={uploads().length > 0}>
              <View style={{ ...bannerCard(), borderColor: token("border"), width: 420 }}>
                {/* 进度一直在变，不放在实时播报区里；读屏只听开始和传完（summary） */}
                <View accessibilityLabel="发送文件" style={{ gap: SPACE.item }}>
                  <Text role="summary" style={{ color: token("foreground"), ...TYPE.body, fontWeight: WEIGHT.strong }}>
                    {uploads().every(uploadEnded) ? "发送完了" : `正在发送 ${uploads().filter((u) => !uploadEnded(u)).length} 个文件…`}
                  </Text>
                  <Each of={uploads()} key={(u) => u.id}>
                    {(u) => (
                      <View style={{ gap: SPACE.hair }}>
                        <Text style={{ color: token("foreground"), ...TYPE.body, numberOfLines: 1 }}>{noBreak(u().name)}</Text>
                        <Text style={{ color: u().state === "failed" ? token("destructive") : u().state === "done" ? token("success") : token("muted-foreground"), ...TYPE.caption, userSelect: "text" }}>
                          {uploadText(u())}
                        </Text>
                      </View>
                    )}
                  </Each>
                  <If when={uploads().every(uploadEnded)}>
                    <View style={{ flexDirection: "row" }}>
                      <Btn label="关闭" onPress={() => host.call("emu.uploadsClear", {})} />
                    </View>
                  </If>
                </View>
              </View>
            </If>
          </View>
        </View>
        <If when={h5Open() || logOpen()}>
          <View style={{ flex: 1.2, minWidth: stacked() ? 0 : PANEL_MIN_W, minHeight: 0, borderColor: token("border-subtle"), borderLeftWidth: stacked() ? 0 : 1, borderTopWidth: stacked() ? 1 : 0 }}>
            <If when={h5Open() && logOpen()}>
              {/* 选中的标签用 foreground 的下划线（中性色，见颜色的说明），下划线压在标签栏的底边上 */}
              <Tabs style={{ flexDirection: "row", gap: SPACE.part, paddingHorizontal: SPACE.inset, paddingTop: SPACE.item, borderBottomWidth: 1, borderColor: token("border-subtle") }}
                indicatorStyle={{ bottom: 0, height: 2, backgroundColor: token("foreground") }}>
                {(["h5", "log"] as const).map((t) => (
                  <Tab selected={sideTab() === t} onPress={() => sideTab.set(t)} accessibilityLabel={t === "h5" ? "H5 调试" : "日志"}
                    hoverStyle={{ backgroundColor: token("accent") }} focusStyle={{ backgroundColor: token("accent") }}
                    style={{ height: CONTROL.sm, justifyContent: "center", paddingHorizontal: SPACE.inset, borderTopLeftRadius: token("radius-sm"), borderTopRightRadius: token("radius-sm"), ...ease() }}>
                    <Text style={{ color: sideTab() === t ? token("foreground") : token("muted-foreground"), ...TYPE.body, fontWeight: WEIGHT.medium }}>{t === "h5" ? "H5 调试" : "日志"}</Text>
                  </Tab>
                ))}
              </Tabs>
            </If>
            <If when={h5Open()}>
              <View accessibilityElementsHidden={logOpen() && sideTab() === "log"} style={{ flex: 1, minHeight: 0, ...panelShown(!(logOpen() && sideTab() === "log")) }}>
                <H5Console pages={pages} listError={listError} refresh={refresh} inspected={inspected} onReboot={() => rebootAsk.set(true)}
                  onInspect={(key, title) => inspected.set({ key, title, device: deviceId() })} onClose={toggleH5} onCopy={copyHref} picking={picking}
                  phone={() => kind() === "phone"} />
              </View>
            </If>
            <If when={logOpen()}>
              <View accessibilityElementsHidden={h5Open() && sideTab() === "h5"} style={{ flex: 1, minHeight: 0, ...panelShown(!(h5Open() && sideTab() === "h5")) }}>
                <LogPanel device={deviceId} live={() => state() === "connected"} onClose={toggleLog} sink={(fn) => (logSink = fn)} />
              </View>
            </If>
          </View>
        </If>
        </View>
      </View>
      <AppDialog open={confirm() !== null} size="sm" onClose={() => confirm.set(null)}>
        <If when={confirm()}>
          {(c) => {
            // 确认框列出的项和磁盘检查用的项：安装取环境检查里的缺失项，建设备取 createItems（和网关同一套）
            const items = (): Array<{ id: string; pkg?: string; sizeMb?: number; diskMb?: number }> => {
              const x = c();
              if (x.kind === "avd") return createItems(x.avd.image);
              return x.ids.map((id) => env()?.missing.find((m) => m.id === id) ?? { id });
            };
            const space = () => spaceCheck(items(), env() ?? { freeMb: 0, avdFreeMb: 0, sameDisk: true });
            const avd = () => { const x = c(); return x.kind === "avd" ? x.avd : null; };
            const downloads = () => items().some((i) => i.id === "emulator" || i.id === "platform-tools" || i.id === "system-image");
            const hasAvd = () => items().some((i) => i.id === "avd");
            return (
              <DialogContent title={avd() ? `创建设备 ${avd()!.name}？` : `下载并安装 ${items().length} 项？`} footer={<>
                <Btn label="取消" onPress={() => confirm.set(null)} />
                <Btn label={avd() ? (avd()!.image.installed ? "创建" : "下载并创建") : "下载并安装"} kind="primary" disabled={space().shortMb > 0} onPress={startInstall} />
              </>}>
                <If when={avd()} else={
                  <View>
                    <Each of={items()} key={(i) => i.id}>
                      {(i) => <Text style={{ color: token("foreground"), ...TYPE.body }}>{`· ${envName(i().id)}${i().pkg ? `（${i().pkg}）` : ""}${i().sizeMb ? `，${sizeText(i().sizeMb!)}` : ""}`}</Text>}
                    </Each>
                  </View>
                }>
                  {(a) => (
                    <View>
                      <Text style={{ color: token("foreground"), ...TYPE.body }}>
                        {`机型 ${a().device.name} · ${imageLabel(a().image)} · 内存 ${ramMbFor(a().image.apiLevel)} MB`}
                      </Text>
                      <If when={!a().image.installed}>
                        <Text style={{ color: token("foreground"), ...TYPE.body }}>
                          {`要先下载系统镜像（${a().image.pkg}），${sizeText(a().image.sizeMb ?? 0)}，装到 ${env()?.sdkRoot ?? ""}`}
                        </Text>
                      </If>
                    </View>
                  )}
                </If>
                <Text style={{ color: token("foreground"), ...TYPE.body }}>
                  {`${space().downloadMb ? `下载${sizeText(space().downloadMb)}，` : ""}安装后${sizeText(space().diskMb).replace("约", "约占")}，${env()?.sdkRoot ?? ""} 所在磁盘剩余 ${gbText(env()?.freeMb ?? 0)}`}
                </Text>
                <If when={hasAvd() && env() && !env()!.sameDisk}>
                  <Text style={{ color: token("foreground"), ...TYPE.body }}>{`${env()?.avdHome ?? ""} 所在磁盘剩余 ${gbText(env()?.avdFreeMb ?? 0)}`}</Text>
                </If>
                <If when={space().shortMb > 0}>
                  <Text role="alert" style={{ color: token("destructive"), ...TYPE.body, fontWeight: WEIGHT.strong }}>{`磁盘空间不足：还需要约 ${gbText(space().shortMb)}`}</Text>
                </If>
                <If when={hasAvd()}>
                  <Text style={{ color: token("muted-foreground"), ...TYPE.caption, userSelect: "text" }}>{`设备建在 ${env()?.avdHome ?? ""}，第一次启动时要约 ${gbText(AVD_DISK_MB)} 空闲空间`}</Text>
                </If>
                <If when={downloads()}>
                  <Text style={{ color: token("muted-foreground"), ...TYPE.caption }}>
                    {"从 Google 的 SDK 仓库（dl.google.com）直接下载，校验 sha1 后再解压。下载前会显示 Google 的许可证，你同意后才会继续。"}
                  </Text>
                </If>
              </DialogContent>
            );
          }}
        </If>
      </AppDialog>
      <AppDialog open={createOpen()} size="lg" onClose={() => createOpen.set(false)}>
        <If when={createOpen()}>
          <CreateAvd catalog={catalog()} loadError={catalogError()} onCancel={() => createOpen.set(false)}
            onNext={(a) => {
              createOpen.set(false);
              confirm.set({ kind: "avd", avd: a });
            }} />
        </If>
      </AppDialog>
      <AppDialog open={license() !== null} size="lg">
        <DialogContent title={`同意许可证 ${license()?.name ?? ""} 后继续安装`} scroll={false}
          description="下面是 Google 的 SDK 仓库清单里这份许可证的全文。同意后会记在 SDK 的 licenses 目录里，Android Studio 也认；不同意的话，这一项不会安装。"
          footer={<>
            {/* 不同意没有损失（只是这一项不装），要提交的是同意，所以同意是主操作 */}
            <Btn label="不同意" disabled={answered() === license()?.id} onPress={() => answer("emu.rejectLicenses")} />
            <Btn label="同意" kind="primary" disabled={answered() === license()?.id} onPress={() => answer("emu.acceptLicenses")} />
          </>}>
          {/* 平时 420 高；窗口矮时跟着对话框缩，按钮一直看得见（Esc 和点背景关不掉这个框） */}
          <Scroll style={{ height: 420, flexShrink: 1, minHeight: 0, borderRadius: token("radius-lg"), borderWidth: 1, borderColor: token("border"), backgroundColor: token("field") }} contentStyle={{ padding: SPACE.inset }}>
            <Text style={{ color: token("foreground"), ...TYPE.caption, fontFamily: "monospace", userSelect: "text" }}>{license()?.text ?? ""}</Text>
          </Scroll>
        </DialogContent>
      </AppDialog>
      <AppDialog open={renameTarget() !== null} size="sm" onClose={() => renameTarget.set(null)}>
        <If when={renameTarget()}>
          {(a) => (
            <DialogContent title="重命名设备" description={`只改显示名称，Android Studio 里也会看到；设备 ID ${a().name} 不变。`} footer={<>
              <Btn label="取消" onPress={() => renameTarget.set(null)} />
              <Btn label={renaming() ? "保存中…" : "保存"} kind="primary" disabled={renaming()} onPress={saveRename} />
            </>}>
              <FieldBox error={!!renameError()}>
                <Input value={renameDraft()} onChange={({ value }) => { renameDraft.set(value); renameError.set(null); }} onSubmit={saveRename}
                  autoFocus accessibilityLabel="显示名称" autoCorrect={false} style={fieldText()} />
              </FieldBox>
              <If when={renameError()}>{(e) => <Text role="alert" style={{ color: token("destructive"), ...TYPE.caption }}>{e()}</Text>}</If>
            </DialogContent>
          )}
        </If>
      </AppDialog>
      <AppDialog open={deleteTarget() !== null} size="sm" onClose={() => { if (!deleting()) deleteTarget.set(null); }}>
        <If when={deleteTarget()}>
          {(a) => (
            <DialogContent title={`删除设备 ${avdLabel(a())}？`} footer={<>
              <Btn label="取消" disabled={deleting()} onPress={() => deleteTarget.set(null)} />
              <Btn label={deleting() ? "删除中…" : "删除"} kind="danger" disabled={deleting()} onPress={confirmDelete} />
            </>}>
              <Text style={{ color: token("foreground"), ...TYPE.body }}>会删除这台设备的全部数据（已装的 App、文件、快照），不能恢复。系统镜像不会删除。</Text>
              <If when={live(a())}>
                <Text style={{ color: token("warning"), ...TYPE.body }}>这台设备正在运行，删除前会先停止它。</Text>
              </If>
              <If when={deleteError()}>{(e) => <Text role="alert" style={{ color: token("destructive"), ...TYPE.caption, userSelect: "text" }}>{e()}</Text>}</If>
            </DialogContent>
          )}
        </If>
      </AppDialog>
      <AppDialog open={mumuCloseAsk() !== null} size="sm" onClose={() => mumuCloseAsk.set(null)}>
        <If when={mumuCloseAsk()}>
          {(m) => (
            <DialogContent title={`关掉 MuMu 模拟器「${m().name}」？`} footer={<>
              <Btn label="取消" onPress={() => mumuCloseAsk.set(null)} />
              <Btn label="关机" kind="danger" onPress={() => { gw(host.call("emu.mumuClose", { index: m().index })); mumuCloseAsk.set(null); }} />
            </>}>
              <Text style={{ color: token("foreground"), ...TYPE.body }}>正在运行的 App 和未保存的内容会丢失。之后可以在这里再启动。</Text>
            </DialogContent>
          )}
        </If>
      </AppDialog>
      <AppDialog open={stop().ask !== null} size="sm" onClose={() => stopEvent({ kind: "cancel" })}>
        <If when={stop().ask}>
          {(a) => (
            <DialogContent title={`停止设备 ${a().label}？`} footer={<>
              <Btn label="取消" disabled={isStopping(stop(), a().name)} onPress={() => stopEvent({ kind: "cancel" })} />
              <Btn label={isStopping(stop(), a().name) ? "停止中…" : "停止"} kind="danger" disabled={isStopping(stop(), a().name)} onPress={() => stopEvent({ kind: "confirm" })} />
            </>}>
              <Text style={{ color: token("foreground"), ...TYPE.body }}>正在运行的 App 和未保存的内容会丢失。设备的数据还在，之后可以再启动。</Text>
              <If when={stop().error}>{(e) => <Text role="alert" style={{ color: token("destructive"), ...TYPE.caption, userSelect: "text" }}>{e()}</Text>}</If>
            </DialogContent>
          )}
        </If>
      </AppDialog>
      <AppDialog open={rebootAsk()} size="sm" onClose={() => rebootAsk.set(false)}>
        <DialogContent title={`${rebootLabel(kind() === "phone")}？`} footer={<>
          <Btn label="取消" onPress={() => rebootAsk.set(false)} />
          <Btn label="重启" kind="danger" onPress={reboot} />
        </>}>
          <Text style={{ color: token("foreground"), ...TYPE.body }}>{kind() === "phone" ? "手机会重启，正在运行的 App 和未保存的内容会丢失。开机后自动重新连接，大约 1 分钟。" : "正在运行的 App 和未保存的内容会丢失，约 30 秒后恢复。"}</Text>
        </DialogContent>
      </AppDialog>
    </View>
  );
}

mount(App);
