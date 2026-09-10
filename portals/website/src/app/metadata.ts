/**
 * metadata.ts
 *
 * 职责：
 * - 构建全局 SEO Metadata
 * - 与 Layout 解耦
 */

import type { Metadata } from "next";
import {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  BRAND_TITLE,
} from "@vxture-platform/shared";

export function buildMetadata(locale: string): Metadata {
  /* 品牌名走 shared 的单一权威。owner 2026-09-10 走查:页面标题已改,
   * 而 tab 标题还挂着旧名——品牌名此前散在四处各写一份,
   * 改了看得见的那两处,看不见的两处没人会想起来。 */
  const titles = BRAND_TITLE;

  const descriptions = {
    "zh-CN": "基于AI的虚拟自然探索平台",
    "en-US": "AI-based virtual nature exploration platform",
  };

  // 确保 locale 是有效的
  const validLocale = (SUPPORTED_LOCALES as readonly string[]).includes(locale)
    ? (locale as "zh-CN" | "en-US")
    : (DEFAULT_LOCALE as "zh-CN" | "en-US");

  return {
    metadataBase: new URL(
      process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    ),

    title: {
      default: titles[validLocale] as string,
      template: `%s | ${titles[validLocale] as string}`,
    },

    description: descriptions[validLocale] as string,

    keywords:
      validLocale === "zh-CN"
        ? ["AI", "数据", "智能", "决策", "虚拟", "平台", "vxture"]
        : [
            "AI",
            "data",
            "intelligence",
            "decision",
            "virtual",
            "platform",
            "vxture",
          ],

    authors: [{ name: "vxture Team" }],

    robots: {
      index: true,
      follow: true,
    },

    openGraph: {
      type: "website",
      url: "https://vxture.com",
      title: titles[validLocale],
      description: descriptions[validLocale],
      images: ["/favicon.ico"],
    },

    twitter: {
      card: "summary_large_image",
      title: titles[validLocale],
      description: descriptions[validLocale],
      images: ["/favicon.ico"],
    },

    icons: {
      icon: "/favicon.ico",
      apple: "/favicon.ico",
    },

    manifest: "/manifest.json",
  };
}
