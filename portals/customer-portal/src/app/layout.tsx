/**
 * Isolated customer portal document and design-system primitives.
 * @package @vxture/customer-portal
 * @layer Presentation
 * @category page
 * @author AI-Generated
 * @date 2026-11-15
 */
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ThemeProvider } from "@vxture/design-system";
import { loadBrand } from "../lib/runtime";
import "@vxture/design-system/styles/fonts.css";
import "./globals.css";

export const dynamic = "force-dynamic";

/** Derive identity from the exact customer host, never a shared static title. */
export async function generateMetadata(): Promise<Metadata> {
  const brand = await loadBrand();
  return {
    title: `${brand.name} · 智能应用门户`,
    description: brand.subtitle,
    robots: { index: false, follow: false },
    ...(brand.favicon
      ? { icons: { icon: `/api/portal/assets/${brand.favicon}` } }
      : {}),
  };
}

/** Mount the published design system without coupling to any other portal. */
export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const brand = await loadBrand();
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <ThemeProvider defaultMode={brand.appearance}>{children}</ThemeProvider>
      </body>
    </html>
  );
}
