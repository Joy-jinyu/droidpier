import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { loadController } from "../src/sdk.ts";
import { protoPath } from "../src/platform.ts";

// 假的模拟器 gRPC 服务：getStatus 只在带对 Bearer 头时成功（Android Studio 用 -grpc-use-token 启动的模拟器就是这样）
async function fakeEmulator(token: string | null) {
  const def = protoLoader.loadSync(protoPath(), { keepCase: true, longs: Number, enums: String, defaults: true });
  const svc = (grpc.loadPackageDefinition(def) as any).android.emulation.control.EmulatorController.service;
  const server = new grpc.Server();
  const seen: (string | undefined)[] = [];
  server.addService(svc, {
    getStatus(call: grpc.ServerUnaryCall<unknown, unknown>, cb: grpc.sendUnaryData<unknown>) {
      const auth = call.metadata.get("authorization")[0]?.toString();
      seen.push(auth);
      if (token !== null && auth !== `Bearer ${token}`) cb({ code: grpc.status.UNAUTHENTICATED, details: "bad token" });
      else cb(null, { booted: true, uptime: 1 });
    },
  });
  const port = await new Promise<number>((res, rej) =>
    server.bindAsync("127.0.0.1:0", grpc.ServerCredentials.createInsecure(), (e, p) => (e ? rej(e) : res(p))),
  );
  return { port, seen, close: () => server.forceShutdown() };
}

const getStatus = (c: any) =>
  new Promise<{ booted: boolean }>((res, rej) => c.getStatus({}, (e: Error | null, r: { booted: boolean }) => (e ? rej(e) : res(r))));

const skip = existsSync(protoPath()) ? false : "本机没有 Android SDK 的 emulator_controller.proto";

test("loadController：模拟器要求 token 时，带上 token 能调用成功", { skip }, async (t) => {
  const emu = await fakeEmulator("tok-123");
  t.after(emu.close);
  const c = loadController(emu.port, "tok-123");
  t.after(() => c.close());
  assert.equal((await getStatus(c)).booted, true);
  assert.deepEqual(emu.seen, ["Bearer tok-123"]);
});

test("loadController：没有 token 时不带 authorization 头", { skip }, async (t) => {
  const emu = await fakeEmulator(null);
  t.after(emu.close);
  const c = loadController(emu.port);
  t.after(() => c.close());
  assert.equal((await getStatus(c)).booted, true);
  assert.deepEqual(emu.seen, [undefined]);
});
