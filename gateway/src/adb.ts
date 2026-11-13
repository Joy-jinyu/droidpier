import { execFile, type ChildProcess } from "node:child_process";
import { ADB_UNRESPONSIVE } from "../../shared/protocol.ts";
import { adbBin } from "./platform.ts";

/** 短命令（排在设备队列里的）一次 adb 调用的超时；long 队列的超时由调用方给。 */
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
 * 装 APK、传文件要几分钟，走 long 这条单独的队列：不挡住 H5 列表这类短命令，长任务之间仍一次一个。
 */
export function createAdb(opts: { exec?: (args: string[], timeoutMs?: number) => Promise<string>; timeoutMs?: number; log?: (s: string) => void } = {}) {
  const log = opts.log ?? ((s: string) => console.log(s));
  const exec = opts.exec ?? ((args: string[], timeoutMs?: number) => execAdb(adbBin(), args, timeoutMs ?? opts.timeoutMs ?? ADB_TIMEOUT_MS, log));
  const tails = new Map<string, Promise<unknown>>();

  function queued(key: string, job: () => Promise<string>): Promise<string> {
    const p = (tails.get(key) ?? Promise.resolve()).then(job);
    const tail = p.catch(() => {});
    tails.set(key, tail);
    void tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
    return p;
  }

  function run(args: string[]): Promise<string> {
    if (args[0] !== "-s" || !args[1]) return exec(args);
    return queued(args[1], () => exec(args));
  }

  return {
    run,
    /** 这台设备上的 adb：参数是 `adb -s <设备 id>` 之后的部分。 */
    device: (id: string) => (args: string[]) => run(["-s", id, ...args]),
    /** 这台设备上的长任务（install、push），超时由调用方给。 */
    long: (id: string) => (args: string[], timeoutMs: number) => {
      const full = ["-s", id, ...args];
      return queued(`long:${id}`, () => exec(full, timeoutMs));
    },
  };
}

/** 模拟器在 adb 里的设备 id：emulator-<控制台端口>。网关里只在这里拼这个前缀。 */
export function emulatorId(serial: number): string {
  return `emulator-${serial}`;
}

/** 网关进程里唯一的 adb 入口：所有模块共用同一组设备队列。 */
export const adb = createAdb();
