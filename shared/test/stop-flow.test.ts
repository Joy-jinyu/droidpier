import { test } from "node:test";
import assert from "node:assert/strict";
import { isStopping, STOP_IDLE, stopStep, type StopEvent, type StopFlow } from "../../ui/stop-flow.ts";

const pixel = { name: "Pixel_9", label: "Pixel 9" };
const tab = { name: "Tab_S", label: "平板" };
/** 依次走完事件，收集发出的请求和提示。 */
const run = (events: StopEvent[], from: StopFlow = STOP_IDLE) => {
  let flow = from;
  const sent: string[] = [];
  const notices: Array<{ text: string; error?: boolean }> = [];
  for (const e of events) {
    const r = stopStep(flow, e);
    flow = r.flow;
    if (r.send) sent.push(r.send);
    if (r.notice) notices.push(r.notice);
  }
  return { flow, sent, notices };
};

test("确认后发一次停止请求，框里显示停止中；连点确认不重复发", () => {
  const r = run([{ kind: "open", target: pixel }, { kind: "confirm" }, { kind: "confirm" }]);
  assert.deepEqual(r.sent, ["Pixel_9"]);
  assert.equal(isStopping(r.flow, "Pixel_9"), true);
  assert.equal(r.flow.ask?.name, "Pixel_9");
});

test("停止中的确认框关不掉；停完关掉框，提示已停止", () => {
  const r = run([{ kind: "open", target: pixel }, { kind: "confirm" }, { kind: "cancel" }]);
  assert.equal(r.flow.ask?.name, "Pixel_9");
  const done = run([{ kind: "done", name: "Pixel_9" }], r.flow);
  assert.equal(done.flow.ask, null);
  assert.equal(isStopping(done.flow, "Pixel_9"), false);
  assert.deepEqual(done.notices, [{ text: "已停止 Pixel 9" }]);
});

test("失败时原因留在框里，框还开着，可以再试", () => {
  const r = run([{ kind: "open", target: pixel }, { kind: "confirm" }, { kind: "failed", name: "Pixel_9", text: "没有停止：设备还在启动" }]);
  assert.equal(r.flow.ask?.name, "Pixel_9");
  assert.equal(r.flow.error, "没有停止：设备还在启动");
  assert.deepEqual(r.notices, []);
  const again = run([{ kind: "confirm" }], r.flow);
  assert.deepEqual(again.sent, ["Pixel_9"]);
  assert.equal(again.flow.error, null);
});

test("列表先看到它停了就算停完，后到的回复不再提示一次", () => {
  const r = run([{ kind: "open", target: pixel }, { kind: "confirm" }, { kind: "gone", name: "Pixel_9" }, { kind: "done", name: "Pixel_9" }, { kind: "failed", name: "Pixel_9", text: "x" }]);
  assert.deepEqual(r.notices, [{ text: "已停止 Pixel 9" }]);
  assert.equal(r.flow.ask, null);
});

test("几台可以同时停：各自停完各自提示；框开着别的设备时，前一台的失败提示在画面上方", () => {
  const r = run([
    { kind: "open", target: pixel }, { kind: "confirm" },
    { kind: "open", target: tab }, { kind: "confirm" },
    { kind: "failed", name: "Pixel_9", text: "没有停止：超时" },
  ]);
  assert.deepEqual(r.sent, ["Pixel_9", "Tab_S"]);
  assert.deepEqual(r.notices, [{ text: "没有停止：超时", error: true }]);
  assert.equal(r.flow.ask?.name, "Tab_S");
  assert.equal(isStopping(r.flow, "Tab_S"), true);
  assert.equal(isStopping(r.flow, "Pixel_9"), false);
});

test("没在停的设备取消就关框，清掉原因", () => {
  const r = run([{ kind: "open", target: pixel }, { kind: "cancel" }]);
  assert.deepEqual(r.flow, STOP_IDLE);
});
