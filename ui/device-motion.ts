/**
 * 机身缩放、转动的过渡：布局一步换到新尺寸，机身再从“看起来还是旧样子”的姿态动回原位（只动 transform，不逐帧排版）。
 * 这里算起点姿态和逐帧姿态；App.tsx 把逐帧姿态当关键帧交给 createMotion 线性播放，被打断时按同一串关键帧算出当前姿态。
 */
import type { Rotation } from "../shared/protocol";

type Size = { width: number; height: number };
/** 机身的 transform：rotate 是度数（CSS 顺时针为正），scaleX / scaleY 在机身自己的坐标轴上。 */
export type Pose = { rotate: number; scaleX: number; scaleY: number };
export const REST: Pose = { rotate: 0, scaleX: 1, scaleY: 1 };
export type Bezier = readonly [number, number, number, number];
/** 一段正在播的过渡：frames 在 ms 毫秒里均匀排开、相邻两帧之间线性走，start 起算。 */
export type Glide = { frames: Pose[]; start: number; ms: number };

/**
 * 设备方向从 from 变成 to 时，新机身起点要倒转的角度：设备顺时针转了多少，机身就先逆时针转回多少。
 * rotation 是设备顺时针转过的角度（gateway/src/emulator.ts 的约定）；转 270° 等于逆时针转 90°，取近的那边。
 */
export function turnAngle(from: Rotation, to: Rotation): number {
  const cw = (((to - from) % 360) + 360) % 360;
  return cw === 0 ? 0 : cw === 270 ? 90 : -cw;
}

/**
 * 起点姿态：新布局 next 套上它，看起来和旧布局 prev 套上 now（被打断时的中途姿态）一样大、一样朝向。
 * angle 是这次新转的角度；转 90° 时新机身的宽对着旧机身的高。
 */
export function startPose(prev: Size, now: Pose, next: Size, angle: number): Pose {
  const w = prev.width * now.scaleX;
  const h = prev.height * now.scaleY;
  const quarter = Math.abs(angle) % 180 === 90;
  return {
    rotate: now.rotate + angle,
    scaleX: (quarter ? h : w) / next.width,
    scaleY: (quarter ? w : h) / next.height,
  };
}

/** 机身（size，套上 pose）斜着时的外接框放不进 area 就整体缩小到刚好放进；放得进原样返回。 */
export function fitPose(pose: Pose, size: Size, area: Size): Pose {
  if (area.width <= 0 || area.height <= 0) return pose;
  const w = size.width * pose.scaleX;
  const h = size.height * pose.scaleY;
  const a = (pose.rotate * Math.PI) / 180;
  const cos = Math.abs(Math.cos(a));
  const sin = Math.abs(Math.sin(a));
  const k = Math.min(1, area.width / (w * cos + h * sin), area.height / (w * sin + h * cos));
  return k < 1 ? { rotate: pose.rotate, scaleX: pose.scaleX * k, scaleY: pose.scaleY * k } : pose;
}

/**
 * 从 from 按 ease 走到 REST 的 steps + 1 个姿态。首尾原样（起点是旧机身看到的样子，终点是原位，本来就放得进），
 * 中间的斜着时放不进 area 就缩小。
 */
export function glideFrames(from: Pose, size: Size, area: Size, ease: Bezier, steps: number): Pose[] {
  const out: Pose[] = [from];
  for (let i = 1; i < steps; i++) {
    const p = bezierAt(ease, i / steps);
    const mix = (a: number, b: number) => a + (b - a) * p;
    out.push(fitPose({ rotate: mix(from.rotate, 0), scaleX: mix(from.scaleX, 1), scaleY: mix(from.scaleY, 1) }, size, area));
  }
  out.push(REST);
  return out;
}

/** 过渡在 now 时刻的姿态：相邻关键帧之间线性插值（和播放一致）；播完后是最后一帧。 */
export function poseAt(g: Glide, now: number): Pose {
  const last = g.frames.length - 1;
  const t = g.ms > 0 ? Math.min(1, Math.max(0, (now - g.start) / g.ms)) : 1;
  const x = t * last;
  const i = Math.min(last - 1, Math.floor(x));
  if (i < 0) return g.frames[last];
  const f = x - i;
  const a = g.frames[i];
  const b = g.frames[i + 1];
  const mix = (u: number, v: number) => u + (v - u) * f;
  return { rotate: mix(a.rotate, b.rotate), scaleX: mix(a.scaleX, b.scaleX), scaleY: mix(a.scaleY, b.scaleY) };
}

/** CSS cubic-bezier(x1, y1, x2, y2) 在进度 t（时间比例）处的值：先按 x 解出曲线参数，再取 y。 */
export function bezierAt([x1, y1, x2, y2]: Bezier, t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const at = (a: number, b: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  // x(s) 在 [0,1] 上单调（x1、x2 都在 [0,1] 里），二分到 1e-6 足够
  let lo = 0;
  let hi = 1;
  let s = t;
  for (let i = 0; i < 40; i++) {
    s = (lo + hi) / 2;
    if (at(x1, x2, s) < t) lo = s;
    else hi = s;
  }
  return at(y1, y2, s);
}
