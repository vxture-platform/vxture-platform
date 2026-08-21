"use client";

import { startTransition, useEffect, useState } from "react";
import {
  FullscreenProvider,
  ThemeProvider,
  ToastProvider,
  TooltipProvider,
} from "@vxture/design-system";
import type { Density } from "@vxture/design-system";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type Locale,
  type Theme,
} from "@vxture-platform/shared";
import { ConsoleIntlProvider } from "@/lib/ConsoleIntl";
import {
  getGlobalUserPreferences,
  subscribeToGlobalPreferenceChanges,
} from "@vxture/platform-browser";
import { StepUpProvider } from "@/providers/StepUpProvider";

type Props = {
  children: React.ReactNode;
  initialLocale: Locale;
  initialMessages: Record<string, unknown>;
  initialMessageCatalog: Record<Locale, Record<string, unknown>>;
  initialTheme: Theme;
  initialDensity: Density;
};

function normalizeClientLocale(locale: string | undefined): Locale {
  return locale && (SUPPORTED_LOCALES as readonly string[]).includes(locale)
    ? (locale as Locale)
    : DEFAULT_LOCALE;
}

export function ConsoleAppProviders({
  children,
  initialLocale,
  initialMessages,
  initialMessageCatalog,
  initialTheme,
  initialDensity,
}: Props) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [messages, setMessages] =
    useState<Record<string, unknown>>(initialMessages);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    const syncLocale = (nextLocale: Locale) => {
      const normalized = normalizeClientLocale(nextLocale);
      const nextMessages = initialMessageCatalog[normalized] ?? initialMessages;
      startTransition(() => {
        setLocale(normalized);
        setMessages(nextMessages);
      });
    };

    const current = getGlobalUserPreferences();
    if (current.locale !== initialLocale) {
      syncLocale(current.locale);
    }

    return subscribeToGlobalPreferenceChanges((preferences) => {
      if (preferences.locale !== locale) {
        syncLocale(preferences.locale);
      }
    });
  }, [initialLocale, initialMessageCatalog, initialMessages, locale]);

  return (
    <ThemeProvider defaultMode={initialTheme} defaultDensity={initialDensity}>
      <FullscreenProvider defaultMode="native" defaultLockScroll={false}>
        <ConsoleIntlProvider locale={locale} messages={messages}>
          <ToastProvider>
            <TooltipProvider>
              <StepUpProvider>{children}</StepUpProvider>
            </TooltipProvider>
          </ToastProvider>
        </ConsoleIntlProvider>
      </FullscreenProvider>
    </ThemeProvider>
  );
}
