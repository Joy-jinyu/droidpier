import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { distStaleReason } from "./dist-fresh.ts";

/** 造一个 site 目录：src/a.md + 可选的 dist/index.html，并指定两者的修改时间（秒） */
function fixture(srcTime: number, distTime?: number): string {
  const site = mkdtempSync(join(tmpdir(), "dist-fresh-"));
  mkdirSync(join(site, "src", "nested"), { recursive: true });
  const src = join(site, "src", "nested", "a.md");
  writeFileSync(src, "x");
  utimesSync(src, srcTime, srcTime);
  if (distTime !== undefined) {
    mkdirSync(join(site, "dist"));
    const out = join(site, "dist", "index.html");
    writeFileSync(out, "<html></html>");
    utimesSync(out, distTime, distTime);
  }
  return site;
}

describe("dist 新鲜度检查", () => {
  it("dist 不存在时给出先构建的提示", () => {
    assert.match(distStaleReason(fixture(1000)) ?? "", /dist.*不存在.*bun run build/);
  });

  it("src 比 dist 新时报过期，并点名最新的源文件", () => {
    const reason = distStaleReason(fixture(2000, 1000)) ?? "";
    assert.match(reason, /过期/);
    assert.match(reason, /a\.md/);
  });

  it("dist 比 src 新时不报错", () => {
    assert.equal(distStaleReason(fixture(1000, 2000)), null);
  });
});
