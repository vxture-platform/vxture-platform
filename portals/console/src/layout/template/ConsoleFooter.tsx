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
import { useTranslations } from "next-intl";

/** Render the user-center footer outside the content scroll region. */
export function ConsoleFooter() {
  const t = useTranslations("shell.legal");
  const website = process.env.NEXT_PUBLIC_WEBSITE_URL || "https://vxture.com";
  return (
    <ShellFooter>
      <span>© {new Date().getFullYear()} Vxture Studio</span>
      <nav className="flex items-center gap-4" aria-label={t("label")}>
        {(["terms", "privacy", "copyright"] as const).map((key) => (
          <a
            key={key}
            href={`${website}/legal/${key}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground"
          >
            {t(key)}
          </a>
        ))}
      </nav>
    </ShellFooter>
  );
}
