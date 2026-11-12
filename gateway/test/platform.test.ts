import { test } from "node:test";
import assert from "node:assert/strict";
import { findJavaHome, type JavaIo } from "../src/platform.ts";

const HOME = "/Users/me";
const STUDIO = "/Applications/Android Studio.app/Contents/jbr/Contents/Home";
const USER_STUDIO = `${HOME}/Applications/Android Studio.app/Contents/jbr/Contents/Home`;
const TOOLBOX = `${HOME}/Library/Application Support/JetBrains/Toolbox/apps/AndroidStudio/ch-0`;

function io(opts: { javaHome?: string; bins?: string[]; toolbox?: string[]; javaHomeCmd?: string | null }): JavaIo & { cmdCalls: number } {
  const r = {
    home: HOME,
    env: opts.javaHome,
    cmdCalls: 0,
    exists: async (p: string) => (opts.bins ?? []).includes(p),
    readdir: async (d: string) => {
      if (d === TOOLBOX && opts.toolbox) return opts.toolbox;
      throw new Error("ENOENT");
    },
    javaHomeCmd: async () => {
      r.cmdCalls++;
      return opts.javaHomeCmd ?? null;
    },
  };
  return r;
}

test("findJavaHome：JAVA_HOME 里有 bin/java 就用它", async () => {
  assert.equal(await findJavaHome(io({ javaHome: "/jdk", bins: ["/jdk/bin/java", `${STUDIO}/bin/java`] })), "/jdk");
});

test("findJavaHome：JAVA_HOME 无效时依次找 /Applications、~/Applications 里的 Android Studio JBR", async () => {
  assert.equal(await findJavaHome(io({ javaHome: "/bad", bins: [`${STUDIO}/bin/java`] })), STUDIO);
  assert.equal(await findJavaHome(io({ bins: [`${USER_STUDIO}/bin/java`] })), USER_STUDIO);
});

test("findJavaHome：JetBrains Toolbox 装的 Android Studio", async () => {
  const jbr = `${TOOLBOX}/241.1/Android Studio.app/Contents/jbr/Contents/Home`;
  assert.equal(await findJavaHome(io({ toolbox: ["241.1"], bins: [`${jbr}/bin/java`] })), jbr);
});

test("findJavaHome：都没有时问 /usr/libexec/java_home；它也失败就是 null（不去跑 /usr/bin/java）", async () => {
  assert.equal(await findJavaHome(io({ javaHomeCmd: "/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home" })), "/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home");
  const none = io({});
  assert.equal(await findJavaHome(none), null);
  assert.equal(none.cmdCalls, 1);
});
