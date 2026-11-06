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
  accountPhone,
  dailyPresentation,
  filterApps,
  parseHomeCopy,
  homeApps,
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
    ).toEqual({ titles: [], fallback: "继续前进" });
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
it("caps subscribed home cards at three without inventing additional products", () => {
  const catalog = [
    app("locked-first", "agent", false),
    app("locked-second", "platform", false),
    app("available", "agent", true),
    app("fourth", "agent", false),
  ];
  const selection = homeApps(catalog);
  expect(selection.map((item) => item.code)).toEqual([
    "available",
    "locked-first",
    "locked-second",
  ]);
  expect(selection.filter((item) => item.available)).toHaveLength(1);
  expect(catalog[0]?.code).toBe("locked-first");
  expect(homeApps([])).toEqual([]);
  expect(homeApps(catalog.slice(0, 1))).toHaveLength(1);
});
it("formats one version prefix and falls back for missing release metadata", () => {
  for (const version of [null, "", " ", "v"])
    expect(appVersion(version)).toBe("v1.0.0");
  expect(appVersion("1.2.3")).toBe("v1.2.3");
  expect(appVersion(" v2.0.0 ")).toBe("v2.0.0");
});
it("selects user favorites before available subscription fill-ins without mutating input", () => {
  const catalog = [
    app("history", "agent", false),
    app("available", "platform", true),
    { ...app("favorite-expired", "agent", false), favorite: true },
    { ...app("favorite-live", "agent", true), favorite: true },
    app("another-live", "agent", true),
  ];
  expect(homeApps(catalog).map((item) => item.code)).toEqual([
    "favorite-live",
    "favorite-expired",
    "available",
  ]);
  expect(catalog[0]?.code).toBe("history");
  expect(homeApps(catalog.slice(2, 3))).toHaveLength(1);
});

describe("account phone display", () => {
  it("removes only a China mobile calling prefix", () => {
    expect(accountPhone("+8613800138000")).toBe("13800138000");
    expect(accountPhone("+86 13800138000")).toBe("13800138000");
    expect(accountPhone("+14155552671")).toBe("+14155552671");
    expect(accountPhone("+861012345678")).toBe("+861012345678");
    expect(accountPhone("")).toBe("");
  });
});
