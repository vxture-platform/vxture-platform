/**
 * Cross-portal user preference utilities
 * @package @vxture/platform-browser
 */

import {
  DEFAULT_LOCALE,
  LOCALE_CONSTANTS,
  type Locale,
  type Theme,
} from "@vxture-platform/shared";
// 主题/偏好的持久化契约键归 design-tokens（2026-08-21 归属纠正）。
import { PREFERENCE_CONSTANTS, THEME_CONSTANTS } from "@vxture/design-tokens";

export type DensityPreference = "compact" | "default" | "comfortable";
export type FontSizePreference = "small" | "default" | "large";

export interface GlobalUserPreferences {
  locale: Locale;
  theme: Theme;
  density: DensityPreference;
  fontSize: FontSizePreference;
}

const DEFAULT_PREFERENCES: GlobalUserPreferences = {
  locale: DEFAULT_LOCALE,
  theme: THEME_CONSTANTS.DEFAULT_THEME,
  density: "default",
  fontSize: "default",
};

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

/**
 * Cookie domain attribute for cross-subdomain sync. Scopes to `.vxture.com` when
 * on a vxture.com host so every *.vxture.com portal shares the cookie; host-only
 * (no domain) on localhost / IPs. Same-domain cross-subdomain only — the cookie
 * never reaches a different registrable domain (e.g. ruyin.ai).
 */
function cookieDomainAttribute(): string {
  if (!isBrowser()) return "";
  const host = window.location.hostname;
  const parent = PREFERENCE_CONSTANTS.COOKIE_DOMAIN;
  if (host === parent || host.endsWith(`.${parent}`)) {
    return `; domain=.${parent}`;
  }
  return "";
}

function readCookie(name: string): string | undefined {
  if (!isBrowser()) return undefined;

  const prefix = `${name}=`;
  return document.cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix))
    ?.slice(prefix.length);
}

function writeCookie(name: string, value: string): void {
  if (!isBrowser()) return;

  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${PREFERENCE_CONSTANTS.COOKIE_MAX_AGE}; samesite=lax${cookieDomainAttribute()}${secure}`;
}

function dispatchPreferenceSync(preferences: GlobalUserPreferences): void {
  if (!isBrowser()) return;

  const payload = JSON.stringify({
    ...preferences,
    updatedAt: Date.now(),
  });

  window.localStorage.setItem(PREFERENCE_CONSTANTS.SYNC_STORAGE_KEY, payload);
  window.dispatchEvent(
    new CustomEvent(PREFERENCE_CONSTANTS.SYNC_EVENT, { detail: preferences }),
  );
}

function normalizeTheme(theme: string | null | undefined): Theme {
  if (theme === "light" || theme === "dark" || theme === "system") {
    return theme;
  }
  return DEFAULT_PREFERENCES.theme;
}

function normalizeLocale(locale: string | null | undefined): Locale {
  if (locale === "zh-CN" || locale === "en-US") {
    return locale;
  }
  return DEFAULT_PREFERENCES.locale;
}

function normalizeDensity(
  density: string | null | undefined,
): DensityPreference {
  if (
    density === "compact" ||
    density === "default" ||
    density === "comfortable"
  ) {
    return density;
  }
  return DEFAULT_PREFERENCES.density;
}

function normalizeFontSize(
  fontSize: string | null | undefined,
): FontSizePreference {
  if (fontSize === "small" || fontSize === "default" || fontSize === "large") {
    return fontSize;
  }
  return DEFAULT_PREFERENCES.fontSize;
}

export function getGlobalUserPreferences(): GlobalUserPreferences {
  if (!isBrowser()) {
    return DEFAULT_PREFERENCES;
  }

  const locale = normalizeLocale(
    window.localStorage.getItem(LOCALE_CONSTANTS.STORAGE_KEY) ??
      readCookie(LOCALE_CONSTANTS.COOKIE_KEY),
  );

  const theme = normalizeTheme(
    window.localStorage.getItem(THEME_CONSTANTS.STORAGE_KEY) ??
      window.localStorage.getItem("theme") ??
      readCookie(THEME_CONSTANTS.COOKIE_KEY),
  );

  const density = normalizeDensity(
    window.localStorage.getItem(PREFERENCE_CONSTANTS.DENSITY_STORAGE_KEY) ??
      readCookie(PREFERENCE_CONSTANTS.DENSITY_COOKIE_KEY),
  );

  const fontSize = normalizeFontSize(
    window.localStorage.getItem(PREFERENCE_CONSTANTS.FONTSIZE_STORAGE_KEY) ??
      readCookie(PREFERENCE_CONSTANTS.FONTSIZE_COOKIE_KEY),
  );

  return { locale, theme, density, fontSize };
}

export function setGlobalUserPreferences(
  partial: Partial<GlobalUserPreferences>,
): GlobalUserPreferences {
  if (!isBrowser()) {
    return { ...DEFAULT_PREFERENCES, ...partial };
  }

  const nextPreferences: GlobalUserPreferences = {
    ...getGlobalUserPreferences(),
    ...partial,
  };

  window.localStorage.setItem(
    LOCALE_CONSTANTS.STORAGE_KEY,
    nextPreferences.locale,
  );
  window.localStorage.setItem(
    THEME_CONSTANTS.STORAGE_KEY,
    nextPreferences.theme,
  );
  window.localStorage.setItem(
    PREFERENCE_CONSTANTS.DENSITY_STORAGE_KEY,
    nextPreferences.density,
  );
  window.localStorage.setItem(
    PREFERENCE_CONSTANTS.FONTSIZE_STORAGE_KEY,
    nextPreferences.fontSize,
  );

  writeCookie(LOCALE_CONSTANTS.COOKIE_KEY, nextPreferences.locale);
  writeCookie(THEME_CONSTANTS.COOKIE_KEY, nextPreferences.theme);
  writeCookie(PREFERENCE_CONSTANTS.DENSITY_COOKIE_KEY, nextPreferences.density);
  writeCookie(
    PREFERENCE_CONSTANTS.FONTSIZE_COOKIE_KEY,
    nextPreferences.fontSize,
  );

  dispatchPreferenceSync(nextPreferences);
  return nextPreferences;
}

export function setGlobalLocalePreference(
  locale: Locale,
): GlobalUserPreferences {
  return setGlobalUserPreferences({ locale });
}

export function setGlobalThemePreference(theme: Theme): GlobalUserPreferences {
  return setGlobalUserPreferences({ theme });
}

export function setGlobalDensityPreference(
  density: DensityPreference,
): GlobalUserPreferences {
  return setGlobalUserPreferences({ density });
}

export function setGlobalFontSizePreference(
  fontSize: FontSizePreference,
): GlobalUserPreferences {
  return setGlobalUserPreferences({ fontSize });
}

export function subscribeToGlobalPreferenceChanges(
  listener: (preferences: GlobalUserPreferences) => void,
): () => void {
  if (!isBrowser()) {
    return () => {};
  }

  const onStorage = (event: StorageEvent) => {
    if (
      event.key !== PREFERENCE_CONSTANTS.SYNC_STORAGE_KEY ||
      !event.newValue
    ) {
      return;
    }

    try {
      const parsed = JSON.parse(
        event.newValue,
      ) as Partial<GlobalUserPreferences>;
      listener({
        locale: normalizeLocale(parsed.locale),
        theme: normalizeTheme(parsed.theme),
        density: normalizeDensity(parsed.density),
        fontSize: normalizeFontSize(parsed.fontSize),
      });
    } catch {
      // ignore malformed payload
    }
  };

  const onCustomEvent = (event: Event) => {
    const detail = (event as CustomEvent<GlobalUserPreferences>).detail;
    if (!detail) return;
    listener(detail);
  };

  window.addEventListener("storage", onStorage);
  window.addEventListener(
    PREFERENCE_CONSTANTS.SYNC_EVENT,
    onCustomEvent as EventListener,
  );

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(
      PREFERENCE_CONSTANTS.SYNC_EVENT,
      onCustomEvent as EventListener,
    );
  };
}
