import { cleanup, colorScheme, effect, host, Image, type JSX, keymap, LayoutAnimation, List, type ListRef, mount, openUrl, reduceMotion, Scroll, setColorScheme, signal, Text, View } from "nsh";
import { Button, ContextMenu, Dialog, Input, Menu, MenuItem, MenuSeparator, Radio, RadioGroup, Select, Toggle, Toolbar, ToolbarGroup, Tooltip } from "nsh/base";
import { middleEllipsis } from "./ellipsis";
import { isStaleStatus } from "./status-rev";
import { gbText, spaceCheck } from "../shared/disk-space";
import { AVD_DISK_MB, avdNameError, createItems, defaultAvdName, displayNameError, ramMbFor } from "../shared/avd-spec";
import { ADB_UNRESPONSIVE, OFFICIAL_ORIGIN, type DeviceCaps, type PhoneInfo, type Rotation } from "../shared/protocol";
import { parseTheme, type Theme } from "../shared/theme";
import { deviceFrame } from "../shared/screen";
import { parseZoom, stepZoom, ZOOM_STEPS } from "../shared/zoom";
import { matchesAvd } from "./device-search";
import { canPick, currentPhoneOf, phoneDetail, phoneLabel, phoneStatus, showPhones } from "./phones";
import { h5PollMs } from "./h5-poll";
import { shouldCloseConsole, type ConsoleEvent } from "./console-gone";
import { activePage, foregroundPkg, h5KeyShown, pickPage } from "./h5-pages";
import { AUTO_START, autoOpen } from "./console-auto";
import { addressEdit, addressShown, addressSubmit, type AddressDraft } from "./address-field";
import { setupCardShown } from "./setup-card";
import { deviceLive } from "./avd-delete";
import { applyBatch, levelColor, type LogRow } from "./log-store";
import type { LogFilter, LogLevel, LogLine } from "../shared/logcat";

type State =
  | "connecting" | "connected" | "no-emulator" | "emulator-closed" | "phone-closed" | "booting" | "rebooting" | "disconnected"
  | "gateway-outdated" | "page-outdated"
  | "unsupported-browser" | "lna-denied" | "lna-prompt" | "bad-origin" | "no-gateway" | "refused";
type Avd = { name: string; displayName?: string; width?: number; height?: number; apiLevel?: number; running: "no" | "grpc" | "no-grpc"; serial?: number };
type Boot = { name: string; progress: string; error?: string; seconds: number };
/** sticky：不自动消失，文字可选中复制，带关闭按钮。 */
type Notice = { text: string; error?: boolean; sticky?: boolean };
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

// shadcn/ui 设计系统（Zinc 灰阶 + 品牌紫），紫色只给选中状态和主操作
const DARK = {
  bg: "#09090b",
  surface: "#111113",
  panel: "#18181b",
  hover: "#27272a",
  lineSoft: "#1f1f23",
  line: "#27272a",
  lineStrong: "#3f3f46",
  text: "#fafafa",
  keyText: "#d4d4d8",
  muted: "#a1a1aa",
  warn: "#fbbf24",
  danger: "#f87171",
  ok: "#4ade80",
  accent: "#7544f2",
  accentSoft: "rgba(139,102,246,0.16)",
  accentText: "#c4b2fb",
  // 紫底上的文字
  onAccent: "#fafafa",
  overlay: "#18181bf2",
  // 没在运行的设备前面的圆点
  idle: "#52525b",
  primaryHover: "#6435e0",
  // 拖文件到设备上时盖在画面上的底色
  dragShade: "rgba(9,9,11,0.82)",
};
const LIGHT: typeof DARK = {
  bg: "#f4f4f5",
  surface: "#ffffff",
  panel: "#fafafa",
  hover: "#e4e4e7",
  lineSoft: "#e4e4e7",
  line: "#e4e4e7",
  lineStrong: "#d4d4d8",
  text: "#09090b",
  keyText: "#3f3f46",
  muted: "#71717a",
  warn: "#b45309",
  danger: "#dc2626",
  ok: "#16a34a",
  accent: "#7544f2",
  accentSoft: "rgba(117,68,242,0.12)",
  accentText: "#5b2fd6",
  onAccent: "#fafafa",
  overlay: "#fffffff2",
  idle: "#a1a1aa",
  primaryHover: "#6435e0",
  dragShade: "rgba(250,250,250,0.85)",
};
// 外观换了颜色跟着换：每次读 C.x 都按当前外观取，读的地方都在 JSX 表达式里，会重新求值
const C = new Proxy(DARK, { get: (_, key: keyof typeof DARK) => (colorScheme() === "light" ? LIGHT : DARK)[key] });

const LABEL: Record<State, string> = {
  connecting: "连接中…",
  connected: "已连接",
  "no-emulator": "没有运行中的模拟器",
  "emulator-closed": "模拟器已关闭",
  "phone-closed": "手机已断开",
  booting: "启动中",
  rebooting: "重启中…",
  disconnected: "与网关断开，正在重连…",
  "gateway-outdated": "网关版本过旧",
  "page-outdated": "页面版本过旧，请强制刷新",
  "unsupported-browser": "不支持这个浏览器",
  "lna-denied": "无法访问本机",
  "lna-prompt": "等待允许访问本机",
  "bad-origin": "来源未被允许",
  "no-gateway": "还没连上本机的 Droidpier",
  refused: "网关没有接受这个浏览器的连接",
};

// 连不上时画面上方的说明；带命令的两种（gateway-outdated、no-gateway）命令由 host 在 upgrade 里给
const PROBLEM: Partial<Record<State, string>> = {
  "phone-closed": "重新插上手机后会自动恢复",
  "gateway-outdated": "网关版本过旧，请运行：",
  "page-outdated": "页面版本过旧，请强制刷新",
  "unsupported-browser": "请用 Chrome 或 Edge 打开",
  "lna-denied": "Chrome 阻止了访问本机：请到 设置 → 隐私和安全 → 网站设置 中允许本站访问本地网络，然后刷新",
  "lna-prompt": "Chrome 正在询问是否允许本站访问本机：请在地址栏旁的权限框里点「允许」",
  // 网关在升级时就拒绝了，页面问不到它信任哪个来源
  "bad-origin": "这个页面地址不在网关允许的来源里：请打开你安装 droidpier 的那个网站上的 /app/",
  // 页面看不出装没装 droidpier；同一条命令没装时先装、装了直接启动
  "no-gateway": "还没连上本机的 Droidpier",
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
  download: "下载中",
  unpack: "解压中",
  license: "等你同意许可证",
  install: "安装中",
  done: "完成",
  failed: "失败",
};
const uploadText = (u: Upload) => {
  if (u.state === "waiting") return "等待中";
  if (u.state === "uploading") return `上传 ${u.size ? Math.floor((u.received / u.size) * 100) : 100}%`;
  if (u.state === "installing") return "安装中…";
  if (u.state === "pushing") return "放进下载文件夹…";
  if (u.state === "done") return u.kind === "apk" ? "已安装" : "已放到 下载 文件夹";
  return `失败：${u.error ?? "未知原因"}`;
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
const ease = (ms = 150) =>
  reduceMotion() ? {} : ({ transitionProperty: "colors, opacity, transform", transitionDuration: ms, transitionTimingFunction: "ease-out" } as const);
/** 按下时轻微缩小（activeStyle 用）。 */
const pressed = (scale: number) => (reduceMotion() ? {} : { transform: [{ scale }] });
/** 弹出层（菜单、提示）出现前和消失后的样子：透明、往 dy 方向偏一点；配合 ease() 淡入淡出。 */
const popOut = (dy: number) => (reduceMotion() ? {} : { opacity: 0, transform: [{ translateY: dy }, { scale: 0.98 }] });
/**
 * 下一次界面变化里新出现的视图淡入、其余挪位置的滑过去；在改状态之前调用。
 * 不给 delete 阶段：nsh 网页端做完 delete 的淡出后不移除视图，透明的旧视图留在原处占位置、挡点击（2026-11-13 实测，侧栏收起后宽 264、opacity 0）。
 */
const LAYOUT_EASE = { duration: 200, create: { type: "easeInEaseOut", property: "opacity" }, update: { type: "easeInEaseOut" } } as const;
const animateNext = () => {
  if (!reduceMotion()) LayoutAnimation.configureNext(LAYOUT_EASE);
};

// 机身边框：内边距 + 1 像素描边
const BEZEL = 11;
const H5_EMPTY = "没有可审查的 H5。只有 debug 包或开启了 WebView 调试的 App 才能审查；先在 App 里打开一个 H5 页面。";
// 下拉框里没有标题的页面，地址大约放得下的字符数
const URL_CHARS = 28;
const pageKey = (p: Page) => `${p.socket}/${p.id}`;
const call = <T,>(name: string, args: object) => host.call(name, args) as Promise<unknown> as Promise<T>;

/** 设备在页面上叫什么：有显示名用显示名，没有用 id。 */
const avdLabel = (a: Avd) => a.displayName ?? a.name;
const isBooting = (b: Boot | undefined) => !!b && (b.progress === "spawning" || b.progress === "booting");

/** 文字按钮：默认是次要按钮；primary 是一屏一个的主操作（紫），danger 是破坏性操作。 */
function Btn(props: { label: string; onPress: () => void; kind?: "danger" | "primary"; disabled?: boolean }) {
  const primary = () => props.kind === "primary";
  return (
    <View onPress={props.onPress} role="button" accessibilityLabel={props.label} disabled={props.disabled}
      hoverStyle={{ backgroundColor: primary() ? C.primaryHover : C.hover }} focusStyle={{ borderColor: C.muted }} activeStyle={pressed(0.97)}
      style={{
        height: 32, justifyContent: "center", backgroundColor: primary() ? C.accent : C.panel, borderRadius: 8, paddingHorizontal: 12,
        borderWidth: 1, borderColor: primary() ? C.accent : C.line, opacity: props.disabled ? 0.4 : 1, ...ease(),
      }}>
      <Text style={{ color: props.kind === "danger" ? C.danger : primary() ? C.onAccent : C.text, fontSize: 13, fontWeight: primary() ? "600" : "500" }}>{props.label}</Text>
    </View>
  );
}

/** adb 没有响应时的说明和就地的“重启模拟器”按钮（按钮先弹确认框）。 */
function AdbStuck(props: { onReboot: () => void }) {
  return (
    <View role="alert" style={{ gap: 6 }}>
      <Text style={{ color: C.danger, fontSize: 12, lineHeight: 18 }}>{ADB_UNRESPONSIVE}</Text>
      <View style={{ flexDirection: "row" }}>
        <Btn label="重启模拟器" onPress={props.onReboot} />
      </View>
    </View>
  );
}

/** 一行结果或报错；adb 无响应时换成带重启按钮的说明。 */
function MsgLine(props: { msg: Msg; onReboot: () => void }) {
  return (
    <If when={!props.msg.adbStuck} else={<AdbStuck onReboot={props.onReboot} />}>
      <Text role={props.msg.error ? "alert" : "text"} style={{ color: props.msg.error ? C.danger : C.ok, fontSize: 12, lineHeight: 18 }}>{props.msg.text}</Text>
    </If>
  );
}

const LOG_LEVELS: Array<{ value: LogLevel; title: string }> = [
  { value: "V", title: "全部级别" },
  { value: "D", title: "调试及以上" },
  { value: "I", title: "信息及以上" },
  { value: "W", title: "警告及以上" },
  { value: "E", title: "错误及以上" },
  { value: "F", title: "只看严重" },
];
const ALL_APPS = "\u0000all";
/** 日志一行的高度：固定行高、一行显示不下就截断。换行的话虚拟列表按估计高度摆放，测出实际高度前行会叠在一起（2026-11-16 实测）。 */
const LOG_ROW_H = 17;

/** 一行日志：时间、pid-tid、级别、tag: 内容；级别和 tag 按级别上色。 */
function LogRowView(props: { row: () => LogRow }) {
  return (
    <If when={!("skipped" in props.row())} else={
      <Text style={{ height: LOG_ROW_H, paddingHorizontal: 10, color: C.muted, fontSize: 11, lineHeight: LOG_ROW_H, fontStyle: "italic", numberOfLines: 1 }}>{`省略了 ${(props.row() as { skipped: number }).skipped} 行（页面跟不上）`}</Text>
    }>
      {(() => {
        const l = () => props.row() as LogLine;
        const color = () => C[levelColor(l().level)];
        const cell = { fontSize: 11, lineHeight: LOG_ROW_H, fontFamily: "monospace", numberOfLines: 1 } as const;
        return (
          <View style={{ height: LOG_ROW_H, flexDirection: "row", gap: 6, paddingHorizontal: 10 }}>
            <Text style={{ ...cell, flexShrink: 0, color: C.muted }}>{`${l().time.slice(6)} ${l().pid}`}</Text>
            <Text style={{ ...cell, flexShrink: 0, maxWidth: "35%", color: color(), fontWeight: "600" }}>{`${l().level} ${l().tag}`}</Text>
            <Text style={{ ...cell, flex: 1, minWidth: 0, color: l().level === "E" || l().level === "F" ? C.danger : C.text }}>{l().msg}</Text>
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
  let list: ListRef | undefined;
  const filter = (): LogFilter => ({ pkg: pkg(), level: level(), text: text() });

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
      void host.call("emu.logcatOpen", { filter: filter() });
    });
  });
  const refilter = () => void host.call("emu.logcatFilter", { filter: filter() });
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
  const selectStyle = { popupStyle: { backgroundColor: C.panel, borderRadius: 8, borderWidth: 1, borderColor: C.line, padding: 4, minWidth: 220, maxHeight: 360 } };
  const trigger = (label: () => string, width: number) => (
    <View style={{ width, height: 30, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.bg }}
      hoverStyle={{ borderColor: C.lineStrong }} focusStyle={{ borderColor: C.muted }}>
      <Text style={{ flex: 1, color: C.text, fontSize: 12, numberOfLines: 1 }}>{label()}</Text>
      <Icon name="chevron" size={14} tint={C.muted} />
    </View>
  );
  const renderItem = (item: { title: string }) => (
    <View style={{ height: 28, justifyContent: "center", paddingHorizontal: 8, borderRadius: 6 }} hoverStyle={{ backgroundColor: C.hover }}>
      <Text style={{ color: C.text, fontSize: 12, numberOfLines: 1 }}>{item.title}</Text>
    </View>
  );

  return (
    <View role="region" accessibilityLabel="日志" style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
      <View role="toolbar" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 10, borderBottomWidth: 1, borderColor: C.lineSoft }}>
        <Select items={appItems()} value={pkg() ?? ALL_APPS} accessibilityLabel="按 App 过滤" {...selectStyle} renderItem={renderItem}
          searchable searchPlaceholder="搜包名" searchAccessibilityLabel="搜包名"
          onOpenChange={({ open }) => { if (open) void loadApps(); }}
          onChange={({ value }) => { pkg.set(value === ALL_APPS ? null : value); refilter(); }}
          trigger={trigger(() => pkg() ?? "全部 App", 190)} />
        <Select items={LOG_LEVELS} value={level()} accessibilityLabel="最低级别" {...selectStyle} renderItem={renderItem}
          onChange={({ value }) => { level.set(value as LogLevel); refilter(); }}
          trigger={trigger(() => LOG_LEVELS.find((l) => l.value === level())!.title, 112)} />
        <View style={{ flex: 1, minWidth: 120, height: 30, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.bg }}>
          <Icon name="search" size={14} tint={C.muted} />
          <Input value={text()} placeholder="搜 tag 或内容" accessibilityLabel="搜 tag 或内容" autoCapitalize="none" autoCorrect={false}
            onChange={({ value }) => {
              text.set(value);
              clearTimeout(textTimer);
              textTimer = setTimeout(refilter, 300);
            }}
            style={{ flex: 1, minWidth: 0, height: 28, color: C.text, fontSize: 12 }} />
        </View>
        <IconBtn icon={paused() ? "play" : "pause"} label={paused() ? "继续" : "暂停"} onPress={() => {
          if (paused()) {
            rows.set(applyBatch(rows(), { lines: held().filter((r): r is LogLine => !("skipped" in r)), reset: false, dropped: 0 }));
            held.set([]);
          }
          paused.set(!paused());
        }} />
        <IconBtn icon="trash" label="清空" onPress={() => { rows.set([]); held.set([]); }} />
        <IconBtn icon="toEnd" label={follow() ? "跟随中" : "跟随最新"} onPress={() => { follow.set(true); list?.scrollToEnd({ animated: false }); }} />
        <IconBtn icon="close" label="关闭日志" onPress={props.onClose} />
      </View>
      <List each={rows()} keyExtractor={(r) => String(r.n)} estimatedItemSize={LOG_ROW_H} style={{ flex: 1, minHeight: 0, backgroundColor: C.surface }}
        ref={(r) => (list = r)} scrollEventThrottle={100}
        onScroll={(e) => {
          // 往上翻离开底部就不再跟随；滚回底部又自动跟随
          const atEnd = e.offset.y + e.size.height >= e.contentSize.height - 40;
          if (atEnd !== follow()) follow.set(atEnd);
        }}
        empty={<Text style={{ padding: 16, color: C.muted, fontSize: 12 }}>{paused() ? "已暂停" : "还没有日志"}</Text>}>
        {(row) => <LogRowView row={row} />}
      </List>
    </View>
  );
}

/** H5 控制台：页面列表由 App 轮询后传进来（pages 为 null 表示还没读到）；refresh 让 App 立刻再读一次。
 * 只看前台页面所在的 App；还没在审查时自动审查它的前台页面，下拉框切到同一 App 的其他页面。
 * onInspect：控制台已在页面里打开。 */
function H5Console(props: {
  pages: () => Page[] | null; listError: () => Msg | null; refresh: () => void; inspected: () => Inspected | null; onReboot: () => void;
  onInspect: (key: string, title: string) => void; onClose: () => void; onCopy: (url: string) => void;
  /** DevTools 的选择元素模式开着，画面上的鼠标在 WebView 里高亮、选中。 */
  picking: () => boolean;
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
        if ("opened" in r) props.onInspect(pageKey(p), p.title || p.url);
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
          ? { text: `已跳转：${r.title ?? ""} JSBridge：${r.bridge ? "在" : "不在"}` }
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

  const pageTitle = (p: Page) => `${p.title || middleEllipsis(p.url, URL_CHARS)}${p.visible ? "" : "（后台）"}`;
  const items = () => appPages().map((p) => ({ value: pageKey(p), title: pageTitle(p) }));
  // 控制台还没打开时盖在占位区上的说明
  const placeholder = () => {
    if (pages() === null) return "正在读取 H5 页面…";
    if (appPages().length === 0) return H5_EMPTY;
    return inspecting() ? "正在打开控制台…" : "";
  };

  return (
    <View role="region" accessibilityLabel="H5 控制台" style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
      <View role="toolbar" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, paddingVertical: 8, paddingHorizontal: 10, borderBottomWidth: 1, borderColor: C.lineSoft }}>
        <Select items={items()} value={activeKey() ?? undefined} accessibilityLabel="调试页面" disabled={items().length === 0}
          onChange={({ value }) => {
            const p = appPages().find((x) => pageKey(x) === value);
            if (p) inspect(p);
          }}
          popupStyle={{ backgroundColor: C.panel, borderRadius: 8, borderWidth: 1, borderColor: C.line, padding: 4, minWidth: 220 }}
          renderItem={(item) => (
            <View style={{ height: 30, justifyContent: "center", paddingHorizontal: 8, borderRadius: 6 }} hoverStyle={{ backgroundColor: C.hover }}>
              <Text style={{ color: C.text, fontSize: 13, numberOfLines: 1 }}>{item.title}</Text>
            </View>
          )}
          trigger={
            <View style={{ width: 160, height: 32, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.bg }}
              hoverStyle={{ borderColor: C.lineStrong }} focusStyle={{ borderColor: C.muted }}>
              <Text style={{ flex: 1, color: activePage() ? C.text : C.muted, fontSize: 13, numberOfLines: 1 }}>
                {activePage() ? pageTitle(activePage()!) : "没有页面"}
              </Text>
              <Icon name="chevron" size={14} tint={C.muted} />
            </View>
          } />
        {/* 当前页面的地址：改了按回车跳转（localhost 自动 adb reverse），Escape 放弃修改 */}
        <View role="group" accessibilityLabel="页面地址"
          style={{ flex: 1, minWidth: 180, height: 32, flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 10, paddingRight: 2, borderRadius: 8, borderWidth: 1, borderColor: addressFocused() ? C.muted : C.line, backgroundColor: C.bg, opacity: navigating() ? 0.6 : 1 }}>
          <Icon name="link" size={14} tint={C.muted} />
          <Input value={addressShown(draft(), currentUrl())} onChange={({ value }) => draft.set(addressEdit(currentUrl(), value))} onSubmit={navigate}
            submitBehavior="submit" readonly={!activePage() || navigating()}
            onFocus={() => addressFocused.set(true)} onBlur={() => addressFocused.set(false)}
            placeholder="localhost:5173/path" accessibilityLabel="页面地址，改了按回车跳转" autoCapitalize="none" autoCorrect={false}
            style={{ flex: 1, minWidth: 0, height: 30, color: C.text, fontSize: 12, fontFamily: "monospace" }} />
          <IconBtn icon="copy" label="复制地址" disabled={!currentUrl()} onPress={() => props.onCopy(currentUrl()!)} />
        </View>
        <IconBtn icon="rotate" label="重新加载控制台" disabled={!props.inspected()} onPress={() => host.call("emu.devtoolsReload", {})} />
        <IconBtn icon="close" label="关闭控制台" onPress={props.onClose} />
      </View>
      <If when={inspectMsg() || listError() || result() || props.picking()}>
        <View style={{ gap: 4, paddingVertical: 6, paddingHorizontal: 12, borderBottomWidth: 1, borderColor: C.lineSoft }}>
          <If when={props.picking()}>
            <Text role="status" style={{ color: C.text, fontSize: 12, lineHeight: 18 }}>选择元素：在画面上移动鼠标高亮，点一下选中；点在网页以外的地方不起作用</Text>
          </If>
          <If when={inspectMsg()}>
            {(m) => (
              <If when={!m().adbStuck} else={<AdbStuck onReboot={props.onReboot} />}>
                <Text role={m().error ? "alert" : "text"} style={{ color: m().error ? C.danger : C.text, fontSize: 12, lineHeight: 18 }}>{m().text}</Text>
              </If>
            )}
          </If>
          <If when={listError()}>{(e) => <MsgLine msg={e()} onReboot={props.onReboot} />}</If>
          <If when={result()}>{(r) => <MsgLine msg={r()} onReboot={props.onReboot} />}</If>
        </View>
      </If>
      <View style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <View testID="devtools" style={{ flex: 1, minHeight: 0, position: "relative" }} />
        <If when={!props.inspected()}>
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: C.surface }}>
            <Text style={{ maxWidth: 360, color: C.muted, fontSize: 13, lineHeight: 20, textAlign: "center" }}>{placeholder()}</Text>
          </View>
        </If>
      </View>
    </View>
  );
}

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

/** 线条图标（24 格的 SVG，按 tint 着色）。 */
function Icon(props: { name: IconName; size?: number; tint: string }) {
  const size = props.size ?? 18;
  return <Image src={iconSrc(props.name)} style={{ pointerEvents: "none", width: size, height: size, tintColor: props.tint }} />;
}

/** 只有图标的按钮：名字给读屏和悬停提示；有 tip 时悬停提示换成 tip（比如不能点的原因），读屏念名字加 tip。 */
function IconBtn(props: { icon: IconName; label: string; onPress: () => void; disabled?: boolean; tip?: string }) {
  return (
    <View onPress={props.onPress} role="button" accessibilityLabel={props.tip ? `${props.label}：${props.tip}` : props.label} disabled={props.disabled}
      tooltip={<Tip label={props.tip ?? props.label} />}
      hoverStyle={{ backgroundColor: C.hover }} focusStyle={{ borderColor: C.muted }} activeStyle={pressed(0.92)}
      style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 8, borderWidth: 1, borderColor: "transparent", opacity: props.disabled ? 0.4 : 1, ...ease() }}>
      <Icon name={props.icon} size={16} tint={C.muted} />
    </View>
  );
}

function Tip(props: { label: string }) {
  return (
    <Tooltip placement="bottom" style={ease(120)} startingStyle={popOut(-3)} endingStyle={popOut(-3)}>
      <View style={{ paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel }}>
        <Text style={{ color: C.text, fontSize: 12 }}>{props.label}</Text>
      </View>
    </Tooltip>
  );
}

/** 工具栏里只有图标的按钮：名字给读屏；悬停提示是名字，有 tip（快捷键）时带上。 */
function ToolBtn(props: { icon: IconName; label: string; onPress: () => void; disabled?: boolean; tip?: string }) {
  return (
    <Button onPress={props.onPress} disabled={props.disabled} accessibilityLabel={props.tip ? `${props.label}：${props.tip}` : props.label}
      tooltip={<Tip label={props.tip ? `${props.label}（${props.tip}）` : props.label} />}
      hoverStyle={{ backgroundColor: C.hover }} focusStyle={{ borderColor: C.muted }} disabledStyle={{ opacity: 0.35 }} activeStyle={pressed(0.9)}
      style={{ ...TOOL_BTN, ...ease() }}>
      <Icon name={props.icon} size={17} tint={C.keyText} />
    </Button>
  );
}
const TOOL_BTN = { height: 30, minWidth: 30, alignItems: "center", justifyContent: "center", borderRadius: 7, borderWidth: 1, borderColor: "transparent" } as const;

/** 工具栏里的一组按钮，共用一块圆角底板。 */
function ToolGroup(props: { label: string; children: JSX.Element }) {
  return (
    <ToolbarGroup accessibilityLabel={props.label}
      style={{ flexDirection: "row", alignItems: "center", gap: 1, padding: 2, borderRadius: 9, borderWidth: 1, borderColor: C.lineSoft, backgroundColor: C.panel, ...ease(200) }}>
      {props.children}
    </ToolbarGroup>
  );
}

/**
 * 菜单里的一项：可带图标；trail 是右侧的短标记（比如 ↗ 表示打开新页面）；note 是标签下面的一行说明（比如不能点的原因）；
 * danger 是删除这类破坏性操作。
 */
function Item(props: { label: string; onSelect: () => void; disabled?: boolean; danger?: boolean; icon?: IconName; trail?: string }) {
  return (
    <MenuItem onSelect={props.onSelect} disabled={props.disabled}
      hoverStyle={{ backgroundColor: C.hover }} focusStyle={{ backgroundColor: C.hover }} disabledStyle={{ opacity: 0.4 }}
      style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6, ...ease(100) }}>
      <If when={props.icon}>{(i) => <Icon name={i()} size={16} tint={C.muted} />}</If>
      <Text style={{ flex: 1, color: props.danger ? C.danger : C.text, fontSize: 13 }}>{props.label}</Text>
      <If when={props.trail}>{(t) => <Text style={{ color: C.muted, fontSize: 12 }}>{t()}</Text>}</If>
    </MenuItem>
  );
}
const menuPopup = () => ({ minWidth: 168, padding: 4, gap: 1, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel, ...ease(140) });

/** 设备画面缩放：缩小、当前比例（点一下回到适应窗口）、放大。 */
function ZoomControl(props: { zoom: number; onZoom: (z: number) => void }) {
  const percent = () => `${Math.round(props.zoom * 100)}%`;
  return (
    <ToolGroup label="画面缩放">
      <ToolBtn icon="minus" label="缩小" disabled={props.zoom === ZOOM_STEPS[0]} onPress={() => props.onZoom(stepZoom(props.zoom, -1))} />
      <Button onPress={() => props.onZoom(1)} accessibilityLabel={`缩放 ${percent()}，适应窗口`} tooltip={<Tip label="适应窗口" />}
        hoverStyle={{ backgroundColor: C.hover }} focusStyle={{ borderColor: C.muted }} activeStyle={pressed(0.95)} style={{ ...TOOL_BTN, minWidth: 46, paddingHorizontal: 4, ...ease() }}>
        <Text style={{ color: C.keyText, fontSize: 12 }}>{percent()}</Text>
      </Button>
      <ToolBtn icon="plus" label="放大" disabled={props.zoom === ZOOM_STEPS[ZOOM_STEPS.length - 1]} onPress={() => props.onZoom(stepZoom(props.zoom, 1))} />
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
    <View role="group" accessibilityLabel="外观" style={{ flexDirection: "row", gap: 2, padding: 2, borderRadius: 8, backgroundColor: C.hover }}>
      <Each of={THEME_OPTIONS} key={(o) => o.theme}>{(o) => (
        <MenuItem role="menuitemradio" checked={props.value === o().theme} closeOnSelect={false} onSelect={() => props.onPick(o().theme)}
          accessibilityLabel={`外观：${o().label}`}
          style={{ width: 30, height: 24, alignItems: "center", justifyContent: "center", borderRadius: 6, borderWidth: 1, borderColor: "transparent", ...ease() }}
          checkedStyle={{ backgroundColor: C.surface, borderColor: C.line }} focusStyle={{ borderColor: C.muted }}>
          <Icon name={o().icon} size={15} tint={props.value === o().theme ? C.text : C.muted} />
        </MenuItem>
      )}</Each>
    </View>
  );
}

/** Droidpier 的标记：圆底上一个 D，菜单顶部和侧栏底部的按钮都用它。 */
function Mark(props: { size: number }) {
  return (
    <View style={{ width: props.size, height: props.size, borderRadius: props.size / 2, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.accentSoft, backgroundColor: C.accentSoft }}>
      <Text style={{ color: C.accentText, fontSize: Math.round(props.size * 0.42), fontWeight: "600" }}>D</Text>
    </View>
  );
}

/** 侧栏底部的按钮：点开向上的菜单，里面是官网、文档和外观。 */
function AppMenu(props: { site: string; theme: Theme; onTheme: (t: Theme) => void }) {
  return (
    <Menu placement="top" offset={6} popupStyle={{ ...menuPopup(), minWidth: 248, padding: 6 }} popupStartingStyle={popOut(4)} popupEndingStyle={popOut(4)} trigger={
      <Button accessibilityLabel="Droidpier 菜单" hoverStyle={{ backgroundColor: C.hover }} focusStyle={{ borderColor: C.muted }}
        style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, borderColor: "transparent", ...ease() }}>
        <Mark size={28} />
        <Text style={{ flex: 1, color: C.text, fontSize: 13, fontWeight: "600" }}>Droidpier</Text>
        <Icon name="chevronUp" size={15} tint={C.muted} />
      </Button>
    }>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 6, paddingBottom: 10, paddingHorizontal: 8 }}>
        <Mark size={36} />
        <View style={{ gap: 2 }}>
          <Text style={{ color: C.text, fontSize: 14, fontWeight: "600" }}>Droidpier</Text>
          <Text style={{ color: C.muted, fontSize: 12 }}>{props.site.replace(/^https?:\/\//, "")}</Text>
        </View>
      </View>
      <MenuSeparator style={{ height: 1, marginBottom: 4, marginHorizontal: 4, backgroundColor: C.line }} />
      <Item icon="globe" label="官网" trail="↗" onSelect={() => void openUrl(`${props.site}/`)} />
      <Item icon="book" label="使用文档" trail="↗" onSelect={() => void openUrl(props.site + DOCS_PATH)} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4, paddingLeft: 10, paddingRight: 4 }}>
        <Icon name="sun" size={16} tint={C.muted} />
        <Text style={{ flex: 1, color: C.text, fontSize: 13 }}>外观</Text>
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
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <Text style={{ flexShrink: 1, color: C.text, fontSize: 12, fontFamily: "monospace", userSelect: "text" }}>{props.cmd}</Text>
      <Btn label="复制命令" onPress={copy} />
      <If when={result() !== null}>
        <Text style={{ color: result() === "ok" ? C.ok : C.danger, fontSize: 12 }}>{result() === "ok" ? "已复制" : "复制失败，请手动选中复制"}</Text>
      </If>
    </View>
  );
}

/** 画面上方的环境检查卡片：缺什么、多大、手动命令，以及安装进度。安装只在确认框里确认后才开始。 */
function SetupCard(props: { env: Env; installs: InstallProgress[]; onInstall: (c: Confirm) => void; onCreate: () => void; onDismiss: () => void }) {
  const busy = () => props.installs.some(isActive);
  // 设备要在“创建设备”对话框里选机型和系统版本，不在“全部安装”里
  const installable = () => props.env.missing.filter((m) => m.auto && m.id !== "avd");
  const total = () => installable().reduce((n, m) => n + (m.sizeMb ?? 0), 0);
  // 展开了“手动安装”的项；默认都收起
  const manualOpen = signal<string[]>([]);
  const toggleManual = (id: string) => manualOpen.set(manualOpen().includes(id) ? manualOpen().filter((x) => x !== id) : [...manualOpen(), id]);
  return (
    <View role="region" accessibilityLabel="环境检查"
      style={{ width: 560, maxWidth: "100%", gap: 10, backgroundColor: C.overlay, borderRadius: 8, padding: 12, borderWidth: 1, borderColor: C.warn }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Text role="header" style={{ color: C.text, fontSize: 14, fontWeight: "bold" }}>环境检查</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <If when={installable().length > 1}>
            <Btn label={`全部安装（${sizeText(total())}）`} disabled={busy()} onPress={() => props.onInstall({ ids: installable().map((m) => m.id), kind: "install" })} />
          </If>
          <If when={!busy()}>
            <Btn label="收起" onPress={props.onDismiss} />
          </If>
        </View>
      </View>
      <Text style={{ color: C.muted, fontSize: 12, lineHeight: 18 }}>
        {props.env.missing.length > 0
          ? `还不能启动设备，缺 ${props.env.missing.length} 项。点“安装”会先让你确认要下载什么、装到哪里。`
          : props.env.error ? "" : "环境已经齐全。"}
      </Text>
      <If when={props.env.error}>
        {(e) => <Text role="alert" style={{ color: C.danger, fontSize: 13, lineHeight: 20 }}>{`${e()}。请重新运行网关后再打开页面。`}</Text>}
      </If>
      <Scroll style={{ maxHeight: 460 }} contentStyle={{ gap: 8 }}>
        <Each of={props.env.missing} key={(m) => m.id}>
          {(m) => (
            <View style={{ gap: 6, padding: 10, borderRadius: 8, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ flex: 1, color: C.text, fontSize: 13, fontWeight: "bold" }}>
                  {`${envName(m().id)}${m().sizeMb ? ` · ${sizeText(m().sizeMb!)}` : ""}`}
                </Text>
                <If when={m().auto}>
                  <If when={m().id === "avd"} else={
                    <Btn label="安装" disabled={busy()} onPress={() => props.onInstall({ ids: [m().id], kind: "install" })} />
                  }>
                    <Btn label="创建设备" disabled={busy()} onPress={props.onCreate} />
                  </If>
                </If>
              </View>
              <Text style={{ color: C.muted, fontSize: 12, lineHeight: 18 }}>{m().detail}</Text>
              <If when={manualHint(m(), props.env) !== null || !!m().command}>
                <View style={{ gap: 6 }}>
                  <View onPress={() => toggleManual(m().id)} role="button" accessibilityLabel="手动安装" accessibilityState={{ expanded: manualOpen().includes(m().id) }}
                    hoverStyle={{ opacity: 0.8 }} style={{ flexDirection: "row", alignSelf: "flex-start", gap: 4 }}>
                    <Text style={{ color: C.muted, fontSize: 12 }}>{`${manualOpen().includes(m().id) ? "▾" : "▸"} 手动安装`}</Text>
                  </View>
                  <If when={manualOpen().includes(m().id)}>
                    <If when={manualHint(m(), props.env)}>{(h) => <Text style={{ color: C.muted, fontSize: 12, lineHeight: 18, userSelect: "text" }}>{h()}</Text>}</If>
                    {/* 旧网关给的 sdkmanager / avdmanager 命令 */}
                    <If when={m().command}>{(cmd) => <CopyCmd cmd={cmd()} />}</If>
                  </If>
                </View>
              </If>
            </View>
          )}
        </Each>
        <If when={props.installs.length > 0}>
          <View role="list" accessibilityLabel="安装进度" style={{ gap: 6 }}>
            <Text style={{ color: C.muted, fontSize: 12 }}>安装进度</Text>
            <Each of={props.installs} key={(p) => p.id}>
              {(p) => (
                <View style={{ gap: 4, padding: 8, borderRadius: 8, borderWidth: 1, borderColor: p().phase === "failed" ? C.danger : C.line }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={{ flex: 1, color: C.text, fontSize: 13 }}>{envName(p().id)}</Text>
                    <Text style={{ color: p().phase === "failed" ? C.danger : p().phase === "done" ? C.ok : C.warn, fontSize: 12 }}>
                      {`${PHASE[p().phase]}${p().pct !== undefined && p().phase === "download" ? ` ${p().pct}%` : ""}`}
                    </Text>
                  </View>
                  <If when={p().logTail}>
                    {(log) => <Text style={{ color: C.muted, fontSize: 11, lineHeight: 16, fontFamily: "monospace", userSelect: "text" }}>{log()}</Text>}
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

// nsh 没有导出 ViewRef 类型，从 Radio 的 ref 取
type Focusable = Exclude<NonNullable<Parameters<typeof Radio>[0]["ref"]>, (node: never) => void>;
type Scroller = Exclude<NonNullable<Parameters<typeof Scroll>[0]["ref"]>, (node: never) => void>;

/** 一行单选项（nsh 的 Radio：方向键在组内移动、Space 选中）：左边名字，右边说明；选中时底色变亮。 */
function Choice(props: { label: string; detail: string; detailColor?: string; checked: boolean; onPress: () => void; ref: (r: Focusable) => void }) {
  return (
    <Radio checked={props.checked} onChange={props.onPress} accessibilityLabel={`${props.label}，${props.detail}`} ref={props.ref}
      style={{
        flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 6, borderWidth: 1,
        borderColor: "transparent", backgroundColor: "transparent", ...ease(),
      }}
      checkedStyle={{ borderColor: C.lineStrong, backgroundColor: C.hover }}
      focusStyle={{ borderColor: C.text }}>
      <Text style={{ flex: 1, color: C.text, fontSize: 13 }}>{props.label}</Text>
      <Text style={{ color: props.detailColor ?? C.muted, fontSize: 12 }}>{props.detail}</Text>
    </Radio>
  );
}

/** 把选中的那项滚到列表可见处（列表刚挂上，还在顶部）；focus 为真时再把键盘焦点放上去。 */
const reveal = async (scroller: Scroller | undefined, item: Focusable | undefined, focus: boolean) => {
  if (!item) return;
  const [m, s] = await Promise.all([item.measure(), scroller?.measure()]);
  if (m && s && scroller) scroller.scrollTo({ y: Math.max(0, m.pagePosition.y - s.pagePosition.y - 4), animated: false });
  if (focus) item.focus();
};

const imageLabel = (i: SystemImage) => `${i.version ?? "Android"}（API ${i.api}）`;

/** 创建设备对话框的内容：目录由 App 在打开时向网关要，选好后点“下一步”交给确认框。 */
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
    return customName() ?? (d && i ? defaultAvdName(d.name, i.api) : "");
  };
  // 目录第一次到达（每次打开对话框一次）：把默认选中的机型和版本滚进可见处，焦点放在机型上
  const deviceRefs = new Map<string, Focusable>();
  const imageRefs = new Map<string, Focusable>();
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
    <View role="group" accessibilityLabel="创建设备" style={{ gap: 10 }}>
      <Text role="header" style={{ color: C.text, fontSize: 15, fontWeight: "bold" }}>创建设备</Text>
      <If when={props.loadError}>{(e) => <Text role="alert" style={{ color: C.danger, fontSize: 13 }}>{e()}</Text>}</If>
      <If when={catalog()} else={<Text style={{ color: C.muted, fontSize: 13 }}>正在读取机型和系统版本…</Text>}>
        {(c) => (
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
            <View style={{ flex: 1, minWidth: 240, gap: 8 }}>
            <Text style={{ color: C.muted, fontSize: 12 }}>{pickedDevice() ? `机型：${pickedDevice()!.name}` : "机型"}</Text>
            <Scroll ref={(r) => (deviceScroll = r)} style={{ height: 248, padding: 4, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }}>
              <RadioGroup style={{ gap: 4 }}>
                <Each of={c().devices} key={(d) => d.id}>
                  {(d) => (
                    <Choice label={d().name} detail={d().oem} checked={pickedDevice()?.id === d().id} onPress={() => device.set(d().id)}
                      ref={(r) => deviceRefs.set(d().id, r)} />
                  )}
                </Each>
              </RadioGroup>
            </Scroll>
            </View>
            <View style={{ flex: 1, minWidth: 240, gap: 8 }}>
            <Text style={{ color: C.muted, fontSize: 12 }}>{pickedImage() ? `系统版本：${imageLabel(pickedImage()!)}` : "系统版本"}</Text>
            <If when={c().imagesError}>{(e) => <Text role="alert" style={{ color: C.warn, fontSize: 12, lineHeight: 18 }}>{`${e()}，只列出已安装的`}</Text>}</If>
            <Scroll ref={(r) => (imageScroll = r)} style={{ height: 248, padding: 4, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }}>
              <RadioGroup style={{ gap: 4 }}>
                <Each of={c().images} key={(i) => i.pkg}>
                  {(i) => (
                    <Choice label={imageLabel(i())} checked={pickedImage()?.pkg === i().pkg} onPress={() => image.set(i().pkg)}
                      detail={i().installed ? (i().tag === "google_apis" ? "已安装" : `已安装 · ${i().tag}`) : `下载${sizeText(i().sizeMb ?? 0)}`}
                      detailColor={i().installed ? C.ok : C.muted} ref={(r) => imageRefs.set(i().pkg, r)} />
                  )}
                </Each>
              </RadioGroup>
            </Scroll>
            </View>
            </View>
            <Text style={{ color: C.muted, fontSize: 12 }}>设备名</Text>
            <Input value={name()} onChange={({ value }) => customName.set(value)} onSubmit={next}
              accessibilityLabel="设备名" autoCapitalize="none" autoCorrect={false}
              style={{ height: 36, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: nameError() && name() !== "" ? C.danger : C.line, backgroundColor: C.bg, color: C.text, fontSize: 13, fontFamily: "monospace" }} />
            <If when={pickedDevice() ? nameError() : null}>{(e) => <Text role="alert" style={{ color: C.danger, fontSize: 12 }}>{e()}</Text>}</If>
          </View>
        )}
      </If>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
        <Btn label="取消" onPress={props.onCancel} />
        <Btn label="下一步" kind="primary" disabled={!canNext()} onPress={next} />
      </View>
    </View>
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
  // null：网关没发过真机列表（旧网关或没带 --phones），不显示「真机」分组
  const phones = signal<PhoneInfo[] | null>(null);
  // 当前设备的身份和能力（ready 带来）：真机的 serial 是 0，按 deviceId 认设备；deviceSize 是 ready.device，真机不在 AVD 列表里，设备框比例靠它
  const deviceId = signal("");
  const kind = signal<"emulator" | "phone">("emulator");
  const caps = signal<DeviceCaps | null>(null);
  const deviceSize = signal({ width: 0, height: 0 });
  const boots = signal<Record<string, Boot>>({});
  const notice = signal<Notice | null>(null);
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
  const cmdCopyResult = signal<"ok" | "fail" | null>(null);
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
  host.on("emu.orientation", (p: { rotation: number }) => rotation.set(p.rotation));
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
    catalogError.set(r.ok ? null : "没有连上网关，读不到机型和系统版本");
    applyCatalog(r.catalog, r.rev);
  });
  const openCreate = () => createOpen.set(true);
  // 每次打开对话框要一次；开着时环境变了（比如刚装好命令行工具）再要一次
  effect(() => {
    env();
    if (createOpen()) loadCatalog();
  });
  const setupDismissed = signal(false);
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
    showNotice({ text: "页面已关闭，控制台已收起" });
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
  let noticeTimer: number | undefined;
  const showNotice = (n: Notice) => {
    notice.set(n);
    clearTimeout(noticeTimer);
    if (!n.sticky) noticeTimer = setTimeout(() => notice.set(null), 4000);
  };

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
      showNotice({ text: "页面已关闭，控制台已收起" });
    }
  });

  let statusRev = -1;
  type DeviceStatus = { deviceId?: string; kind?: "emulator" | "phone"; caps?: DeviceCaps | null; device?: { width: number; height: number }; logcat?: boolean };
  const applyDevice = (p: DeviceStatus) => {
    deviceId.set(p.deviceId ?? "");
    kind.set(p.kind ?? "emulator");
    caps.set(p.caps ?? null);
    if (p.device) deviceSize.set(p.device);
    logcatOk.set(p.logcat === true);
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
  host.on("emu.boot", (b: Boot) => {
    boots.set({ ...boots(), [b.name]: b });
    if (b.progress === "failed") {
      const a = (avds() ?? []).find((x) => x.name === b.name);
      showNotice({ text: `${a ? avdLabel(a) : b.name} 启动失败${b.error ? `：${b.error}` : ""}`, error: true, sticky: true });
    }
  });
  host.on("emu.notice", (n: Notice) => showNotice(n));
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
  host.call("emu.status", {}).then((s: { state: State; serial: number; rotation: number; fps: number; latencyMs: number; avds: Avd[] | null; phones?: PhoneInfo[] | null; boots: Boot[]; upgrade: string | null; rev: number; uploads?: Upload[]; gateway?: GatewayBanner | null } & DeviceStatus & Omit<Setup, "rev">) => {
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
    boots.set(Object.fromEntries(s.boots.map((b) => [b.name, b])));
  });

  // 按钮在没连上设备时返回 ok:false，给个提示，不假装成功
  const act = (p: Promise<{ ok: boolean }>) =>
    p.then((r) => { if (!r.ok) showNotice({ text: "还没有连接设备", error: true }); });
  const key = (k: string) => act(host.call("emu.key", { key: k }));
  // 安装和许可证只要求连着网关，不要求连着设备
  const gw = (p: Promise<{ ok: boolean }>) =>
    p.then((r) => { if (!r.ok) showNotice({ text: "没有连上网关，操作没有发出", error: true }); });

  const problemColor = () => (state() === "page-outdated" ? C.warn : C.danger);
  const bootingName = () => Object.values(boots()).find(isBooting);
  const currentAvd = () => (avds() ?? []).find((a) => a.running === "grpc" && a.serial === serial());
  // 设备框的宽高比：当前设备的分辨率，横屏时对调；不知道分辨率时按 1080×2340
  // 机身大小：放进按键之间剩下的地方，屏幕区按当前设备转过之后的宽高比；不知道分辨率时按 1080×2340
  // 画面缩放：1 是适应窗口；读到这台浏览器存的值后换过去
  // 点缩放按钮时机身平滑变大小，画布跟着屏幕区的 ResizeObserver 逐帧走；读到存的值时直接换，不做动画
  const zoom = signal(1);
  host.call("emu.zoom", {}).then((z: unknown) => zoom.set(parseZoom(z)));
  const setZoom = (z: number) => {
    animateNext();
    zoom.set(z);
    host.call("emu.setZoom", { zoom: z });
  };
  const deviceArea = signal({ width: 0, height: 0 });
  const frame = () => {
    const a = currentAvd();
    const d = a?.width && a.height ? { width: a.width, height: a.height } : deviceSize().width ? deviceSize() : { width: 1080, height: 2340 };
    return deviceFrame(deviceArea(), d, rotation() as Rotation, BEZEL, zoom());
  };
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
  const query = signal("");
  const listed = () => (avds() ?? []).filter((a) => matchesAvd(a, query()));
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
  const switchTo = (a: Avd) => act(host.call("emu.use", { name: a.name }));
  const isCurrentPhone = (p: PhoneInfo) => kind() === "phone" && p.id === deviceId() && (state() === "connected" || state() === "rebooting");
  const pickPhone = (p: PhoneInfo) => {
    if (!canPick(p)) return;
    if (p.id !== selected()) animateNext();
    selected.set(p.id);
    if (!isCurrentPhone(p)) act(host.call("emu.use", { name: p.id }));
  };
  const copyHref = (url: string) =>
    host.call("emu.copy", { text: url }).then(
      () => showNotice({ text: "已复制页面地址" }),
      () => showNotice({ text: "复制失败，请手动选中地址复制", error: true }),
    );
  const pickDevice = (a: Avd) => {
    if (a.name !== selected()) animateNext();
    selected.set(a.name);
    if (a.running === "grpc" && !isCurrent(a) && a.serial !== serial()) switchTo(a);
  };
  const avdStatus = (a: Avd) => {
    if (a.running === "grpc") return isCurrent(a) ? "运行中 · 当前画面" : "运行中";
    if (a.running === "no-grpc") return "运行中但无法接管";
    const b = boots()[a.name];
    return isBooting(b) ? `启动中 ${b!.seconds} 秒` : "未运行";
  };
  const avdTint = (a: Avd) => (a.running === "grpc" ? C.ok : a.running === "no-grpc" || isBooting(boots()[a.name]) ? C.warn : C.muted);
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
  const subtitle = () => {
    const a = shown();
    if (!a) return statusText();
    return [avdSpec(a), shownIsLive() ? statusText() : avdStatus(a)].filter(Boolean).join(" · ");
  };
  const emptyText = () => {
    const a = shown();
    if (!a) return (avds() ?? []).length > 0 ? "在左侧选一台设备" : "本机还没有模拟器设备，先新建一台";
    if (a.running === "grpc") return "运行中，画面上现在是别的设备";
    if (a.running === "no-grpc") return "这台设备已在运行，但启动时没有开启 gRPC，Droidpier 接管不了。把它关掉后在这里重新启动。";
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
  const showSetup = () => {
    const e = env();
    if (!e) return null;
    const failed = installs().some((p) => p.phase === "failed");
    return setupCardShown({ ok: e.ok, busy: setupBusy(), failed, hasInstalls: installs().length > 0, dismissed: setupDismissed() }) ? e : null;
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
        else renameError.set(`没有改成：${r.error ?? "未知原因"}`);
      },
      (e: Error) => { if (still()) renameError.set(`没有改成：${e.message}`); },
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
        } else if (still()) deleteError.set(`没有删除：${r.error ?? "未知原因"}`);
      },
      (e: Error) => { if (still()) deleteError.set(`没有删除：${e.message}`); },
    ).finally(() => deleting.set(false));
  };
  // 停止运行：网关等设备真的停了才回复，期间这一项显示“停止中”
  const stopping = signal<string | null>(null);
  const beingStopped = (a: Avd) => stopping() === a.name;
  const stopDevice = (a: Avd) => {
    if (stopping()) return;
    stopping.set(a.name);
    (host.call("emu.stopAvd", { name: a.name }) as Promise<{ ok: boolean; error?: string }>).then(
      (r) => showNotice(r.ok ? { text: `已停止 ${avdLabel(a)}` } : { text: `没有停止：${r.error ?? "未知原因"}`, error: true }),
      (e: Error) => showNotice({ text: `没有停止：${e.message}`, error: true }),
    ).finally(() => stopping.set(null));
  };
  // 回复晚了（页面 15 秒超时）或别的页面删掉了它：新列表里没有这台了，就当删完
  effect(() => {
    const a = deleteTarget();
    const list = avds();
    if (!a || !list || list.some((x) => x.name === a.name)) return;
    deleteTarget.set(null);
    showNotice({ text: `已删除 ${avdLabel(a)}` });
  });

  const DeviceRow = (props: { avd: () => Avd }) => {
    const a = props.avd;
    return (
      <ContextMenu offset={4} popupStyle={menuPopup()} popupStartingStyle={popOut(-4)} popupEndingStyle={popOut(-4)} trigger={
        <Button onPress={() => pickDevice(a())} selected={shown()?.name === a().name} accessibilityLabel={`${avdLabel(a())}，${avdStatus(a())}`}
          hoverStyle={{ backgroundColor: C.hover }} selectedStyle={{ backgroundColor: C.hover }} focusStyle={{ borderColor: C.muted }} activeStyle={pressed(0.985)}
          style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, borderColor: "transparent", ...ease() }}>
          <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: C.surface }}>
            <Icon name="smartphone" size={17} tint={avdTint(a())} />
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
            <Text style={{ color: C.text, fontSize: 13, lineHeight: 18, fontWeight: "600" }}>{avdLabel(a())}</Text>
            <Text style={{ color: a().running === "no-grpc" || isBooting(boots()[a().name]) ? C.warn : C.muted, fontSize: 11, lineHeight: 15 }}>{avdStatus(a())}</Text>
          </View>
          <Text style={{ color: C.muted, fontSize: 11 }}>{a().apiLevel ? ANDROID[a().apiLevel!] ?? `API ${a().apiLevel}` : ""}</Text>
        </Button>
      }>
        <Item label="重命名" disabled={beingDeleted(a())} onSelect={() => openRename(a())} />
        <Item label={beingStopped(a()) ? "停止中" : "停止运行"} disabled={!live(a()) || beingStopped(a()) || beingDeleted(a())} onSelect={() => stopDevice(a())} />
        <Item label="删除" danger disabled={beingDeleted(a())} onSelect={() => openDelete(a())} />
      </ContextMenu>
    );
  };

  // 真机这一版只列出来，不能点；样式跟 DeviceRow 一致
  // 可用的手机能点开看画面（操作是 PR 4）；样式跟 DeviceRow 一致
  const PhoneRow = (props: { phone: () => PhoneInfo }) => {
    const p = props.phone;
    return (
      <Button onPress={() => pickPhone(p())} disabled={!canPick(p())} selected={selected() === p().id} accessibilityLabel={`${phoneLabel(p())}，${phoneStatus(p(), isCurrentPhone(p()))}`}
        hoverStyle={{ backgroundColor: C.hover }} selectedStyle={{ backgroundColor: C.hover }} focusStyle={{ borderColor: C.muted }} activeStyle={pressed(0.985)}
        style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, borderColor: "transparent", ...ease() }}>
        <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: C.surface }}>
          <Icon name="smartphone" size={17} tint={p().state === "device" ? C.text : C.muted} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <Text style={{ color: C.text, fontSize: 13, lineHeight: 18, fontWeight: "600" }}>{phoneLabel(p())}</Text>
          <Text style={{ color: p().state === "device" ? C.muted : C.warn, fontSize: 11, lineHeight: 15 }}>{phoneStatus(p(), isCurrentPhone(p()))}</Text>
        </View>
        <Text style={{ color: C.muted, fontSize: 11 }}>{phoneDetail(p())}</Text>
      </Button>
    );
  };

  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: C.surface, ...ease(200) }}>
      <If when={!sidebarHidden()}>
        <View role="navigation" accessibilityLabel="设备列表"
          style={{ width: 264, margin: 8, marginRight: 0, padding: 8, gap: 6, borderRadius: 14, borderWidth: 1, borderColor: C.lineSoft, backgroundColor: C.bg, ...ease(200) }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 2 }}>
            <IconBtn icon="plus" label="新建设备" disabled={setupBusy() || !env()} onPress={openCreate} />
            <IconBtn icon="panelLeft" label="收起侧栏" onPress={() => setSidebar(true)} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 32, paddingHorizontal: 10, borderRadius: 8, backgroundColor: C.hover }}>
            <Icon name="search" size={14} tint={C.muted} />
            <Input value={query()} onChange={({ value }) => query.set(value)} placeholder="搜索设备" accessibilityLabel="搜索设备" autoCapitalize="none" autoCorrect={false}
              style={{ flex: 1, height: 30, borderWidth: 0, backgroundColor: "transparent", color: C.text, fontSize: 13 }} />
          </View>
          <Text style={{ color: C.muted, fontSize: 11, fontWeight: "600", paddingHorizontal: 8, paddingTop: 8, paddingBottom: 2 }}>设备</Text>
          <Scroll style={{ flex: 1 }} contentStyle={{ gap: 2 }}>
            <If when={avds() !== null} else={<Text style={{ color: C.muted, fontSize: 13, paddingHorizontal: 8 }}>正在读取设备列表…</Text>}>
              <If when={(avds() ?? []).length > 0} else={
                <View style={{ gap: 8, paddingHorizontal: 8, alignItems: "flex-start" }}>
                  <Text style={{ color: C.muted, fontSize: 13, lineHeight: 20 }}>本机还没有模拟器设备</Text>
                  <Btn label="创建设备" disabled={setupBusy() || !env()} onPress={openCreate} />
                </View>
              }>
                <If when={listed().length > 0} else={<Text style={{ color: C.muted, fontSize: 13, lineHeight: 20, paddingHorizontal: 8 }}>{`没有名字含“${query().trim()}”的设备`}</Text>}>
                  <Each of={listed()} key={(a) => a.name}>{(a) => <DeviceRow avd={a} />}</Each>
                </If>
              </If>
            </If>
            <If when={showPhones(phones())}>
              <Text style={{ color: C.muted, fontSize: 11, fontWeight: "600", paddingHorizontal: 8, paddingTop: 12, paddingBottom: 2 }}>真机</Text>
              <If when={(phones() ?? []).length > 0} else={
                <Text style={{ color: C.muted, fontSize: 13, lineHeight: 20, paddingHorizontal: 8 }}>插上手机，并在手机上打开 USB 调试</Text>
              }>
                <Each of={phones() ?? []} key={(p) => p.id}>{(p) => <PhoneRow phone={p} />}</Each>
              </If>
            </If>
          </Scroll>
          <View style={{ height: 1, marginHorizontal: 4, backgroundColor: C.lineSoft }} />
          <AppMenu site={site()} theme={theme()} onTheme={pickTheme} />
        </View>
      </If>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 16 }}>
          <If when={sidebarHidden()}>
            <IconBtn icon="panelLeft" label="展开侧栏" onPress={() => setSidebar(false)} />
          </If>
          <View style={{ flex: 1, minWidth: 180, gap: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Text role="header" style={{ flexShrink: 1, color: C.text, fontSize: 14, fontWeight: "600", numberOfLines: 1 }}>{shown() ? avdLabel(shown()!) : currentPhone() ? phoneLabel(currentPhone()!) : "没有连接设备"}</Text>
              <If when={h5Open() && foregroundPkg(pages() ?? [])}>
                {(pkg) => <Text style={{ flexShrink: 1, color: C.muted, fontSize: 12, fontFamily: "monospace", numberOfLines: 1 }}>{pkg()}</Text>}
              </If>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: shownIsLive() && state() === "connected" ? C.ok : shown() ? avdTint(shown()!) : C.warn }} />
              <Text style={{ flexShrink: 1, color: C.muted, fontSize: 11, numberOfLines: 1 }}>{subtitle()}</Text>
            </View>
          </View>
          <Toolbar accessibilityLabel="设备操作" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <ZoomControl zoom={zoom()} onZoom={setZoom} />
            <ToolGroup label="画面">
              <If when={caps()?.rotate !== false}>
                <ToolBtn icon="rotateLeft" label="向左旋转" tip="点过屏幕后按 ⌘←" disabled={!shownIsLive()} onPress={() => act(host.call("emu.rotate", { dir: "left" }))} />
                <ToolBtn icon="rotateRight" label="向右旋转" tip="点过屏幕后按 ⌘→" disabled={!shownIsLive()} onPress={() => act(host.call("emu.rotate", { dir: "right" }))} />
              </If>
              <ToolBtn icon="camera" label="截图" tip="点过屏幕后按 ⌘S" disabled={!shownIsLive()} onPress={() => act(host.call("emu.screenshot", {}))} />
            </ToolGroup>
            <ToolGroup label="硬件按键">
              <ToolBtn icon="power" label="电源" tip="点过屏幕后按 ⌘P" disabled={!shownIsLive() || caps()?.input === false} onPress={() => key("Power")} />
              <ToolBtn icon="volDown" label="音量−" tip="点过屏幕后按 ⌘-" disabled={!shownIsLive() || caps()?.input === false} onPress={() => key("AudioVolumeDown")} />
              <ToolBtn icon="volUp" label="音量+" tip="点过屏幕后按 ⌘=" disabled={!shownIsLive() || caps()?.input === false} onPress={() => key("AudioVolumeUp")} />
            </ToolGroup>
            <If when={h5Key() && shownIsLive()}>
              <ToolGroup label="H5 调试">
                <Toggle pressed={h5Open()} onChange={toggleH5} accessibilityLabel="H5 控制台" tooltip={<Tip label="H5 控制台" />}
                  hoverStyle={{ backgroundColor: C.hover }} focusStyle={{ borderColor: C.muted }} pressedStyle={{ backgroundColor: C.accentSoft }} activeStyle={pressed(0.9)} style={{ ...TOOL_BTN, ...ease() }}>
                  <Icon name="code" size={17} tint={h5Open() ? C.accentText : C.keyText} />
                </Toggle>
              </ToolGroup>
            </If>
            <If when={logcatOk() && device() !== ""}>
              <ToolGroup label="日志">
                <Toggle pressed={logOpen()} onChange={toggleLog} accessibilityLabel="日志" tooltip={<Tip label="日志（logcat）" />}
                  hoverStyle={{ backgroundColor: C.hover }} focusStyle={{ borderColor: C.muted }} pressedStyle={{ backgroundColor: C.accentSoft }} activeStyle={pressed(0.9)} style={{ ...TOOL_BTN, ...ease() }}>
                  <Icon name="logs" size={17} tint={logOpen() ? C.accentText : C.keyText} />
                </Toggle>
              </ToolGroup>
            </If>
            <Menu align="end" offset={6} popupStyle={menuPopup()} popupStartingStyle={popOut(-4)} popupEndingStyle={popOut(-4)} trigger={
              <Button accessibilityLabel="更多操作" tooltip={<Tip label="更多操作" />} hoverStyle={{ backgroundColor: C.hover }} focusStyle={{ borderColor: C.muted }}
                activeStyle={pressed(0.9)} style={{ ...TOOL_BTN, borderColor: C.lineSoft, backgroundColor: C.panel, ...ease() }}>
                <Icon name="more" size={17} tint={C.keyText} />
              </Button>
            }>
              <If when={caps()?.reboot !== false}>
                <Item label={state() === "rebooting" ? "重启中" : kind() === "phone" ? "重启手机" : "重启模拟器系统"} disabled={!shownIsLive() || state() !== "connected"} onSelect={() => rebootAsk.set(true)} />
              </If>
              <If when={caps()?.stop !== false}>
                <Item label="关闭模拟器" disabled={!shownIsLive() || state() !== "connected"} onSelect={() => act(host.call("emu.stop", {}))} />
              </If>
              <MenuSeparator style={{ height: 1, marginVertical: 4, backgroundColor: C.line }} />
              <Item label="重命名" disabled={!shown() || beingDeleted(shown()!)} onSelect={() => { const a = shown(); if (a) openRename(a); }} />
              <Item label="删除" danger disabled={!shown() || beingDeleted(shown()!)}
                onSelect={() => { const a = shown(); if (a) openDelete(a); }} />
            </Menu>
          </Toolbar>
        </View>
        <View style={{ flex: 1, minHeight: 0, flexDirection: "row" }}>
        <View style={{ flex: 1, minWidth: 0, minHeight: 0, position: "relative" }}>
          {/* 连不上和环境检查要用户处理：放在设备上方占位置，不盖住画面 */}
          <If when={PROBLEM[state()] || showSetup()}>
            <View style={{ alignItems: "center", gap: 8, paddingTop: 12, paddingHorizontal: 16 }}>
              <If when={PROBLEM[state()]}>
                {(text) => (
                  <View role="alert" style={{ gap: 8, backgroundColor: C.overlay, borderRadius: 8, padding: 12, borderWidth: 1, borderColor: problemColor(), maxWidth: 520 }}>
                    <Text style={{ color: problemColor(), fontSize: 13, fontWeight: "bold", lineHeight: 20 }}>{text()}</Text>
                    <If when={state() === "no-gateway" && upgrade()}>
                      {(cmd) => (
                        <View style={{ gap: 6 }}>
                          <Text style={{ color: C.text, fontSize: 13, lineHeight: 20 }}>在终端运行下面的命令（第一次会自动安装，之后直接启动；它在后台运行，关闭终端也不影响），这个页面会自动连上</Text>
                          <CopyCmd cmd={cmd()} />
                        </View>
                      )}
                    </If>
                    <If when={state() === "gateway-outdated" && upgrade()}>
                      {(cmd) => (
                        <View style={{ gap: 8 }}>
                          <Text style={{ color: C.text, fontSize: 12, fontFamily: "monospace", userSelect: "text" }}>{cmd()}</Text>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                            <Btn label="复制命令" onPress={() => {
                              host.call("emu.copy", { text: cmd() }).then(
                                () => { cmdCopyResult.set("ok"); setTimeout(() => cmdCopyResult.set(null), 2000); },
                                () => { cmdCopyResult.set("fail"); setTimeout(() => cmdCopyResult.set(null), 3000); },
                              );
                            }} />
                            <If when={cmdCopyResult() !== null}>
                              <Text style={{ color: cmdCopyResult() === "ok" ? C.ok : C.danger, fontSize: 12 }}>
                                {cmdCopyResult() === "ok" ? "已复制" : "复制失败，请手动选中复制"}
                              </Text>
                            </If>
                          </View>
                        </View>
                      )}
                    </If>
                  </View>
                )}
              </If>
              <If when={showSetup()}>
                {(e) => <SetupCard env={e()} installs={installs()} onInstall={(c) => confirm.set(c)} onCreate={openCreate} onDismiss={() => { animateNext(); setupDismissed.set(true); }} />}
              </If>
            </View>
          </If>
          <View style={{ flex: 1, minHeight: 0, alignItems: "center", gap: 14, paddingTop: 24, paddingBottom: 16, paddingHorizontal: 16 }}>
            <View onLayout={({ bounds }) => deviceArea.set({ width: bounds.size.width, height: bounds.size.height })}
              style={{ flex: 1, minHeight: 0, alignSelf: "stretch", alignItems: "center", justifyContent: "center", position: "relative" }}>
                <View style={{ width: frame().width, height: frame().height, flexShrink: 0, padding: BEZEL - 1, borderRadius: 44, borderWidth: 1, borderColor: C.lineStrong, backgroundColor: "#000" }}>
                  <View testID="screen" style={{ flex: 1, minHeight: 0, position: "relative", borderRadius: 34, overflow: "hidden" }} />
                  <If when={drag().active}>
                    <View role="status" style={{
                      position: "absolute", top: BEZEL - 1, left: BEZEL - 1, right: BEZEL - 1, bottom: BEZEL - 1, pointerEvents: "none",
                      alignItems: "center", justifyContent: "center", gap: 6, padding: 24, borderRadius: 34, borderWidth: 2,
                      borderColor: drag().blocked ? C.danger : C.accent, backgroundColor: C.dragShade,
                    }}>
                      <Text style={{ color: drag().blocked ? C.danger : C.text, fontSize: 15, fontWeight: "600", textAlign: "center" }}>
                        {drag().blocked ? `不能安装：${drag().blocked}` : `松开以安装到 ${currentAvd() ? avdLabel(currentAvd()!) : "这台设备"}`}
                      </Text>
                      <If when={!drag().blocked}>
                        <Text style={{ color: C.muted, fontSize: 12, lineHeight: 18, textAlign: "center" }}>APK 会直接安装，其他文件放进 下载 文件夹</Text>
                      </If>
                    </View>
                  </If>
                </View>
              {/* 选中的不是画面上这台（没在运行、正在启动、正在切换）：盖住画面，说明它的状态 */}
              <If when={!shownIsLive()}>
                <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", gap: 10, padding: 24, backgroundColor: C.surface }}>
                  <Icon name="smartphone" size={40} tint={shown() ? avdTint(shown()!) : C.muted} />
                  <Text style={{ color: C.text, fontSize: 15, fontWeight: "600", textAlign: "center" }}>{shown() ? avdLabel(shown()!) : "没有连接设备"}</Text>
                  <Text style={{ maxWidth: 360, color: C.muted, fontSize: 13, lineHeight: 20, textAlign: "center" }}>{emptyText()}</Text>
                  <If when={shown()?.running === "grpc"}>
                    <Btn label="切换到这台" kind="primary" onPress={() => { const a = shown(); if (a) switchTo(a); }} />
                  </If>
                  <If when={shown() && canStart(shown()!)}>
                    <Btn label="启动" kind="primary" onPress={() => { const a = shown(); if (a) act(host.call("emu.start", { name: a.name })); }} />
                  </If>
                  <If when={!shown() && (avds() ?? []).length === 0 && avds() !== null}>
                    <Btn label="新建设备" kind="primary" disabled={setupBusy() || !env()} onPress={openCreate} />
                  </If>
                </View>
              </If>
            </View>
            <Toolbar accessibilityLabel="系统导航"
              style={{ flexDirection: "row", gap: 4, padding: 3, borderRadius: 12, borderWidth: 1, borderColor: C.lineSoft, backgroundColor: C.panel }}>
              <ToolBtn icon="back" label="返回" tip="点过屏幕后按 ⌘⌫" disabled={!shownIsLive() || caps()?.input === false} onPress={() => key("GoBack")} />
              <ToolBtn icon="home" label="主页" tip="点过屏幕后按 ⇧⌘H" disabled={!shownIsLive() || caps()?.input === false} onPress={() => key("GoHome")} />
              <ToolBtn icon="recents" label="最近" tip="点过屏幕后按 ⌘O" disabled={!shownIsLive() || caps()?.input === false} onPress={() => key("AppSwitch")} />
            </Toolbar>
          </View>
          <View style={{ position: "absolute", top: 8, left: 0, right: 0, alignItems: "center", gap: 8 }}>
            <If when={gatewayShown()}>
              {(b) => (
                <View role="status" style={{ gap: 8, backgroundColor: C.overlay, borderRadius: 8, padding: 12, borderWidth: 1, borderColor: b().kind === "manual" ? C.warn : C.line, maxWidth: 520 }}>
                  <Text style={{ color: b().kind === "manual" ? C.warn : C.text, fontSize: 13, lineHeight: 20 }}>{b().text}</Text>
                  <If when={b().command}>
                    {(cmd) => <CopyCmd cmd={cmd()} />}
                  </If>
                  <If when={b().kind === "manual"}>
                    <View style={{ flexDirection: "row" }}>
                      <Btn label="关闭" onPress={() => gatewayDismissed.set(b().text)} />
                    </View>
                  </If>
                </View>
              )}
            </If>
            <If when={clip() !== null}>
              <View role="alert" style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.overlay, borderRadius: 8, padding: 8, borderWidth: 1, borderColor: C.line }}>
                <Text style={{ color: copyFailed() ? C.danger : C.text, fontSize: 13 }}>
                  {copyFailed() ? "复制失败，请再点一次" : "模拟器里复制了新内容"}
                </Text>
                <Btn label="点击复制" onPress={copyClip} />
                <Btn label="忽略" onPress={() => clip.set(null)} />
              </View>
            </If>
            <If when={adbStuck() && state() === "connected"}>
              <View style={{ gap: 8, backgroundColor: C.overlay, borderRadius: 8, padding: 12, borderWidth: 1, borderColor: C.danger, maxWidth: 520 }}>
                <AdbStuck onReboot={() => rebootAsk.set(true)} />
                <View style={{ flexDirection: "row" }}>
                  <Btn label="忽略" onPress={() => adbStuck.set(false)} />
                </View>
              </View>
            </If>
            <If when={uploads().length > 0}>
              <View role="status" accessibilityLabel="传文件" style={{ gap: 6, backgroundColor: C.overlay, borderRadius: 8, padding: 12, borderWidth: 1, borderColor: C.line, width: 420, maxWidth: "92%" }}>
                <Each of={uploads()} key={(u) => u.id}>
                  {(u) => (
                    <View style={{ gap: 2 }}>
                      <Text style={{ color: C.text, fontSize: 13, numberOfLines: 1 }}>{u().name}</Text>
                      <Text style={{ color: u().state === "failed" ? C.danger : u().state === "done" ? C.ok : C.muted, fontSize: 12, lineHeight: 18, userSelect: "text" }}>
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
            </If>
            <If when={notice()}>
              {(n) => (
                <View role="status" style={{ gap: 8, backgroundColor: C.overlay, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12, borderWidth: 1, borderColor: n().error ? C.danger : C.line, maxWidth: 520 }}>
                  <Text style={{ color: n().error ? C.danger : C.text, fontSize: 13, userSelect: n().sticky ? "text" : undefined }}>{n().text}</Text>
                  <If when={n().sticky}>
                    <View style={{ flexDirection: "row" }}>
                      <Btn label="关闭" onPress={() => notice.set(null)} />
                    </View>
                  </If>
                </View>
              )}
            </If>
          </View>
        </View>
        <If when={h5Open() || logOpen()}>
          <View style={{ flex: 1.2, minWidth: 0, borderLeftWidth: 1, borderColor: C.lineSoft }}>
            <If when={h5Open() && logOpen()}>
              <View role="tablist" style={{ flexDirection: "row", gap: 4, paddingHorizontal: 10, paddingTop: 8, borderBottomWidth: 1, borderColor: C.lineSoft }}>
                {(["h5", "log"] as const).map((t) => (
                  <View role="tab" accessibilityLabel={t === "h5" ? "H5 调试" : "日志"} accessibilityState={{ selected: sideTab() === t }} onPress={() => sideTab.set(t)}
                    hoverStyle={{ backgroundColor: C.hover }}
                    style={{ paddingHorizontal: 12, paddingVertical: 6, borderTopLeftRadius: 6, borderTopRightRadius: 6, borderBottomWidth: 2, borderColor: sideTab() === t ? C.accentText : "transparent" }}>
                    <Text style={{ color: sideTab() === t ? C.text : C.muted, fontSize: 12, fontWeight: "600" }}>{t === "h5" ? "H5 调试" : "日志"}</Text>
                  </View>
                ))}
              </View>
            </If>
            <If when={h5Open()}>
              <View style={{ flex: 1, minHeight: 0, display: logOpen() && sideTab() === "log" ? "none" : "flex" }}>
                <H5Console pages={pages} listError={listError} refresh={refresh} inspected={inspected} onReboot={() => rebootAsk.set(true)}
                  onInspect={(key, title) => inspected.set({ key, title, device: deviceId() })} onClose={toggleH5} onCopy={copyHref} picking={picking} />
              </View>
            </If>
            <If when={logOpen()}>
              <View style={{ flex: 1, minHeight: 0, display: h5Open() && sideTab() === "h5" ? "none" : "flex" }}>
                <LogPanel device={deviceId} live={() => state() === "connected"} onClose={toggleLog} sink={(fn) => (logSink = fn)} />
              </View>
            </If>
          </View>
        </If>
        </View>
      </View>
      <Dialog open={confirm() !== null} animation="fade" onOpenChange={({ open }) => { if (!open) confirm.set(null); }}
        backdropStyle={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        style={{ marginHorizontal: "auto", marginTop: "12%", width: 460, maxWidth: "92%", backgroundColor: C.panel, borderRadius: 10, borderWidth: 1, borderColor: C.line, padding: 16, gap: 10 }}>
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
              <View role="group" accessibilityLabel={avd() ? "确认创建设备" : "确认安装"} style={{ gap: 10 }}>
                <Text role="header" style={{ color: C.text, fontSize: 15, fontWeight: "bold" }}>
                  {avd() ? `创建设备 ${avd()!.name}？` : `下载并安装 ${items().length} 项？`}
                </Text>
                <If when={avd()} else={
                  <View style={{ gap: 4 }}>
                    <Each of={items()} key={(i) => i.id}>
                      {(i) => <Text style={{ color: C.text, fontSize: 13, lineHeight: 20 }}>{`· ${envName(i().id)}${i().pkg ? `（${i().pkg}）` : ""}${i().sizeMb ? `，${sizeText(i().sizeMb!)}` : ""}`}</Text>}
                    </Each>
                  </View>
                }>
                  {(a) => (
                    <View style={{ gap: 4 }}>
                      <Text style={{ color: C.text, fontSize: 13, lineHeight: 20 }}>
                        {`机型 ${a().device.name} · ${imageLabel(a().image)} · 内存 ${ramMbFor(a().image.apiLevel)} MB`}
                      </Text>
                      <If when={!a().image.installed}>
                        <Text style={{ color: C.text, fontSize: 13, lineHeight: 20 }}>
                          {`要先下载系统镜像（${a().image.pkg}），${sizeText(a().image.sizeMb ?? 0)}，装到 ${env()?.sdkRoot ?? ""}`}
                        </Text>
                      </If>
                    </View>
                  )}
                </If>
                <Text style={{ color: C.text, fontSize: 13, lineHeight: 20 }}>
                  {`${space().downloadMb ? `下载${sizeText(space().downloadMb)}，` : ""}安装后${sizeText(space().diskMb).replace("约", "约占")}，${env()?.sdkRoot ?? ""} 所在磁盘剩余 ${gbText(env()?.freeMb ?? 0)}`}
                </Text>
                <If when={hasAvd() && env() && !env()!.sameDisk}>
                  <Text style={{ color: C.text, fontSize: 13, lineHeight: 20 }}>{`${env()?.avdHome ?? ""} 所在磁盘剩余 ${gbText(env()?.avdFreeMb ?? 0)}`}</Text>
                </If>
                <If when={space().shortMb > 0}>
                  <Text role="alert" style={{ color: C.danger, fontSize: 13, fontWeight: "bold" }}>{`磁盘空间不足：还需要约 ${gbText(space().shortMb)}`}</Text>
                </If>
                <If when={hasAvd()}>
                  <Text style={{ color: C.muted, fontSize: 12, lineHeight: 18, userSelect: "text" }}>{`设备建在 ${env()?.avdHome ?? ""}，第一次启动时要约 ${gbText(AVD_DISK_MB)} 空闲空间`}</Text>
                </If>
                <If when={downloads()}>
                  <Text style={{ color: C.muted, fontSize: 12, lineHeight: 18 }}>
                    {"从 Google 的 SDK 仓库（dl.google.com）直接下载，校验 sha1 后再解压。下载前会显示 Google 的许可证，你同意后才会继续。"}
                  </Text>
                </If>
                <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
                  <Btn label="取消" onPress={() => confirm.set(null)} />
                  <Btn label={avd() ? (avd()!.image.installed ? "创建" : "下载并创建") : "下载并安装"} kind="primary" disabled={space().shortMb > 0} onPress={startInstall} />
                </View>
              </View>
            );
          }}
        </If>
      </Dialog>
      <Dialog open={createOpen()} animation="fade" onOpenChange={({ open }) => { if (!open) createOpen.set(false); }}
        backdropStyle={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        style={{ marginHorizontal: "auto", marginTop: "6%", width: 720, maxWidth: "92%", backgroundColor: C.panel, borderRadius: 10, borderWidth: 1, borderColor: C.line, padding: 16, gap: 10 }}>
        <If when={createOpen()}>
          <CreateAvd catalog={catalog()} loadError={catalogError()} onCancel={() => createOpen.set(false)}
            onNext={(a) => {
              createOpen.set(false);
              confirm.set({ kind: "avd", avd: a });
            }} />
        </If>
      </Dialog>
      <Dialog open={license() !== null} animation="fade" closeOnEscape={false} closeOnBackdropPress={false}
        backdropStyle={{ backgroundColor: "rgba(0,0,0,0.6)" }}
        style={{ marginHorizontal: "auto", marginTop: "6%", width: 680, maxWidth: "94%", backgroundColor: C.panel, borderRadius: 10, borderWidth: 1, borderColor: C.line, padding: 16, gap: 10 }}>
        <View role="group" accessibilityLabel="许可证" style={{ gap: 10 }}>
          <Text role="header" style={{ color: C.text, fontSize: 15, fontWeight: "bold" }}>{`同意许可证 ${license()?.name ?? ""} 后继续安装`}</Text>
          <Text style={{ color: C.muted, fontSize: 12, lineHeight: 18 }}>下面是 Google 的 SDK 仓库清单里这份许可证的全文。同意后会记在 SDK 的 licenses 目录里，Android Studio 也认；不同意的话，这一项不会安装。</Text>
          <Scroll style={{ height: 420, borderRadius: 6, borderWidth: 1, borderColor: C.line, backgroundColor: C.bg }} contentStyle={{ padding: 10 }}>
            <Text style={{ color: C.text, fontSize: 12, lineHeight: 18, fontFamily: "monospace", userSelect: "text" }}>{license()?.text ?? ""}</Text>
          </Scroll>
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
            <Btn label="不同意" kind="danger" disabled={answered() === license()?.id} onPress={() => answer("emu.rejectLicenses")} />
            <Btn label="同意" disabled={answered() === license()?.id} onPress={() => answer("emu.acceptLicenses")} />
          </View>
        </View>
      </Dialog>
      <Dialog open={renameTarget() !== null} animation="fade" onOpenChange={({ open }) => { if (!open) renameTarget.set(null); }}
        backdropStyle={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        style={{ marginHorizontal: "auto", marginTop: "12%", width: 420, maxWidth: "92%", backgroundColor: C.panel, borderRadius: 10, borderWidth: 1, borderColor: C.line, padding: 16, gap: 10 }}>
        <If when={renameTarget()}>
          {(a) => (
            <View role="group" accessibilityLabel="重命名设备" style={{ gap: 10 }}>
              <Text role="header" style={{ color: C.text, fontSize: 15, fontWeight: "bold" }}>重命名设备</Text>
              <Text style={{ color: C.muted, fontSize: 12, lineHeight: 18 }}>{`只改显示的名字，Android Studio 里也会看到；设备 id ${a().name} 不变。`}</Text>
              <Input value={renameDraft()} onChange={({ value }) => { renameDraft.set(value); renameError.set(null); }} onSubmit={saveRename}
                autoFocus accessibilityLabel="设备名称" autoCorrect={false}
                style={{ height: 36, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: renameError() ? C.danger : C.line, backgroundColor: C.bg, color: C.text, fontSize: 13 }} />
              <If when={renameError()}>{(e) => <Text role="alert" style={{ color: C.danger, fontSize: 12, lineHeight: 18 }}>{e()}</Text>}</If>
              <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
                <Btn label="取消" onPress={() => renameTarget.set(null)} />
                <Btn label={renaming() ? "保存中…" : "保存"} kind="primary" disabled={renaming()} onPress={saveRename} />
              </View>
            </View>
          )}
        </If>
      </Dialog>
      <Dialog open={deleteTarget() !== null} animation="fade" onOpenChange={({ open }) => { if (!open && !deleting()) deleteTarget.set(null); }}
        backdropStyle={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        style={{ marginHorizontal: "auto", marginTop: "12%", width: 420, maxWidth: "92%", backgroundColor: C.panel, borderRadius: 10, borderWidth: 1, borderColor: C.line, padding: 16, gap: 10 }}>
        <If when={deleteTarget()}>
          {(a) => (
            <View role="group" accessibilityLabel="确认删除设备" style={{ gap: 10 }}>
              <Text role="header" style={{ color: C.text, fontSize: 15, fontWeight: "bold" }}>{`删除设备 ${avdLabel(a())}？`}</Text>
              <Text style={{ color: C.text, fontSize: 13, lineHeight: 20 }}>会删除这台设备的全部数据（已装的 App、文件、快照），不能恢复。系统镜像不会删除。</Text>
              <If when={live(a())}>
                <Text style={{ color: C.warn, fontSize: 13, lineHeight: 20 }}>这台设备正在运行，删除前会先停止它。</Text>
              </If>
              <If when={deleteError()}>{(e) => <Text role="alert" style={{ color: C.danger, fontSize: 12, lineHeight: 18, userSelect: "text" }}>{e()}</Text>}</If>
              <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
                <Btn label="取消" disabled={deleting()} onPress={() => deleteTarget.set(null)} />
                <Btn label={deleting() ? "删除中…" : "删除"} kind="danger" disabled={deleting()} onPress={confirmDelete} />
              </View>
            </View>
          )}
        </If>
      </Dialog>
      <Dialog open={rebootAsk()} animation="fade" onOpenChange={({ open }) => { if (!open) rebootAsk.set(false); }}
        backdropStyle={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        style={{ marginHorizontal: "auto", marginTop: "12%", width: 420, maxWidth: "92%", backgroundColor: C.panel, borderRadius: 10, borderWidth: 1, borderColor: C.line, padding: 16, gap: 10 }}>
        <View role="group" accessibilityLabel={kind() === "phone" ? "确认重启手机" : "确认重启模拟器"} style={{ gap: 10 }}>
          <Text role="header" style={{ color: C.text, fontSize: 15, fontWeight: "bold" }}>{kind() === "phone" ? "重启手机？" : "重启模拟器系统？"}</Text>
          <Text style={{ color: C.text, fontSize: 13, lineHeight: 20 }}>{kind() === "phone" ? "手机会重启，正在运行的 App 和未保存的内容会丢失。开机后自动重新连接，大约 1 分钟。" : "正在运行的 App 和未保存的内容会丢失，约 30 秒后恢复。"}</Text>
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
            <Btn label="取消" onPress={() => rebootAsk.set(false)} />
            <Btn label="重启" kind="danger" onPress={reboot} />
          </View>
        </View>
      </Dialog>
    </View>
  );
}

mount(App);
