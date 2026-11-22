import { test } from "node:test";
import assert from "node:assert/strict";
import { activePage, foregroundPkg, h5KeyShown, pickPage, visiblePkg, visibleTitle } from "../../ui/h5-pages.ts";

const page = (id: string, o: { pkg?: string; url?: string; visible?: boolean } = {}) => ({
  socket: "webview_devtools_remote_1", id, title: "", url: o.url ?? `https://example.com/${id}`, pkg: o.pkg ?? "com.example.app", visible: o.visible ?? false,
});

test("前台 App：取真正可见的页面的包名；没有可见页面时退回第一项", () => {
  assert.equal(foregroundPkg([page("a", { pkg: "com.example.bg" }), page("b", { pkg: "com.example.app", visible: true })]), "com.example.app");
  assert.equal(foregroundPkg([page("a", { pkg: "com.example.bg" })]), "com.example.bg");
  assert.equal(foregroundPkg([]), null);
});

test("标题旁的包名：只取真正可见的页面的；没有可见页面（回到主屏）时没有", () => {
  assert.equal(visiblePkg([page("a", { pkg: "com.example.bg" }), page("b", { pkg: "com.example.app", visible: true })]), "com.example.app");
  assert.equal(visiblePkg([page("a", { pkg: "com.apple.mobilesafari" })]), null);
  assert.equal(visiblePkg([]), null);
});

test("H5 键：连着设备、列表里有真正可见的页面才显示", () => {
  const base = { connected: true, adbStuck: false, consoleOpen: false };
  assert.equal(h5KeyShown({ ...base, list: [page("a", { visible: true })] }), true);
  assert.equal(h5KeyShown({ ...base, list: [page("a")] }), false);
  assert.equal(h5KeyShown({ ...base, list: [] }), false);
  assert.equal(h5KeyShown({ ...base, list: null }), false);
});

test("H5 键：没有设备时隐藏", () => {
  assert.equal(h5KeyShown({ connected: false, adbStuck: false, consoleOpen: false, list: [page("a", { visible: true })] }), false);
  assert.equal(h5KeyShown({ connected: false, adbStuck: true, consoleOpen: false, list: null }), false);
});

test("H5 键：adb 无响应、读不到列表时也显示，好打开面板看原因", () => {
  assert.equal(h5KeyShown({ connected: true, adbStuck: true, consoleOpen: false, list: null }), true);
  assert.equal(h5KeyShown({ connected: true, adbStuck: true, consoleOpen: false, list: [] }), true);
});

test("H5 键：控制台开着时保留，用它收起控制台", () => {
  assert.equal(h5KeyShown({ connected: true, adbStuck: false, consoleOpen: true, list: [page("a")] }), true);
  assert.equal(h5KeyShown({ connected: false, adbStuck: false, consoleOpen: true, list: null }), false);
});

test("默认页面：可见的优先", () => {
  assert.equal(pickPage([page("bg"), page("fg", { visible: true })])?.id, "fg");
});

test("默认页面：不选 data: 预加载页面", () => {
  const preload = page("pre", { url: "data:text/html;charset=utf-8,<html></html>", visible: true });
  assert.equal(pickPage([preload, page("real", { visible: true })])?.id, "real");
  assert.equal(pickPage([preload, page("bg")])?.id, "bg");
  assert.equal(pickPage([preload]), undefined);
  assert.equal(pickPage([]), undefined);
});

test("activePage：前台可见的页面；后台的、data: 预加载的不算", () => {
  assert.equal(activePage([page("bg"), page("fg", { visible: true })])?.url, "https://example.com/fg");
  assert.equal(activePage([page("pre", { url: "data:text/html,", visible: true }), page("bg")]), undefined);
  assert.equal(activePage([page("bg")]), undefined);
  assert.equal(activePage([]), undefined);
});

test("页面标题：只有零宽字符或空白时当作没有标题，界面改用网址", () => {
  assert.equal(visibleTitle("\u200b"), "");
  assert.equal(visibleTitle(" \ufeff\n"), "");
  assert.equal(visibleTitle("  首页 "), "首页");
  assert.equal(visibleTitle("a\u200bb"), "a\u200bb");
});
