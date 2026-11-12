import { execFile, type ChildProcess } from "node:child_process";
import { ADB_UNRESPONSIVE } from "../../shared/protocol.ts";
import { adbBin } from "./platform.ts";

/** 一次 adb 调用的超时。 */
export const ADB_TIMEOUT_MS = 5000;

/** adb 调用超时：设备里的 adbd 多半卡住了。 */
export class AdbUnresponsive extends Error {
  constructor() {
    super(ADB_UNRESPONSIVE);
    this.name = "AdbUnresponsive";
  }
}

// 还在跑的 adb 进程：网关退出时一起结束，卡在 adbd 上的不能留成孤儿
const children = new Set<ChildProcess>();

/** 结束所有还在跑的 adb 进程。同步，可以在 process 的 exit 事件里调用。 */
export function killAdbChildren(): void {
  for (const c of children) c.kill("SIGKILL");
}

/**
 * 跑一次 adb。超时用 SIGKILL 结束并记日志，归类为 AdbUnresponsive；其他失败原样抛。
 * execFile 默认只发 SIGTERM，进程不理它时回调要等它自己退出，所以显式用 SIGKILL。
 */
export function execAdb(bin: string, args: string[], timeoutMs: number, log: (s: string) => void): Promise<string> {
  return new Promise((res, rej) => {
    const child = execFile(bin, args, { timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 8 * 2 ** 20 }, (e, stdout) => {
      children.delete(child);
      if (!e) return res(stdout);
      if ((e as { killed?: boolean }).killed) {
        log(`adb ${args.join(" ")} 超过 ${timeoutMs / 1000} 秒没返回，已用 SIGKILL 结束`);
        return rej(new AdbUnresponsive());
      }
      rej(e);
    });
    children.add(child);
  });
}

/**
 * adb 调用入口。带 `-s <设备>` 的命令按设备排队，同一台设备同一时间只有一个 adb 进程在跑；
 * 不带 -s 的（forward --list、devices）只找本机 adb server，不排队。
 */
export function createAdb(opts: { exec?: (args: string[]) => Promise<string>; timeoutMs?: number; log?: (s: string) => void } = {}) {
  const log = opts.log ?? ((s: string) => console.log(s));
  const exec = opts.exec ?? ((args: string[]) => execAdb(adbBin(), args, opts.timeoutMs ?? ADB_TIMEOUT_MS, log));
  const tails = new Map<string, Promise<unknown>>();

  function run(args: string[]): Promise<string> {
    if (args[0] !== "-s" || !args[1]) return exec(args);
    const key = args[1];
    const p = (tails.get(key) ?? Promise.resolve()).then(() => exec(args));
    const tail = p.catch(() => {});
    tails.set(key, tail);
    void tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
    return p;
  }

  return {
    run,
    /** 这台设备上的 adb：参数是 `adb -s emulator-<serial>` 之后的部分。 */
    device: (serial: number) => (args: string[]) => run(["-s", `emulator-${serial}`, ...args]),
  };
}

/** 网关进程里唯一的 adb 入口：所有模块共用同一组设备队列。 */
export const adb = createAdb();
