import { createHash } from "node:crypto";
import { MANIFEST_HOST } from "./platform.ts";

/** 清单里一个包在本机要下的东西：完整包的地址（相对清单）、sha1、字节数，它的许可证，以及装好后要写的 package.xml。 */
export type RepoPackage = {
  path: string;
  /** 如 37.2.13。 */
  revision: string;
  archive: { url: string; sha1: string; size: number };
  licence: { id: string; text: string };
  packageXml: string;
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e: string) => {
    if (e[0] !== "#") return ENTITIES[e] ?? m;
    return String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
  });
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** <revision> 里的 major.minor.micro，缺的记 0。 */
function revisionOf(body: string): number[] {
  const rev = /<revision>([\s\S]*?)<\/revision>/.exec(body)?.[1] ?? "";
  return ["major", "minor", "micro"].map((k) => Number(new RegExp(`<${k}>(\\d+)</${k}>`).exec(rev)?.[1] ?? 0));
}

function compareRev(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/**
 * 本机能用的完整包：host-os 没写或是 macosx，host-arch 没写或是 aarch64；写了 aarch64 的优先（emulator 分 x64 / aarch64 两个包，
 * platform-tools 只写 host-os，系统镜像都不写）。补丁包（<patches>）不要。
 */
function pickArchive(body: string): RepoPackage["archive"] | null {
  let best: { a: RepoPackage["archive"]; exact: boolean } | null = null;
  for (const a of body.match(/<archive>[\s\S]*?<\/archive>/g) ?? []) {
    const os = /<host-os>(.*?)<\/host-os>/.exec(a)?.[1];
    const arch = /<host-arch>(.*?)<\/host-arch>/.exec(a)?.[1];
    if ((os !== undefined && os !== MANIFEST_HOST.os) || (arch !== undefined && arch !== MANIFEST_HOST.arch)) continue;
    const complete = /<complete>([\s\S]*?)<\/complete>/.exec(a)?.[1];
    if (!complete) continue;
    const url = /<url>(.*?)<\/url>/.exec(complete)?.[1]?.trim();
    const sha1 = /<checksum type="sha1">([0-9a-f]{40})<\/checksum>/.exec(complete)?.[1];
    const size = Number(/<size>(\d+)<\/size>/.exec(complete)?.[1]);
    if (!url || !sha1 || !size) continue;
    const exact = arch === MANIFEST_HOST.arch;
    if (!best || (exact && !best.exact)) best = { a: { url: decodeXml(url), sha1, size }, exact };
  }
  return best?.a ?? null;
}

/**
 * sdkmanager 装好一个包后写的 package.xml：<repository> 里放许可证和 <localPackage>（清单里 remotePackage 的类型、修订号、
 * 名字、许可证引用和依赖，去掉 channelRef 和 archives）。Android Studio 靠它认出装了什么、什么版本。
 * type-details 的 xsi:type 用清单里的前缀，前缀在根元素上照清单声明。
 */
function packageXml(manifest: string, path: string, body: string, licence: { id: string; text: string }): string {
  const ns = new Map([...manifest.matchAll(/xmlns:([\w-]+)="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const pick = (tag: string) => {
    const open = new RegExp(`<${tag}\\b[^>]*?(/?)>`).exec(body);
    if (!open) return "";
    if (open[1] === "/") return open[0];
    const end = body.indexOf(`</${tag}>`, open.index);
    return end < 0 ? "" : body.slice(open.index, end + tag.length + 3);
  };
  const typeDetails = pick("type-details");
  const prefix = /xsi:type="([\w-]+):/.exec(typeDetails)?.[1];
  const decl = prefix && ns.has(prefix) && prefix !== "ns2" ? ` xmlns:${prefix}="${ns.get(prefix)}"` : "";
  // 清单里的缩进换行去掉，和 sdkmanager 写的一样是一整行
  const flat = (xml: string) => xml.replace(/>\s+</g, "><").trim();
  const details = flat(typeDetails).replace(/^<type-details\b/, '<type-details xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"').replace(/\sxmlns:xsi="[^"]*"(?=[^>]*xmlns:xsi=)/, "");
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + `<ns2:repository xmlns:ns2="http://schemas.android.com/repository/android/common/02"${decl}>`
    + `<license id="${escapeXml(licence.id)}" type="text">${escapeXml(licence.text)}</license>`
    + `<localPackage path="${escapeXml(path)}" obsolete="false">`
    + details + flat(pick("revision")) + flat(pick("display-name")) + flat(pick("uses-license")) + flat(pick("dependencies"))
    + "</localPackage></ns2:repository>";
}

/** 在清单里找包 path：只看稳定通道，取修订号最高、本机有完整包的那份；找不到返回 null。 */
export function findPackage(xml: string, path: string): RepoPackage | null {
  const stable = /<channel id="([^"]+)">stable<\/channel>/.exec(xml)?.[1] ?? "channel-0";
  const want = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let best: { rev: number[]; body: string; archive: RepoPackage["archive"] } | null = null;
  for (const m of xml.matchAll(new RegExp(`<remotePackage path="${want}"[^>]*>([\\s\\S]*?)</remotePackage>`, "g"))) {
    const body = m[1];
    if (/<channelRef ref="([^"]+)"/.exec(body)?.[1] !== stable) continue;
    const archive = pickArchive(body);
    if (!archive) continue;
    const rev = revisionOf(body);
    if (!best || compareRev(rev, best.rev) > 0) best = { rev, body, archive };
  }
  if (!best) return null;
  const ref = /<uses-license ref="([^"]+)"/.exec(best.body)?.[1];
  const text = ref && new RegExp(`<license id="${ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>([\\s\\S]*?)</license>`).exec(xml)?.[1];
  if (!ref || text === undefined || text === null) return null;
  const licence = { id: ref, text: decodeXml(text) };
  const [major, minor, micro] = best.rev;
  const revision = /<minor>|<micro>/.test(/<revision>([\s\S]*?)<\/revision>/.exec(best.body)?.[1] ?? "") ? `${major}.${minor}.${micro}` : `${major}`;
  return { path, revision, archive: best.archive, licence, packageXml: packageXml(xml, path, best.body, licence) };
}

const sha1 = (s: string) => createHash("sha1").update(s, "utf8").digest("hex");

/**
 * 同意一份许可证后 <sdk>/licenses/<id> 里记的哈希。sdkmanager 记的是许可证正文的 sha1（License.getLicenseHash）；
 * 正文首尾的空白在不同版本的清单里有过出入（本机 2019 年同意的那份结尾没有换行），所以原文和去掉首尾空白的各记一个。
 */
export function licenceHashes(text: string): string[] {
  return [...new Set([sha1(text), sha1(text.trim())])];
}

/** 许可证文件里有没有这份正文的哈希（每行一个，和 sdkmanager 的 checkAccepted 一样）。 */
export function isLicenceAccepted(file: string, text: string): boolean {
  const lines = new Set(file.split(/\r?\n/).map((l) => l.trim()));
  return licenceHashes(text).some((h) => lines.has(h));
}

/** 许可证文件加上这份正文的哈希后的内容：已有的行不动，缺的哈希照 sdkmanager 的写法（换行 + 哈希）追加。 */
export function licenceFileText(existing: string, text: string): string {
  const lines = new Set(existing.split(/\r?\n/).map((l) => l.trim()));
  return existing + licenceHashes(text).filter((h) => !lines.has(h)).map((h) => `\n${h}`).join("");
}
