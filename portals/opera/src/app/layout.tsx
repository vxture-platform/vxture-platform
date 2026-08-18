import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  BootSplash,
  ThemeProvider,
  themeBootstrapScript,
} from "@vxture/design-system";
import "@vxture/design-system/styles/fonts.css";
import "./globals.css";

export const metadata: Metadata = {
  icons: { icon: "/assets/favicon.ico" },
  title: "Opera · Vxture 基础设施控制平面",
  description:
    "平台技术资源、运行、计量、发布、可观测与安全管理。不承担商业运营职责。",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
        {/* Icons are DS React components (@phosphor-icons/react via iconRegistry);
            the legacy icon webfont links are gone with shell-template. */}
      </head>
      <body>
        {/* 启动占位在 React 根**之外**：进了根就会被水合接管，跟其余组件一样
            要等 JS，也就失去了填补空窗的意义。ThemeProvider 挂载后打上
            html[data-app-ready]，CSS 随即把它隐藏。 */}
        <BootSplash />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
