// 命令行参数：只接受认得的参数。打错的参数（--prot 7306）以前会被忽略，网关照常在 7300 启动，用户以为换了端口
import { isOrigin } from "./auth.ts";
import { DEFAULT_PORT } from "./page-url.ts";

/** 启动网关要用的参数。--local / --public 由 page-url.ts 直接看 argv。service 表示由 launchd 拉起（gateway/src/service.ts）。 */
export type CliOptions = { port: number; noOpen: boolean; allowOrigins: string[]; service: boolean };

export type ServiceCommand = "start" | "stop" | "status" | "logs";

export type CliResult =
  | { kind: "run"; options: CliOptions }
  | { kind: "service"; command: ServiceCommand; args: string[]; noOpen: boolean }
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "error"; message: string };

const SERVICE_COMMANDS: readonly string[] = ["start", "stop", "status", "logs"];

// --public 是兼容别名、--allow-origin 只在本地模拟公网页面时用、--service 只给 launchd 用，都不写进帮助
export const USAGE = [
  "用法：",
  "  droidpier start [--port <端口>] [--local] [--no-open]",
  "                   在后台运行：关闭终端不影响，开机后自动启动；已在运行时重启它",
  "  droidpier stop    停止后台运行，开机也不再自动启动",
  "  droidpier status  查看后台运行的状态",
  "  droidpier logs    打印日志位置和最近的日志",
  "  droidpier [--port <端口>] [--local] [--no-open]",
  "                   在当前终端里运行，按 Ctrl+C 停止",
  "",
  `  --port <端口>  在 127.0.0.1 的这个端口上监听，默认 ${DEFAULT_PORT}`,
  "  --local        打开网关自己托管的页面 http://127.0.0.1:<端口>/app/，不打开公网页面",
  "  --no-open      启动时不打开浏览器，只打印页面地址",
  "  --version      打印版本后退出",
  "  -h, --help     打印这段说明后退出",
].join("\n");

/** 解析 droidpier 后面的参数（不含 node 和脚本路径）。有 --help / --version 时只做这一件事，不看其他参数。 */
export function parseCli(args: string[]): CliResult {
  if (args.includes("-h") || args.includes("--help")) return { kind: "help" };
  if (args.includes("--version")) return { kind: "version" };
  const [first, ...rest] = args;
  if (first !== undefined && SERVICE_COMMANDS.includes(first)) {
    const command = first as ServiceCommand;
    if (command !== "start") return rest.length ? { kind: "error", message: `多余的参数：${rest[0]}` } : { kind: "service", command, args: [], noOpen: false };
    if (rest.includes("--service")) return { kind: "error", message: "不认识的参数：--service" };
    // 后台服务的参数会存进登录项，测试用的放行来源不能跟着常驻
    if (rest.includes("--allow-origin")) return { kind: "error", message: "--allow-origin 只用于本地测试，不能用在 droidpier start；在前台运行：droidpier --allow-origin <来源>" };
    const r = parseRun(rest);
    if (r.kind === "error") return r;
    // --no-open 只管这一次打不打开页面；后台服务本来就不开浏览器
    return { kind: "service", command, args: rest.filter((a) => a !== "--no-open"), noOpen: r.options.noOpen };
  }
  return parseRun(args);
}

function parseRun(args: string[]): Extract<CliResult, { kind: "run" | "error" }> {
  const options: CliOptions = { port: DEFAULT_PORT, noOpen: false, allowOrigins: [], service: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--local" || a === "--public") continue;
    if (a === "--service") {
      options.service = true;
      options.noOpen = true;
    } else if (a === "--no-open") {
      options.noOpen = true;
    } else if (a === "--port") {
      const v = args[++i];
      const port = Number(v);
      if (v === undefined || !Number.isInteger(port) || port <= 0 || port > 65535) return { kind: "error", message: `--port 不合法：${v ?? "缺少端口号"}` };
      options.port = port;
    } else if (a === "--allow-origin") {
      // 本地模拟公网页面时临时放行的来源，例如 --allow-origin http://droid.test:7351
      const v = args[++i];
      if (v === undefined || !isOrigin(v)) return { kind: "error", message: `--allow-origin 不合法：${v ?? "缺少来源"}（要写成 http://主机:端口）` };
      options.allowOrigins.push(v);
    } else {
      return { kind: "error", message: a.startsWith("-") ? `不认识的参数：${a}` : `多余的参数：${a}` };
    }
  }
  return { kind: "run", options };
}

/** droidpier --version 打印的一行。版本是构建时间，只有打包好的可执行文件才有（scripts/build-binary.ts）。 */
export function versionLine(version: string): string {
  return version ? `droidpier ${version}` : "droidpier 开发版（从源码运行，没有版本号）";
}
