import { findRunning } from "./discovery.ts";
import { loadController } from "./sdk.ts";
import { discoveryDir } from "./platform.ts";

const emu = await findRunning();
if (!emu) {
  console.error(`没有找到带 gRPC 的运行中模拟器（${discoveryDir()}）`);
  process.exit(1);
}
const c = loadController(emu.grpcPort, emu.token);
const unary = (m: string, req: object) =>
  new Promise<any>((res, rej) => c[m](req, (e: Error | null, r: any) => (e ? rej(e) : res(r))));

const s = await unary("getStatus", {});
console.log(`emulator-${emu.serial} grpc:${emu.grpcPort} booted=${s.booted} ${s.version}`);
await unary("sendKey", { eventType: "keypress", key: "GoHome" });
console.log("sent GoHome");
c.close();
