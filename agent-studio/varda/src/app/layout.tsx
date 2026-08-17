/**
 * layout.tsx - Next.js 根布局（嵌入模式，无宿主 shell）
 * @package @vxture/agent-studio-varda
 * @layer Presentation
 * @category App
 *
 * @author AI-Generated
 * @date 2026-04-30
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  FullscreenProvider,
  ThemeProvider,
  themeBootstrapScript,
} from "@vxture/design-system";
import "@vxture/design-system/styles/fonts.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Varda 智能助手",
  description: "Vxture 平台内嵌 AI 助手",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body className="vx-varda-body">
        <ThemeProvider defaultMode="system" defaultDensity="default">
          <FullscreenProvider defaultMode="native" defaultLockScroll={false}>
            {children}
          </FullscreenProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
