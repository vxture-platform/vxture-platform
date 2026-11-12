/**
 * Calendar-boundary and contextual filtering regressions.
 * @package @vxture/workbench
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-11-05
 */
import { describe, expect, it } from "vitest";
import {
  appVersion,
  dailyPresentation,
  filterApps,
  parseHomeCopy,
  homeApps,
  sortApps,
} from "./presentation";
import type { WorkApp } from "./contracts";

const copy = parseHomeCopy({
  titles: ["向前一步。", "专注所长"],
  fallback: "稳步向前",
});
const app = (
  code: string,
  category: WorkApp["category"],
  available: boolean,
): WorkApp => ({
  code,
  category,
  available,
  name: code,
  brand: "",
  description: "专业业务",
  version: null,
  stage: "stable",
  tier: null,
  icon: null,
  href: null,
  availabilityLabel: "",
});

// ============================================================================
// Calendar boundaries and catalog filtering
// ============================================================================
describe("daily presentation", () => {
  it("keeps copy stable within a Shanghai day and changes at local midnight", () => {
    const morning = dailyPresentation(new Date("2026-11-05T01:00:00Z"), copy);
    const evening = dailyPresentation(new Date("2026-11-05T15:59:59Z"), copy);
    const nextDay = dailyPresentation(new Date("2026-11-05T16:00:00Z"), copy);
    expect(morning.title).toBe(evening.title);
    expect(nextDay.title).not.toBe(evening.title);
    expect(morning).toMatchObject({
      date: "2026/11/05",
      weekday: "星期四",
      greeting: "早上好",
    });
    expect(
      dailyPresentation(new Date("2026-11-05T05:00:00Z"), copy).greeting,
    ).toBe("下午好");
    expect(evening.greeting).toBe("晚上好");
  });
  it("uses an editable fallback for malformed or empty title lists", () => {
    expect(
      parseHomeCopy({ titles: [null, "  ", 0], fallback: "继续前进。" }),
    ).toEqual({ titles: [], fallback: "继续前进", appLimit: 3 });
    expect(
      dailyPresentation(new Date(), parseHomeCopy(null)).title,
    ).toBeTruthy();
    expect(copy.titles).toContain("向前一步");
  });
  it("keeps greetings and weekdays aligned across Shanghai year boundaries", () => {
    expect(
      dailyPresentation(new Date("2026-12-31T16:00:00Z"), copy),
    ).toMatchObject({
      date: "2027/01/01",
      weekday: "星期五",
      greeting: "晚上好",
    });
    for (const [instant, greeting] of [
      ["2027-01-01T20:59:59Z", "晚上好"],
      ["2027-01-01T21:00:00Z", "早上好"],
      ["2027-01-02T04:00:00Z", "下午好"],
      ["2027-01-02T10:00:00Z", "晚上好"],
    ] as const) {
      expect(dailyPresentation(new Date(instant), copy).greeting).toBe(
        greeting,
      );
    }
  });
});

describe("catalog filtering", () => {
  const apps = [
    app("TenderForge", "agent", true),
    app("Knowledge", "platform", true),
    app("Review", "agent", false),
  ];
  it("updates every category count for availability without collapsing other tabs", () => {
    const result = filterApps(apps, "", true, "agent");
    expect(result.counts).toEqual({ all: 2, agent: 1, platform: 1 });
    expect(result.items.map((item) => item.code)).toEqual(["TenderForge"]);
  });
  it("searches case-insensitively and distinguishes no matches from all products", () => {
    expect(filterApps(apps, " TENDER ", false, "all").counts.all).toBe(1);
    expect(filterApps(apps, "不存在", false, "all").items).toEqual([]);
    expect(filterApps(apps, "业务", false, "all").counts.all).toBe(3);
  });
});

// ============================================================================
// Home selection preserves real availability while keeping the approved rhythm.
// ============================================================================
it("prioritizes favorites without filtering other subscriptions and caps at three", () => {
  const catalog = [
    app("unstarred", "agent", false),
    ...["a", "b", "c", "d"].map((code) => ({
      ...app(code, "agent", false),
      favorite: true,
    })),
  ];
  expect(homeApps(catalog).map((item) => item.code)).toEqual(["a", "b", "c"]);
  expect(homeApps([catalog[0]!])).toEqual([catalog[0]!]);
  expect(homeApps([])).toEqual([]);
  expect(catalog[0]?.code).toBe("unstarred");
});
it("formats one version prefix and falls back for missing release metadata", () => {
  for (const version of [null, "", " ", "v"])
    expect(appVersion(version)).toBe("v1.0.0");
  expect(appVersion("1.2.3")).toBe("v1.2.3");
  expect(appVersion(" v2.0.0 ")).toBe("v2.0.0");
});
it("prioritizes availability before recent and frequent without favorite bias", () => {
  const catalog = [
    {
      ...app("old-favorite", "agent", true),
      favorite: true,
      lastUsedAt: "2026-09-01T00:00:00Z",
      launches30d: 0,
    },
    {
      ...app("popular", "agent", false),
      lastUsedAt: "2026-11-05T00:00:00Z",
      launches30d: 20,
    },
    {
      ...app("new", "agent", true),
      lastUsedAt: "2026-11-10T00:00:00Z",
      launches30d: 2,
    },
    {
      ...app("tie-new", "agent", true),
      lastUsedAt: "2026-11-09T00:00:00Z",
      launches30d: 20,
    },
    app("unused", "agent", true),
  ];
  expect(homeApps(catalog, "recent").map((item) => item.code)).toEqual([
    "new",
    "tie-new",
    "old-favorite",
  ]);
  expect(homeApps(catalog, "frequent").map((item) => item.code)).toEqual([
    "tie-new",
    "new",
    "old-favorite",
  ]);
  expect(homeApps(catalog).map((item) => item.code)).toEqual([
    "old-favorite",
    "tie-new",
    "new",
  ]);
  expect(homeApps([catalog[0]!], "frequent")).toEqual([catalog[0]!]);
});

// ============================================================================
// Home and catalog share one order; filtering must preserve that relative order.
// ============================================================================
it("shares every sort mode across home and the full filtered catalog", () => {
  const catalog = [
    {
      ...app("favorite", "agent", true),
      favorite: true,
      launches30d: 1,
      lastUsedAt: "2026-11-01T00:00:00Z",
    },
    {
      ...app("popular", "platform", true),
      launches30d: 20,
      lastUsedAt: "2026-11-05T00:00:00Z",
    },
    {
      ...app("recent", "agent", true),
      launches30d: 3,
      lastUsedAt: "2026-11-10T00:00:00Z",
    },
    app("unused", "agent", false),
  ];
  for (const [view, expected] of [
    ["favorites", ["favorite", "popular", "recent", "unused"]],
    ["recent", ["recent", "popular", "favorite", "unused"]],
    ["frequent", ["popular", "recent", "favorite", "unused"]],
  ] as const) {
    const ordered = sortApps(catalog, view);
    expect(ordered.map((item) => item.code)).toEqual(expected);
    expect(homeApps(catalog, view)).toEqual(ordered.slice(0, 3));
    expect(
      filterApps(ordered, "", true, "agent").items.map((item) => item.code),
    ).toEqual(
      expected.filter((code) => code === "favorite" || code === "recent"),
    );
  }
  expect(catalog[0]?.code).toBe("favorite");
  expect(sortApps([])).toEqual([]);
});

it("keeps available applications above unavailable favorites, newer and frequent products", () => {
  const available = app("available-unused", "agent", true);
  const unavailable = {
    ...app("unavailable", "agent", false),
    favorite: true,
    launches30d: 999,
    lastUsedAt: "2026-11-11T00:00:00Z",
  };
  for (const view of ["favorites", "recent", "frequent"] as const) {
    expect(sortApps([unavailable, available], view)).toEqual([
      available,
      unavailable,
    ]);
    expect(homeApps([unavailable, available], view)).toEqual([
      available,
      unavailable,
    ]);
  }
});

it("takes any configured home count from the complete global order", () => {
  const catalog = Array.from({ length: 8 }, (_, i) => ({
    ...app(String(i), "agent", i !== 1),
    favorite: i === 4,
    launches30d: i,
  }));
  for (const view of ["favorites", "recent", "frequent"] as const) {
    const ordered = sortApps(catalog, view);
    for (const count of [1, 3, 5, 8, 12])
      expect(homeApps(catalog, view, count)).toEqual(ordered.slice(0, count));
  }
  expect(parseHomeCopy({ appLimit: 6 }).appLimit).toBe(6);
  for (const appLimit of [0, -1, 1.5, "6", null])
    expect(parseHomeCopy({ appLimit }).appLimit).toBe(3);
});
