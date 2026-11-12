import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ClientMsg } from "../../shared/protocol.ts";
import { createPointerTracker } from "../../host/src/pointer.ts";

// 固定的测试几何：canvas 在 (100, 200)，大小 400x600，设备 1080x1920
const RECT = { left: 100, top: 200, width: 400, height: 600 };
const DEVICE = { width: 1080, height: 1920 };
function geom() { return { rect: RECT, device: DEVICE }; }

function makeTracker() {
  const msgs: ClientMsg[] = [];
  const tracker = createPointerTracker((m) => msgs.push(m), geom);
  return { tracker, msgs };
}

describe("pointer tracker", () => {
  it("down → move → up 发 3 条消息，最后一条 down:false", () => {
    const { tracker, msgs } = makeTracker();
    tracker.down({ clientX: 110, clientY: 210, pointerId: 1 });
    tracker.move({ clientX: 120, clientY: 220, pointerId: 1 });
    tracker.up({ clientX: 130, clientY: 230, pointerId: 1 });
    assert.equal(msgs.length, 3);
    assert.equal(msgs[0].t, "touch");
    assert.equal((msgs[0] as { t: "touch"; down: boolean }).down, true);
    assert.equal(msgs[2].t, "touch");
    assert.equal((msgs[2] as { t: "touch"; down: boolean }).down, false);
  });

  it("没有 down 时调用 move 发 0 条消息", () => {
    const { tracker, msgs } = makeTracker();
    tracker.move({ clientX: 120, clientY: 220, pointerId: 1 });
    assert.equal(msgs.length, 0);
  });

  it("down → cancel → up 只发 2 条消息（cancel 补发 up，后续 up 不重复）", () => {
    const { tracker, msgs } = makeTracker();
    tracker.down({ clientX: 110, clientY: 210, pointerId: 1 });
    tracker.cancel();
    tracker.up({ clientX: 130, clientY: 230, pointerId: 1 });
    assert.equal(msgs.length, 2);
    assert.equal((msgs[0] as { t: "touch"; down: boolean }).down, true);
    assert.equal((msgs[1] as { t: "touch"; down: boolean }).down, false);
  });

  it("pointer 离开画布后抬起仍发送 up", () => {
    const { tracker, msgs } = makeTracker();
    tracker.down({ clientX: 110, clientY: 210, pointerId: 1 });
    // up 坐标在画布外（clientX=600 >> right edge=500）
    tracker.up({ clientX: 600, clientY: 210, pointerId: 1 });
    assert.equal(msgs.length, 2);
    const up = msgs[1] as { t: "touch"; x: number; y: number; down: boolean };
    assert.equal(up.t, "touch");
    assert.equal(up.down, false);
    // x 应被夹到设备最大值 1079
    assert.equal(up.x, DEVICE.width - 1);
  });

  it("cancel 在最后一次位置抬起", () => {
    const { tracker, msgs } = makeTracker();
    tracker.down({ clientX: 110, clientY: 210, pointerId: 1 });
    tracker.move({ clientX: 200, clientY: 400, pointerId: 1 });
    tracker.cancel();
    // cancel 应在 move 的设备坐标处发 down:false
    assert.equal(msgs.length, 3);
    const moveMsg = msgs[1] as { t: "touch"; x: number; y: number; down: boolean };
    const cancelMsg = msgs[2] as { t: "touch"; x: number; y: number; down: boolean };
    assert.equal(cancelMsg.t, "touch");
    assert.equal(cancelMsg.down, false);
    assert.equal(cancelMsg.x, moveMsg.x);
    assert.equal(cancelMsg.y, moveMsg.y);
  });

  it("连续 down 先补发抬起", () => {
    const { tracker, msgs } = makeTracker();
    tracker.down({ clientX: 110, clientY: 210, pointerId: 1 });
    tracker.down({ clientX: 150, clientY: 250, pointerId: 2 });
    // 第二次 down 前应先补发 down:false（在第一次的坐标），再发第二次 down:true
    assert.equal(msgs.length, 3);
    const first = msgs[0] as { t: "touch"; x: number; y: number; down: boolean };
    const release = msgs[1] as { t: "touch"; x: number; y: number; down: boolean };
    const second = msgs[2] as { t: "touch"; x: number; y: number; down: boolean };
    assert.equal(first.down, true);
    assert.equal(release.down, false);
    assert.equal(release.x, first.x);
    assert.equal(release.y, first.y);
    assert.equal(second.down, true);
  });
});

describe("pointer tracker 旋转", () => {
  it("geom 给出 rotation 时按旋转后的方向换算", () => {
    const msgs: ClientMsg[] = [];
    const rect = { left: 0, top: 0, width: 1170, height: 540 };
    const tracker = createPointerTracker((m) => msgs.push(m), () => ({ rect, device: { width: 1080, height: 2340 }, rotation: 90 }));
    tracker.down({ clientX: 0, clientY: 0, pointerId: 1 });
    assert.deepEqual(msgs[0], { t: "touch", x: 0, y: 2339, down: true });
  });
});
