import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPageUrl, pageOrigin } from "../src/page-url.ts";

const PUBLIC = "https://droid.devpier.dev";

test("pageOrigin：无参数时返回公网 origin", () => {
  assert.equal(pageOrigin([]), PUBLIC);
});

test("pageOrigin：--local 时返回空串（调用方补 127.0.0.1）", () => {
  assert.equal(pageOrigin(["--local"]), "");
});

test("pageOrigin：--public 是兼容别名，不改行为（仍打开公网）", () => {
  assert.equal(pageOrigin(["--public"]), PUBLIC);
});

test("buildPageUrl：默认端口打开公网页面，不带 #", () => {
  assert.equal(buildPageUrl([], 7300), `${PUBLIC}/app/`);
  assert.equal(buildPageUrl(["--public"], 7300), `${PUBLIC}/app/`);
});

test("buildPageUrl：端口不是 7300 时公网页面带 #port", () => {
  assert.equal(buildPageUrl([], 7306), `${PUBLIC}/app/#port=7306`);
});

test("buildPageUrl：--local 打开本机页面，不带 #", () => {
  assert.equal(buildPageUrl(["--local"], 7300), "http://127.0.0.1:7300/app/");
  assert.equal(buildPageUrl(["--local"], 7306), "http://127.0.0.1:7306/app/");
});

test("buildPageUrl：链接里没有口令", () => {
  for (const url of [buildPageUrl([], 7300), buildPageUrl([], 7306), buildPageUrl(["--local"], 7306)]) assert.ok(!url.includes("token"), url);
});
