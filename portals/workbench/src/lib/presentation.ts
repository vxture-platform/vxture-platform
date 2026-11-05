/**
 * Deterministic daily copy and catalog filtering.
 * @package @vxture/workbench
 * @layer Presentation
 * @category utils
 * @author AI-Generated
 * @date 2026-11-05
 */
import type { WorkApp } from "./contracts";

export interface HomeCopy {
  titles: readonly string[];
  fallback: string;
}
export type Category = "all" | "agent" | "platform";
const FALLBACK = "从容起步，稳步向前";

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
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (name: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === name)?.value ?? "";
  const dayIndex = Math.floor(
    Date.UTC(
      Number(part("year")),
      Number(part("month")) - 1,
      Number(part("day")),
    ) / 86_400_000,
  );
  const hour = Number(part("hour"));
  return {
    title: copy.titles[dayIndex % copy.titles.length] ?? copy.fallback,
    date: `${part("year")}/${part("month")}/${part("day")}`,
    weekday: new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      weekday: "long",
    }).format(now),
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
