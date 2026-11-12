import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanStaleUploads } from "../src/upload-temp.ts";

test("只删一小时前的 droidpier-upload-* 目录，新的和别人的不动", async () => {
  const root = await mkdtemp(join(tmpdir(), "emu-stale-"));
  const old = new Date(Date.now() - 2 * 3600_000);
  for (const d of ["droidpier-upload-old", "droidpier-upload-new", "other-old"]) await mkdir(join(root, d, "x"), { recursive: true });
  await utimes(join(root, "droidpier-upload-old"), old, old);
  await utimes(join(root, "other-old"), old, old);
  await cleanStaleUploads(root, Date.now());
  assert.deepEqual((await readdir(root)).sort(), ["droidpier-upload-new", "other-old"]);
});

test("目录不存在时不报错", async () => {
  await cleanStaleUploads(join(tmpdir(), "no-such-dir-droidpier"), Date.now());
});
