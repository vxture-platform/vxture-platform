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
import {
  synchronizeGlobalLocale,
  createLocalePreferenceTransport,
} from "@vxture/platform-browser";
import { usePathname, useRouter } from "next/navigation";
const accountLocale = createLocalePreferenceTransport(
  `${process.env.NEXT_PUBLIC_OIDC_API_BASE ?? "http://localhost:3081"}/oidc/customer/self`,
  "PATCH",
);

/** Refresh server messages when another platform surface changes the language. */
export function LocaleSync(): null {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  // Workforce surfaces must never mutate a customer account sharing this browser.
  const transport =
    pathname.startsWith("/workforce") || pathname.startsWith("/operator")
      ? undefined
      : accountLocale;
  useEffect(
    () =>
      synchronizeGlobalLocale(
        locale,
        (next) => {
          document.documentElement.lang = next;
          if (next !== locale) router.refresh();
        },
        transport,
      ),
    [locale, router, transport],
  );
  return null;
}
