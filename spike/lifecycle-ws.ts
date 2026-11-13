// 一次性检查脚本：直接走 WebSocket 协议驱动网关的 avds / start / stop / use，打印收到的文本消息和帧数。
// 网关要用 DROIDPIER_ALLOW_ANY_WS_CLIENT=1 启动：macOS 上它的 WebSocket 只收 Chrome / Edge（gateway/src/peer.ts）
// 用法：node spike/lifecycle-ws.ts <avds|start|stop|use|watch> [AVD 名] --token <网关打印的口令> [--url ws://127.0.0.1:7300/] [--wait 秒]
import WebSocket from "ws";
import { PROTOCOL_VERSION, type ClientMsg } from "../shared/protocol.ts";

const [action = "watch", name] = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));
const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const url = arg("--url", "ws://127.0.0.1:7300/");
const waitS = Number(arg("--wait", "240"));
const token = arg("--token", "");

const t0 = Date.now();
const log = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s] ${s}`);
let frames = 0;
let firstFrameLogged = false;
let readyCount = 0;

// 网关只认白名单里的 Origin，冒充网关自己的页面
const ws = new WebSocket(url, { headers: { Origin: `http://127.0.0.1:${new URL(url).port}` } });
const done = (code = 0) => {
  log(`结束：收到帧 ${frames}`);
  ws.close();
  setTimeout(() => process.exit(code), 100);
};
setTimeout(() => (log("等待超时"), done(1)), waitS * 1000);

ws.on("open", () => ws.send(JSON.stringify({ t: "hello", version: PROTOCOL_VERSION, width: 540, height: 1170, token } satisfies ClientMsg)));
ws.on("close", (code) => log(`连接关闭 code=${code}`));
let sent = false;
ws.on("message", (data, isBinary) => {
  if (isBinary) {
    frames++;
    if (!firstFrameLogged) log(`第一帧（${(data as Buffer).length} 字节）`);
    firstFrameLogged = true;
    if (action === "start" && readyCount > 0) done();
    return;
  }
  const m = JSON.parse(data.toString());
  log(JSON.stringify(m).slice(0, 400));
  if (!sent) {
    sent = true;
    const msg: ClientMsg | null =
      action === "avds" ? { t: "avds" } : action === "start" ? { t: "start", name: name! } : action === "stop" ? { t: "stop" } : action === "use" ? { t: "use", name: name! } : null;
    if (msg) {
      log(`发送 ${JSON.stringify(msg)}`);
      ws.send(JSON.stringify(msg));
    }
  }
  if (m.t === "ready") {
    readyCount++;
    firstFrameLogged = false;
  }
  if (action === "avds" && m.t === "avds") done();
  if (action === "stop" && m.t === "status" && m.state === "emulator-closed") setTimeout(done, 1500);
  if (action === "start" && m.t === "boot" && m.progress === "failed") done(1);
  if (action === "use" && (m.t === "error" || readyCount > 1)) setTimeout(done, 500);
});
