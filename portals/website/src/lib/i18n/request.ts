/**
 * i18n 请求配置——按需加载翻译 namespace
 * @package @vxture/website
 * @layer Presentation
 * @category I18n
 * @author AI-Generated
 * @date 2026-03-17
 */

import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

// ── 类型定义 ─────────────────────────────────────────────────────────────────

/** 支持按需加载的页面标识 */
type PageKey =
  | "home"
  | "appcenter"
  | "products"
  | "solutions"
  | "cases"
  | "company"
  | "auth"
  | "legal";

/** namespace 条目：嵌套写入 key 和对应文件路径（不含 .json） */
type NsEntry = { key: string; file: string };

// ── 页面 namespace 映射表 ─────────────────────────────────────────────────────

const PAGE_NAMESPACE_MAP: Record<PageKey, NsEntry[]> = {
  home: [
    { key: "home.hero", file: "home/hero" },
    { key: "home.features", file: "home/features" },
    { key: "home.productTiers", file: "home/product-tiers" },
    { key: "home.cases", file: "home/cases" },
    { key: "home.cta", file: "home/cta" },
  ],
  appcenter: [{ key: "appcenter", file: "appcenter" }],
  products: [{ key: "products", file: "products" }],
  solutions: [{ key: "solutions", file: "solutions" }],
  cases: [{ key: "cases", file: "cases" }],
  auth: [{ key: "auth", file: "auth" }],
  legal: [{ key: "legal", file: "legal" }],
  company: [
    { key: "company.about", file: "company/about" },
    { key: "company.contact", file: "company/contact" },
  ],
};

// ── 静态 import 映射表 ────────────────────────────────────────────────────────
//
// Turbopack/Webpack 要求动态 import() 的路径在编译时可静态分析。
// 完全动态的模板字符串（如 `@/../messages/${locale}/${file}.json`）
// 会被编译为 "Cannot find module 'unknown'"，导致所有翻译加载失败。
//
// 解决方案：用枚举函数将所有合法路径写成字面量，打包器可静态追踪每条路径。

/** 加载 zh-CN 下的 namespace 文件 */
async function loadZhCN(file: string): Promise<Record<string, unknown>> {
  switch (file) {
    // ── root ──────────────────────────────────────────────────────────────────
    case "root":
      return (await import("@/../messages/zh-CN.json")).default as Record<
        string,
        unknown
      >;
    // ── common ────────────────────────────────────────────────────────────────
    // common.json 本身是指针文件；直接加载权威内容 common/common.json
    case "common":
      return (await import("@/../messages/zh-CN/common/common.json"))
        .default as Record<string, unknown>;
    // ── layout ────────────────────────────────────────────────────────────────
    case "layout/header":
      return (await import("@/../messages/zh-CN/layout/header.json"))
        .default as Record<string, unknown>;
    case "layout/footer":
      return (await import("@/../messages/zh-CN/layout/footer.json"))
        .default as Record<string, unknown>;
    // ── home ──────────────────────────────────────────────────────────────────
    case "home/hero":
      return (await import("@/../messages/zh-CN/home/hero.json"))
        .default as Record<string, unknown>;
    case "home/features":
      return (await import("@/../messages/zh-CN/home/features.json"))
        .default as Record<string, unknown>;
    case "home/product-tiers":
      return (await import("@/../messages/zh-CN/home/product-tiers.json"))
        .default as Record<string, unknown>;
    case "home/cases":
      return (await import("@/../messages/zh-CN/home/cases.json"))
        .default as Record<string, unknown>;
    case "home/cta":
      return (await import("@/../messages/zh-CN/home/cta.json"))
        .default as Record<string, unknown>;
    // ── 单文件页面 ────────────────────────────────────────────────────────────
    case "auth":
      return (await import("@/../messages/zh-CN/auth/auth.json"))
        .default as Record<string, unknown>;
    case "appcenter":
      return (await import("@/../messages/zh-CN/appcenter.json"))
        .default as Record<string, unknown>;
    case "products":
      return (await import("@/../messages/zh-CN/products.json"))
        .default as Record<string, unknown>;
    case "solutions":
      return (await import("@/../messages/zh-CN/solutions.json"))
        .default as Record<string, unknown>;
    case "cases":
      return (await import("@/../messages/zh-CN/cases.json")).default as Record<
        string,
        unknown
      >;
    case "legal":
      return (await import("@/../messages/zh-CN/legal.json")).default as Record<
        string,
        unknown
      >;
    // ── company ───────────────────────────────────────────────────────────────
    case "company/about":
      return (await import("@/../messages/zh-CN/company/about.json"))
        .default as Record<string, unknown>;
    case "company/contact":
      return (await import("@/../messages/zh-CN/company/contact.json"))
        .default as Record<string, unknown>;
    default:
      return {};
  }
}

/** 加载 en-US 下的 namespace 文件 */
async function loadEnUS(file: string): Promise<Record<string, unknown>> {
  switch (file) {
    // ── root ──────────────────────────────────────────────────────────────────
    case "root":
      return (await import("@/../messages/en-US.json")).default as Record<
        string,
        unknown
      >;
    // ── common ────────────────────────────────────────────────────────────────
    // common.json 本身是指针文件；直接加载权威内容 common/common.json
    case "common":
      return (await import("@/../messages/en-US/common/common.json"))
        .default as Record<string, unknown>;
    // ── layout ────────────────────────────────────────────────────────────────
    case "layout/header":
      return (await import("@/../messages/en-US/layout/header.json"))
        .default as Record<string, unknown>;
    case "layout/footer":
      return (await import("@/../messages/en-US/layout/footer.json"))
        .default as Record<string, unknown>;
    // ── home ──────────────────────────────────────────────────────────────────
    case "home/hero":
      return (await import("@/../messages/en-US/home/hero.json"))
        .default as Record<string, unknown>;
    case "home/features":
      return (await import("@/../messages/en-US/home/features.json"))
        .default as Record<string, unknown>;
    case "home/product-tiers":
      return (await import("@/../messages/en-US/home/product-tiers.json"))
        .default as Record<string, unknown>;
    case "home/cases":
      return (await import("@/../messages/en-US/home/cases.json"))
        .default as Record<string, unknown>;
    case "home/cta":
      return (await import("@/../messages/en-US/home/cta.json"))
        .default as Record<string, unknown>;
    // ── 单文件页面 ────────────────────────────────────────────────────────────
    case "auth":
      return (await import("@/../messages/en-US/auth/auth.json"))
        .default as Record<string, unknown>;
    case "appcenter":
      return (await import("@/../messages/en-US/appcenter.json"))
        .default as Record<string, unknown>;
    case "products":
      return (await import("@/../messages/en-US/products.json"))
        .default as Record<string, unknown>;
    case "solutions":
      return (await import("@/../messages/en-US/solutions.json"))
        .default as Record<string, unknown>;
    case "cases":
      return (await import("@/../messages/en-US/cases.json")).default as Record<
        string,
        unknown
      >;
    case "legal":
      return (await import("@/../messages/en-US/legal.json")).default as Record<
        string,
        unknown
      >;
    // ── company ───────────────────────────────────────────────────────────────
    case "company/about":
      return (await import("@/../messages/en-US/company/about.json"))
        .default as Record<string, unknown>;
    case "company/contact":
      return (await import("@/../messages/en-US/company/contact.json"))
        .default as Record<string, unknown>;
    default:
      return {};
  }
}

/** 按 locale 分发，加载指定 namespace 文件 */
async function loadNamespace(
  locale: string,
  file: string,
): Promise<Record<string, unknown>> {
  try {
    if (locale === "zh-CN") return await loadZhCN(file);
    if (locale === "en-US") return await loadEnUS(file);
    return {};
  } catch {
    return {};
  }
}

// ── 嵌套写入工具 ──────────────────────────────────────────────────────────────

/** 按 dot-path（如 "home.hero"）将值写入目标对象的嵌套位置 */
function setNested(
  obj: Record<string, unknown>,
  dotKey: string,
  value: unknown,
): void {
  const parts = dotKey.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!part) continue;
    if (typeof cur[part] !== "object" || cur[part] === null) {
      cur[part] = {};
    }
    cur = cur[part] as Record<string, unknown>;
  }
  const lastPart = parts[parts.length - 1];
  if (lastPart) {
    cur[lastPart] = value;
  }
}

// ── getRequestConfig 主体 ─────────────────────────────────────────────────────

export default getRequestConfig(async ({ requestLocale }) => {
  // ── locale 解析 ─────────────────────────────────────────────────────────────
  const requested = await requestLocale;
  const locale = routing.locales.includes(
    requested as (typeof routing.locales)[number],
  )
    ? (requested as (typeof routing.locales)[number])
    : routing.defaultLocale;

  // ── 始终加载：root + common + layout ────────────────────────────────────────
  const [rootMessages, commonMessages, headerMessages, footerMessages] =
    await Promise.all([
      loadNamespace(locale, "root"),
      loadNamespace(locale, "common"),
      loadNamespace(locale, "layout/header"),
      loadNamespace(locale, "layout/footer"),
    ]);

  // ── 页面 namespace ─────────────────────────────────────────────────────────
  // [locale]/layout 会在客户端跨页面导航时复用，Provider 不能依赖首次请求路径。
  // 因此这里一次性提供所有页面 namespace，避免从 auth 页登录跳首页时缺少 home.*。
  const pageEntries = Object.values(PAGE_NAMESPACE_MAP).flat();
  const pageValues = await Promise.all(
    pageEntries.map((e) => loadNamespace(locale, e.file)),
  );

  // ── 组装 messages ────────────────────────────────────────────────────────────
  const messages: Record<string, unknown> = {
    ...rootMessages,
    ...commonMessages,
    layout: { header: headerMessages, footer: footerMessages },
  };
  pageEntries.forEach((entry, i) =>
    setNested(messages, entry.key, pageValues[i]),
  );

  return { locale, messages, routing };
});
