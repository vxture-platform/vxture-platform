import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Funnel_Display, Geist_Mono, Inter } from "next/font/google";
import {
  BootSplash,
  ThemeProvider,
  themeBootstrapScript,
} from "@vxture/design-system";
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
      <body
        className={`${fontBrand.variable} ${inter.variable} ${geistMono.variable}`}
      >
        {/* 启动占位在 React 根**之外**：进了根就会被水合接管，跟其余组件一样
            要等 JS，也就失去了填补空窗的意义。ThemeProvider 挂载后打上
            html[data-app-ready]，CSS 随即把它隐藏。 */}
        <BootSplash />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
