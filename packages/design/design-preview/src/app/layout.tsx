/**
 * layout.tsx - 预览面根布局。
 * @package @vxture/design-preview
 *
 * 只装 DS 的 ThemeProvider 与 ToastProvider。密度与字号不是 provider——它们是
 * `html` 上的一个类（`.density-*` / `.vx-font-*`），页面上的开关直接改 class，
 * 这样看到的就是产品运行时的真实机制，不是预览面特制的一套。
 */

import type { ReactNode } from "react";
import {
  ThemeProvider,
  ToastProvider,
  TooltipProvider,
} from "@vxture/design-system";
import { Shell } from "@/preview/Shell";
import "./globals.css";

export const metadata = {
  title: "Vxture Design Preview",
  description: "设计系统预览面（仅开发用，不发布不部署）",
};

export default function RootLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="bg-background text-foreground">
        <ThemeProvider>
          <ToastProvider>
            <TooltipProvider>
              <Shell>{children}</Shell>
            </TooltipProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
