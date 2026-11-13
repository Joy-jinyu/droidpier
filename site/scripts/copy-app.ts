/**
 * 把 nsh 打包的模拟器页面复制到 dist/app/，和官网一起部署到 /app/。
 * 产物默认在仓库根目录的 `.nsh/out/Droidpier`，worktree 里用环境变量 EMU_APP_DIR 指定。
 * 没设 EMU_APP_DIR 且默认位置没有产物时，只打印跳过原因并以 0 退出，本地没打包 nsh 也能构建官网；
 * 显式设了 EMU_APP_DIR 却找不到产物，说明路径写错了，以非 0 退出。
 */
import { cpSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const siteDir = join(fileURLToPath(import.meta.url), "..", "..");
const appDir = resolve(process.env.EMU_APP_DIR || join(siteDir, "..", ".nsh", "out", "Droidpier"));
const target = join(siteDir, "dist", "app");

if (!existsSync(join(appDir, "index.html"))) {
  if (process.env.EMU_APP_DIR) {
    console.error(`[copy-app] 失败：EMU_APP_DIR=${appDir} 下没有 index.html，检查路径是否指向 nsh 打包产物（.nsh/out/Droidpier）`);
    process.exit(1);
  }
  console.log(`[copy-app] 跳过：${appDir} 下没有 index.html（先在仓库根目录运行 bun run build:ui，或用 EMU_APP_DIR 指定产物目录）`);
  process.exit(0);
}

rmSync(target, { recursive: true, force: true });
// .br/.gz 是 nsh 给能直接发预压缩文件的服务器准备的；Cloudflare Pages 自己压缩，不用它们
cpSync(appDir, target, { recursive: true, filter: (src) => !/\.(br|gz)$/.test(src) });
console.log(`[copy-app] 已复制 ${appDir} → dist/app/`);
