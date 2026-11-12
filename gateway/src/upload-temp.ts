import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

/** 传文件的临时目录名前缀（建在 os.tmpdir() 下）。 */
export const UPLOAD_DIR_PREFIX = "droidpier-upload-";

/** 删掉上次网关异常退出留下的临时目录：只删超过 maxAgeMs 没动过的，正在用的不会这么老。 */
export async function cleanStaleUploads(root: string, now: number, maxAgeMs = 3600_000): Promise<void> {
  const names = await readdir(root).catch(() => [] as string[]);
  for (const n of names) {
    if (!n.startsWith(UPLOAD_DIR_PREFIX)) continue;
    const dir = join(root, n);
    const st = await stat(dir).catch(() => null);
    if (st?.isDirectory() && now - st.mtimeMs > maxAgeMs) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
