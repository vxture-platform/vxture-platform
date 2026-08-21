/**
 * fontSizePreference.ts - self-contained font-size preference persistence.
 * @package @vxture/design-system
 *
 * The font-size preference (contract key `vx-fontsize`) syncs across *.vxture.com
 * via a cookie + localStorage, using the @vxture/design-tokens contract keys. It
 * lives inside the DS — with NO @vxture/platform-browser dependency — so the
 * published package stays lean and installable by external consumers. Theme /
 * density / locale stay owned by each portal's platform-browser; this manages only
 * the font-size slice and uses the same keys, so the two interoperate (each
 * preference is read from its own key, never from the cross-tab snapshot).
 */
import { PREFERENCE_CONSTANTS } from "@vxture/design-tokens";

export type FontSizePreference = "small" | "default" | "large";

const DEFAULT_FONT_SIZE: FontSizePreference = "default";

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function normalize(value: string | null | undefined): FontSizePreference {
  return value === "small" || value === "default" || value === "large"
    ? value
    : DEFAULT_FONT_SIZE;
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

/** Scope to `.vxture.com` for cross-subdomain sync; host-only on localhost / IP. */
function cookieDomainAttribute(): string {
  if (!isBrowser()) return "";
  const host = window.location.hostname;
  const parent = PREFERENCE_CONSTANTS.COOKIE_DOMAIN;
  if (host === parent || host.endsWith(`.${parent}`)) {
    return `; domain=.${parent}`;
  }
  return "";
}

/** Current font-size preference (localStorage, then the cross-subdomain cookie). */
export function readFontSizePreference(): FontSizePreference {
  if (!isBrowser()) return DEFAULT_FONT_SIZE;
  return normalize(
    window.localStorage.getItem(PREFERENCE_CONSTANTS.FONTSIZE_STORAGE_KEY) ??
      readCookie(PREFERENCE_CONSTANTS.FONTSIZE_COOKIE_KEY),
  );
}

/** Persist the font-size preference to localStorage + the `.vxture.com` cookie. */
export function writeFontSizePreference(value: FontSizePreference): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(PREFERENCE_CONSTANTS.FONTSIZE_STORAGE_KEY, value);
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie =
    `${PREFERENCE_CONSTANTS.FONTSIZE_COOKIE_KEY}=${encodeURIComponent(value)}` +
    `; path=/; max-age=${PREFERENCE_CONSTANTS.COOKIE_MAX_AGE}; samesite=lax` +
    `${cookieDomainAttribute()}${secure}`;
}

/**
 * Cross-tab sync: re-read on a write to the font-size key or to the shared
 * preference snapshot (which platform-browser writes when any preference changes).
 */
export function subscribeFontSizePreference(
  listener: (value: FontSizePreference) => void,
): () => void {
  if (!isBrowser()) return () => {};
  const onStorage = (event: StorageEvent) => {
    if (
      event.key === PREFERENCE_CONSTANTS.FONTSIZE_STORAGE_KEY ||
      event.key === PREFERENCE_CONSTANTS.SYNC_STORAGE_KEY
    ) {
      listener(readFontSizePreference());
    }
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}
