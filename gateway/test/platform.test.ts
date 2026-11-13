import { test } from "node:test";
import assert from "node:assert/strict";
import { androidUserHome, avdHome, explicitAvdHome } from "../src/platform.ts";
import { homedir } from "node:os";
import { join } from "node:path";

/** 临时改环境变量跑 fn，跑完还原。 */
function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const old = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  const set = (k: string, v: string | undefined) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
  for (const [k, v] of Object.entries(vars)) set(k, v);
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(old)) set(k, v);
  }
}

test("avdHome：ANDROID_AVD_HOME 是空字符串时当没设，用 ~/.android/avd", () => {
  withEnv({ ANDROID_AVD_HOME: "", ANDROID_USER_HOME: undefined }, () => {
    assert.equal(avdHome(), join(homedir(), ".android/avd"));
    assert.equal(explicitAvdHome(), undefined);
  });
  withEnv({ ANDROID_AVD_HOME: "/x/avd" }, () => {
    assert.equal(avdHome(), "/x/avd");
    assert.equal(explicitAvdHome(), "/x/avd");
  });
});

test("avdHome：和模拟器一样，没设 ANDROID_AVD_HOME 时用 ANDROID_USER_HOME/avd，再其次 ~/.android/avd", () => {
  withEnv({ ANDROID_AVD_HOME: undefined, ANDROID_USER_HOME: "/u/.android" }, () => assert.equal(avdHome(), "/u/.android/avd"));
  withEnv({ ANDROID_AVD_HOME: "", ANDROID_USER_HOME: "" }, () => assert.equal(avdHome(), join(homedir(), ".android/avd")));
  withEnv({ ANDROID_AVD_HOME: "/x/avd", ANDROID_USER_HOME: "/u/.android" }, () => assert.equal(avdHome(), "/x/avd"));
});

test("androidUserHome：ANDROID_USER_HOME 非空时用它，否则 ~/.android", () => {
  withEnv({ ANDROID_USER_HOME: "/u/.android" }, () => assert.equal(androidUserHome(), "/u/.android"));
  withEnv({ ANDROID_USER_HOME: "" }, () => assert.equal(androidUserHome(), join(homedir(), ".android")));
});
