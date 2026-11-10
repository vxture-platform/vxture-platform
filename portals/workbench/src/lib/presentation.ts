/**
 * Deterministic daily copy and catalog filtering.
 * @package @vxture/workbench
 * @layer Presentation
 * @category utils
 * @author AI-Generated
 * @date 2026-11-05
 */
import {
  civilDateInZone,
  formatDay,
  DEFAULT_LOCALE,
  type Locale,
} from "@vxture-platform/shared";
import { translate } from "./messages";
import type { WorkApp } from "./contracts";

export interface HomeCopy {
  titles: readonly string[];
  fallback: string;
  appLimit?: number;
}
export type Category = "all" | "agent" | "platform";
const FALLBACK = "从容起步，稳步向前";
const WORKBENCH_TIME_ZONE = "Asia/Shanghai";
const WEEKDAYS = [
  "星期日",
  "星期一",
  "星期二",
  "星期三",
  "星期四",
  "星期五",
  "星期六",
] as const;

// ============================================================================
// Configuration and daily presentation
// ============================================================================
/**
 * Validate editable copy before it reaches the page.
 * @param input - Untrusted configuration.
 * @returns Clean copy with a guaranteed fallback.
 */
export function parseHomeCopy(input: unknown): HomeCopy {
  const object =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)
      : {};
  const clean = (value: unknown): string =>
    typeof value === "string" ? value.trim().replace(/[。.!！]+$/u, "") : "";
  const titles = Array.isArray(object.titles)
    ? object.titles.map(clean).filter(Boolean)
    : [];
  const appLimit =
    Number.isSafeInteger(object.appLimit) && Number(object.appLimit) > 0
      ? Number(object.appLimit)
      : 3;
  return { titles, fallback: clean(object.fallback) || FALLBACK, appLimit };
}

/**
 * Select copy and greeting using the same Shanghai calendar boundary.
 * @param now - Current instant.
 * @param copy - Validated editable titles.
 * @returns Stable title, date and greeting for the current day.
 */
export function dailyPresentation(
  now: Date,
  copy: HomeCopy,
  locale: Locale = DEFAULT_LOCALE,
): { title: string; date: string; weekday: string; greeting: string } {
  const { year, month, day } = civilDateInZone(now, WORKBENCH_TIME_ZONE);
  const calendarDay = Date.UTC(year, month - 1, day);
  const dayIndex = Math.floor(calendarDay / 86_400_000);
  // The workbench calendar is explicitly Shanghai, which uses UTC+08:00.
  const hour = (now.getUTCHours() + 8) % 24;
  return {
    title: translate(
      locale,
      copy.titles[dayIndex % copy.titles.length] ?? copy.fallback,
    ),
    date: formatDay(now, locale, "—", { timeZone: WORKBENCH_TIME_ZONE }),
    weekday: translate(locale, WEEKDAYS[new Date(calendarDay).getUTCDay()]!),
    greeting: translate(
      locale,
      hour < 12 && hour >= 5
        ? "早上好"
        : hour < 18 && hour >= 12
          ? "下午好"
          : "晚上好",
    ),
  };
}

/**
 * Filter once for search and availability, then calculate independent tab counts.
 * @param apps - Catalog projections.
 * @param query - Search text.
 * @param availableOnly - Restrict to confirmed available products.
 * @param category - Selected presentation category.
 * @returns Matching cards and cross-category counts.
 */
export function filterApps(
  apps: readonly WorkApp[],
  query: string,
  availableOnly: boolean,
  category: Category,
) {
  const needle = query.trim().toLocaleLowerCase();
  const matching = apps.filter(
    (app) =>
      (!availableOnly || app.available) &&
      `${app.name} ${app.brand} ${app.description}`
        .toLocaleLowerCase()
        .includes(needle),
  );
  return {
    counts: {
      all: matching.length,
      agent: matching.filter((app) => app.category === "agent").length,
      platform: matching.filter((app) => app.category === "platform").length,
    },
    items: matching.filter(
      (app) => category === "all" || app.category === category,
    ),
  };
}

/**
 * Prioritize availability, then apply the persisted application order.
 * @param apps - Current-workspace subscribed applications with server activity.
 * @param view - Shared favorite priority, recent launches or thirty-day frequency.
 * @returns Every application in availability groups, each ranked by the selected preference.
 */
export function sortApps(
  apps: readonly WorkApp[],
  view: "favorites" | "recent" | "frequent" = "favorites",
): WorkApp[] {
  const lastUsed = (app: WorkApp): number =>
    app.lastUsedAt ? Date.parse(app.lastUsedAt) || 0 : 0;
  return apps.toSorted(
    (left, right) =>
      Number(right.available) - Number(left.available) ||
      (view === "favorites"
        ? Number(Boolean(right.favorite)) - Number(Boolean(left.favorite))
        : 0) ||
      (view !== "recent"
        ? (right.launches30d ?? 0) - (left.launches30d ?? 0)
        : 0) ||
      lastUsed(right) - lastUsed(left) ||
      left.code.localeCompare(right.code),
  );
}

/**
 * Select the configured number of applications from the full catalog order.
 * @param apps - Current-workspace subscribed applications with server activity.
 * @param view - Shared portal sort preference.
 * @param limit - Positive configured home count; invalid values use three.
 * @returns The leading subscribed products in the selected global order.
 */
export function homeApps(
  apps: readonly WorkApp[],
  view: "favorites" | "recent" | "frequent" = "favorites",
  limit = 3,
): WorkApp[] {
  const count = Number.isSafeInteger(limit) && limit > 0 ? limit : 3;
  return sortApps(apps, view).slice(0, count);
}

/**
 * Keep the version consistent in cards and details, including absent registry values.
 * @param version - Optional release version from the product registry.
 * @returns One v-prefixed version with the approved initial-release fallback.
 */
export function appVersion(version: string | null): string {
  const value = version?.trim().replace(/^v/i, "").trim();
  return `v${value || "1.0.0"}`;
}

// ============================================================================
// Shared product labels for cards and detail panels
// ============================================================================
export const RELEASE_LABELS: Record<string, string> = {
  preview: "预览版",
  beta: "公测版",
  stable: "正式版",
  sunset: "停售中",
};
export const TIER_LABELS: Record<string, string> = {
  free: "免费版",
  starter: "入门版",
  standard: "标准版",
  pro: "专业版",
  professional: "专业版",
  team: "团队版",
  enterprise: "企业版",
};

/**
 * Hide the China calling prefix for local mobile display without changing stored identity.
 * @param phone - Canonical phone value returned by identity.
 * @returns The local China mobile number, or the unchanged international number.
 */
export function accountPhone(phone: string): string {
  const value = phone.trim();
  return /^\+86\s*1[3-9]\d{9}$/.test(value)
    ? value.replace(/^\+86\s*/, "")
    : value;
}
