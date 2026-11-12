/** host 发出的每份状态都带递增的 rev；比已应用的旧的那份（例如晚到的 emu.status 调用结果）不再应用。 */
export function isStaleStatus(rev: number, lastApplied: number): boolean {
  return rev < lastApplied;
}
