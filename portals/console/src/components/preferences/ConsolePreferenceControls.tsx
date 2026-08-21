"use client";

import { startTransition, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/lib/i18n/navigation";
import { Button, NativeSelect, useTheme } from "@vxture/design-system";
import type { Density } from "@vxture/design-system";
import {
  getGlobalUserPreferences,
  setGlobalDensityPreference,
  setGlobalLocalePreference,
  setGlobalThemePreference,
  subscribeToGlobalPreferenceChanges,
} from "@vxture/platform-browser";
import type { Locale, Theme } from "@vxture-platform/shared";

const THEME_OPTIONS: readonly Theme[] = ["system", "light", "dark"];
const DENSITY_OPTIONS: readonly Density[] = [
  "compact",
  "default",
  "comfortable",
];

export function ConsolePreferenceControls() {
  const t = useTranslations("preferences");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const { theme, setTheme, density, setDensity } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return subscribeToGlobalPreferenceChanges((preferences) => {
      startTransition(() => {
        setTheme(preferences.theme);
        setDensity(preferences.density);
      });
    });
  }, [setDensity, setTheme]);

  const currentTheme = (theme ?? getGlobalUserPreferences().theme) as Theme;
  const currentThemeIndex = Math.max(THEME_OPTIONS.indexOf(currentTheme), 0);
  const nextTheme =
    THEME_OPTIONS[(currentThemeIndex + 1) % THEME_OPTIONS.length]!;

  return (
    <div className="console-preferences" aria-label={t("title")}>
      <label className="console-preferences__field">
        <span>{t("locale.label")}</span>
        <NativeSelect
          value={locale}
          onChange={(event) => {
            const nextLocale = event.target.value as Locale;
            setGlobalLocalePreference(nextLocale);
            router.replace(pathname, { locale: nextLocale });
          }}
        >
          <option value="zh-CN">{t("locale.zh-CN")}</option>
          <option value="en-US">{t("locale.en-US")}</option>
        </NativeSelect>
      </label>

      <label className="console-preferences__field">
        <span>{t("density.label")}</span>
        <NativeSelect
          value={mounted ? density : getGlobalUserPreferences().density}
          onChange={(event) => {
            const nextDensity = event.target.value as Density;
            setDensity(nextDensity);
            setGlobalDensityPreference(nextDensity);
          }}
        >
          {DENSITY_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {t(`density.${option}`)}
            </option>
          ))}
        </NativeSelect>
      </label>

      <Button
        variant="outline"
        size="md"
        onClick={() => {
          setTheme(nextTheme);
          setGlobalThemePreference(nextTheme);
        }}
      >
        {t("theme.switchTo", { theme: t(`theme.${nextTheme}`) })}
      </Button>
    </div>
  );
}
