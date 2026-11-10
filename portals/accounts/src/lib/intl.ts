/**
 * Server-side Accounts messages resolved from the shared cookie or browser locale.
 * @package @vxture/accounts
 * @layer Presentation
 * @category utility
 * @author AI-Generated
 * @date 2026-11-10
 */

import { resolveLocale } from "@vxture/core-locale";
import type { Locale } from "@vxture-platform/shared";
import enUS from "../../messages/en-US.json";
import zhCN from "../../messages/zh-CN.json";

export type AccountsMessages = typeof zhCN;

const CATALOG: Record<Locale, AccountsMessages> = {
  "zh-CN": zhCN,
  "en-US": enUS as AccountsMessages,
};

export function accountsLocale(headers: Headers): Locale {
  return resolveLocale({ headers });
}

export function accountsMessages(locale: Locale): AccountsMessages {
  return CATALOG[locale] ?? CATALOG["zh-CN"];
}
