/**
 * RootLayout - 根布局
 *
 * 职责：
 * - 定义基础 HTML 结构（<html>、<body>）
 * - 加载全局字体
 * - 配置元数据
 * - 挂载 ThemeProvider，统一管理全站主题（由 next-themes 自动处理 DOM class）
 * - 挂载 FullscreenProvider，统一管理全站全屏状态
 * - 不依赖 locale 的全局配置
 *
 * 注意：next-intl Provider 和其他依赖 locale 的内容应该在 [locale]/layout.tsx 中
 *
 * @package @vxture/website
 * @layer Presentation
 * @category Pages
 * @author AI-Generated
 * @date 2026-03-18
 */

import type { Metadata } from "next";
// 常量走 `/server` 入口(vxture-platform#356)。它们的家是 @vxture/design-tokens,
// 而伞包主入口首行是 "use client" —— 从 server component 里 `THEME_CONSTANTS.X`
// 这样**点进去**,RSC 运行时会拦下:「You cannot dot into a client module from a
// server component. You can only pass the imported name through.」
// 整名传递(如 themeBootstrapScript)不受影响,所以它留在主入口那组也没错;
// 但取值必须从 server-safe 子集拿。
import {
  BootSplash,
  ThemeProvider,
  FullscreenProvider,
  themeBootstrapScript,
} from "@vxture/design-system";
import { THEME_CONSTANTS } from "@vxture/design-system/server";
import { DEFAULT_LOCALE } from "@vxture-platform/shared";
import "@vxture/design-system/styles/fonts.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "vxture AI",
  description: "AI-based virtual nature exploration platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // No cookies()/headers() in the root layout: reading the theme/density cookie
  // opted every route — including the static marketing pages — into dynamic SSR.
  // themeBootstrapScript already applies the persisted theme from localStorage
  // before first paint, and density is only applied client-side on mount, so the
  // layout stays static and defers the actual preference to the client.
  return (
    // suppressHydrationWarning 是 next-themes 官方要求，避免 SSR/CSR class 不一致警告
    <html lang={DEFAULT_LOCALE} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
        {/* Warm up the unpkg connection (DNS+TLS) before the render-blocking
            icon stylesheets below are requested. TODO(perf): self-host
            @phosphor-icons/web so these are not third-party render-blocking. */}
        <link rel="preconnect" href="https://unpkg.com" />
        <link
          rel="preconnect"
          href="https://unpkg.com"
          crossOrigin="anonymous"
        />
        {/* Phosphor icon font — user panel uses ph ph-* classes. */}
        <link
          rel="stylesheet"
          href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css"
        />
        <link
          rel="stylesheet"
          href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/fill/style.css"
        />
      </head>
      <body>
        {/* 启动占位在 React 根**之外**：进了根就会被水合接管，跟其余组件一样
            要等 JS，也就失去了填补空窗的意义。ThemeProvider 挂载后打上
            html[data-app-ready]，CSS 随即把它隐藏。 */}
        <BootSplash />
        {/* ThemeProvider 管理全站多主题模式，默认跟随系统偏好 */}
        <ThemeProvider
          defaultMode={THEME_CONSTANTS.DEFAULT_THEME}
          defaultDensity="default"
        >
          {/* FullscreenProvider 管理全站全屏状态，默认 pseudo 模式 */}
          <FullscreenProvider defaultMode="native" defaultLockScroll={false}>
            {children}
          </FullscreenProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
