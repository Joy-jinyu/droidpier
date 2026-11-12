/** 只保留最新一帧的单槽缓冲：消费跟不上时直接丢旧帧，不排队。 */
export class LatestFrame<T> {
  private slot: T | undefined;
  dropped = 0;

  put(f: T): void {
    if (this.slot !== undefined) this.dropped++;
    this.slot = f;
  }

  take(): T | undefined {
    const f = this.slot;
    this.slot = undefined;
    return f;
  }
}
