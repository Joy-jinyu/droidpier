import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import headingIdPlugin from "./src/plugins/heading-id.mjs";
import { LOCALES, SIDEBAR } from "./src/site-config.mjs";

/**
 * starlight-llms-txt 生成 llms.txt / llms-full.txt / llms-small.txt。
 *
 * 我们需要在 llms.txt 中列出每个英文文档页的 .md 链接，但插件注入的 /llms.txt 路由
 * 是一个汇总索引页，不支持逐页列出。
 *
 * 解决方案：NOT 使用插件自带的 Starlight plugin（会注入 /llms.txt 路由），
 * 改为在 integrations 数组中添加一个内联 Astro integration，仅注入
 * llms-full.txt、llms-small.txt 和 _llms-txt/[slug].txt 路由，并设置插件
 * 需要的虚拟模块 virtual:starlight-llms-txt/context。
 * /llms.txt 由文件路由 src/pages/llms.txt.ts 提供，不存在路由冲突。
 *
 * 注：这里手动内联了 ProjectContext（已知的静态配置值），避免对插件内部 API 的脆性依赖。
 */
const llmsTxtDir = new URL("./node_modules/starlight-llms-txt/", import.meta.url);

/** 与插件保持一致的 ProjectContext，仅供虚拟模块使用 */
const projectContext = {
  base: "/",
  title: "Droidpier",
  description: "One command to install. No Android Studio required.",
  details: undefined,
  optionalLinks: [],
  customSets: [{ label: "Docs", paths: ["docs/**"], slug: "docs" }],
  minify: {},
  promote: ["index*"],
  demote: [],
  exclude: [],
  defaultLocale: "root",
  locales: LOCALES,
  pageSeparator: "\n\n",
  rawContent: false,
  customSelectors: [],
};

/**
 * 内联 Astro integration：仅注入 llms-full/small/custom 路由，不注入 llms.txt。
 *
 * 本 integration 直接引用了 starlight-llms-txt 的三个内部文件（未在 package exports 中暴露）：
 *   - llms-full.txt.ts
 *   - llms-small.txt.ts
 *   - llms-custom.txt.ts
 * 以及手动重建了插件的虚拟模块 virtual:starlight-llms-txt/context。
 *
 * 因此 starlight-llms-txt 已在 package.json 中精确锁定为 0.12.0（无 ^ 或 ~），
 * 升级前必须重新核对上述文件路径与虚拟模块结构是否有变化。
 */
const llmsTxtIntegration = {
  name: "llms-txt-no-index",
  hooks: {
    "astro:config:setup"({ injectRoute, updateConfig }) {
      // 注入 llms-full.txt（由插件原始文件处理，内容不变）
      injectRoute({
        entrypoint: new URL("./llms-full.txt.ts", llmsTxtDir),
        pattern: "/llms-full.txt",
        prerender: true,
      });
      // 注入 llms-small.txt
      injectRoute({
        entrypoint: new URL("./llms-small.txt.ts", llmsTxtDir),
        pattern: "/llms-small.txt",
        prerender: true,
      });
      // 注入 _llms-txt/[slug].txt（自定义集合）
      injectRoute({
        entrypoint: new URL("./llms-custom.txt.ts", llmsTxtDir),
        pattern: "/_llms-txt/[slug].txt",
        prerender: true,
      });

      // 设置虚拟模块 virtual:starlight-llms-txt/context
      const moduleId = "virtual:starlight-llms-txt/context";
      const resolvedId = `\0${moduleId}`;
      const moduleCode = `export const starlightLllmsTxtContext = ${JSON.stringify(projectContext)}`;
      updateConfig({
        vite: {
          plugins: [
            {
              name: "vite-plugin-llms-txt-context",
              resolveId(id) {
                if (id === moduleId) return resolvedId;
              },
              load(id) {
                if (id === resolvedId) return moduleCode;
              },
            },
          ],
        },
      });
    },
  },
};

/**
 * Astro integration: inject headingIdPlugin into the default Sätteri hast pipeline.
 *
 * Uses unshift() so our plugin runs BEFORE Starlight's satteriHeadingIdsPlugin
 * and createHeadingIdsPlugin. It strips the `{#id}` marker from translated
 * headings and sets properties.id; the downstream heading-id plugin then sees
 * the id already set and skips its slugger logic.
 */
const headingIdIntegration = {
  name: "heading-id-injector",
  hooks: {
    "astro:config:setup"({ config }) {
      const processor = config.markdown?.processor;
      // 未配置 Sätteri 或版本不匹配时快速失败，避免 {#id} 标记静默残留在 HTML 里
      if (!Array.isArray(processor?.options?.hastPlugins)) {
        throw new Error(
          "[heading-id-injector] markdown.processor 不是 Sätteri 实例（options.hastPlugins 不是数组）。" +
          "该插件只支持 Sätteri 处理器，请检查 astro.config.mjs 中的 markdown.processor 配置。"
        );
      }
      processor.options.hastPlugins.unshift(headingIdPlugin());
    },
  },
};

export default defineConfig({
  site: "https://droid.devpier.dev",
  vite: {
    build: {
      // 小字体不内联成 data: URI，否则会被 CSP 的 font-src 'self' 拦下（见 public/_headers）
      assetsInlineLimit: (file) => (/\.woff2?$/.test(file) ? false : undefined),
    },
  },
  integrations: [
    starlight({
      title: "Droidpier",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/twosugar/droidpier",
        },
      ],
      defaultLocale: "root",
      locales: LOCALES,
      customCss: [
        "./src/styles/theme.css",
        "@fontsource-variable/onest",
        "@fontsource-variable/jetbrains-mono",
      ],
      components: {
        Footer: "./src/components/Footer.astro",
        PageTitle: "./src/components/PageTitle.astro",
        // 首页主标语区；只有 frontmatter 带 hero 的页面（首页）会用到
        Hero: "./src/components/home/Hero.astro",
      },
      credits: false,
      sidebar: SIDEBAR,
    }),
    // 注入 llms-full/small 路由 + 虚拟模块（不含 /llms.txt，避免与文件路由冲突）
    llmsTxtIntegration,
    // 注入 heading-id 插件到默认 Sätteri hast 管道
    headingIdIntegration,
  ],
});
