/**
 * 连接状态里，哪些说明页面现在没连着网关：这时设备列表是断开前的旧数据，运行状态不可信，
 * 启动、切换、停止都发不出去。connecting 不算（连上之前、切换设备时都会短暂经过它）。
 */
const DOWN = new Set([
  "disconnected", "no-gateway", "lna-denied", "lna-prompt", "bad-origin", "refused", "unsupported-browser",
  "gateway-outdated", "page-outdated",
]);

export function gatewayDown(state: string): boolean {
  return DOWN.has(state);
}
