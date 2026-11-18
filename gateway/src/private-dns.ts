/**
 * 关掉模拟器里 Android 默认的「自动」Private DNS，让模拟器跟着 Mac 的 TUN 代理（Clash Verge、mihomo 等）上网。
 *
 * 默认（private_dns_mode 没设或 opportunistic）时 Android 用 DoT（853 端口）向 10.0.2.3 查询，模拟器把它转给 Mac 的
 * DNS 服务器。TUN 代理只劫持 53 端口的 DNS，DoT 绕过了它，查到的是国内 DNS 的污染地址，代理拿不到域名就按直连处理，
 * Google 等打不开。关掉后查询走 53 端口，被代理换成 fake-ip。2026-11-18 实测（模拟器 36.4.10、Android 16、mihomo TUN）：
 * 关之前 www.google.com 解析成 104.244.42.197，关之后是 198.18.0.6 并能连通。
 * 设置存在 AVD 里，之后开机仍然是关的；用户自己指定的 DoT 服务器（hostname）不动。真机不调用这里。
 */
export type PrivateDnsDeps = {
  /** 在这台模拟器上跑一条 adb 命令（带超时，失败就抛）。 */
  exec: (args: string[]) => Promise<string>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log: (s: string) => void;
};

/** 等开机完成最多这么久：刚连上时模拟器可能还在开机，settings 服务没起来。冷启动实测几十秒，留足余量。 */
const BOOT_WAIT_MS = 180_000;
const POLL_MS = 2000;

/** 系统默认的「自动」：settings 里没有这一项时 get 返回 null。 */
const AUTO_MODES = new Set(["", "null", "opportunistic"]);

export async function turnOffAutoPrivateDns(d: PrivateDnsDeps): Promise<"off" | "kept" | "failed"> {
  const start = d.now();
  while ((await d.exec(["shell", "getprop", "sys.boot_completed"]).then((s) => s.trim(), () => "")) !== "1") {
    if (d.now() - start >= BOOT_WAIT_MS) {
      d.log(`等了 ${BOOT_WAIT_MS / 1000} 秒还没开机完成，没有调整 Private DNS`);
      return "failed";
    }
    await d.sleep(POLL_MS);
  }
  try {
    const mode = (await d.exec(["shell", "settings", "get", "global", "private_dns_mode"])).trim();
    if (!AUTO_MODES.has(mode)) return "kept";
    await d.exec(["shell", "settings", "put", "global", "private_dns_mode", "off"]);
    d.log("已关闭模拟器的自动 Private DNS，DNS 查询改走 53 端口，Mac 上的 TUN 代理能接管");
    return "off";
  } catch (e) {
    d.log(`调整 Private DNS 失败：${(e as Error).message}`);
    return "failed";
  }
}
