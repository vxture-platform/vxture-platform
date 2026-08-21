import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type Locale,
} from "@vxture-platform/shared";
import enUSMessages from "../../messages/en-US.json";
import zhCNMessages from "../../messages/zh-CN.json";

export function normalizeConsoleLocale(locale: string | undefined): Locale {
  return locale && (SUPPORTED_LOCALES as readonly string[]).includes(locale)
    ? (locale as Locale)
    : DEFAULT_LOCALE;
}

export async function loadConsoleMessages(
  locale: Locale,
): Promise<Record<string, unknown>> {
  switch (locale) {
    case "en-US":
      return enUSMessages as Record<string, unknown>;
    case "zh-CN":
    default:
      return zhCNMessages as Record<string, unknown>;
  }
}

export async function loadConsoleMessageCatalog(): Promise<
  Record<Locale, Record<string, unknown>>
> {
  return {
    "en-US": enUSMessages as Record<string, unknown>,
    "zh-CN": zhCNMessages as Record<string, unknown>,
  };
}
