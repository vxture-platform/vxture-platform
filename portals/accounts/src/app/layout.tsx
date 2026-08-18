/**
 * RootLayout - accounts surface root layout
 * @package @vxture/accounts
 *
 * Lean single-locale shell (no next-intl): fonts + ThemeProvider only. The
 * accounts surface is the neutral identity face (OIDC login + future account
 * center). See docs/design/identity-platform-idp.md.
 */
import type { Metadata } from "next";
import {
  BootSplash,
  ThemeProvider,
  themeBootstrapScript,
} from "@vxture/design-system";
import "@vxture/design-system/styles/fonts.css";
import "./globals.css";

export const metadata: Metadata = {
  icons: { icon: "/assets/favicon.ico" },
  title: "登录 · Vxture",
  description: "Vxture 统一身份登录",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body>
        {/* 启动占位在 React 根**之外**：进了根就会被水合接管，跟其余组件一样
            要等 JS，也就失去了填补空窗的意义。ThemeProvider 挂载后打上
            html[data-app-ready]，CSS 随即把它隐藏。 */}
        <BootSplash />
        <ThemeProvider defaultMode="system" defaultDensity="default">
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
