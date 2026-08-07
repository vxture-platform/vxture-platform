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
import { Funnel_Display, Geist_Mono, Inter } from "next/font/google";
import {
  BootSplash,
  ThemeProvider,
  FullscreenProvider,
  themeBootstrapScript,
} from "@vxture/design-system";
import { DEFAULT_LOCALE, THEME_CONSTANTS } from "@vxture/shared";
import "./globals.css";

const fontBrand = Funnel_Display({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--vx-font-loader-brand",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  display: "swap",
  variable: "--vx-font-loader-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--vx-font-loader-mono",
});

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
      <body
        className={`${fontBrand.variable} ${inter.variable} ${geistMono.variable}`}
      >
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
