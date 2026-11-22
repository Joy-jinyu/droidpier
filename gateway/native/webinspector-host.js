// WebKit 调试界面（系统的 WebInspectorUI.framework）在 Safari 里靠原生的 InspectorFrontendHost 收发消息；
// 放进普通浏览器的 iframe 时没有它，这里补一个替身：消息走 WebSocket 连回网关（gateway/src/server.ts 的 /webinspector/ws/）。
// 网关在 Main.html 的 Main.js 之前插入这个文件。参数：?ws=<host:port/path>&version=<iOS 命令表版本>&ios=<模拟器系统版本>
(function () {
  var params = new URLSearchParams(location.search);
  // 只连回提供这个页面的网关：这个页面跑在网关自己的源上，不能让别的网站用 ?ws=<别处> 打开它、让别人给它喂数据
  // （网关回这个页面时还带 connect-src 'self' 的 CSP，这里是第二道）
  var target = params.get("ws") || "";
  if (target.indexOf(location.host + "/webinspector/ws/") !== 0) throw new Error("[droidpier] 调试地址不对：" + target);
  var ws = new WebSocket("ws://" + target);
  var queue = [];
  var open = false;
  ws.onopen = function () {
    open = true;
    queue.forEach(function (m) { ws.send(m); });
    queue = [];
  };
  // 前端调 loaded() 之前收到的后端消息先存着：太早交给它，Target.targetCreated 会在主目标准备好之前处理，直接抛错
  // （2026-11-22 原型实测）
  var inbox = [];
  var ready = false;
  ws.onmessage = function (e) {
    if (ready) InspectorFrontendAPI.dispatchMessageAsync(e.data);
    else inbox.push(e.data);
  };
  ws.onclose = function () { console.warn("[droidpier] 调试连接已断开"); };
  var zoom = 1;
  var version = params.get("version");
  var host = {
    isRemote: true,
    inspectionLevel: 1,
    platform: "mac",
    platformVersionName: "",
    debuggableInfo: { debuggableType: "web-page", targetPlatformName: "iOS", targetBuildVersion: "Unknown", targetProductVersion: params.get("ios") || version || "Unknown", targetIsSimulator: true },
    localizedStringsURL: "zh_CN.lproj/localizedStrings.js",
    // iOS 的协议和 macOS 不完全一样（比如没有 Page.setShowRulers）：用 Legacy/iOS/<版本> 下的命令表。
    // 必须显式给值：没定义时下面的 Proxy 会把它变成函数，前端拿函数源码当地址去加载
    backendCommandsURL: version ? "Protocol/Legacy/iOS/" + version + "/InspectorBackendCommands.js" : undefined,
    supportsWebExtensions: false,
    supportsShowCertificate: false,
    supportsDiagnosticLogging: false,
    sendMessageToBackend: function (m) {
      if (open) ws.send(m);
      else queue.push(m);
    },
    loaded: function () {
      ready = true;
      inbox.forEach(function (m) { InspectorFrontendAPI.dispatchMessageAsync(m); });
      inbox = [];
    },
    connect: function () {},
    bringToFront: function () {},
    isUnderTest: function () { return false; },
    engineeringSettingsAllowed: function () { return false; },
    supportsDockSide: function () { return false; },
    canSave: function () { return false; },
    canLoad: function () { return false; },
    canPickColorFromScreen: function () { return false; },
    zoomFactor: function () { return zoom; },
    setZoomFactor: function (z) { zoom = z; },
    userInterfaceLayoutDirection: function () { return "ltr"; },
    copyText: function (t) { if (navigator.clipboard) navigator.clipboard.writeText(t); },
    openURLExternally: function (u) { window.open(u, "_blank", "noopener"); },
    isBeingInspected: function () { return false; },
    getPath: function () { return ""; },
  };
  // 前端还会调很多 Safari 才有的方法（窗口、停靠、扩展……），一律当空操作
  window.InspectorFrontendHost = new Proxy(host, {
    get: function (t, k) { return k in t ? t[k] : function () { return undefined; }; },
  });
})();
