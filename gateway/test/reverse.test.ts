import { test } from "node:test";
import assert from "node:assert/strict";
import { createReverses } from "../src/reverse.ts";

test("ensure 对同一端口只执行一次 reverse", async () => {
  const cmds: string[][] = [];
  const exec = async (args: string[]) => { cmds.push(args); return ""; };
  const r = createReverses(exec);
  await r.ensure(5173);
  await r.ensure(5173);
  const reverseCalls = cmds.filter((a) => a[0] === "reverse" && a[1] === "tcp:5173");
  assert.equal(reverseCalls.length, 1);
  assert.deepEqual(reverseCalls[0], ["reverse", "tcp:5173", "tcp:5173"]);
});

test("list 返回已建立的端口列表", async () => {
  const exec = async () => "";
  const r = createReverses(exec);
  await r.ensure(5173);
  await r.ensure(3000);
  const ports = r.list();
  assert.ok(ports.includes(5173));
  assert.ok(ports.includes(3000));
});

test("removeAll 只移除自己建立的 reverse", async () => {
  const cmds: string[][] = [];
  const exec = async (args: string[]) => { cmds.push(args); return ""; };
  const r = createReverses(exec);
  await r.ensure(5173);
  await r.ensure(3000);
  await r.removeAll();
  const removeCalls = cmds.filter((a) => a[0] === "reverse" && a[1] === "--remove");
  assert.equal(removeCalls.length, 2);
  const ports = removeCalls.map((a) => a[2]);
  assert.ok(ports.includes("tcp:5173"));
  assert.ok(ports.includes("tcp:3000"));
});

test("removeAll 后 list 返回空", async () => {
  const exec = async () => "";
  const r = createReverses(exec);
  await r.ensure(5173);
  await r.removeAll();
  assert.deepEqual(r.list(), []);
});

// 修复并发：Promise.all 下两个 ensure(5173) 只应执行一次 exec
test("并发 ensure 同端口只执行一次 reverse", async () => {
  const cmds: string[][] = [];
  const exec = async (args: string[]) => { cmds.push(args); return ""; };
  const r = createReverses(exec);
  await Promise.all([r.ensure(5173), r.ensure(5173)]);
  const reverseCalls = cmds.filter((a) => a[0] === "reverse" && a[1] === "tcp:5173");
  assert.equal(reverseCalls.length, 1);
  assert.deepEqual(r.list(), [5173]);
});

// exec 第一次失败后，ensure 应清除飞行中记录，下次重试时再执行一次 exec
test("ensure 失败后可重试，成功后 list 才包含该端口", async () => {
  const cmds: string[][] = [];
  let callCount = 0;
  const exec = async (args: string[]) => {
    cmds.push(args);
    callCount++;
    if (callCount === 1) throw new Error("adb error");
    return "";
  };
  const r = createReverses(exec);
  // 第一次失败
  await assert.rejects(() => r.ensure(5173));
  assert.deepEqual(r.list(), [], "失败后 list 不应包含该端口");
  // 第二次成功
  await r.ensure(5173);
  assert.equal(callCount, 2, "应执行两次 exec");
  assert.deepEqual(r.list(), [5173]);
});

test("ensure 未完成时调用 removeAll：等它完成后照样移除，list 为空", async () => {
  const cmds: string[][] = [];
  let finish!: () => void;
  const exec = (args: string[]) => {
    cmds.push(args);
    if (args[1] === "tcp:5173") return new Promise<string>((r) => (finish = () => r("")));
    return Promise.resolve("");
  };
  const r = createReverses(exec);
  const ensuring = r.ensure(5173);
  const removing = r.removeAll();
  finish();
  await ensuring;
  await removing;
  assert.deepEqual(cmds.at(-1), ["reverse", "--remove", "tcp:5173"]);
  assert.deepEqual(r.list(), []);
});

test("removeAll 中某个端口移除失败：其余端口照样移除，list 清空，最后报出失败的端口", async () => {
  const cmds: string[][] = [];
  const exec = async (args: string[]) => {
    cmds.push(args);
    if (args[1] === "--remove" && args[2] === "tcp:5173") throw new Error("device offline");
    return "";
  };
  const r = createReverses(exec);
  await r.ensure(5173);
  await r.ensure(3000);
  await assert.rejects(() => r.removeAll(), /5173.*device offline/);
  const removed = cmds.filter((a) => a[1] === "--remove").map((a) => a[2]);
  assert.deepEqual(removed.sort(), ["tcp:3000", "tcp:5173"]);
  assert.deepEqual(r.list(), []);
});
