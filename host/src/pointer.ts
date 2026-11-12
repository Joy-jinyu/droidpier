import type { ClientMsg, Rotation } from "../../shared/protocol.ts";
import { toDevice } from "../../shared/input-map.ts";

type PointerEvent = { clientX: number; clientY: number; pointerId: number };
type Geom = () => {
  rect: { left: number; top: number; width: number; height: number };
  device: { width: number; height: number };
  rotation?: Rotation;
};

/** 指针跟踪器：只跟踪一个指针，保证始终发出抬起事件。 */
export function createPointerTracker(
  send: (m: ClientMsg) => void,
  geom: Geom
): {
  down(e: PointerEvent): void;
  move(e: PointerEvent): void;
  up(e: PointerEvent): void;
  cancel(): void;
} {
  let active = false;
  // 最后一次发送的设备坐标，供 cancel 使用
  let lastX = 0;
  let lastY = 0;

  function sendTouch(clientX: number, clientY: number, isDown: boolean): void {
    const { rect, device, rotation } = geom();
    const { x, y } = toDevice({ x: clientX, y: clientY }, rect, device, rotation);
    lastX = x;
    lastY = y;
    send({ t: "touch", x, y, down: isDown });
  }

  function releaseAtLast(): void {
    if (!active) return;
    active = false;
    send({ t: "touch", x: lastX, y: lastY, down: false });
  }

  return {
    down(e) {
      // 若已有指针按下，先在原位补发抬起
      if (active) releaseAtLast();
      active = true;
      sendTouch(e.clientX, e.clientY, true);
    },
    move(e) {
      if (!active) return;
      sendTouch(e.clientX, e.clientY, true);
    },
    up(e) {
      if (!active) return;
      active = false;
      sendTouch(e.clientX, e.clientY, false);
    },
    cancel() {
      // 在最后已知坐标补发 down:false
      releaseAtLast();
    },
  };
}
