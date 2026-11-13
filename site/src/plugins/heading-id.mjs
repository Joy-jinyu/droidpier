/**
 * heading-id-plugin (satteri hast)
 *
 * 在翻译页的 Markdown 标题末尾写上 `{#stable-id}`，本插件剥离该标记并把
 * id 写入 heading 元素的 properties.id，使 createHeadingIdsPlugin 在后续
 * 看到 existingId 是字符串时直接复用，不再对中文/日文文本 slugify。
 *
 * 格式说明（satteri hast plugin）：
 *   - visit(node) 对 h1–h6 元素调用，返回替换节点或 undefined（无改动）。
 *   - `properties: { ...node.properties, id }` 使 createHeadingIdsPlugin
 *     的 `typeof existingId === "string"` 判断为 true，跳过 slugger。
 *
 * 注册方式：在 astro.config.mjs 的 astro:config:setup 中把 headingIdPlugin()
 * 插入 processor.options.hastPlugins 头部（unshift），确保在 Starlight 的
 * satteriHeadingIdsPlugin 之前运行。
 */

/** @returns {import("satteri").HastPlugin} */
export default function headingIdPlugin() {
  return {
    name: "stable-heading-id",
    element: {
      filter: ["h1", "h2", "h3", "h4", "h5", "h6"],
      visit(node) {
        const children = node.children;
        if (!children?.length) return;
        const last = children[children.length - 1];
        if (!last || last.type !== "text") return;
        const match = last.value.match(/\s*\{#([^\s{}]+)\}$/);
        if (!match) return;

        const id = match[1];
        const newValue = last.value.slice(0, -match[0].length);
        const newChildren =
          newValue === ""
            ? children.slice(0, -1)
            : [...children.slice(0, -1), { type: "text", value: newValue }];

        return {
          type: "element",
          tagName: node.tagName,
          properties: { ...node.properties, id },
          children: newChildren,
        };
      },
    },
  };
}
