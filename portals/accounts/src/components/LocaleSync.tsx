"use client";

/**
 * Keep this portal aligned with the shared platform language preference.
 * @package @vxture/accounts
 * @layer Presentation
 * @category I18n
 * @author AI-Generated
 * @date 2026-11-11
 */
import { useEffect } from "react";
import { useLocale } from "next-intl";
import type { Locale } from "@vxture-platform/shared";
import { synchronizeGlobalLocale } from "@vxture/platform-browser";
import { useRouter } from "next/navigation";

/** Refresh server messages when another platform surface changes the language. */
export function LocaleSync(): null {
  const locale = useLocale() as Locale;
  const router = useRouter();
  useEffect(
    () =>
      synchronizeGlobalLocale(locale, (next) => {
        document.documentElement.lang = next;
        if (next !== locale) router.refresh();
      }),
    [locale, router],
  );
  return null;
}
