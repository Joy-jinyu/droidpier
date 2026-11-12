import { test } from "node:test";
import assert from "node:assert/strict";
import { createHeldKeys } from "../../host/src/held-keys.ts";
import type { ClientMsg } from "../protocol.ts";

test("keydown 后 releaseAll 补发 keyup", () => {
  const sent: ClientMsg[] = [];
  const hk = createHeldKeys((m) => sent.push(m));
  hk.onMsg({ t: "key", key: "Backspace", eventType: "keydown" });
  hk.onMsg({ t: "key", key: "ArrowLeft", eventType: "keydown" });
  hk.releaseAll();
  const keyups = sent.filter((m) => m.t === "key" && m.eventType === "keyup").map((m) => (m as Extract<ClientMsg, { t: "key" }>).key).sort();
  assert.deepEqual(keyups, ["ArrowLeft", "Backspace"]);
});

test("已 keyup 的键不重复补发", () => {
  const sent: ClientMsg[] = [];
  const hk = createHeldKeys((m) => sent.push(m));
  hk.onMsg({ t: "key", key: "Backspace", eventType: "keydown" });
  hk.onMsg({ t: "key", key: "Backspace", eventType: "keyup" });
  hk.releaseAll();
  assert.equal(sent.length, 0);
});

test("keypress 不记录", () => {
  const sent: ClientMsg[] = [];
  const hk = createHeldKeys((m) => sent.push(m));
  hk.onMsg({ t: "key", key: "Enter", eventType: "keypress" });
  hk.releaseAll();
  assert.equal(sent.length, 0);
});
