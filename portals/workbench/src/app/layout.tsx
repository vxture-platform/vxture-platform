/**
 * Work root with the published DS theme runtime.
 * @package @vxture/workbench
 * @layer Presentation
 * @category page
 * @author AI-Generated
 * @date 2026-11-05
 */
import { cookies } from "next/headers";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  LOCALE_CONSTANTS,
  type Locale,
} from "@vxture-platform/shared";
import { WorkLocaleProvider } from "../lib/locale";
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

const baseMetadata: Metadata = {
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

/** Localize document metadata using the shared locale cookie. */
export async function generateMetadata(): Promise<Metadata> {
  const locale = (await cookies()).get(LOCALE_CONSTANTS.COOKIE_KEY)?.value;
  return {
    ...baseMetadata,
    description:
      locale === "en-US"
        ? "Expertise at your fingertips"
        : baseMetadata.description,
  };
}

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
  const savedLocale = (await cookies()).get(LOCALE_CONSTANTS.COOKIE_KEY)
    ?.value as Locale;
  const locale = SUPPORTED_LOCALES.includes(savedLocale)
    ? savedLocale
    : DEFAULT_LOCALE;
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body>
        <ThemeProvider defaultMode="system">
          <FullscreenProvider>
            <WorkLocaleProvider initialLocale={locale}>
              <WorkPortal {...configuration} />
              {children}
            </WorkLocaleProvider>
          </FullscreenProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
