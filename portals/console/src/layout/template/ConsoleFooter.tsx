"use client";

/**
 * Stationary legal navigation shared with the Accounts user center.
 * @package @vxture/console
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-12
 */
import { ShellFooter } from "@vxture/design-system";
import { useLocale, useTranslations } from "next-intl";

/** Render the user-center footer outside the content scroll region. */
export function ConsoleFooter() {
  const locale = useLocale();
  const t = useTranslations("shell.legal");
  const website = process.env.NEXT_PUBLIC_WEBSITE_URL || "https://vxture.com";
  return (
    <ShellFooter
      legal={{
        copyright: {
          href: `${website}/${locale}/legal/copyright`,
          label: t("copyright"),
          year: new Date().getFullYear(),
          owner: "Vxture Studio",
        },
        brand: { href: `${website}/${locale}/legal/brand`, label: t("brand") },
        cookies: {
          href: `${website}/${locale}/legal/cookies`,
          label: t("cookies"),
        },
        terms: { href: `${website}/${locale}/legal/terms`, label: t("terms") },
        privacy: {
          href: `${website}/${locale}/legal/privacy`,
          label: t("privacy"),
        },
        navigationLabel: t("label"),
      }}
    />
  );
}
