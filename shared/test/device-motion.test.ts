import { test } from "node:test";
import assert from "node:assert/strict";
import { bezierAt, fitPose, glideFrames, poseAt, REST, startPose, turnAngle, type Glide } from "../../ui/device-motion.ts";

const close = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("turnAngle：设备顺时针转 90° 时机身先逆时针转回 90°，向左转反过来，转 180° 取一边，没转是 0", () => {
  assert.equal(turnAngle(0, 90), -90);
  assert.equal(turnAngle(90, 0), 90);
  assert.equal(turnAngle(0, 270), 90);
  assert.equal(turnAngle(270, 0), -90);
  assert.equal(turnAngle(0, 180), -180);
  assert.equal(turnAngle(90, 90), 0);
});

test("startPose：只缩放时，新机身起点缩成旧机身的大小", () => {
  const p = startPose({ width: 351, height: 760 }, REST, { width: 269, height: 582 }, 0);
  assert.equal(p.rotate, 0);
  close(p.scaleX, 351 / 269);
  close(p.scaleY, 760 / 582);
});

test("startPose：转 90° 时新机身的宽对着旧机身的高，起点看起来和旧机身一样大", () => {
  const prev = { width: 351, height: 760 };
  const next = { width: 700, height: 323 };
  const p = startPose(prev, REST, next, -90);
  assert.equal(p.rotate, -90);
  // 转回 -90° 后，新机身的宽（缩放后）竖着放，等于旧机身的高
  close(next.width * p.scaleX, prev.height);
  close(next.height * p.scaleY, prev.width);
});

test("startPose：动画中途被打断时从当前姿态接着走，角度叠加、大小按当前看到的算", () => {
  const prev = { width: 700, height: 323 };
  const now = { rotate: -40, scaleX: 0.8, scaleY: 0.9 };
  const next = { width: 351, height: 760 };
  const p = startPose(prev, now, next, 90);
  assert.equal(p.rotate, 50);
  close(next.width * p.scaleX, prev.height * now.scaleY);
  close(next.height * p.scaleY, prev.width * now.scaleX);
});

test("fitPose：放得进原样返回；斜着放不进时整体等比缩小到外接框刚好放进", () => {
  const size = { width: 351, height: 752 };
  const area = { width: 426, height: 800 };
  assert.deepEqual(fitPose(REST, size, area), REST);
  const p = fitPose({ rotate: 45, scaleX: 1, scaleY: 1 }, size, area);
  assert.equal(p.rotate, 45);
  close(p.scaleX, p.scaleY);
  const bw = (351 + 752) * Math.SQRT1_2 * p.scaleX;
  const bh = (351 + 752) * Math.SQRT1_2 * p.scaleY;
  assert.ok(bw <= area.width + 1e-6 && bh <= area.height + 1e-6);
  close(Math.max(bw / area.width, bh / area.height), 1);
  // 设备区还没量出来（0）时不缩
  assert.deepEqual(fitPose({ rotate: 45, scaleX: 1, scaleY: 1 }, size, { width: 0, height: 0 }), { rotate: 45, scaleX: 1, scaleY: 1 });
});

test("glideFrames：从起点走到原位，角度单调，转动中每帧外接框都放得进设备区", () => {
  const next = { width: 426, height: 204 };
  const area = { width: 426, height: 760 };
  const from = startPose({ width: 351, height: 752 }, REST, next, 90);
  const frames = glideFrames(from, next, area, [0.4, 0, 0.2, 1], 20);
  assert.equal(frames.length, 21);
  assert.deepEqual(frames[0], from);
  assert.deepEqual(frames[20], REST);
  for (let i = 1; i < frames.length; i++) assert.ok(frames[i].rotate <= frames[i - 1].rotate);
  // 设备区比机身还紧时，终点也停在原位（不缩），首帧也还是起点
  const tight = glideFrames(from, next, { width: 420, height: 200 }, [0.4, 0, 0.2, 1], 20);
  assert.deepEqual(tight[20], REST);
  assert.deepEqual(tight[0], from);
  for (const f of frames) {
    const a = (f.rotate * Math.PI) / 180;
    const w = next.width * f.scaleX;
    const h = next.height * f.scaleY;
    assert.ok(w * Math.abs(Math.cos(a)) + h * Math.abs(Math.sin(a)) <= area.width + 1e-6);
    assert.ok(w * Math.abs(Math.sin(a)) + h * Math.abs(Math.cos(a)) <= area.height + 1e-6);
  }
});

test("poseAt：起点是第一帧，播完和过了时长都是最后一帧，中间在相邻两帧之间线性走", () => {
  const frames = [{ rotate: -90, scaleX: 2, scaleY: 0.5 }, { rotate: -30, scaleX: 1.5, scaleY: 0.8 }, REST];
  const g: Glide = { frames, start: 1000, ms: 300 };
  assert.deepEqual(poseAt(g, 1000), frames[0]);
  assert.deepEqual(poseAt(g, 1300), REST);
  assert.deepEqual(poseAt(g, 5000), REST);
  assert.deepEqual(poseAt(g, 900), frames[0]);
  const mid = poseAt(g, 1075);
  close(mid.rotate, -60);
  close(mid.scaleX, 1.75);
  close(mid.scaleY, 0.65);
});

test("bezierAt：两端是 0 和 1，线性曲线原样返回，CSS ease 在一半处约 0.8024，单调不减", () => {
  assert.equal(bezierAt([0.4, 0, 0.2, 1], 0), 0);
  assert.equal(bezierAt([0.4, 0, 0.2, 1], 1), 1);
  close(bezierAt([0, 0, 1, 1], 0.3), 0.3);
  close(bezierAt([0.25, 0.1, 0.25, 1], 0.5), 0.8024);
  let last = 0;
  for (let t = 0; t <= 1; t += 0.01) {
    const v = bezierAt([0.4, 0, 0.2, 1], t);
    assert.ok(v >= last - 1e-9);
    last = v;
  }
});
