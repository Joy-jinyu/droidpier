import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scrubBuffer, scrubDir } from "../../scripts/scrub-paths.ts";

test("scrubBuffer：home 换成等长占位，长度不变，其他字节不动", () => {
  const buf = Buffer.concat([Buffer.from([0, 1]), Buffer.from("/Users/alice/.cargo/x and /Users/alice/y"), Buffer.from([255])]);
  const out = scrubBuffer(buf, "/Users/alice")!;
  assert.equal(out.length, buf.length);
  assert.equal(out.indexOf("alice"), -1);
  assert.equal(out.subarray(2, out.length - 1).toString(), "/Users/xxxxx/.cargo/x and /Users/xxxxx/y");
  assert.deepEqual([out[0], out[1], out[out.length - 1]], [0, 1, 255]);
});

test("scrubBuffer：没有 home 时返回 null", () => {
  assert.equal(scrubBuffer(Buffer.from("nothing here"), "/Users/alice"), null);
});

test("scrubDir：递归处理目录，只改含 home 的文件", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scrub-"));
  await writeFile(join(dir, "a.wasm"), Buffer.from("x/Users/alice/y"));
  await writeFile(join(dir, "b.js"), "clean");
  const changed = await scrubDir(dir, "/Users/alice");
  assert.deepEqual(changed.map((f) => f.slice(dir.length + 1)), ["a.wasm"]);
  assert.equal(await readFile(join(dir, "a.wasm"), "utf8"), "x/Users/xxxxx/y");
});
