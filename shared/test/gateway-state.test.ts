import { test } from "node:test";
import assert from "node:assert/strict";
import { gatewayDown } from "../../ui/gateway-state.ts";

test("gatewayDown：和网关断开、连不上、版本不对时列表不可信", () => {
  for (const s of ["disconnected", "no-gateway", "lna-denied", "lna-prompt", "bad-origin", "refused", "unsupported-browser", "gateway-outdated", "page-outdated"]) {
    assert.equal(gatewayDown(s), true, s);
  }
});

test("gatewayDown：连着网关的状态（有没有设备都算）和连接中不算断开", () => {
  for (const s of ["connected", "no-emulator", "emulator-closed", "phone-closed", "booting", "rebooting", "connecting"]) {
    assert.equal(gatewayDown(s), false, s);
  }
});
