import { inputToMsgs, keyToMsg, pasteToMsgs, shortcutToMsg, textToMsgs, toDevice, wheelToSwipe } from "../../shared/input-map.ts";
import { fitSize, frameLatencyMs } from "../../shared/screen.ts";
import { createClipSync } from "./clip-sync.ts";
import { createConnection, type BootMsg, type ConnState, type VersionErrorCode } from "./connection.ts";
import { createHeldKeys } from "./held-keys.ts";
import { createPointerTracker } from "./pointer.ts";
import { isDevtoolsSrc } from "./devtools-src.ts";
import { gatewayPort, isLoopbackHost, isSupportedBrowser, parsePort, type LocalPermission } from "./launch.ts";
import { createRenderer } from "./renderer.ts";
import { createUploads } from "./uploads.ts";
import { parseZoom, ZOOM_STEPS } from "../../shared/zoom.ts";
import { parseTheme, THEMES } from "../../shared/theme.ts";
import { registerTools } from "./webmcp.ts";
import { INSTALL_CMD, INSTALL_IDS, type AvdCatalog, type AvdInfo, type ClientMsg, type EnvItemId, type EnvReport, type InstallProgress, type Licence, type Rotation } from "../../shared/protocol.ts";

// 以前记端口和启动口令的键，都不用了，清掉
const OLD_KEYS = ["droidpier.port", "droidpier.launch"];

// 网关不在默认端口时它打开的是 /app/#port=<端口>；# 一直留在地址栏里，刷新也还在
function resolvePort(): number {
  try {
    for (const k of OLD_KEYS) localStorage.removeItem(k);
  } catch {}
  return gatewayPort({ hashPort: parsePort(location.hash), loc: location });
}

// Chrome 不同版本给这个权限起过不同的名字，挨个试；都不认就是 null
async function localPermission(): Promise<LocalPermission> {
  for (const name of ["loopback-network", "local-network-access", "local-network"]) {
    try {
      return (await navigator.permissions.query({ name } as unknown as PermissionDescriptor)).state;
    } catch {}
  }
  return null;
}
const GATEWAY_PORT = resolvePort();
// 设备画面的缩放存在这台浏览器里；存储不可用（隐私模式等）时每次都适应窗口
const ZOOM_KEY = "droidpier.zoom";
// 页面外观存在这台浏览器里；存储不可用（隐私模式等）时每次都跟随系统
const THEME_KEY = "droidpier.theme";
// 还不知道设备尺寸、容器也没量出来时，hello 用这个尺寸（网关会夹到设备尺寸内）
const FALLBACK_CSS = { width: 540, height: 1170 };
const RESIZE_DEBOUNCE_MS = 150;

type Player = { hostEvent(name: string, payload: unknown): void };
type Boot = BootMsg & { seconds: number };

/** nsh web.host 入口：把模拟器画面按比例放进 testID="screen"，转发输入，回答 emu.* 调用。 */
export async function createHost(player: Player) {
  let dpr = window.devicePixelRatio || 1;
  let rotation: Rotation = 0;
  let device = { width: 0, height: 0 };
  let serial = 0;
  // 画布当前的 CSS 尺寸，由容器大小和设备宽高比算出
  let css = { width: 0, height: 0 };
  let slotSize = { width: 0, height: 0 };
  const size = () => {
    const base = css.width ? css : slotSize.width ? slotSize : FALLBACK_CSS;
    return { width: Math.round(base.width * dpr), height: Math.round(base.height * dpr) };
  };

  // box 铺满占位 View，画布在里面居中；box 绝对定位，不会反过来撑大占位 View
  const box = document.createElement("div");
  box.style.cssText = "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden";
  const frame = document.createElement("div");
  frame.style.cssText = "position:relative";
  const canvas = document.createElement("canvas");
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "模拟器屏幕");
  // 输入法组字只发生在可编辑元素上：键盘焦点实际放在这个隐藏的 textarea 上
  const ime = document.createElement("textarea");
  ime.setAttribute("aria-hidden", "true");
  ime.tabIndex = -1;
  ime.autocapitalize = "off";
  ime.spellcheck = false;
  ime.style.cssText = "position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;padding:0;border:0;resize:none;pointer-events:none";
  frame.append(canvas, ime);
  box.append(frame);

  // 页面状态只存在这里：App 挂载前发的事件会丢，App 挂载后靠 emu.status 一次拿全
  let state: ConnState | VersionErrorCode | "unsupported-browser" = "connecting";
  let upgrade: string | null = null;
  // 每发一次 emu.status 事件加一；App 用它丢掉比已应用的旧的那份
  let rev = 0;
  const paint = () => {
    // 没接上设备时旧画面变暗，避免看起来还连着
    const dim = state !== "connected";
    canvas.style.cssText = `width:${css.width}px;height:${css.height}px;display:block;outline:none;touch-action:none;background:#000;transition:opacity .2s;opacity:${dim ? 0.3 : 1}`;
  };

  let lastSent = { width: 0, height: 0 };
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  const sendResize = () => {
    if (resizeTimer !== null) { clearTimeout(resizeTimer); resizeTimer = null; }
    const want = size();
    if (want.width === lastSent.width && want.height === lastSent.height) return;
    if (conn.control({ t: "resize", ...want })) lastSent = want;
  };
  // 按容器重新算画布尺寸；debounce 为真时（拖动窗口）晚一点再让网关换尺寸
  const layout = (debounce: boolean) => {
    const next = fitSize(slotSize, device, rotation);
    if (next.width !== css.width || next.height !== css.height) {
      css = next;
      paint();
    }
    if (!debounce) sendResize();
    else {
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(sendResize, RESIZE_DEBOUNCE_MS);
    }
  };
  const ro = new ResizeObserver(() => {
    const slot = box.parentElement;
    if (!slot) return;
    slotSize = { width: slot.clientWidth, height: slot.clientHeight };
    layout(true);
  });

  let draws = 0;
  let latencyMs = 0;
  let stats = { fps: 0, latencyMs: 0 };

  const renderer = createRenderer(canvas, (tsMs) => {
    draws++;
    latencyMs = frameLatencyMs(Date.now(), tsMs);
  });
  // 页面没焦点等情况下写不进系统剪贴板，交给 TSX 显示提示条，用户点一下再写；text 为 null 时收起
  const clipSync = createClipSync(
    (text) => navigator.clipboard.writeText(text),
    (text) => player.hostEvent("emu.clip", { text }),
  );

  // 环境检查和安装状态：同 state，App 挂载后靠 emu.status 一次拿全，之后靠 emu.setup 事件（带 rev）
  let env: EnvReport | null = null;
  let installs: InstallProgress[] = [];
  let license: Licence | null = null;
  const setupEvent = () => player.hostEvent("emu.setup", { env, installs, license, rev: ++rev });
  // 创建设备对话框的目录：App 调 emu.catalog 时向网关要一份新的，先返回手上的
  let catalog: AvdCatalog | null = null;

  let avds: AvdInfo[] | null = null;
  let avdWaiters: Array<(l: AvdInfo[]) => void> = [];
  const boots = new Map<string, { since: number; last: Boot }>();
  const refreshAvds = () => conn.control({ t: "avds" });

  // 拖进来的文件：传输状态只在这里，App 靠 emu.status 拿全、之后靠 emu.uploads 事件（带 rev）
  const uploads = createUploads({
    send: (m) => conn.control(m),
    sendBinary: (b) => conn.sendBinary(b),
    onChange: (list) => player.hostEvent("emu.uploads", { list, rev: ++rev }),
    onNotice: (text) => player.hostEvent("emu.notice", { text }),
    replyTimeoutMs: 10_000,
  });

  const supported = isSupportedBrowser((navigator as { userAgentData?: { brands: { brand: string }[] } }).userAgentData?.brands);
  if (!supported) state = "unsupported-browser";
  const statusEvent = () => player.hostEvent("emu.status", { state, serial, upgrade, rev: ++rev });
  const conn = !supported ? idleConnection() : createConnection({
    url: `ws://127.0.0.1:${GATEWAY_PORT}`,
    hidden: () => document.hidden,
    pageIsPublic: !isLoopbackHost(location.hostname),
    localPermission,
    size,
    onOpen: () => {
      lastSent = size();
      // 网关会在 hello 后重发当前的安装进度和许可证
      installs = [];
      license = null;
      setupEvent();
      if (document.hidden) conn.control({ t: "pause" });
      refreshAvds();
    },
    onState: (s) => {
      const prev = state;
      state = s;
      // 没连上本机网关时页面给出安装命令
      upgrade = s === "no-gateway" ? INSTALL_CMD : null;
      paint();
      // 重启中还是同一台设备
      if (s !== "connected" && s !== "rebooting") serial = 0;
      statusEvent();
      // 设备开了、关了、换了，列表里的运行状态跟着变
      if (prev !== s && s !== "connecting" && s !== "disconnected") refreshAvds();
    },
    onReady: (d, sn) => {
      device = d;
      serial = sn;
      layout(false);
      statusEvent();
      refreshAvds();
    },
    onOrientation: (r) => {
      if (r === rotation) return;
      // 方向变了，正按着的手指按旧方向换算过，先抬起
      pointer.cancel();
      rotation = r;
      layout(false);
      player.hostEvent("emu.orientation", { rotation });
    },
    onFrame: (h, px) => renderer.put(px, h.width, h.height, h.tsMs),
    onScreenshot: (name, png) => {
      const blob = new Blob([png], { type: "image/png" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      player.hostEvent("emu.notice", { text: `已保存截图 ${name}` });
    },
    onClip: (text) => clipSync.onClip(text),
    onAvds: (list) => {
      avds = list;
      player.hostEvent("emu.avds", { list });
      const w = avdWaiters;
      avdWaiters = [];
      for (const f of w) f(list);
    },
    onBoot: (b) => {
      const now = Date.now();
      const prev = boots.get(b.name);
      // 新一轮启动（之前那次已经结束）重新计时
      const since = prev && (prev.last.progress === "spawning" || prev.last.progress === "booting") ? prev.since : now;
      const boot: Boot = { ...b, seconds: Math.floor((now - since) / 1000) };
      boots.set(b.name, { since, last: boot });
      player.hostEvent("emu.boot", boot);
      if (b.progress === "ready" || b.progress === "failed") refreshAvds();
    },
    onEnv: (e) => {
      env = e;
      setupEvent();
      refreshAvds();
    },
    onInstall: (p) => {
      installs = [...installs.filter((x) => x.id !== p.id), p];
      setupEvent();
    },
    onLicenses: (l) => {
      license = l;
      setupEvent();
    },
    onUpload: (m) => uploads.onMsg(m),
    onClose: () => uploads.disconnected(),
    onCatalog: (c) => {
      catalog = c;
      player.hostEvent("emu.catalog", { catalog, rev: ++rev });
    },
    onError: (message) => player.hostEvent("emu.notice", { text: message, error: true }),
    onAdbStuck: (message) => player.hostEvent("emu.adbStuck", { message }),
    onReboot: (result, error) => player.hostEvent("emu.notice", result === "done"
      ? { text: "模拟器已重启" }
      : result === "adb-down"
        ? { text: "模拟器已重启，但里面的 adb 还没有响应：H5 调试暂时不可用", error: true }
        : { text: `重启失败：${error ?? "未知原因"}`, error: true }),
    onVersionError: (code, cmd) => {
      state = code;
      upgrade = cmd;
      serial = 0;
      paint();
      statusEvent();
    },
  });
  paint();

  setInterval(() => {
    stats = { fps: draws, latencyMs: draws ? latencyMs : stats.latencyMs };
    draws = 0;
    player.hostEvent("emu.stats", stats);
  }, 1000);

  // DPR 变化（页面缩放、换屏）时按新尺寸取帧
  const watchDpr = () => {
    const mq = matchMedia(`(resolution: ${dpr}dppx)`);
    mq.addEventListener(
      "change",
      () => {
        dpr = window.devicePixelRatio || 1;
        layout(false);
        watchDpr();
      },
      { once: true }
    );
  };
  watchDpr();

  const heldKeys = createHeldKeys((m) => conn.send(m));

  // 滚轮转滑动：50ms 合并，滑动发完再发下一组
  let wheelAccDelta = 0;
  let wheelAt = { x: 0, y: 0 };
  let wheelTimer: ReturnType<typeof setTimeout> | null = null;
  let swipeSending = false;
  let swipePendingDelta = 0;
  let swipePendingAt = { x: 0, y: 0 };
  let swipeGen = 0;
  let swipeLastX = 0;
  let swipeLastY = 0;

  // 中断滚轮滑动：无论是否在发，都清掉还没触发的合并 timer 和累积；正在发时补发 touch-up
  function abortWheelSwipe(): void {
    if (wheelTimer !== null) { clearTimeout(wheelTimer); wheelTimer = null; }
    wheelAccDelta = 0;
    swipePendingDelta = 0;
    if (!swipeSending) return;
    swipeGen++;
    swipeSending = false;
    conn.send({ t: "touch", x: swipeLastX, y: swipeLastY, down: false });
  }

  async function sendWheelSwipe(deltaY: number, at: { x: number; y: number }): Promise<void> {
    const steps = wheelToSwipe(deltaY, at, device, rotation);
    if (steps.length === 0) return; // 位移为 0 或不足 min-swipe，丢弃
    const gen = ++swipeGen;
    swipeSending = true;
    swipeLastX = at.x;
    swipeLastY = at.y;
    for (const step of steps) {
      if (step.delayMs > 0) await new Promise<void>((r) => setTimeout(r, step.delayMs));
      if (swipeGen !== gen) return; // 已被中断，调用方已补发 touch-up
      conn.send({ t: "touch", x: step.x, y: step.y, down: step.down });
      swipeLastX = step.x;
      swipeLastY = step.y;
    }
    if (swipeGen !== gen) return;
    swipeSending = false;
    if (swipePendingDelta !== 0) {
      const pd = swipePendingDelta;
      const pa = swipePendingAt;
      swipePendingDelta = 0;
      sendWheelSwipe(pd, pa);
    }
  }

  // 失焦或页面隐藏时补发 keyup 并释放触摸，防止 Android 侧卡键/卡触
  const releaseAll = () => {
    heldKeys.releaseAll();
    pointer.cancel();
    abortWheelSwipe(); // 页面隐藏后 timer 被节流到 ≥1s，必须立即中断
  };

  // 鼠标按下状态，供滚轮处理器判断是否有拖拽进行中
  let pointerIsDown = false;
  const pointer = createPointerTracker((m) => conn.send(m), () => ({ rect: canvas.getBoundingClientRect(), device, rotation }));
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !device.width) return;
    e.preventDefault();
    pointerIsDown = true;
    abortWheelSwipe(); // 中断进行中的滚轮滑动，防止 pointer id 0 上 touch 事件交叉
    ime.focus({ preventScroll: true });
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}
    pointer.down(e);
  });
  canvas.addEventListener("pointermove", (e) => pointer.move(e));
  canvas.addEventListener("pointerup", (e) => { pointerIsDown = false; pointer.up(e); });
  canvas.addEventListener("pointercancel", () => { pointerIsDown = false; pointer.cancel(); });
  canvas.addEventListener("lostpointercapture", () => { pointerIsDown = false; pointer.cancel(); });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    // 画面上的滚轮只给设备：nsh 在根元素上自己滚动滚动视图、不看 preventDefault，不拦住的话放大后设备区会跟着滚
    e.stopPropagation();
    if (pointerIsDown || !device.width) return;
    // deltaMode 转换：PIXEL(0) 不变；LINE(1) ×40px；PAGE(2) × canvas CSS 高度
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 40;
    else if (e.deltaMode === 2) dy *= css.height;
    if (dy === 0) return; // 纯横向滚动（Shift+wheel 等），忽略
    const rect = canvas.getBoundingClientRect();
    const at = toDevice({ x: e.clientX, y: e.clientY }, rect, device, rotation);
    if (swipeSending) {
      swipePendingDelta += dy;
      swipePendingAt = at;
      return;
    }
    wheelAccDelta += dy;
    wheelAt = at;
    if (wheelTimer !== null) clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => {
      wheelTimer = null;
      // 指针已按下：这次滑动会和拖拽交叉，丢掉
      if (pointerIsDown || wheelAccDelta === 0) return;
      // 位移太小时不发、保留累积，等后续滚动补足；wheelToSwipe 返回 [] 判断
      if (wheelToSwipe(wheelAccDelta, wheelAt, device, rotation).length === 0) return;
      const delta = wheelAccDelta;
      wheelAccDelta = 0;
      sendWheelSwipe(delta, wheelAt);
    }, 50);
  }, { passive: false });
  canvas.addEventListener("focus", () => ime.focus({ preventScroll: true }));

  const onKey = (type: "keydown" | "keyup") => (e: KeyboardEvent) => {
    // 229：输入法正在处理这个键
    if (e.keyCode === 229) return;
    if (type === "keydown") {
      const s = shortcutToMsg(e);
      if (s) {
        // 按住不放会自动重复：电源会反复亮灭屏、截图会连拍，只认第一下；重复的也拦下，不让浏览器缩放、存网页
        e.preventDefault();
        if (!e.repeat) conn.send(s);
        return;
      }
    }
    const m = keyToMsg(e, type);
    if (!m) return;
    e.preventDefault();
    conn.send(m);
    heldKeys.onMsg(m);
  };
  ime.addEventListener("keydown", onKey("keydown"));
  ime.addEventListener("keyup", onKey("keyup"));
  ime.addEventListener("blur", releaseAll);
  canvas.addEventListener("blur", releaseAll);
  window.addEventListener("blur", releaseAll);
  // 标签页在后台时让网关停推画面
  document.addEventListener("visibilitychange", () => {
    player.hostEvent("emu.visibility", { hidden: document.hidden });
    if (document.hidden) {
      releaseAll();
      conn.control({ t: "pause" });
    } else {
      conn.wake();
      conn.control({ t: "resume" });
      refreshAvds();
    }
  });
  ime.addEventListener("compositionend", (e) => {
    if (e.data) for (const m of textToMsgs(e.data)) conn.send(m);
    ime.value = "";
  });
  // Cmd+V：keyToMsg 放过了 Cmd 组合键，浏览器在焦点元素上触发 paste
  const onPaste = (e: ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain");
    for (const m of pasteToMsgs(text ?? "")) conn.send(m);
  };
  ime.addEventListener("paste", onPaste);
  canvas.addEventListener("paste", onPaste);
  ime.addEventListener("input", (e) => {
    const ie = e as InputEvent;
    if (ie.isComposing) return;
    for (const m of inputToMsgs(ie)) conn.send(m);
    ime.value = "";
  });

  // 文件拖到屏幕上：APK 安装，其他文件放进下载文件夹。拖到屏幕外不让浏览器自己打开文件
  const dropBlocked = () =>
    state === "connected" ? null : state === "rebooting" ? "模拟器正在重启，等它开机后再试" : "没有连接设备";
  const takeFiles = (list: File[]) => {
    const why = dropBlocked();
    if (why) return player.hostEvent("emu.notice", { text: why, error: true });
    if (list.length) uploads.add(list);
  };
  const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");
  let dragDepth = 0;
  let shownBlocked: string | null = null;
  const dragEvent = (active: boolean) => {
    shownBlocked = dropBlocked();
    player.hostEvent("emu.drag", { active, blocked: shownBlocked });
  };
  box.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (dragDepth++ === 0) dragEvent(true);
  });
  box.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    // 拖着的过程中设备断开或开始重启：遮罩跟着变
    if (dropBlocked() !== shownBlocked) dragEvent(true);
    e.dataTransfer!.dropEffect = dropBlocked() ? "none" : "copy";
  });
  box.addEventListener("dragleave", (e) => {
    if (!hasFiles(e) || --dragDepth > 0) return;
    dragDepth = 0;
    dragEvent(false);
  });
  box.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepth = 0;
    dragEvent(false);
    takeFiles([...e.dataTransfer!.files]);
  });
  window.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = "none";
  });
  window.addEventListener("drop", (e) => { if (hasFiles(e)) e.preventDefault(); });

  // 占位 View 由 nsh 渲染；出现后把画面和 DevTools 放进去，被重新渲染移走时放回
  // DevTools 前端（appspot）嵌在页面里，连的是 127.0.0.1 网关：Chrome 的本地网络访问检查要求 iframe 显式委托权限，
  // 不加 allow 时 WebSocket 报 ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS（实测 Chrome 157）
  const devtools = document.createElement("iframe");
  devtools.title = "DevTools";
  devtools.allow = "local-network-access; local-network; loopback-network; clipboard-write";
  devtools.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff";
  // 地址里的票据只能用一次，重新加载要再要一个地址
  let devtoolsPage: { socket: string; id: string } | null = null;
  // 每次关闭控制台加一：关闭前发出的 inspect，回复晚到时不再打开
  let devtoolsGen = 0;
  const attach = () => {
    const slot = document.querySelector('[data-testid="screen"]');
    if (slot && box.parentElement !== slot) {
      if (box.parentElement) ro.unobserve(box.parentElement);
      slot.appendChild(box);
      ro.observe(slot);
    }
    const dslot = document.querySelector('[data-testid="devtools"]');
    if (dslot && devtools.parentElement !== dslot) dslot.appendChild(devtools);
  };
  new MutationObserver(attach).observe(document.documentElement, { childList: true, subtree: true });
  attach();

  // 浏览器里的 AI 助手（WebMCP）能调用的工具；会改状态的操作在 webmcp.ts 里先弹确认
  registerTools({
    connected: () => state === "connected" && device.width > 0,
    device: () => device,
    rotation: () => rotation,
    async snapshot() {
      const f = renderer.shown();
      if (!f) return null;
      // 帧里的 alpha 不可靠（画的时候只用 rgb），转成不透明再编码
      const px = new Uint8ClampedArray(f.pixels);
      for (let i = 3; i < px.length; i += 4) px[i] = 255;
      const oc = new OffscreenCanvas(f.width, f.height);
      oc.getContext("2d")!.putImageData(new ImageData(px, f.width, f.height), 0, 0);
      return { width: f.width, height: f.height, jpeg: await oc.convertToBlob({ type: "image/jpeg", quality: 0.8 }) };
    },
    send: (m) => conn.send(m),
    control: (m) => conn.control(m),
    avds: () => (refreshAvds() ? new Promise<AvdInfo[]>((res) => avdWaiters.push(res)) : Promise.resolve(avds ?? [])),
    webviews: () => conn.request({ t: "webviews" }).then((r) => ({ list: r.list, error: r.error })),
    navigate: (socket, id, address) => conn.request({ t: "navigate", socket, id, address })
      .then(({ ok, href, title, error }) => ({ ok, href, title, error })),
    async installApk(file, signal) {
      const before = new Set(uploads.list().map((i) => i.id));
      uploads.add([file]);
      const id = uploads.list().find((i) => !before.has(i.id))?.id;
      // 和网关 adb 长任务的超时一样是 10 分钟，到点不再等，安装本身不受影响
      const until = Date.now() + 10 * 60_000;
      for (;;) {
        const it = uploads.list().find((i) => i.id === id);
        if (!it) return { state: "failed", error: "传输记录不见了" };
        if (it.state === "done" || it.state === "failed") return { state: it.state, error: it.error };
        if (signal.aborted) return { state: it.state, error: "调用方取消了等待，安装仍在继续，进度看页面" };
        if (Date.now() > until) return { state: it.state, error: "等了 10 分钟还没装完，进度看页面" };
        await new Promise((r) => setTimeout(r, 500));
      }
    },
    confirm: (text) => window.confirm(text),
  });

  const sent = (m: ClientMsg) => ({ ok: conn.send(m) });
  const ctl = (m: ClientMsg) => ({ ok: conn.control(m) });
  const needName = (fn: string, args: unknown) => {
    const name = (args as { name?: unknown } | undefined)?.name;
    if (typeof name !== "string") throw new Error(`${fn} 需要 name`);
    return name;
  };
  const needPage = (fn: string, args: unknown) => {
    const a = args as { socket?: unknown; id?: unknown } | undefined;
    if (typeof a?.socket !== "string" || typeof a.id !== "string") throw new Error(`${fn} 需要 socket 和 id`);
    return { socket: a.socket, id: a.id };
  };

  const inspect = (page: { socket: string; id: string }) => {
    const gen = devtoolsGen;
    return conn.request({ t: "inspect", ...page }).then((r) => {
      if (gen !== devtoolsGen) return { cancelled: true };
      if ("url" in r) {
        if (!isDevtoolsSrc(r.url, String(GATEWAY_PORT))) return { error: "DevTools 前端地址不可信，已拒绝打开" };
        devtoolsPage = page;
        devtools.src = r.url;
        return { opened: true };
      }
      if ("hint" in r) return { hint: r.hint };
      return { error: r.error, adbStuck: r.code === "adb-unresponsive" };
    });
  };

  return {
    call(name: string, args: { key?: string; text?: string; name?: string; address?: string; dir?: string } | undefined) {
      if (name === "emu.key") {
        if (typeof args?.key !== "string") throw new Error("emu.key 需要 key");
        return sent({ t: "key", key: args.key, eventType: "keypress" });
      }
      // 顺时针不带 dir，旧网关也照样能转；旧网关不认 dir，会把逆时针也转成顺时针
      if (name === "emu.rotate") return sent(args?.dir === "left" ? { t: "rotate", dir: "left" } : { t: "rotate" });
      if (name === "emu.screenshot") return sent({ t: "screenshot" });
      // 确认框里点了“重启”才调用
      if (name === "emu.reboot") return state === "connected" ? ctl({ t: "reboot" }) : { ok: false };
      // 下一份列表到了再返回；没连上网关时直接给缓存
      if (name === "emu.avds") {
        if (!refreshAvds()) return avds ?? [];
        return new Promise<AvdInfo[]>((res) => avdWaiters.push(res));
      }
      if (name === "emu.start") return ctl({ t: "start", name: needName(name, args) });
      if (name === "emu.use") return ctl({ t: "use", name: needName(name, args) });
      if (name === "emu.stop") return state === "connected" ? ctl({ t: "stop" }) : { ok: false };
      // 提示条上的按钮调用，处在用户点击里
      if (name === "emu.copy") {
        if (typeof args?.text !== "string") throw new Error("emu.copy 需要 text");
        return navigator.clipboard.writeText(args.text).then(() => ({ ok: true }));
      }
      if (name === "emu.webviews") {
        // 读失败不抛：adbStuck 时页面要就地给出“重启模拟器”
        return conn.request({ t: "webviews" }).then((r) => ({ list: r.list, error: r.error, adbStuck: r.code === "adb-unresponsive" }));
      }
      // 拿到前端地址就在 testID="devtools" 的占位 View 里显示，返回 opened 让 TSX 展开控制台
      if (name === "emu.inspect") return inspect(needPage(name, args));
      if (name === "emu.devtoolsReload") {
        if (!devtoolsPage) return { ok: false };
        return inspect(devtoolsPage).then((r) => ({ ok: "opened" in r, ...r }));
      }
      // 断开 DevTools 连接，不然网关代理和 WebView 调试会话一直挂着
      if (name === "emu.devtoolsClose") {
        devtoolsGen++;
        devtoolsPage = null;
        devtools.src = "about:blank";
        return { ok: true };
      }
      if (name === "emu.navigate") {
        if (typeof args?.address !== "string") throw new Error("emu.navigate 需要 address");
        return conn.request({ t: "navigate", ...needPage(name, args), address: args.address })
          .then(({ ok, href, title, bridge, error, code }) => ({ ok, href, title, bridge, error, adbStuck: code === "adb-unresponsive" }));
      }
      // 失败不抛，页面就地显示原因；旧网关不认这条消息，等满超时后同样走这里
      if (name === "emu.renameAvd") {
        const displayName = (args as { displayName?: unknown } | undefined)?.displayName;
        if (typeof displayName !== "string") throw new Error("emu.renameAvd 需要 displayName");
        return conn.request({ t: "renameAvd", name: needName(name, args), displayName }).then(
          (r) => ({ ok: r.ok, error: r.error }),
          (e: Error) => ({ ok: false, error: e.message.endsWith("没有回应") ? `${e.message}，可能需要更新 droidpier` : e.message }),
        );
      }
      if (name === "emu.status") {
        return {
          state, serial, upgrade, rev, rotation, ...stats, avds, boots: [...boots.values()].map((b) => b.last),
          env, installs, license, uploads: uploads.list(),
        };
      }
      if (name === "emu.uploadsClear") {
        uploads.clear();
        return { ok: true };
      }
      // 页面确认框里点了确认才调用
      if (name === "emu.install") {
        const ids = (args as { ids?: unknown } | undefined)?.ids;
        if (!Array.isArray(ids) || !ids.every((id) => (INSTALL_IDS as readonly unknown[]).includes(id))) throw new Error("emu.install 需要 ids");
        // 新一轮安装：上一轮的进度不再显示
        installs = [];
        setupEvent();
        return ctl({ t: "install", ids: ids as EnvItemId[] });
      }
      if (name === "emu.catalog") {
        const ok = conn.control({ t: "catalog" });
        return { ok, catalog, rev };
      }
      // 页面确认框里点了确认才调用
      if (name === "emu.createAvd") {
        const a = args as { name?: unknown; device?: unknown; image?: unknown } | undefined;
        if (typeof a?.name !== "string" || typeof a.device !== "string" || typeof a.image !== "string") throw new Error("emu.createAvd 需要 name、device、image");
        installs = [];
        setupEvent();
        return ctl({ t: "createAvd", name: a.name, device: a.device, image: a.image });
      }
      // 带着页面上显示的那份许可证的 id：网关只认正在等的那份
      if (name === "emu.acceptLicenses" || name === "emu.rejectLicenses") {
        const id = (args as { id?: unknown } | undefined)?.id;
        if (typeof id !== "number") throw new Error(`${name} 需要 id`);
        return ctl({ t: name === "emu.acceptLicenses" ? "acceptLicenses" : "rejectLicenses", id });
      }
      if (name === "emu.zoom") {
        try {
          return parseZoom(localStorage.getItem(ZOOM_KEY));
        } catch {
          return parseZoom(null);
        }
      }
      if (name === "emu.setZoom") {
        const zoom = (args as { zoom?: unknown } | undefined)?.zoom;
        if (!ZOOM_STEPS.includes(zoom as number)) throw new Error(`emu.setZoom 需要 zoom：${ZOOM_STEPS.join("、")} 之一`);
        try {
          localStorage.setItem(ZOOM_KEY, String(zoom));
          return { ok: true };
        } catch {
          return { ok: false };
        }
      }
      if (name === "emu.theme") {
        try {
          return parseTheme(localStorage.getItem(THEME_KEY));
        } catch {
          return parseTheme(null);
        }
      }
      if (name === "emu.setTheme") {
        const theme = (args as { theme?: unknown } | undefined)?.theme;
        if (!THEMES.includes(theme as never)) throw new Error("emu.setTheme 需要 theme：system、light 或 dark");
        try {
          localStorage.setItem(THEME_KEY, theme as string);
          return { ok: true };
        } catch {
          return { ok: false };
        }
      }
      throw new Error(`no host function ${name}`);
    },
  };
}

// 不连网关（浏览器不支持）时代替连接：什么都发不出去
function idleConnection(): ReturnType<typeof createConnection> {
  return {
    send: () => false,
    control: () => false,
    sendBinary: () => false,
    request: () => Promise.reject(new Error("没有连接网关")),
    wake: () => {},
  };
}
