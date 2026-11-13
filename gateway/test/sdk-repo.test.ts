import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { H, REPO, SYS_IMG } from "./fixtures/repo-manifests.ts";
import { findPackage, licenceFileText, isLicenceAccepted, licenceHashes } from "../src/sdk-repo.ts";

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");

test("emulator：取稳定通道里修订号最高的那份，macOS aarch64 的完整包", () => {
  const p = findPackage(REPO, "emulator")!;
  assert.equal(p.revision, "37.2.13");
  assert.deepEqual(p.archive, { url: "emulator-darwin_aarch64-16740729.zip", sha1: H("3"), size: 416113219 });
  // 许可证正文按 XML 解码，原样保留结尾换行（sdkmanager 的哈希按原文算）
  assert.deepEqual(p.licence, { id: "android-sdk-license", text: 'Terms & "Conditions"\n\nJanuary 16, 2019\n' });
});

test("platform-tools：archive 不写 host-arch 时 macOS 的包也算", () => {
  const p = findPackage(REPO, "platform-tools")!;
  assert.equal(p.revision, "37.0.1");
  assert.deepEqual(p.archive, { url: "platform-tools_r37.0.1-darwin.zip", sha1: H("6"), size: 16110554 });
});

test("系统镜像：archive 不写 host-os 也算，许可证是它自己清单里的 arm-dbt", () => {
  const p = findPackage(SYS_IMG, "system-images;android-34;google_apis;arm64-v8a")!;
  assert.equal(p.revision, "14");
  assert.equal(p.archive.url, "arm64-v8a-34_r14.zip");
  assert.deepEqual(p.licence, { id: "android-sdk-arm-dbt-license", text: "ARM terms\n" });
});

test("没有这个包、没有稳定版、没有本机能用的包、sha1 不是 40 位十六进制：都返回 null", () => {
  assert.equal(findPackage(REPO, "cmdline-tools;latest"), null);
  assert.equal(findPackage(REPO.replace(/channel-0"\/>/g, 'channel-1"/>'), "platform-tools"), null);
  assert.equal(findPackage(REPO.replace(/<host-os>macosx<\/host-os>/g, "<host-os>windows</host-os>"), "platform-tools"), null);
  assert.equal(findPackage(REPO.replace(H("6"), "abc"), "platform-tools"), null);
});

test("package.xml：照 sdkmanager 写的格式，带许可证、类型、修订号和依赖，命名空间都有声明", () => {
  const { packageXml } = findPackage(REPO, "emulator")!;
  assert.match(packageXml, /^<\?xml version="1\.0" encoding="UTF-8" standalone="yes"\?>/);
  assert.match(packageXml, /<ns2:repository xmlns:ns2="http:\/\/schemas\.android\.com\/repository\/android\/common\/02"/);
  assert.match(packageXml, /xmlns:generic="http:\/\/schemas\.android\.com\/repository\/android\/generic\/02"/);
  assert.match(packageXml, /<license id="android-sdk-license" type="text">Terms &amp; &quot;Conditions&quot;\n\nJanuary 16, 2019\n<\/license>/);
  assert.match(packageXml, /<localPackage path="emulator" obsolete="false">/);
  assert.match(packageXml, /<type-details xmlns:xsi="http:\/\/www\.w3\.org\/2001\/XMLSchema-instance" xsi:type="generic:genericDetailsType"\/>/);
  assert.match(packageXml, /<revision><major>37<\/major><minor>2<\/minor><micro>13<\/micro><\/revision>/);
  assert.match(packageXml, /<display-name>Android Emulator<\/display-name><uses-license ref="android-sdk-license"\/><dependencies><dependency path="patcher;v4"\/><\/dependencies><\/localPackage><\/ns2:repository>$/);
  // 清单里的 channelRef、archives 不进 package.xml
  assert.doesNotMatch(packageXml, /channelRef|archives/);
  const img = findPackage(SYS_IMG, "system-images;android-34;google_apis;arm64-v8a")!.packageXml;
  assert.match(img, /xmlns:sys-img="http:\/\/schemas\.android\.com\/sdk\/android\/repo\/sys-img2\/03"/);
  assert.match(img, /xsi:type="sys-img:sysImgDetailsType"><api-level>34<\/api-level>/);
});

test("许可证哈希：正文原文和去掉首尾空白的各一个（sdkmanager 按 getValue() 的 sha1 记）", () => {
  assert.deepEqual(licenceHashes("Terms\n"), [sha1("Terms\n"), sha1("Terms")]);
  assert.deepEqual(licenceHashes("Terms"), [sha1("Terms")]);
});

test("许可证文件：没有时写成 sdkmanager 的格式（每个哈希前一个换行），已有的哈希保留、不重复写", () => {
  const text = "Terms\n";
  const [a, b] = licenceHashes(text);
  assert.equal(licenceFileText("", text), `\n${a}\n${b}`);
  assert.equal(isLicenceAccepted(licenceFileText("", text), text), true);
  // 用户以前接受过旧版正文：旧哈希留着，加上新的
  assert.equal(licenceFileText(`\n${H("9")}`, text), `\n${H("9")}\n${a}\n${b}`);
  assert.equal(licenceFileText(`\n${a}`, text), `\n${a}\n${b}`);
  assert.equal(isLicenceAccepted(`\n${H("9")}`, text), false);
  assert.equal(isLicenceAccepted(`\r\n${b}\r\n`, text), true);
});
