"use client";

/**
 * Keep this portal aligned with the shared platform language preference.
 * @package @vxture/console
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
import { fetchUserProfile, updateUserProfile } from "@/api/console-bff";
const accountLocale = {
  read: fetchUserProfile,
  write: (language: Locale) => updateUserProfile({ language }),
};

/** Preserve the complete route, query and fragment while applying the shared locale. */
export function LocaleSync(): null {
  const locale = useLocale() as Locale;
  const router = useRouter();
  useEffect(
    () =>
      synchronizeGlobalLocale(
        locale,
        (next) => {
          document.documentElement.lang = next;
          if (next === locale) return;
          const url = new URL(window.location.href);
          const segments = url.pathname.split("/");
          segments[1] = next;
          router.replace(`${segments.join("/")}${url.search}${url.hash}`);
        },
        accountLocale,
      ),
    [locale, router],
  );
  return null;
}
