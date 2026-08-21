/**
 * metadata.ts
 *
 * 职责：
 * - 构建全局 SEO Metadata
 * - 与 Layout 解耦
 */

import type { Metadata } from "next";
import { SUPPORTED_LOCALES, DEFAULT_LOCALE } from "@vxture-platform/shared";

export function buildMetadata(locale: string): Metadata {
  const titles = {
    "zh-CN": "vxture AI | 释放数据潜力",
    "en-US": "vxture AI | Unleash Data Potential",
  };

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
