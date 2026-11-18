// 网关比页面旧时页面上显示什么、要不要让网关马上检查更新。网关在 hello 后的 gateway 消息里报功能级别（shared/protocol.ts 的 GATEWAY_LEVEL）。
import { updateFailureText, type UpdateState } from "../../shared/protocol.ts";

/** gateway 消息的内容；null 表示旧网关（hello 后没发 gateway 就发了别的）。 */
export type GatewayInfo = { level: number; version: string; service: boolean; autoUpdate: boolean };
export type UpdateReport = { state: UpdateState; message?: string };
/** 画面上方的提示：updating 网关在自己更新，manual 要用户运行安装命令。 */
export type GatewayBanner = { kind: "updating" | "manual"; text: string; command?: string };

/** 网关的功能级别低于 level：旧网关算 0。 */
export const gatewayBelow = (info: GatewayInfo | null, level: number) => (info?.level ?? 0) < level;

/** 网关比页面旧，而且它是开着自动更新的后台服务：页面让它马上检查一次。 */
export const shouldRequestUpdate = (info: GatewayInfo | null, pageLevel: number) =>
  info !== null && gatewayBelow(info, pageLevel) && info.service && info.autoUpdate;


/** 网关不比页面旧时返回 null。report 是网关对 update 的最近一次回复；command 是这个站点的安装命令。 */
export function gatewayBanner(info: GatewayInfo | null, pageLevel: number, report: UpdateReport | null, command: string): GatewayBanner | null {
  const manual = (text: string): GatewayBanner => ({ kind: "manual", text, command });
  if (!gatewayBelow(info, pageLevel)) return null;
  if (!info || !info.service) return manual("网关版本较旧，请运行安装命令更新");
  if (!info.autoUpdate) return manual("网关版本较旧，自动更新已关闭，请运行安装命令更新");
  switch (report?.state) {
    case undefined:
    case "checking":
    case "restarting":
      return { kind: "updating", text: "网关有新版本，正在自动更新…" };
    case "deferred":
      return { kind: "updating", text: `网关有新版本，${report.message ?? "有操作在进行"}，结束后自动更新` };
    case "latest":
      return manual("网关版本较旧，下载站上暂时还没有新版本，稍后会自动再试；也可以运行安装命令更新");
    case "failed":
      return manual(`网关自动更新失败：${updateFailureText(report.message)}。请运行安装命令更新`);
    case "off":
      return manual("网关版本较旧，请运行安装命令更新");
  }
}

/**
 * 请求超时（15 秒没回）时给用户看的话。网关功能级别低于这条消息要的级别时说它太旧、不支持；
 * 否则是网关真的慢（删大目录），slow 是那种情况的说明。
 */
export function timeoutText(info: GatewayInfo | null | undefined, level: number, what: string, slow: string): string {
  return info !== undefined && gatewayBelow(info, level) ? `网关版本太旧，不支持${what}，请运行安装命令更新网关` : slow;
}
