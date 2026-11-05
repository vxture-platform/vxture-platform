/**
 * Calendar-boundary and contextual filtering regressions.
 * @package @vxture/workbench
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-11-05
 */
import { describe, expect, it } from "vitest";
import { dailyPresentation, filterApps, parseHomeCopy } from "./presentation";
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
