/** 删设备按钮不能点的原因；能删返回 null。运行中（含无法接管的）和启动中的设备都要先关掉：模拟器正开着它的数据目录。 */
export function deleteBlocked(avd: { running: "grpc" | "no-grpc" | "no" }, booting: boolean): string | null {
  return avd.running !== "no" || booting ? "先关闭这台设备再删除" : null;
}
