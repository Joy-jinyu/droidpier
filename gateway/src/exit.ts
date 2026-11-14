/**
 * 退出信号处理：跑一次清理，最多等 timeoutMs 就退出；清理途中再来一次信号立即退出。
 * 清理卡住（比如设备没响应，每个 adb 调用都等满超时）不能让网关关不掉。
 */
export function exitHandler(opts: {
  cleanup: () => Promise<void>;
  exit: (code: number) => void;
  /** 清理完（或超时）后的退出码，默认 0。 */
  code?: number;
  timeoutMs: number;
  log: (s: string) => void;
}): () => Promise<void> {
  let exiting = false;
  return async () => {
    if (exiting) {
      opts.log("再次收到退出信号，跳过清理直接退出");
      opts.exit(1);
      return;
    }
    exiting = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((r) => (timer = setTimeout(() => r("timeout"), opts.timeoutMs)));
    const done = opts.cleanup().then(
      () => "done" as const,
      (e: Error) => (opts.log(`退出清理出错：${e.message}`), "done" as const),
    );
    if ((await Promise.race([done, timeout])) === "timeout") opts.log(`退出清理超过 ${opts.timeoutMs}ms，直接退出`);
    clearTimeout(timer);
    opts.exit(opts.code ?? 0);
  };
}
