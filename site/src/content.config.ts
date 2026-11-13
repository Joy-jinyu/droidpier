import { defineCollection } from "astro:content";
import { docsLoader, i18nLoader } from "@astrojs/starlight/loaders";
import { docsSchema, i18nSchema } from "@astrojs/starlight/schema";
import { z } from "astro/zod";

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      // 首页正文都在组件 props 里，/index.md 用这段纯 Markdown 摘要代替（见 src/pages/[...slug].md.ts）
      extend: z.object({ markdownSummary: z.string().optional() }),
    }),
  }),
  i18n: defineCollection({
    loader: i18nLoader(),
    schema: i18nSchema({
      // 页脚 MIT 许可证行，Task 6 翻译时填充各语言版本
      extend: z.object({
        "site.footer.license": z.string().optional(),
      }),
    }),
  }),
};
