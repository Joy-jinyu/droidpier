import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toDevice, keyToMsg, textToMsgs, pasteToMsgs, inputToMsgs, wheelToSwipe } from "../input-map.ts";

describe("toDevice", () => {
  it("正常换算", () => {
    assert.deepEqual(
      toDevice({ x: 270, y: 585 }, { left: 0, top: 0, width: 540, height: 1170 }, { width: 1080, height: 2340 }),
      { x: 540, y: 1170 }
    );
  });

  it("超出范围夹住", () => {
    assert.deepEqual(
      toDevice({ x: -5, y: 2000 }, { left: 0, top: 0, width: 540, height: 1170 }, { width: 1080, height: 2340 }),
      { x: 0, y: 2339 }
    );
  });

  it("有偏移的 rect", () => {
    assert.deepEqual(
      toDevice({ x: 110, y: 20 }, { left: 100, top: 10, width: 540, height: 1170 }, { width: 1080, height: 2340 }),
      { x: 20, y: 20 }
    );
  });
});

// 真机核对（Pixel_5_API_34，模拟器 32.1.14，开 pointer_location 看触点）：rotation 是设备顺时针转过的角度，
// 画面始终是人眼看到的方向；表里是画布 左上、右上、左下、右下 四个角落到竖屏面板上的坐标。
const PORTRAIT_RECT = { left: 0, top: 0, width: 540, height: 1170 };
const LANDSCAPE_RECT = { left: 0, top: 0, width: 1170, height: 540 };
const DEV = { width: 1080, height: 2340 };
const CORNERS: Array<[0 | 90 | 180 | 270, Array<[number, number]>]> = [
  [0, [[0, 0], [1079, 0], [0, 2339], [1079, 2339]]],
  [90, [[0, 2339], [0, 0], [1079, 2339], [1079, 0]]],
  [180, [[1079, 2339], [0, 2339], [1079, 0], [0, 0]]],
  [270, [[1079, 0], [1079, 2339], [0, 0], [0, 2339]]],
];

describe("toDevice 旋转", () => {
  it("横屏 90° 时画布左上角落到设备 (0, 2339)", () => {
    assert.deepEqual(toDevice({ x: 0, y: 0 }, LANDSCAPE_RECT, DEV, 90), { x: 0, y: 2339 });
  });

  for (const [rotation, expected] of CORNERS) {
    it(`${rotation}° 画布四角映射到设备四角`, () => {
      const rect = rotation % 180 === 0 ? PORTRAIT_RECT : LANDSCAPE_RECT;
      const pts = [[0, 0], [rect.width, 0], [0, rect.height], [rect.width, rect.height]];
      assert.deepEqual(
        pts.map(([x, y]) => toDevice({ x, y }, rect, DEV, rotation)),
        expected.map(([x, y]) => ({ x, y }))
      );
    });
  }

  it("90° 时实测点：画布 (2040/2, 100/2) 落到面板 (100, 300)", () => {
    assert.deepEqual(toDevice({ x: 1020, y: 50 }, LANDSCAPE_RECT, DEV, 90), { x: 100, y: 300 });
  });

  it("270° 时实测点：画布 (300/2, 980/2) 落到面板 (100, 300)", () => {
    assert.deepEqual(toDevice({ x: 150, y: 490 }, LANDSCAPE_RECT, DEV, 270), { x: 100, y: 300 });
  });
});

const base = { metaKey: false, ctrlKey: false, altKey: false, isComposing: false };

describe("keyToMsg", () => {
  it("单字符 keydown → keypress", () => {
    assert.deepEqual(
      keyToMsg({ key: "a", ...base }, "keydown"),
      { t: "key", key: "a", eventType: "keypress" }
    );
  });

  it("单字符 keyup → null", () => {
    assert.equal(keyToMsg({ key: "a", ...base }, "keyup"), null);
  });

  it("metaKey → null", () => {
    assert.equal(keyToMsg({ key: "r", ...base, metaKey: true }, "keydown"), null);
  });

  it("功能键 keyup", () => {
    assert.deepEqual(
      keyToMsg({ key: "Backspace", ...base }, "keyup"),
      { t: "key", key: "Backspace", eventType: "keyup" }
    );
  });

  it("isComposing → null", () => {
    assert.equal(keyToMsg({ key: "Process", ...base, isComposing: true }, "keydown"), null);
  });
});

describe("textToMsgs", () => {
  it("纯 ASCII 拆成逐字符", () => {
    assert.equal(textToMsgs("hi").length, 2);
  });

  it("含非 ASCII → text 消息", () => {
    assert.deepEqual(textToMsgs("中文 abc"), [{ t: "text", text: "中文 abc" }]);
  });
});

describe("pasteToMsgs", () => {
  it("粘贴 ASCII 也只发一条 text", () => {
    const url = "https://example.com/a?b=" + "x".repeat(2000);
    assert.deepEqual(pasteToMsgs(url), [{ t: "text", text: url }]);
  });

  it("空内容不发", () => {
    assert.deepEqual(pasteToMsgs(""), []);
  });
});

describe("inputToMsgs", () => {
  it("非组字的 insertText（Option 字符、表情面板）发出去", () => {
    assert.deepEqual(inputToMsgs({ isComposing: false, inputType: "insertText", data: "©" }), [{ t: "text", text: "©" }]);
    assert.deepEqual(inputToMsgs({ isComposing: false, inputType: "insertText", data: "😀" }), [{ t: "text", text: "😀" }]);
  });

  it("组字中、组字文本、删除、没有 data 都不发", () => {
    assert.deepEqual(inputToMsgs({ isComposing: true, inputType: "insertText", data: "a" }), []);
    assert.deepEqual(inputToMsgs({ isComposing: false, inputType: "insertCompositionText", data: "中" }), []);
    assert.deepEqual(inputToMsgs({ isComposing: false, inputType: "deleteContentBackward", data: null }), []);
    assert.deepEqual(inputToMsgs({ isComposing: false, inputType: "insertText", data: null }), []);
  });
});

describe("wheelToSwipe", () => {
  const device = { width: 1080, height: 2340 };
  const at = { x: 540, y: 1170 };

  it("deltaY=100 → 10 个点，首点触下 y=1170，尾点抬起 y=870，中间 8 个移动点", () => {
    const steps = wheelToSwipe(100, at, device);
    assert.equal(steps.length, 10);
    assert.deepEqual(steps[0], { x: 540, y: 1170, down: true, delayMs: 0 });
    assert.deepEqual(steps[9], { x: 540, y: 870, down: false, delayMs: 8 });
    for (let i = 1; i <= 8; i++) {
      assert.equal(steps[i].down, true, `step ${i} 应是 down:true`);
      assert.equal(steps[i].delayMs, 8, `step ${i} 间隔应为 8ms`);
    }
  });

  it("deltaY=-1000 → 位移上限 900 像素", () => {
    const steps = wheelToSwipe(-1000, at, device);
    assert.equal(Math.abs(steps[9].y - at.y), 900);
  });

  it("起点 y=100 往上滑 300，终点 y 夹到 0", () => {
    const steps = wheelToSwipe(100, { x: 540, y: 100 }, device);
    assert.equal(steps[9].y, 0);
    assert.equal(steps[9].x, 540);
  });

  it("rotation=90 时 x 减小（屏幕上方），y 不变", () => {
    const steps = wheelToSwipe(100, at, device, 90);
    assert.equal(steps[0].x, 540);
    assert.equal(steps[0].y, 1170);
    assert.equal(steps[9].x, 240); // 540 - 300
    assert.equal(steps[9].y, 1170); // y 不变
    assert.equal(steps[9].down, false);
  });

  it("rotation=90 x 夹到 [0, width-1]", () => {
    const steps = wheelToSwipe(100, { x: 200, y: 1170 }, device, 90);
    assert.equal(steps[9].x, 0);
    assert.equal(steps[9].y, 1170);
  });

  it("rotation=180 时 y 增大（屏幕上方方向与 0° 相反）", () => {
    const steps = wheelToSwipe(100, at, device, 180);
    assert.equal(steps[9].y, 1470); // 1170 + 300
    assert.equal(steps[9].x, 540);
  });

  it("rotation=270 时 x 增大", () => {
    const steps = wheelToSwipe(100, at, device, 270);
    assert.equal(steps[9].x, 840); // 540 + 300
    assert.equal(steps[9].y, 1170);
  });

  // --- 防误触安全检测 ---

  it("deltaY=0 → 空数组，不会变成误触", () => {
    assert.deepEqual(wheelToSwipe(0, at, device), []);
  });

  it("起点靠顶部（y=5，deltaY=2）：终点夹到 0，起点后移到 40，|start−end|=40≥40", () => {
    // rawDist=6，endY=0，actDist=5<40 → 起点往下移到 endY+40=40
    const steps = wheelToSwipe(2, { x: 540, y: 5 }, device);
    assert.ok(steps.length > 0, "应返回非空序列");
    assert.equal(steps[9].y, 0, "终点在顶边");
    assert.ok(Math.abs(steps[0].y - steps[9].y) >= 40, "起止距离 ≥ 40px");
    assert.equal(steps[0].y, 40, "起点后移到 40");
  });

  it("tiny delta 中间位置（deltaY=4）：后移后 |start−end|=40，返回非空序列", () => {
    // rawDist=12，endY=1158，actDist=12<40 → 起点后移到 1198
    const steps = wheelToSwipe(4, at, device);
    assert.ok(steps.length > 0, "tiny delta 中间位置应能扩展");
    assert.ok(Math.abs(steps[0].y - steps[9].y) >= 40, "起止距离 ≥ 40px");
    assert.equal(steps[0].y, 1198, "起点后移");
    assert.equal(steps[9].y, 1158, "终点在目标位置");
  });

  it("设备太小（height=30），滑动轴上最大可用距离 < 40 → 空数组", () => {
    // endY=0，startY 夹到 29，|29-0|=29<40 → []
    assert.deepEqual(wheelToSwipe(1, { x: 0, y: 1 }, { width: 1080, height: 30 }), []);
  });

  it("rotation=90 起点靠左（x=20，deltaY=10）：后移到 x=40，|40−0|=40≥40", () => {
    // rawDist=30，endX=0，actDist=20<40 → startX 后移到 40
    const steps = wheelToSwipe(10, { x: 20, y: 1170 }, device, 90);
    assert.ok(steps.length > 0);
    assert.equal(steps[0].x, 40, "起点 x 后移");
    assert.equal(steps[9].x, 0, "终点 x 在左边");
    assert.ok(Math.abs(steps[0].x - steps[9].x) >= 40);
  });
});
