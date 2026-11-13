import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { protoPath } from "./platform.ts";

// grpc-js 动态加载的客户端没有静态类型，这里只声明用到的形状
export type EmulatorControllerClient = grpc.Client & Record<string, any>;

/** 连接本机模拟器的 gRPC 服务；带 token 时每次调用都附 Bearer 头。 */
export function loadController(port: number, token?: string): EmulatorControllerClient {
  const def = protoLoader.loadSync(protoPath(), {
    keepCase: true,
    longs: Number,
    enums: String,
    defaults: true,
  });
  const pkg = grpc.loadPackageDefinition(def) as any;
  const Ctor = pkg.android.emulation.control.EmulatorController;
  // 本机明文通道：grpc-js 不允许把调用凭据叠到 insecure 通道上（会抛 Cannot compose insecure credentials），
  // 所以 token 用拦截器在每次调用的元数据里加 Bearer 头
  const interceptors: grpc.Interceptor[] = token
    ? [
        (options, next) =>
          new grpc.InterceptingCall(next(options), {
            start(md, listener, start) {
              md.set("authorization", `Bearer ${token}`);
              start(md, listener);
            },
          }),
      ]
    : [];
  return new Ctor(`127.0.0.1:${port}`, grpc.credentials.createInsecure(), { "grpc.max_receive_message_length": 64 * 1024 * 1024, interceptors });
}
