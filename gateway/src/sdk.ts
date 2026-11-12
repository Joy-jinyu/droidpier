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
  let creds = grpc.credentials.createInsecure();
  if (token) {
    const call = grpc.credentials.createFromMetadataGenerator((_p, cb) => {
      const md = new grpc.Metadata();
      md.set("authorization", `Bearer ${token}`);
      cb(null, md);
    });
    // 本机明文连接也要带 token：grpc-js 只允许在 insecure 通道上用 combineChannelCredentials 的变通写法
    creds = grpc.credentials.combineChannelCredentials(grpc.credentials.createInsecure(), call);
  }
  return new Ctor(`127.0.0.1:${port}`, creds, { "grpc.max_receive_message_length": 64 * 1024 * 1024 });
}
