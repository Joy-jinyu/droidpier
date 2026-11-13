import { cleanup, colorScheme, effect, host, Image, type JSX, mount, Scroll, setColorScheme, signal, Text, View } from "nsh";
import { Dialog, Input, Link, Radio, RadioGroup, Select, Tooltip } from "nsh/base";
import { middleEllipsis } from "./ellipsis";
import { isStaleStatus } from "./status-rev";
import { gbText, spaceCheck } from "../shared/disk-space";
import { AVD_DISK_MB, avdNameError, createItems, defaultAvdName, displayNameError, ramMbFor } from "../shared/avd-spec";
import { ADB_UNRESPONSIVE, NEEDS_JAVA, type Rotation } from "../shared/protocol";
import { parseTheme, type Theme } from "../shared/theme";
import { deviceFrame } from "../shared/screen";
import { parseZoom, stepZoom, ZOOM_STEPS } from "../shared/zoom";
import { h5PollMs } from "./h5-poll";
import { shouldCloseConsole, type ConsoleEvent } from "./console-gone";
import { foregroundPkg, h5KeyShown, pickPage } from "./h5-pages";
import { setupCardShown } from "./setup-card";

type State =
  | "connecting" | "connected" | "no-emulator" | "emulator-closed" | "booting" | "rebooting" | "disconnected"
  | "gateway-outdated" | "page-outdated"
  | "unsupported-browser" | "lna-denied" | "lna-prompt" | "bad-origin" | "no-gateway";
type Avd = { name: string; displayName?: string; width?: number; height?: number; apiLevel?: number; running: "no" | "grpc" | "no-grpc"; serial?: number };
type Boot = { name: string; progress: string; error?: string; seconds: number };
/** sticky：不自动消失，文字可选中复制，带关闭按钮。 */
type Notice = { text: string; error?: boolean; sticky?: boolean };
type Page = { socket: string; pkg?: string; id: string; title: string; url: string; visible: boolean };
type InspectResult = { opened: true } | { cancelled: true } | { hint: string } | { error: string; adbStuck?: boolean };
type Inspected = { key: string; title: string; serial: number };
type NavigateResult = { ok: boolean; title?: string; bridge?: boolean; error?: string; adbStuck?: boolean };
type WebViewsResult = { list: Page[]; error?: string; adbStuck?: boolean };
type Msg = { text: string; error?: boolean; adbStuck?: boolean };
type EnvId = "java" | "sdk" | "cmdline-tools" | "emulator" | "platform-tools" | "system-image" | "avd";
type Missing = { id: EnvId; detail: string; sizeMb?: number; diskMb?: number; command?: string; auto: boolean };
type Env = {
  ok: boolean; missing: Missing[]; sdkRoot: string; avdHome: string; androidCli: boolean;
  freeMb: number; avdFreeMb: number; sameDisk: boolean; error?: string;
};
type Licence = { id: number; name: string; text: string };
type InstallProgress = { id: string; phase: "download" | "unpack" | "license" | "install" | "done" | "failed"; pct?: number; logTail: string };
type Setup = { env: Env | null; installs: InstallProgress[]; license: Licence | null; rev: number };
type DeviceModel = { id: string; name: string; oem: string };
type SystemImage = { pkg: string; api: string; apiLevel: number; tag: string; installed: boolean; version?: string; sizeMb?: number; diskMb?: number };
type Catalog = {
  devices: DeviceModel[]; images: SystemImage[]; existing: string[]; defaultDevice: string | null; defaultImage: string | null;
  needTools: boolean; devicesError?: string; imagesError?: string;
};
type NewAvd = { name: string; device: DeviceModel; image: SystemImage };
type Upload = {
  id: number; name: string; size: number; kind: "apk" | "file";
  state: "waiting" | "uploading" | "installing" | "pushing" | "done" | "failed"; received: number; error?: string;
};
type Confirm = { kind: "install"; ids: EnvId[] } | { kind: "avd"; avd: NewAvd };

// 侧栏顶上回官网的链接；本机网关托管的页面也指向公网官网
const SITE_URL = "https://droid.devpier.dev/";

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
};

// 连不上时画面上方的说明；带命令的两种（gateway-outdated、no-gateway）命令由 host 在 upgrade 里给
const PROBLEM: Partial<Record<State, string>> = {
  "gateway-outdated": "网关版本过旧，请运行：",
  "page-outdated": "页面版本过旧，请强制刷新",
  "unsupported-browser": "请用 Chrome 或 Edge 打开",
  "lna-denied": "Chrome 阻止了访问本机：请到 设置 → 隐私和安全 → 网站设置 中允许本站访问本地网络，然后刷新",
  "lna-prompt": "Chrome 正在询问是否允许本站访问本机：请在地址栏旁的权限框里点「允许」",
  "bad-origin": "这个页面地址不在网关允许的来源里，请打开 https://droid.devpier.dev/app/",
  // 页面看不出装没装 droidpier；同一条命令没装时先装、装了直接启动
  "no-gateway": "还没连上本机的 Droidpier",
};

const ENV_NAME: Record<EnvId, string> = {
  java: "Java",
  sdk: "Android SDK 目录",
  "cmdline-tools": "命令行工具（cmdline-tools）",
  emulator: "模拟器程序（emulator）",
  "platform-tools": "adb (platform-tools)",
  "system-image": "系统镜像",
  avd: "模拟器设备",
};
// 装一项之前要先有的项，按安装顺序；网关按同样的顺序装
const ENV_NEEDS: Record<EnvId, EnvId[]> = {
  java: [],
  sdk: [],
  "cmdline-tools": ["sdk"],
  emulator: ["sdk", "cmdline-tools"],
  "platform-tools": ["sdk", "cmdline-tools"],
  "system-image": ["sdk", "cmdline-tools"],
  avd: ["sdk", "cmdline-tools", "system-image"],
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

// 机身边框（内边距 + 1 像素描边）和机身两边到按键的间距
const BEZEL = 11;
const DEVICE_GAP = 16;
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
      hoverStyle={{ backgroundColor: primary() ? C.primaryHover : C.hover }} focusStyle={{ borderColor: C.muted }}
      style={{
        height: 32, justifyContent: "center", backgroundColor: primary() ? C.accent : C.panel, borderRadius: 8, paddingHorizontal: 12,
        borderWidth: 1, borderColor: primary() ? C.accent : C.line, opacity: props.disabled ? 0.4 : 1,
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

/** H5 控制台：页面列表由 App 轮询后传进来（pages 为 null 表示还没读到）；refresh 让 App 立刻再读一次。
 * 只看前台页面所在的 App；还没在审查时自动审查它的前台页面，下拉框切到同一 App 的其他页面。
 * onInspect：控制台已在页面里打开。 */
function H5Console(props: {
  pages: () => Page[] | null; listError: () => Msg | null; refresh: () => void; inspected: () => Inspected | null; onReboot: () => void;
  onInspect: (key: string, title: string) => void; onClose: () => void;
}) {
  const pages = props.pages;
  const listError = props.listError;
  const selected = signal<string | null>(null);
  const address = signal("");
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

  const canNavigate = () => !!activePage() && address().trim() !== "" && !navigating();
  const navigate = () => {
    const p = activePage();
    if (!p || !canNavigate()) return;
    navigating.set(true);
    result.set(null);
    call<NavigateResult>("emu.navigate", { socket: p.socket, id: p.id, address: address().trim() }).then(
      (r: NavigateResult) => result.set(r.ok
        ? { text: `已跳转：${r.title ?? ""} JSBridge：${r.bridge ? "在" : "不在"}` }
        : { text: r.error ?? "跳转失败", error: true, adbStuck: r.adbStuck }),
      (e: Error) => result.set({ text: e.message, error: true }),
    ).finally(() => {
      navigating.set(false);
      props.refresh();
    });
  };

  const pageTitle = (p: Page) => `${p.title || middleEllipsis(p.url, URL_CHARS)}${p.visible ? "" : "（后台）"}`;
  const items = () => appPages().map((p) => ({ value: pageKey(p), title: pageTitle(p) }));
  // 控制台还没打开时盖在占位区上的说明
  const placeholder = () => {
    if (pages() === null) return "正在读取 H5 页面…";
    if (appPages().length === 0) return H5_EMPTY;
    return inspecting() ? "正在打开控制台…" : "";
  };

  return (
    <View role="region" accessibilityLabel="H5 控制台"
      style={{ flex: 1.2, minWidth: 0, borderLeftWidth: 1, borderColor: C.lineSoft }}>
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
            <View style={{ width: 200, height: 32, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.bg }}
              hoverStyle={{ borderColor: C.lineStrong }} focusStyle={{ borderColor: C.muted }}>
              <Text style={{ flex: 1, color: activePage() ? C.text : C.muted, fontSize: 13, numberOfLines: 1 }}>
                {activePage() ? pageTitle(activePage()!) : "没有页面"}
              </Text>
              <Icon name="chevron" size={14} tint={C.muted} />
            </View>
          } />
        <Input value={address()} onChange={({ value }) => address.set(value)} onSubmit={navigate}
          placeholder="localhost:5173/path" accessibilityLabel="跳转地址" autoCapitalize="none" autoCorrect={false}
          style={{ flex: 1, minWidth: 160, height: 32, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.bg, color: C.text, fontSize: 12, fontFamily: "monospace" }} />
        <Btn label={navigating() ? "跳转中…" : "跳转"} onPress={navigate} disabled={!canNavigate()} />
        <IconBtn icon="rotate" label="重新加载控制台" disabled={!props.inspected()} onPress={() => host.call("emu.devtoolsReload", {})} />
        <IconBtn icon="close" label="关闭控制台" onPress={props.onClose} />
      </View>
      <If when={inspectMsg() || listError() || result()}>
        <View style={{ gap: 4, paddingVertical: 6, paddingHorizontal: 12, borderBottomWidth: 1, borderColor: C.lineSoft }}>
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
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
};
type IconName = keyof typeof ICON_PATHS;
const iconSrc = (name: IconName) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name]}</svg>`)}`;

/** 线条图标（24 格的 SVG，按 tint 着色）。 */
function Icon(props: { name: IconName; size?: number; tint: string }) {
  const size = props.size ?? 18;
  return <Image src={iconSrc(props.name)} style={{ pointerEvents: "none", width: size, height: size, tintColor: props.tint }} />;
}

/** 只有图标的按钮：名字给读屏和悬停提示。 */
function IconBtn(props: { icon: IconName; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <View onPress={props.onPress} role="button" accessibilityLabel={props.label} disabled={props.disabled}
      tooltip={<Tip label={props.label} />}
      hoverStyle={{ backgroundColor: C.hover }} focusStyle={{ borderColor: C.muted }}
      style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 8, borderWidth: 1, borderColor: "transparent", opacity: props.disabled ? 0.4 : 1 }}>
      <Icon name={props.icon} size={16} tint={C.muted} />
    </View>
  );
}

function Tip(props: { label: string }) {
  return (
    <Tooltip placement="bottom">
      <View style={{ paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel }}>
        <Text style={{ color: C.text, fontSize: 12 }}>{props.label}</Text>
      </View>
    </Tooltip>
  );
}

/** 设备四周的按键：图标在上、名字在下；pressed 是开关类按键的开着状态。 */
function Key(props: { icon: IconName; label: string; onPress: () => void; disabled?: boolean; pressed?: boolean; tip?: string }) {
  return (
    <View onPress={props.onPress} role="button" accessibilityLabel={props.tip ? `${props.label}：${props.tip}` : props.label} disabled={props.disabled}
      tooltip={props.tip ? <Tip label={props.tip} /> : undefined}
      accessibilityState={props.pressed === undefined ? undefined : { pressed: props.pressed }}
      hoverStyle={{ backgroundColor: props.pressed ? C.accentSoft : C.hover }} focusStyle={{ borderColor: C.muted }}
      style={{
        width: 52, height: 52, alignItems: "center", justifyContent: "center", gap: 3, borderRadius: 10, borderWidth: 1, borderColor: "transparent",
        backgroundColor: props.pressed ? C.accentSoft : "transparent", opacity: props.disabled ? 0.4 : 1,
      }}>
      <Icon name={props.icon} tint={props.pressed ? C.accentText : C.keyText} />
      <Text style={{ color: props.pressed ? C.accentText : C.keyText, fontSize: 11 }}>{props.label}</Text>
    </View>
  );
}

/** 一组按键的底板。 */
function KeyGroup(props: { label: string; children: JSX.Element; row?: boolean; style?: object }) {
  return (
    <View role="group" accessibilityLabel={props.label}
      style={{ flexDirection: props.row ? "row" : "column", gap: props.row ? 20 : 4, padding: 6, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel, ...props.style }}>
      {props.children}
    </View>
  );
}

/** 设备画面缩放：缩小、当前比例（点一下回到适应窗口）、放大。 */
function ZoomControl(props: { zoom: number; onZoom: (z: number) => void }) {
  const percent = () => `${Math.round(props.zoom * 100)}%`;
  return (
    <View role="group" accessibilityLabel="画面缩放" style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
      <IconBtn icon="minus" label="缩小" disabled={props.zoom === ZOOM_STEPS[0]} onPress={() => props.onZoom(stepZoom(props.zoom, -1))} />
      <View onPress={() => props.onZoom(1)} role="button" accessibilityLabel={`缩放 ${percent()}，适应窗口`}
        tooltip={<Tip label="适应窗口" />}
        hoverStyle={{ backgroundColor: C.hover }} focusStyle={{ borderColor: C.muted }}
        style={{ minWidth: 48, height: 32, paddingHorizontal: 6, alignItems: "center", justifyContent: "center", borderRadius: 8, borderWidth: 1, borderColor: "transparent" }}>
        <Text style={{ color: C.muted, fontSize: 12 }}>{percent()}</Text>
      </View>
      <IconBtn icon="plus" label="放大" disabled={props.zoom === ZOOM_STEPS[ZOOM_STEPS.length - 1]} onPress={() => props.onZoom(stepZoom(props.zoom, 1))} />
    </View>
  );
}

const THEME_OPTIONS: { theme: Theme; icon: IconName; label: string }[] = [
  { theme: "system", icon: "monitor", label: "跟随系统" },
  { theme: "light", icon: "sun", label: "浅色" },
  { theme: "dark", icon: "moon", label: "深色" },
];

/** 页面外观三选一：跟随系统、浅色、深色。 */
function ThemePicker(props: { value: Theme; onPick: (t: Theme) => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 6 }}>
      <Text style={{ flex: 1, color: C.muted, fontSize: 12, fontWeight: "600" }}>外观</Text>
      <RadioGroup accessibilityLabel="外观" style={{ flexDirection: "row", gap: 2 }}>
        <Each of={THEME_OPTIONS} key={(o) => o.theme}>{(o) => (
          <Radio checked={props.value === o().theme} onChange={() => props.onPick(o().theme)} accessibilityLabel={o().label}
            tooltip={<Tip label={o().label} />}
            style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 8, borderWidth: 1, borderColor: "transparent" }}
            hoverStyle={{ backgroundColor: C.hover }} checkedStyle={{ backgroundColor: C.accentSoft }} focusStyle={{ borderColor: C.muted }}>
            <Icon name={o().icon} size={16} tint={props.value === o().theme ? C.accentText : C.muted} />
          </Radio>
        )}</Each>
      </RadioGroup>
    </View>
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
  const missingIds = () => props.env.missing.map((m) => m.id);
  const withNeeds = (id: EnvId): EnvId[] => [...ENV_NEEDS[id], id].filter((x) => missingIds().includes(x));
  const total = () => props.env.missing.reduce((n, m) => n + (m.sizeMb ?? 0), 0);
  // 没有 Java 时要跑 sdkmanager / avdmanager 的项都装不了，等用户装好 Java 再来
  const noJava = () => missingIds().includes("java");
  const blocked = (id: EnvId) => noJava() && NEEDS_JAVA.includes(id);
  // 设备要在“创建设备”对话框里选机型和系统版本，不在“全部安装”里
  const installable = () => missingIds().filter((id) => id !== "java" && id !== "avd");
  return (
    <View role="region" accessibilityLabel="环境检查"
      style={{ width: 560, maxWidth: "100%", gap: 10, backgroundColor: C.overlay, borderRadius: 8, padding: 12, borderWidth: 1, borderColor: C.warn }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Text role="header" style={{ color: C.text, fontSize: 14, fontWeight: "bold" }}>环境检查</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <If when={props.env.missing.length > 0 && installable().length > 0}>
            <Btn label={`全部安装（${sizeText(total())}）`} disabled={busy() || noJava()} onPress={() => props.onInstall({ ids: installable(), kind: "install" })} />
          </If>
          <If when={!busy()}>
            <Btn label="收起" onPress={props.onDismiss} />
          </If>
        </View>
      </View>
      <Text style={{ color: C.muted, fontSize: 12, lineHeight: 18 }}>
        {props.env.missing.length > 0
          ? `本机缺 ${props.env.missing.length} 项。点“安装”会先让你确认要下载什么、装到哪里。`
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
                  {`${ENV_NAME[m().id]}${m().sizeMb ? ` · ${sizeText(m().sizeMb!)}` : ""}`}
                </Text>
                <If when={m().auto}>
                  <If when={m().id === "avd"} else={
                    <Btn label="安装" disabled={busy() || blocked(m().id)} onPress={() => props.onInstall({ ids: withNeeds(m().id), kind: "install" })} />
                  }>
                    <Btn label="创建设备" disabled={busy() || blocked("avd")} onPress={props.onCreate} />
                  </If>
                </If>
              </View>
              <Text style={{ color: C.muted, fontSize: 12, lineHeight: 18 }}>{m().detail}</Text>
              <If when={m().command}>{(cmd) => <CopyCmd cmd={cmd()} />}</If>
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
                    <Text style={{ flex: 1, color: C.text, fontSize: 13 }}>{ENV_NAME[p().id as EnvId] ?? p().id}</Text>
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
        borderColor: "transparent", backgroundColor: "transparent",
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
function CreateAvd(props: { catalog: Catalog | null; loadError: string | null; onCancel: () => void; onNext: (a: NewAvd) => void; onInstallTools: () => void }) {
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
            <If when={!c().needTools} else={
              <View style={{ gap: 8 }}>
                <Text style={{ color: C.text, fontSize: 13, lineHeight: 20 }}>读取机型要用 avdmanager，本机还没有命令行工具（cmdline-tools）。先装好它，再回来选机型。</Text>
                <View style={{ flexDirection: "row" }}>
                  <Btn label="安装命令行工具" onPress={props.onInstallTools} />
                </View>
              </View>
            }>
              <If when={c().devicesError}>{(e) => <Text role="alert" style={{ color: C.danger, fontSize: 13, lineHeight: 20 }}>{e()}</Text>}</If>
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
            </If>
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
  const state = signal<State>("connecting");
  const serial = signal(0);
  const fps = signal(0);
  const latency = signal(0);
  const avds = signal<Avd[] | null>(null);
  const boots = signal<Record<string, Boot>>({});
  const notice = signal<Notice | null>(null);
  const upgrade = signal<string | null>(null);
  const cmdCopyResult = signal<"ok" | "fail" | null>(null);
  const h5Open = signal(false);
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
  // 重启：确认框；adb 无响应的提示条（输入时发现的）
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
  const device = () => (state() === "connected" ? serial() : 0);
  let listDevice = 0;
  let loading = false;
  let okStreak = 0;
  const refresh = () => {
    const dev = device();
    if (loading || !dev) return;
    loading = true;
    const failed = (msg: Msg) => {
      okStreak = 0;
      listError.set(msg);
      listAdbStuck.set(!!msg.adbStuck);
      closeIfGone({ kind: "list-failed" });
    };
    call<WebViewsResult>("emu.webviews", {}).then(
      (r: WebViewsResult) => {
        // 读的过程中设备换了：这份列表是旧设备的
        if (dev !== device()) return;
        if (r.error) return failed(r.adbStuck ? { text: r.error, error: true, adbStuck: true } : { text: `读取 H5 列表失败：${r.error}`, error: true });
        okStreak++;
        pages.set(r.list);
        listError.set(null);
        listAdbStuck.set(false);
        closeIfGone({ kind: "list", keys: r.list.map(pageKey) });
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
  const h5Key = () => h5KeyShown({ connected: device() !== 0, adbStuck: listAdbStuck(), consoleOpen: h5Open(), list: pages() });
  // 设备断开时控制台没有东西可看，和点关闭一样收起
  effect(() => {
    if (h5Open() && !device()) {
      closeDevtools();
      h5Open.set(false);
      showNotice({ text: "页面已关闭，控制台已收起" });
    }
  });

  let statusRev = -1;
  host.on("emu.status", (p: { state: State; serial: number; upgrade: string | null; rev: number }) => {
    if (isStaleStatus(p.rev, statusRev)) return;
    statusRev = p.rev;
    closeIfGone({ kind: "status", state: p.state, serial: p.serial ?? 0 });
    state.set(p.state);
    serial.set(p.serial ?? 0);
    upgrade.set(p.upgrade);
  });
  host.on("emu.stats", (p: { fps: number; latencyMs: number }) => {
    fps.set(p.fps);
    latency.set(p.latencyMs);
  });
  host.on("emu.avds", (p: { list: Avd[] }) => avds.set(p.list));
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
  host.call("emu.status", {}).then((s: { state: State; serial: number; rotation: number; fps: number; latencyMs: number; avds: Avd[] | null; boots: Boot[]; upgrade: string | null; rev: number; uploads?: Upload[] } & Omit<Setup, "rev">) => {
    applySetup({ env: s.env, installs: s.installs, license: s.license, rev: s.rev });
    applyUploads(s.uploads, s.rev);
    // 调用和结果之间到了更新的 emu.status 事件时，结果里的状态已过时
    if (!isStaleStatus(s.rev, statusRev)) {
      statusRev = s.rev;
      state.set(s.state);
      upgrade.set(s.upgrade);
      serial.set(s.serial);
    }
    rotation.set(s.rotation);
    fps.set(s.fps);
    latency.set(s.latencyMs);
    if (s.avds) avds.set(s.avds);
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
  const zoom = signal(1);
  host.call("emu.zoom", {}).then((z: unknown) => zoom.set(parseZoom(z)));
  const setZoom = (z: number) => {
    zoom.set(z);
    host.call("emu.setZoom", { zoom: z });
  };
  const deviceArea = signal({ width: 0, height: 0 });
  const sideKeys = signal({ left: 0, right: 0 });
  const frame = () => {
    const a = currentAvd();
    const area = deviceArea();
    const box = { width: area.width - sideKeys().left - sideKeys().right - 2 * DEVICE_GAP, height: area.height };
    return deviceFrame(box, { width: a?.width ?? 1080, height: a?.height ?? 2340 }, rotation() as Rotation, BEZEL, zoom());
  };
  const toggleH5 = () => {
    if (h5Open()) closeDevtools();
    h5Open.set(!h5Open());
  };
  const statusText = () => {
    const s = state();
    if (s === "connected") return `已连接 · ${fps()} 帧/秒 · 延迟 ${latency()} 毫秒`;
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
  // 对话框里点“安装命令行工具”：走环境检查同一个确认框，缺的前置项一起装
  const installTools = () => {
    createOpen.set(false);
    const missing = (env()?.missing ?? []).map((m) => m.id);
    const ids: EnvId[] = [...ENV_NEEDS["cmdline-tools"], "cmdline-tools"];
    confirm.set({ kind: "install", ids: ids.filter((id) => missing.includes(id)) });
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

  const DeviceRow = (props: { avd: () => Avd }) => {
    const a = props.avd;
    const boot = () => boots()[a().name];
    const current = () => a().running === "grpc" && a().serial === serial() && (state() === "connected" || state() === "rebooting");
    const spec = () => {
      const parts: string[] = [];
      if (a().width && a().height) parts.push(`${a().width}×${a().height}`);
      if (a().apiLevel) parts.push(ANDROID[a().apiLevel!] ? `Android ${ANDROID[a().apiLevel!]}` : `API ${a().apiLevel}`);
      return parts.join(" · ") || "规格未知";
    };
    const status = () => {
      if (a().running === "grpc") return current() ? "运行中 · 当前画面" : "运行中";
      if (a().running === "no-grpc") return "运行中但无法接管";
      const b = boot();
      return isBooting(b) ? `启动中 ${b!.seconds} 秒` : "未运行";
    };
    const statusColor = () =>
      a().running === "grpc" ? C.ok : a().running === "no-grpc" || isBooting(boot()) ? C.warn : C.muted;
    return (
      <View style={{ gap: 6, padding: 12, borderRadius: 12, backgroundColor: current() ? C.panel : "transparent", borderWidth: 1, borderColor: current() ? C.lineStrong : C.line }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: a().running === "no" ? C.idle : statusColor() }} />
          <Text style={{ flex: 1, color: C.text, fontSize: 13, lineHeight: 18, fontWeight: current() ? "600" : "500" }}>{avdLabel(a())}</Text>
          <IconBtn icon="pencil" label={`重命名 ${avdLabel(a())}`} onPress={() => openRename(a())} />
        </View>
        <Text style={{ color: C.muted, fontSize: 12, fontFamily: "monospace" }}>{spec()}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <Text style={{ color: statusColor(), fontSize: 12 }}>{status()}</Text>
          <If when={a().running === "no" && !isBooting(boot())}>
            <Btn label="启动" onPress={() => act(host.call("emu.start", { name: a().name }))} />
          </If>
          <If when={current()}>
            <Btn label="关闭" kind="danger" onPress={() => act(host.call("emu.stop", {}))} />
          </If>
          <If when={a().running === "grpc" && !current()}>
            <Btn label="切换到这台" onPress={() => act(host.call("emu.use", { name: a().name }))} />
          </If>
        </View>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: C.bg }}>
      <View role="navigation" accessibilityLabel="设备列表"
        style={{ width: 248, paddingVertical: 16, paddingHorizontal: 12, gap: 8, backgroundColor: C.bg }}>
        {/* Link 不认 hoverStyle / focusStyle，状态样式只能写 class，跟不了页面的浅色 / 深色切换：悬停用变淡，焦点框用两种外观下都看得见的 zinc-400 */}
        <Link href={SITE_URL} accessibilityLabel="Droidpier 官网首页"
          style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 6, paddingVertical: 4, marginBottom: 8, borderRadius: 6 }}
          class="hover:opacity-80 focus:outline-2 focus:outline-zinc-400">
          <Text style={{ color: C.text, fontSize: 14, fontWeight: "bold" }}>Droidpier</Text>
          <Text style={{ color: C.muted, fontSize: 12 }}>官网 ↗</Text>
        </Link>
        <Text style={{ color: C.muted, fontSize: 12, fontWeight: "600", paddingHorizontal: 6, paddingBottom: 4 }}>设备</Text>
        <If when={avds() !== null} else={<Text style={{ color: C.muted, fontSize: 13 }}>正在读取设备列表…</Text>}>
          <If when={(avds() ?? []).length > 0} else={
            <View style={{ gap: 8 }}>
              <Text style={{ color: C.muted, fontSize: 13, lineHeight: 20 }}>本机还没有模拟器设备</Text>
              <Btn label="创建设备" disabled={setupBusy() || !env()} onPress={openCreate} />
            </View>
          }>
            <Each of={avds()} key={(a) => a.name}>{(a) => <DeviceRow avd={a} />}</Each>
            <Btn label="新建设备" disabled={setupBusy() || !env()} onPress={openCreate} />
          </If>
        </If>
        <View style={{ flex: 1 }} />
        <ThemePicker value={theme()} onPick={pickTheme} />
      </View>
      <View style={{ flex: 1, minWidth: 0, marginVertical: 8, marginRight: 8, borderRadius: 12, borderWidth: 1, borderColor: C.lineSoft, backgroundColor: C.surface, overflow: "hidden" }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 12, paddingHorizontal: 20, borderBottomWidth: 1, borderColor: C.lineSoft }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minWidth: 0, flexShrink: 1 }}>
            <Text role="header" style={{ color: C.text, fontSize: 15, fontWeight: "600", numberOfLines: 1 }}>{currentAvd() ? avdLabel(currentAvd()!) : "没有连接设备"}</Text>
            <If when={h5Open() && foregroundPkg(pages() ?? [])}>
              {(pkg) => <Text style={{ flexShrink: 1, color: C.muted, fontSize: 12, fontFamily: "monospace", numberOfLines: 1 }}>{pkg()}</Text>}
            </If>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <ZoomControl zoom={zoom()} onZoom={setZoom} />
            <View style={{ width: 1, height: 16, marginHorizontal: 6, backgroundColor: C.line }} />
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: state() === "connected" ? C.ok : C.warn }} />
            <Text style={{ color: state() === "connected" ? C.muted : C.warn, fontSize: 12 }}>{statusText()}</Text>
          </View>
        </View>
        <View style={{ flex: 1, minHeight: 0, flexDirection: "row" }}>
        <View style={{ flex: 1, minWidth: 0, minHeight: 0, position: "relative" }}>
          <View style={{ flex: 1, minHeight: 0, alignItems: "center", justifyContent: "center", gap: 16, paddingVertical: 24, paddingHorizontal: 16 }}>
            <View onLayout={({ bounds }) => deviceArea.set({ width: bounds.size.width, height: bounds.size.height })}
              style={{ flex: 1, minHeight: 0, alignSelf: "stretch", alignItems: "center", justifyContent: "center" }}>
              {/* 放大到超出这块区域时两个方向都能滚动；没超出时居中 */}
              <Scroll style={{ flex: 1, alignSelf: "stretch" }} contentStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
              <Scroll horizontal style={{ alignSelf: "stretch" }} contentStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
              <View style={{ flexDirection: "row", gap: DEVICE_GAP }}>
                <View onLayout={({ bounds }) => sideKeys.set({ ...sideKeys(), left: bounds.size.width })} style={{ alignSelf: "flex-start", marginTop: 96 }}>
                  <KeyGroup label="工具">
                    <Key icon="rotateLeft" label="向左旋转" onPress={() => act(host.call("emu.rotate", { dir: "left" }))} />
                    <Key icon="rotateRight" label="向右旋转" tip="点过屏幕后按 ⌘→" onPress={() => act(host.call("emu.rotate", { dir: "right" }))} />
                    <Key icon="camera" label="截图" tip="点过屏幕后按 ⌘S" onPress={() => act(host.call("emu.screenshot", {}))} />
                    <Key icon="reboot" label={state() === "rebooting" ? "重启中" : "重启"} disabled={state() !== "connected"} onPress={() => rebootAsk.set(true)} />
                    <If when={h5Key()}>
                      <View style={{ height: 1, marginHorizontal: 8, marginVertical: 2, backgroundColor: C.line }} />
                      <Key icon="code" label="H5" pressed={h5Open()} onPress={toggleH5} />
                    </If>
                  </KeyGroup>
                </View>
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
                <View onLayout={({ bounds }) => sideKeys.set({ ...sideKeys(), right: bounds.size.width })} style={{ alignSelf: "flex-start", marginTop: 96, gap: 12 }}>
                  <KeyGroup label="电源键">
                    <Key icon="power" label="电源" tip="点过屏幕后按 ⌘P" onPress={() => key("Power")} />
                  </KeyGroup>
                  <KeyGroup label="音量键">
                    <Key icon="volUp" label="音量+" tip="点过屏幕后按 ⌘=" onPress={() => key("AudioVolumeUp")} />
                    <Key icon="volDown" label="音量−" tip="点过屏幕后按 ⌘-" onPress={() => key("AudioVolumeDown")} />
                  </KeyGroup>
                </View>
              </View>
              </Scroll>
              </Scroll>
            </View>
            <KeyGroup label="系统导航" row>
              <Key icon="back" label="返回" tip="点过屏幕后按 ⌘⌫" onPress={() => key("GoBack")} />
              <Key icon="home" label="主页" tip="点过屏幕后按 ⇧⌘H" onPress={() => key("GoHome")} />
              <Key icon="recents" label="最近" tip="点过屏幕后按 ⌘O" onPress={() => key("AppSwitch")} />
            </KeyGroup>
          </View>
          <View style={{ position: "absolute", top: 8, left: 0, right: 0, alignItems: "center", gap: 8 }}>
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
              {(e) => <SetupCard env={e()} installs={installs()} onInstall={(c) => confirm.set(c)} onCreate={openCreate} onDismiss={() => setupDismissed.set(true)} />}
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
        <If when={h5Open()}>
          <H5Console pages={pages} listError={listError} refresh={refresh} inspected={inspected} onReboot={() => rebootAsk.set(true)}
            onInspect={(key, title) => inspected.set({ key, title, serial: serial() })} onClose={toggleH5} />
        </If>
        </View>
      </View>
      <Dialog open={confirm() !== null} animation="fade" onOpenChange={({ open }) => { if (!open) confirm.set(null); }}
        backdropStyle={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        style={{ marginHorizontal: "auto", marginTop: "12%", width: 460, maxWidth: "92%", backgroundColor: C.panel, borderRadius: 10, borderWidth: 1, borderColor: C.line, padding: 16, gap: 10 }}>
        <If when={confirm()}>
          {(c) => {
            // 确认框列出的项和磁盘检查用的项：安装取环境检查里的缺失项，建设备取 createItems（和网关同一套）
            const items = (): Array<{ id: string; sizeMb?: number; diskMb?: number }> => {
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
                      {(i) => <Text style={{ color: C.text, fontSize: 13 }}>{`· ${ENV_NAME[i().id as EnvId]}${i().sizeMb ? `，${sizeText(i().sizeMb!)}` : ""}`}</Text>}
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
                  {`${space().downloadMb ? `下载约 ${gbText(space().downloadMb)}，` : ""}安装后约占 ${gbText(space().diskMb)}，${env()?.sdkRoot ?? ""} 所在磁盘剩余 ${gbText(env()?.freeMb ?? 0)}`}
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
                    {env()?.androidCli
                      ? "本机的命令行工具是 23 及以上版本：它可能不询问就接受 Google 的许可证，会往 ~/.android/bin 装约 90 MB 的程序、建 ~/.android/cli，并默认上报使用数据。也可以先删除 cmdline-tools/latest，让页面安装会逐项询问的 22.0。"
                      : "安装过程中会显示 Google 的许可证，你同意后才会继续。"}
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
          <CreateAvd catalog={catalog()} loadError={catalogError()} onCancel={() => createOpen.set(false)} onInstallTools={installTools}
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
          <Text style={{ color: C.muted, fontSize: 12, lineHeight: 18 }}>下面是 sdkmanager 给出的许可证全文。不同意的话，这一项不会安装。</Text>
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
      <Dialog open={rebootAsk()} animation="fade" onOpenChange={({ open }) => { if (!open) rebootAsk.set(false); }}
        backdropStyle={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        style={{ marginHorizontal: "auto", marginTop: "12%", width: 420, maxWidth: "92%", backgroundColor: C.panel, borderRadius: 10, borderWidth: 1, borderColor: C.line, padding: 16, gap: 10 }}>
        <View role="group" accessibilityLabel="确认重启模拟器" style={{ gap: 10 }}>
          <Text role="header" style={{ color: C.text, fontSize: 15, fontWeight: "bold" }}>重启模拟器系统？</Text>
          <Text style={{ color: C.text, fontSize: 13, lineHeight: 20 }}>正在运行的 App 和未保存的内容会丢失，约 30 秒后恢复。</Text>
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
