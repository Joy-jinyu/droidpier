// 试验：不经浏览器，直接统计模拟器在不同格式/尺寸下每秒推多少帧
// 用法：node gateway/src/fps-probe.ts <RGBA8888|PNG> <width> <height> <秒数>
import { findRunning } from "./discovery.ts";
import { loadController } from "./sdk.ts";

const [format = "RGBA8888", w = "540", h = "1170", secs = "8"] = process.argv.slice(2);
const emu = (await findRunning())!;
const c = loadController(emu.grpcPort, emu.token);
let n = 0, bytes = 0, lag = 0;
const per: number[] = [];
const call = c.streamScreenshot({ format, width: Number(w), height: Number(h) });
call.on("data", (img: any) => { n++; bytes += img.image.length; lag += Date.now() - img.timestampUs / 1000; });
call.on("error", () => {});
const t = setInterval(() => { per.push(n); n = 0; }, 1000);
setTimeout(() => {
  clearInterval(t); call.cancel(); c.close();
  const total = per.reduce((a, b) => a + b, 0);
  console.log(`${format} ${w}x${h}: per-sec=${per.join(",")} avgBytes=${total ? Math.round(bytes / total) : 0} emu→gw=${total ? (lag / total).toFixed(1) : "-"}ms`);
}, Number(secs) * 1000);
