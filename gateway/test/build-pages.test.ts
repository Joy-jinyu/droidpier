import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, truncate, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appCspProblems, buildPages, checkPages, DOWNLOAD_NAME, replaceOrigin } from "../../scripts/build-pages.ts";
import { OFFICIAL_ORIGIN } from "../../shared/protocol.ts";
import { headersFor, parseHeaders } from "../../scripts/serve-pages.ts";

const LOCAL = "http://127.0.0.1:* https://127.0.0.1:* ws://127.0.0.1:* wss://127.0.0.1:* http://localhost:* https://localhost:* ws://localhost:* wss://localhost:*";
const SITE_APP_CSP = `default-src 'self'; script-src 'self' 'unsafe-inline' blob: 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ${LOCAL}; frame-ancestors 'none'; base-uri 'self'; object-src 'none'`;
const GOOD_APP_CSP = SITE_APP_CSP.replace("; frame-ancestors", "; frame-src https://chrome-devtools-frontend.appspot.com; frame-ancestors");
const headersText = (appCsp: string) =>
  `/*\n  Content-Security-Policy: default-src 'self'\n  X-Content-Type-Options: nosniff\n/app/\n  ! Content-Security-Policy\n  Content-Security-Policy: ${appCsp}\n/app/*\n  ! Content-Security-Policy\n  Content-Security-Policy: ${appCsp}\n`;

/** 假的官网 dist、nsh 产物、下载文件和安装脚本 */
async function fixture(t: { after(fn: () => unknown): void }, opts: { appCsp?: string; origin?: string } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "emu-pages-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const site = join(dir, "site");
  const app = join(dir, "app");
  const download = join(dir, "download");
  await mkdir(join(site, "app"), { recursive: true });
  await mkdir(join(site, "docs"), { recursive: true });
  await writeFile(join(site, "index.html"), "<h1>site</h1>");
  await writeFile(join(site, "docs/index.html"), "<h1>docs</h1>");
  await writeFile(join(site, "_headers"), headersText(opts.appCsp ?? GOOD_APP_CSP));
  await writeFile(join(site, "app/old.js"), "stale");
  await mkdir(join(app, "browser.x"), { recursive: true });
  await writeFile(join(app, "index.html"), "<h1>app</h1>");
  await writeFile(join(app, "nsh.wasm"), "wasm");
  await writeFile(join(app, "nsh.wasm.br"), "br");
  await writeFile(join(app, "index.html.gz"), "gz");
  await writeFile(join(app, "browser.x/host.js"), "host");
  await mkdir(download);
  const xz = Buffer.from("fake-xz");
  await writeFile(join(download, `${DOWNLOAD_NAME}.tar.xz`), xz);
  await writeFile(join(download, `${DOWNLOAD_NAME}.tar.xz.sha256`), `${createHash("sha256").update(xz).digest("hex")}  ${DOWNLOAD_NAME}.tar.xz\n`);
  const installSh = join(dir, "install.sh");
  await writeFile(installSh, '#!/bin/sh\nbase="${DROIDPIER_DOWNLOAD:-https://droid.devpier.dev/download}"\n');
  const out = join(dir, "out");
  return { siteDist: site, appDir: app, downloadDir: download, installSh, out, origin: opts.origin ?? OFFICIAL_ORIGIN };
}

test("buildPages：官网在根目录，nsh 产物换掉 /app/，下载文件进 download/，install.sh 在根目录", async (t) => {
  const f = await fixture(t);
  await buildPages(f);
  assert.ok(existsSync(join(f.out, "index.html")));
  assert.ok(existsSync(join(f.out, "docs/index.html")));
  assert.ok(existsSync(join(f.out, "_headers")));
  assert.deepEqual((await readdir(join(f.out, "app"))).sort(), ["browser.x", "index.html", "nsh.wasm"]);
  assert.ok(existsSync(join(f.out, "app/browser.x/host.js")));
  assert.deepEqual((await readdir(join(f.out, "download"))).sort(), [`${DOWNLOAD_NAME}.tar.xz`, `${DOWNLOAD_NAME}.tar.xz.sha256`]);
  assert.ok(existsSync(join(f.out, "install.sh")));
  assert.deepEqual(await checkPages(f.out, f.origin), []);
});

test("buildPages：部署自己的一套时，官网和 install.sh 里的官方地址换成自己的，/app/ 和下载包不动", async (t) => {
  const f = await fixture(t, { origin: "https://emu.example.dev" });
  await writeFile(join(f.siteDist, "sitemap-index.xml"), "<loc>https://droid.devpier.dev/docs/</loc>");
  await writeFile(join(f.siteDist, "docs/index.html"), "<p>页面在 droid.devpier.dev，安装：curl -fsSL https://droid.devpier.dev/install.sh | sh</p>");
  await writeFile(join(f.appDir, "index.html"), "https://droid.devpier.dev");
  await buildPages(f);
  assert.equal(await readFile(join(f.out, "sitemap-index.xml"), "utf8"), "<loc>https://emu.example.dev/docs/</loc>");
  assert.equal(await readFile(join(f.out, "docs/index.html"), "utf8"), "<p>页面在 emu.example.dev，安装：curl -fsSL https://emu.example.dev/install.sh | sh</p>");
  assert.match(await readFile(join(f.out, "install.sh"), "utf8"), /https:\/\/emu\.example\.dev\/download/);
  assert.equal(await readFile(join(f.out, "app/index.html"), "utf8"), "https://droid.devpier.dev");
  assert.deepEqual(await checkPages(f.out, f.origin), []);
});

test("checkPages：部署在官方地址的子域名上时，替换后的文字不算留着官方地址", async (t) => {
  const f = await fixture(t, { origin: "https://beta.droid.devpier.dev" });
  await writeFile(join(f.siteDist, "llms.txt"), "https://droid.devpier.dev/docs/");
  await buildPages(f);
  assert.equal(await readFile(join(f.out, "llms.txt"), "utf8"), "https://beta.droid.devpier.dev/docs/");
  assert.deepEqual(await checkPages(f.out, f.origin), []);
});

test("checkPages：install.sh 不从这一套的地址下载、官网里还留着官方地址都报出来", async (t) => {
  const f = await fixture(t, { origin: "https://emu.example.dev" });
  await buildPages(f);
  await writeFile(join(f.out, "install.sh"), '#!/bin/sh\nbase="https://droid.devpier.dev/download"\n');
  await writeFile(join(f.out, "llms.txt"), "https://droid.devpier.dev/");
  const problems = (await checkPages(f.out, f.origin)).join("\n");
  assert.match(problems, /install\.sh 不是从 https:\/\/emu\.example\.dev\/download/);
  assert.match(problems, /llms\.txt 里还有官方地址/);
});

test("replaceOrigin：带 https:// 的整个换，只写主机名的换主机名，名字相近的不动", () => {
  assert.equal(replaceOrigin("https://droid.devpier.dev/app/", "http://droid.test:7351"), "http://droid.test:7351/app/");
  assert.equal(replaceOrigin("`droid.devpier.dev`", "https://emu.example.dev"), "`emu.example.dev`");
  assert.equal(replaceOrigin("droidXdevpierXdev", "https://emu.example.dev"), "droidXdevpierXdev");
  for (const s of ["beta.droid.devpier.dev", "https://beta.droid.devpier.dev/", "droid.devpier.dev.example", "my-droid.devpier.dev"]) {
    assert.equal(replaceOrigin(s, "https://emu.example.dev"), s);
  }
  assert.equal(replaceOrigin("见 droid.devpier.dev。", "https://emu.example.dev"), "见 emu.example.dev。");
  assert.equal(replaceOrigin('base="${DROIDPIER_DOWNLOAD:-https://droid.devpier.dev/download}"', "https://emu.example.dev"), 'base="${DROIDPIER_DOWNLOAD:-https://emu.example.dev/download}"');
});

test("buildPages：重跑时先清空输出目录，不留上次的文件", async (t) => {
  const f = await fixture(t);
  await mkdir(f.out, { recursive: true });
  await writeFile(join(f.out, "leftover.txt"), "x");
  await buildPages(f);
  assert.equal(existsSync(join(f.out, "leftover.txt")), false);
});

test("checkPages：缺文件、sha256 对不上、超过 25 MiB、/app/ 里有 .br/.gz 都报出来", async (t) => {
  const f = await fixture(t);
  await buildPages(f);
  await rm(join(f.out, "install.sh"));
  await writeFile(join(f.out, `download/${DOWNLOAD_NAME}.tar.xz.sha256`), `${"0".repeat(64)}  x\n`);
  await writeFile(join(f.out, "app/extra.js.gz"), "gz");
  await writeFile(join(f.out, "big.bin"), "");
  await truncate(join(f.out, "big.bin"), 25 * 2 ** 20 + 1);
  const problems = (await checkPages(f.out, f.origin)).join("\n");
  assert.match(problems, /缺 install\.sh/);
  assert.match(problems, /sha256/);
  assert.match(problems, /big\.bin.*25 MiB/);
  assert.match(problems, /app\/extra\.js\.gz/);
});

test("checkPages：官网 /app/ 的 CSP 不放行 DevTools iframe 时报出来", async (t) => {
  const f = await fixture(t, { appCsp: SITE_APP_CSP });
  await buildPages(f);
  assert.match((await checkPages(f.out, f.origin)).join("\n"), /chrome-devtools-frontend\.appspot\.com/);
});

test("appCspProblems：要连本机网关、要嵌 appspot DevTools；frame-src 缺省时按 child-src、default-src 回退", () => {
  assert.deepEqual(appCspProblems(GOOD_APP_CSP), []);
  assert.equal(appCspProblems(SITE_APP_CSP).length, 1);
  assert.deepEqual(appCspProblems(SITE_APP_CSP.replace("default-src 'self'", "default-src 'self' https://chrome-devtools-frontend.appspot.com")), []);
  assert.deepEqual(appCspProblems(SITE_APP_CSP.replace("default-src 'self'", "default-src 'self'; child-src https://chrome-devtools-frontend.appspot.com")), []);
  assert.match(appCspProblems(GOOD_APP_CSP.replace(" ws://127.0.0.1:*", "")).join(), /ws:\/\/127\.0\.0\.1/);
  assert.equal(appCspProblems("").length, 0);
  assert.equal(appCspProblems("default-src 'none'").length, 2);
});

test("headersFor：按 Cloudflare Pages 语义，/app/ 的 ! 先删站点 CSP 再加自己的", () => {
  const rules = parseHeaders(headersText(GOOD_APP_CSP));
  assert.deepEqual(headersFor(rules, "/docs/"), { "content-security-policy": "default-src 'self'", "x-content-type-options": "nosniff" });
  for (const p of ["/app/", "/app/index.html", "/app/browser.x/host.js"]) {
    assert.deepEqual(headersFor(rules, p), { "content-security-policy": GOOD_APP_CSP, "x-content-type-options": "nosniff" }, p);
  }
  assert.equal(headersFor(rules, "/application/")["content-security-policy"], "default-src 'self'");
});
