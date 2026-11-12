// 抹掉构建产物里的本机路径（比如 Rust 编译进 wasm 的 ~/.cargo/registry 路径），免得公开发布时带出用户名
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** 把 buf 里出现的 home 换成等长的占位（/Users/xxxx），长度不变，wasm 等二进制里的偏移不受影响；没改返回 null。 */
export function scrubBuffer(buf: Buffer, home: string): Buffer | null {
  const from = Buffer.from(home);
  if (from.length < 2 || buf.indexOf(from) < 0) return null;
  const parts = home.split("/");
  const masked = parts.map((p, i) => (i === parts.length - 1 ? "x".repeat(p.length) : p)).join("/");
  const to = Buffer.from(masked);
  const out = Buffer.from(buf);
  for (let i = out.indexOf(from); i >= 0; i = out.indexOf(from, i + to.length)) to.copy(out, i);
  return out;
}

/** 递归处理目录里的所有文件，返回改过的文件。 */
export async function scrubDir(dir: string, home: string): Promise<string[]> {
  const changed: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue;
    const f = join(e.parentPath, e.name);
    const out = scrubBuffer(await readFile(f), home);
    if (out) {
      await writeFile(f, out);
      changed.push(f);
    }
  }
  return changed;
}
