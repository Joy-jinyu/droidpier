import { installCmd } from "../../shared/protocol.ts";
import { PUBLIC_ORIGIN } from "./auth.ts";

/** 升级（或重新安装）这个网关的命令：从它信任的公网页面所在的站点装。 */
export const INSTALL_CMD = installCmd(PUBLIC_ORIGIN);

/** 网关默认端口，页面找不到别的端口时也连它（host/src/launch.ts）。 */
export const DEFAULT_PORT = 7300;

/** 根据 argv 中是否有 --local 决定打开公网还是本机页面；--public 是兼容别名，不改行为 */
export function pageOrigin(argv: string[]): string {
  return argv.includes("--local") ? "" : PUBLIC_ORIGIN;
}

/** 拼出网关启动后要打开的页面 URL：本机页面就在网关端口上；公网页面只在端口不是默认的 7300 时用 #port 告诉页面。 */
export function buildPageUrl(argv: string[], port: number): string {
  const origin = pageOrigin(argv);
  if (!origin) return `http://127.0.0.1:${port}/app/`;
  return `${origin}/app/${port === DEFAULT_PORT ? "" : `#port=${port}`}`;
}
