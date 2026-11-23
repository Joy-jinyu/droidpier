/**
 * 检查模拟器的全局 HTTP 代理还能不能用，用不了时由用户点按钮清掉。
 *
 * 抓包工具（Proxyman 的「配置 Android 模拟器」等）用 `settings put global http_proxy <Mac 的 IP>:<端口>` 给模拟器设代理，
 * 设置存在 AVD 里，重启也还在。抓包工具关了或者 Mac 换了 IP 却没恢复，模拟器里的 App 就都上不了网，而 DNS、ping 照常，
 * 很难看出原因。
 *
 * 只看 TCP 能不能连上不够：Mac 开着 TUN 代理（mihomo 等）时，连一个不存在的地址也会先被它握手成功。所以在模拟器里经这个
 * 代理发一个 HTTP 请求，回复的第一行是 `HTTP/` 才算能用（代理回 502 也算，代理本身是好的）。2026-11-23 实测（模拟器
 * 36.4.10、Android 16、mihomo TUN）：Proxyman 在跑时 10.0.2.2:9091 回 `HTTP/1.0 204 No Content`；Mac 换 IP 后旧的
 * 10.20.95.233:9091 超时；203.0.113.1:9091 TCP 能连上但没有回复。
 *
 * 代理能连通也不一定能用：抓包工具会解密 HTTPS，设备没装它的根证书时（装过的证书在模拟器重启后也会丢）App 的 HTTPS
 * 全部失败。抓包工具只解密配置过的域名（2026-11-23 实测 Proxyman：api.longbridge.xyz 换成它签的证书，Google、百度不动），
 * 拿固定域名去试测不出来，所以看设备日志里最近有没有证书校验失败，报出是哪些 App。
 */
export type ProxyDeps = {
  /** 在这台模拟器上跑一条 adb 命令（带超时，失败就抛）。 */
  exec: (args: string[]) => Promise<string>;
};

/** proxy 为 null 表示没设代理；ok 表示代理回了 HTTP 响应；untrusted 是最近因证书不受信任而 HTTPS 失败的 App（只在 ok 时查）。 */
export type ProxyState = { proxy: null } | { proxy: string; ok: false } | { proxy: string; ok: true; untrusted: string[] };

/** 没设过时 get 返回 null；`:0` 是清掉代理的写法（Proxyman 恢复时也这样写）。 */
const NO_PROXY = new Set(["", "null", ":0"]);
// 主机名不能以 - 开头：会被 nc 当成选项（-l 让它监听，一直等到 adb 超时）
const HOST_PORT = /^([A-Za-z0-9][A-Za-z0-9.-]*):(\d{1,5})$/;

/**
 * 等回复的秒数。toybox nc 读完输入就断开，收不到回复，所以输入要多开一会儿；本机的代理几毫秒就回。
 * 整条命令要在 adb 短命令的 5 秒超时（adb.ts 的 ADB_TIMEOUT_MS）内跑完。
 */
const WAIT_S = 2;

const PROBE_REQUEST = "HEAD http://connectivitycheck.gstatic.com/generate_204 HTTP/1.0\\r\\n\\r\\n";

/** 只看最近这么多秒的日志：更早的失败可能是装好证书之前的。 */
const RECENT_S = 300;
/** 证书不受信任时各网络库打的日志：Java（Conscrypt / OkHttp）、rustls、Flutter（BoringSSL）、Chromium WebView。 */
const UNTRUSTED_LOG = "Trust anchor for certification path not found|invalid peer certificate: UnknownIssuer|CertPathValidatorException|CERTIFICATE_VERIFY_FAILED|ERR_CERT_AUTHORITY_INVALID";
/**
 * 最近日志里证书校验失败的进程换成包名，一行一个；进程已经退出的写 ?。
 * logcat -T 收「秒.毫秒」的时间戳。2026-11-23 实测（模拟器 36.4.10、Android 16）不到 1 秒。
 */
const UNTRUSTED_CMD =
  `logcat -d -v threadtime -T "$(( $(date +%s) - ${RECENT_S} )).000" 2>/dev/null | grep -E '${UNTRUSTED_LOG}'` +
  ` | awk '{print $3}' | sort -u | while read p; do ps -o NAME= -p $p || echo "?"; done | sort -u`;

export async function checkProxy(d: ProxyDeps): Promise<ProxyState> {
  const proxy = await readProxy(d);
  if (proxy === null) return { proxy: null };
  const m = HOST_PORT.exec(proxy);
  // 认不出的地址系统也用不了，按连不上处理；这种值也不能拼进下面的 shell 命令
  if (!m) return { proxy, ok: false };
  const out = await d.exec(["shell", `(printf '${PROBE_REQUEST}'; sleep ${WAIT_S}) | nc -w ${WAIT_S} ${m[1]} ${m[2]} 2>&1 | head -1`]);
  if (!out.startsWith("HTTP/")) return { proxy, ok: false };
  const untrusted = (await d.exec(["shell", UNTRUSTED_CMD])).split("\n").map((s) => s.trim()).filter(Boolean);
  return { proxy, ok: true, untrusted };
}

/**
 * 清掉全局代理。expected 是检测时看到的代理：现在的设置和它不同（检测完换了设备、用户又改了）就不动，回 changed。
 * cleared：清完读回来确实没有代理了；failed：读回来还在。
 */
export async function clearProxy(d: ProxyDeps, expected: string): Promise<"cleared" | "changed" | "failed"> {
  if ((await readProxy(d)) !== expected) return "changed";
  await d.exec(["shell", "settings", "put", "global", "http_proxy", ":0"]);
  return (await readProxy(d)) === null ? "cleared" : "failed";
}

async function readProxy(d: ProxyDeps): Promise<string | null> {
  const v = (await d.exec(["shell", "settings", "get", "global", "http_proxy"])).trim();
  return NO_PROXY.has(v) ? null : v;
}
