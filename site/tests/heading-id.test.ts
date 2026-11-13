/**
 * heading-id.test.ts
 *
 * 验证 heading-id-plugin (satteri hast) 正确处理 {#id} 语法。
 * 直接构造最小 hast element 节点测试，不依赖 satteri/remark 运行时。
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import headingIdPlugin from "../src/plugins/heading-id.mjs";

/**
 * 调用插件 visit，返回替换节点（有匹配时）或原节点（无匹配时）。
 * 对应 satteri hast 插件的调用方式：
 *   const plugin = headingIdPlugin();
 *   const result = plugin.element.visit(node) ?? node;
 */
function runVisit(node: any): any {
  const plugin = (headingIdPlugin as any)();
  const result = plugin.element.visit(node);
  return result ?? node;
}

/** 构造一个最小的 hast h2 element 节点 */
function h2(text: string): any {
  return {
    type: "element",
    tagName: "h2",
    properties: {},
    children: [{ type: "text", value: text }],
  };
}

describe("heading-id-plugin (satteri hast)", () => {
  it("普通标题不受影响", () => {
    const result = runVisit(h2("Hello world"));
    assert.equal(result.children[0].value, "Hello world");
    assert.equal(result.properties.id, undefined);
  });

  it("识别 {#some-id} 并从标题文字中移除，设置 properties.id", () => {
    const result = runVisit(h2("Hello world {#my-anchor}"));
    assert.equal(result.children[0].value, "Hello world");
    assert.equal(result.properties.id, "my-anchor");
  });

  it("处理中文标题 + {#english-slug}", () => {
    const result = runVisit(h2("实测性能 {#measured-performance}"));
    assert.equal(result.children[0].value, "实测性能");
    assert.equal(result.properties.id, "measured-performance");
  });

  it("标记紧贴末尾（无空格）时也能识别", () => {
    const result = runVisit(h2("Title{#tight-id}"));
    assert.equal(result.children[0].value, "Title");
    assert.equal(result.properties.id, "tight-id");
  });

  it("仅含 {#id} 的标题：text 子节点被移除", () => {
    const result = runVisit(h2("{#standalone}"));
    assert.equal(result.children.length, 0);
    assert.equal(result.properties.id, "standalone");
  });

  it("多子节点标题：只处理最后一个 text 子节点", () => {
    const node = {
      type: "element",
      tagName: "h2",
      properties: {},
      children: [
        { type: "element", tagName: "code", properties: {}, children: [{ type: "text", value: "code" }] },
        { type: "text", value: " Chrome 阻止了本地网络访问 {#chrome-blocked-local-network-access}" },
      ],
    };
    const result = runVisit(node);
    assert.equal(result.children[1].value, " Chrome 阻止了本地网络访问");
    assert.equal(result.properties.id, "chrome-blocked-local-network-access");
  });
});
