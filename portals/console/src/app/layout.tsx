/**
 * RootLayout - 根布局
 *
 * 职责：定义 HTML 结构、加载全局样式、挂载 ThemeProvider。
 * locale 相关内容在 [locale]/layout.tsx 中处理。
 *
 * @package @vxture/console
 * @layer Presentation
 * @category Pages
 * @author AI-Generated
 * @date 2026-05-05
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
// 常量走 `/server` 入口(vxture-platform#356)。它们的家是 @vxture/design-tokens,
// 而伞包主入口首行是 "use client" —— 从 server component 里 `THEME_CONSTANTS.X`
// 这样**点进去**,RSC 运行时会拦下:「You cannot dot into a client module from a
// server component. You can only pass the imported name through.」
// 整名传递(如 themeBootstrapScript)不受影响,所以它留在主入口那组也没错;
// 但取值必须从 server-safe 子集拿。
import {
  FullscreenProvider,
  BootSplash,
  ThemeProvider,
  themeBootstrapScript,
} from "@vxture/design-system";
import {
  PREFERENCE_CONSTANTS,
  THEME_CONSTANTS,
} from "@vxture/design-system/server";
import type { Density } from "@vxture/design-system";
import { DEFAULT_LOCALE } from "@vxture/shared";
import type { Theme } from "@vxture/shared";
import "@vxture/design-system/styles/fonts.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Workspace Console",
  description: "Unified management console for platform and tenant operations.",
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const cookieStore = await cookies();
  const initialTheme = (cookieStore.get(THEME_CONSTANTS.COOKIE_KEY)?.value ??
    THEME_CONSTANTS.DEFAULT_THEME) as Theme;
  const densityCookie = cookieStore.get(
    PREFERENCE_CONSTANTS.DENSITY_COOKIE_KEY,
  )?.value;
  const initialDensity: Density =
    densityCookie === "compact" || densityCookie === "comfortable"
      ? densityCookie
      : "default";

  return (
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
        {/* Phosphor icon font — Console templates design uses `ph ph-*` classes. */}
        <link
          rel="stylesheet"
          href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css"
        />
        <link
          rel="stylesheet"
          href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/bold/style.css"
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
        <ThemeProvider
          defaultMode={initialTheme}
          defaultDensity={initialDensity}
        >
          <FullscreenProvider defaultMode="native" defaultLockScroll={false}>
            {children}
          </FullscreenProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
