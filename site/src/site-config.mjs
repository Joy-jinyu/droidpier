/**
 * 站点结构的唯一出处：语言列表和侧边栏。astro.config.mjs 和 /llms.txt 都从这里读。
 */

/** Starlight 的 locales，同时喂给 starlight-llms-txt 的虚拟模块 */
export const LOCALES = {
  root: { label: "English", lang: "en" },
  "zh-cn": { label: "简体中文", lang: "zh-CN" },
  "zh-tw": { label: "繁體中文", lang: "zh-TW" },
  es: { label: "Español", lang: "es" },
  "pt-br": { label: "Português (Brasil)", lang: "pt-BR" },
  ru: { label: "Русский", lang: "ru" },
  de: { label: "Deutsch", lang: "de" },
  ja: { label: "日本語", lang: "ja" },
  fr: { label: "Français", lang: "fr" },
  ko: { label: "한국어", lang: "ko" },
  it: { label: "Italiano", lang: "it" },
  ar: { label: "العربية", lang: "ar", dir: "rtl" },
  hi: { label: "हिन्दी", lang: "hi" },
};

/** Starlight 侧边栏：分组、各语言分组名和每组的文档顺序 */
export const SIDEBAR = [
  {
    label: "Getting started",
    translations: {
      "zh-CN": "快速开始",
      "zh-TW": "快速開始",
      "ja": "はじめに",
      "es": "Primeros pasos",
      "pt-BR": "Primeiros passos",
      "ru": "Начало работы",
      "de": "Erste Schritte",
      "fr": "Prise en main",
      "it": "Per iniziare",
      "ko": "시작하기",
      "ar": "البدء",
      "hi": "शुरुआत करें",
    },
    items: [
      "docs/getting-started/requirements",
      "docs/getting-started/install",
      "docs/getting-started/first-run",
    ],
  },
  {
    label: "Guides",
    translations: {
      "zh-CN": "使用指南",
      "zh-TW": "使用指南",
      "ja": "ガイド",
      "es": "Guías",
      "pt-BR": "Guias",
      "ru": "Руководства",
      "de": "Anleitungen",
      "fr": "Guides",
      "it": "Guide",
      "ko": "가이드",
      "ar": "الأدلة",
      "hi": "गाइड",
    },
    items: [
      "docs/guides/devices",
      "docs/guides/keyboard-and-input",
      "docs/guides/clipboard",
      "docs/guides/screenshots",
      "docs/guides/troubleshooting",
    ],
  },
  {
    label: "Reference",
    translations: {
      "zh-CN": "参考资料",
      "zh-TW": "參考資料",
      "ja": "リファレンス",
      "es": "Referencia",
      "pt-BR": "Referência",
      "ru": "Справочник",
      "de": "Referenz",
      "fr": "Référence",
      "it": "Riferimento",
      "ko": "참조",
      "ar": "المرجع",
      "hi": "संदर्भ",
    },
    items: [
      "docs/reference/cli",
      "docs/reference/security",
      "docs/reference/browser-support",
    ],
  },
];

/** 按侧边栏顺序展开的英文文档 slug */
export const DOC_SLUGS = SIDEBAR.flatMap((group) => group.items);
