"use client";

/**
 * Workbench locale context backed by the platform preference contract.
 * @package @vxture/workbench
 * @layer Presentation
 * @category I18n
 * @author AI-Generated
 * @date 2026-11-11
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_LOCALE,
  LOCALE_CONFIGS,
  SUPPORTED_LOCALES,
  type Locale,
} from "@vxture-platform/shared";
import {
  setGlobalLocalePreference,
  synchronizeGlobalLocale,
  createLocalePreferenceTransport,
} from "@vxture/platform-browser";
import { translate } from "./messages";

// ============================================================================
// Shared locale state and interface access
// ============================================================================
export const LOCALE_OPTIONS = SUPPORTED_LOCALES.map(
  (locale) => LOCALE_CONFIGS[locale],
);
const accountLocale = createLocalePreferenceTransport(
  "/auth/language",
  "PATCH",
  {
    "x-workbench-request": "1",
  },
);
const LocaleContext = createContext({
  locale: DEFAULT_LOCALE,
  changeLocale: (_value: string): void => undefined,
});

/** Share one locale across authenticated pages, public pages and portaled dialogs. */
export function WorkLocaleProvider({
  children,
  initialLocale = DEFAULT_LOCALE,
}: {
  children: ReactNode;
  initialLocale?: Locale;
}): React.JSX.Element {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  useEffect(
    () => synchronizeGlobalLocale(initialLocale, setLocale, accountLocale),
    [initialLocale],
  );
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const changeLocale = (value: string): void => {
    if (!SUPPORTED_LOCALES.includes(value as Locale)) return;
    const next = value as Locale;
    setLocale(next);
    setGlobalLocalePreference(next);
  };
  return (
    <LocaleContext.Provider value={{ locale, changeLocale }}>
      {children}
    </LocaleContext.Provider>
  );
}

/** Obtain current locale and translate only interface-owned copy. */
export function useWorkLocale() {
  const context = useContext(LocaleContext);
  return {
    ...context,
    t: (message: string, ...values: string[]) =>
      translate(context.locale, message, ...values),
  };
}
