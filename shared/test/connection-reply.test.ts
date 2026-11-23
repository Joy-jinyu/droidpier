import { test } from "node:test";
import assert from "node:assert/strict";
import { isReply } from "../../host/src/connection.ts";
import type { ServerMsg } from "../protocol.ts";

test("isReply：带 rid 的回复都能结算请求，包括 stopAvd（之前漏了，停止设备要等满 15 秒超时）", () => {
  const replies: ServerMsg[] = [
    { t: "stopAvd", rid: 1, ok: true },
    { t: "deleteAvd", rid: 2, ok: true },
    { t: "renameAvd", rid: 3, ok: false, error: "x" },
    { t: "webviews", rid: 4, list: [] },
    { t: "logcatRead", rid: 5, lines: [] },
    { t: "proxyCheck", rid: 6, proxy: null },
    { t: "proxyClear", rid: 7, ok: true },
  ];
  for (const m of replies) assert.equal(isReply(m), true, m.t);
});

test("isReply：不带 rid 的推送不是回复", () => {
  const pushes: ServerMsg[] = [
    { t: "error", message: "x" },
    { t: "inspectMode", on: true, mapped: true },
    { t: "highlight", box: null },
  ];
  for (const m of pushes) assert.equal(isReply(m), false, m.t);
});
