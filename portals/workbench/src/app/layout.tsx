/**
 * Work root with the published DS theme runtime.
 * @package @vxture/workbench
 * @layer Presentation
 * @category page
 * @author AI-Generated
 * @date 2026-11-05
 */
import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  FullscreenProvider,
  ThemeProvider,
  themeBootstrapScript,
} from "@vxture/design-system";
import { loadRuntime } from "../lib/runtime";
import { WorkPortal } from "../modules/work/WorkPortal";
import "@vxture/design-system/styles/fonts.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ruyin Work",
  applicationName: "Ruyin Work",
  description: "专业所长，皆为所用",
  icons: {
    icon: [{ url: "/favicon.ico", type: "image/x-icon" }],
    shortcut: "/favicon.ico",
    apple: "/brand/vxture-mark.png",
  },
};
export const dynamic = "force-dynamic";

/**
 * Supply one consistent frame and theme for authenticated and public states.
 * @param props - Route contents.
 * @returns The themed application document.
 */
export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}): Promise<React.JSX.Element> {
  const configuration = await loadRuntime();
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body>
        <ThemeProvider defaultMode="system">
          <FullscreenProvider>
            <WorkPortal {...configuration} />
            {children}
          </FullscreenProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
