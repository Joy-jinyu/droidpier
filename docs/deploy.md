# 部署公网页面（droid.devpier.dev）

页面托管在 Cloudflare Pages，整个域名只放这一个站：

| 地址 | 内容 | 来源 |
| --- | --- | --- |
| `/` | 官网 | android-emu-web-site 仓库的 `site/dist` |
| `/app/` | 网页模拟器 | 本仓库 `bun run build:ui` 的产物 `.nsh/out/Droidpier` |
| `/download/droidpier-darwin-arm64.tar.xz`、`.tar.xz.sha256` | 网关可执行文件 | 本仓库 `bun run build:bin` 的产物 `dist/` |
| `/install.sh` | 安装脚本 | 本仓库 `scripts/install.sh` |

响应头（CSP 等）由官网的 `site/public/_headers` 决定，构建后在 `site/dist/_headers`。

## 怎么用

```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh
droidpier
```

在 Chrome 或 Edge 里打开终端打印出的链接，Chrome 弹出访问本地网络的权限框时点"允许"。

## 部署步骤

部署和登录都要维护者本人来做。

1. 构建官网：在 android-emu-web-site 仓库的 `site/` 里运行 `bun run build`，得到 `site/dist`。
2. 构建网关和页面：在本仓库运行 `bun run build:bin`。它先跑 `build:ui`，再生成 `dist/droidpier-darwin-arm64.tar.xz` 和 `.sha256`。`build:ui` 需要 nsh：把 `NSH` 设成 nsh 可执行文件的路径，或把 `nsh` 放进 `PATH`；编 wasm 用的 llvm 默认在 `/opt/homebrew/opt/llvm/bin`，别处的话设 `LLVM_BIN`。
3. 拼部署目录：

   ```sh
   node scripts/build-pages.ts <android-emu-web-site 仓库>/site/dist
   ```

   产物在 `dist/pages`。脚本最后会检查：必需文件都在、sha256 对得上、没有超过 25 MiB 的文件、`/app/` 下没有 `.br`/`.gz`、`_headers` 里 `/app/` 的 CSP 放行了本机网关（`ws://127.0.0.1:*`）和 DevTools iframe（`https://chrome-devtools-frontend.appspot.com`）。有一项不通过就以非 0 退出，不要部署。
4. 本地先看一遍（可选）：`node scripts/serve-pages.ts dist/pages --port 7351`，按 `_headers` 加响应头，在 `http://127.0.0.1:7351/` 提供。
5. 登录 Cloudflare：`bunx wrangler@4 login`，用 `bunx wrangler@4 whoami` 确认账号。
6. 第一次部署时创建 Pages 项目（项目名用 `android-emu-web`，下面都按这个名字写）：

   ```sh
   bunx wrangler@4 pages project create android-emu-web --production-branch main
   ```

7. 部署：

   ```sh
   bunx wrangler@4 pages deploy dist/pages --project-name android-emu-web --branch main
   ```

   wrangler 会打印这次部署的预览地址（`https://<hash>.android-emu-web.pages.dev`）。
8. 第一次部署后绑定域名：Cloudflare 控制台 → Workers & Pages → android-emu-web → Custom domains → Set up a custom domain，填 `droid.devpier.dev`。`devpier.dev` 在同一个 Cloudflare 账号下，DNS 记录会自动加上。等证书状态变成 Active。

## 部署后验证

在一个新的 Chrome 配置里逐项检查：

- [ ] `https://droid.devpier.dev/` 是官网，`/app/` 打开模拟器页面（本机没运行 droidpier 时显示"还没连上本机的 Droidpier"和安装、运行两步）。
- [ ] `curl -sI https://droid.devpier.dev/app/` 的 `content-security-policy` 是 `/app/` 自己那一份（包含 `ws://127.0.0.1:*` 和 `frame-src https://chrome-devtools-frontend.appspot.com`），只有一份。
- [ ] `curl -fsSL https://droid.devpier.dev/install.sh | sh` 能装好；`shasum -a 256` 和 `.sha256` 一致。
- [ ] 按其他用户的步骤走一遍（不需要口令或专门的链接）：
  1. 安装：`curl -fsSL https://droid.devpier.dev/install.sh | sh`。
  2. 在终端运行 `droidpier`，保持终端开着。它会打开 `https://droid.devpier.dev/app/`；已经开着的页面也会在一两秒内自己连上，不用刷新。
  3. 第一次用时 Chrome 会弹出"访问本地网络"的权限框，点"允许"后出现画面，可以操作。
  - 端口不是默认的 7300 时（`droidpier --port 7306`），打开的地址带 `#port=7306`，页面会记住这个端口。
  - 关掉 droidpier：页面显示"还没连上本机的 Droidpier"和两步说明；再运行 droidpier，页面自动重连。
  - 换一个新配置，点"拒绝"：页面显示"无法访问本机"，并说明去 设置 → 隐私和安全 → 网站设置 里改。
  - H5 调试里点"审查"，嵌入的 DevTools 能打开。
  - DevTools 控制台里没有 CSP 报错。
- 全部通过后即完成部署。如需打开本机页面调试，加 `--local` 参数。

## 回滚

- Cloudflare 控制台 → Workers & Pages → android-emu-web → Deployments，在上一个正常的部署上选"Rollback to this deployment"。
- 或者 checkout 上一个版本，重新执行"部署步骤"的 1–3 和 7。
- 回滚页面不影响其他用户本机已经装好的网关。页面和网关的协议版本对不上时，页面会提示升级命令。
