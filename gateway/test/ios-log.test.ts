import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLogcatLine } from "../../shared/logcat.ts";
import { iosLogLines, iosLogTranslator, parseLaunchctlApps } from "../src/ios-log.ts";

const ev = (o: Record<string, unknown>) => JSON.stringify({ timestamp: "2026-11-22 10:17:15.916083+0800", messageType: "Default", processID: 43976, threadID: 1380644, processImagePath: "/Applications/MobileSafari.app/MobileSafari", subsystem: "com.apple.WebKit", category: "Loading", eventMessage: "loaded", ...o });

test("iosLogLines：ndjson 日志转成日志面板能解析的 threadtime 行", () => {
  const [line] = iosLogLines(ev({}));
  assert.deepEqual(parseLogcatLine(line), { time: "11-22 10:17:15.916", pid: 43976, tid: 1380644, level: "I", tag: "MobileSafari", msg: "[com.apple.WebKit:Loading] loaded" });
  assert.equal(parseLogcatLine(iosLogLines(ev({ messageType: "Error", subsystem: "" }))[0])?.level, "E");
  assert.equal(parseLogcatLine(iosLogLines(ev({ messageType: "Fault" }))[0])?.level, "F");
  assert.equal(parseLogcatLine(iosLogLines(ev({ messageType: "Debug" }))[0])?.level, "D");
  assert.equal(parseLogcatLine(iosLogLines(ev({ subsystem: "" }))[0])?.msg, "loaded");
});

test("iosLogLines：多行内容拆成同一个头的几行；不是日志事件、坏 JSON 的返回空", () => {
  const lines = iosLogLines(ev({ eventMessage: "a\nb" }));
  assert.deepEqual(lines.map((l) => parseLogcatLine(l)?.msg), ["[com.apple.WebKit:Loading] a", "b"]);
  assert.deepEqual(iosLogLines('{"eventType":"activityCreateEvent"}'), []);
  assert.deepEqual(iosLogLines("{oops"), []);
});

test("iosLogTranslator：断在半行的输出等下一块拼上再转", () => {
  const got: string[] = [];
  const feed = iosLogTranslator((s) => got.push(s));
  const whole = ev({}) + "\n";
  feed(whole.slice(0, 30));
  assert.deepEqual(got, []);
  feed(whole.slice(30));
  assert.equal(got.length, 1);
  assert.equal(parseLogcatLine(String(got[0]).trimEnd())?.msg, "[com.apple.WebKit:Loading] loaded");
});

test("parseLaunchctlApps：只要运行中的 App（UIKitApplication 行、pid 不是 -）", () => {
  const out = [
    "PID\tStatus\tLabel",
    "43976\t0\tUIKitApplication:com.apple.mobilesafari[44a8][rb-legacy]",
    "-\t0\tUIKitApplication:com.apple.Maps[1234][rb-legacy]",
    "32010\t0\tcom.apple.locationd",
  ].join("\n");
  assert.deepEqual(parseLaunchctlApps(out), [{ pid: 43976, bundle: "com.apple.mobilesafari" }]);
});
