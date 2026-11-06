/**
 * Deterministic daily copy and catalog filtering.
 * @package @vxture/workbench
 * @layer Presentation
 * @category utils
 * @author AI-Generated
 * @date 2026-11-05
 */
import { civilDateInZone, formatDay } from "@vxture-platform/shared";
import type { WorkApp } from "./contracts";

export interface HomeCopy {
  titles: readonly string[];
  fallback: string;
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
  return { titles, fallback: clean(object.fallback) || FALLBACK };
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
): { title: string; date: string; weekday: string; greeting: string } {
  const { year, month, day } = civilDateInZone(now, WORKBENCH_TIME_ZONE);
  const calendarDay = Date.UTC(year, month - 1, day);
  const dayIndex = Math.floor(calendarDay / 86_400_000);
  // The workbench calendar is explicitly Shanghai, which uses UTC+08:00.
  const hour = (now.getUTCHours() + 8) % 24;
  return {
    title: copy.titles[dayIndex % copy.titles.length] ?? copy.fallback,
    date: formatDay(now, "zh-CN", "—", { timeZone: WORKBENCH_TIME_ZONE }),
    weekday: WEEKDAYS[new Date(calendarDay).getUTCDay()]!,
    greeting:
      hour < 12 && hour >= 5
        ? "早上好"
        : hour < 18 && hour >= 12
          ? "下午好"
          : "晚上好",
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
 * Select up to three subscribed applications without filling with public products.
 * @param apps - Current-workspace subscribed applications in registry order.
 * @returns Available subscribed products first, capped at three.
 */
export function homeApps(apps: readonly WorkApp[]): WorkApp[] {
  return apps
    .toSorted((left, right) => Number(right.available) - Number(left.available))
    .slice(0, 3);
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
