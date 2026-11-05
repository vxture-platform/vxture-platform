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
import { ThemeProvider, themeBootstrapScript } from "@vxture/design-system";
import { loadRuntime } from "../lib/runtime";
import { WorkPortal } from "../modules/work/WorkPortal";
import "@vxture/design-system/styles/fonts.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ruyin Work",
  description: "专业所长，皆为所用",
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
          <WorkPortal {...configuration} />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
