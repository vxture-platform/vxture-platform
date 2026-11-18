/**
 * selection.test.ts - Cross-page selection and partial failure regressions.
 * @package @vxture/opera
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-11-18
 */
import { describe, expect, it, vi } from "vitest";
import {
  executeGrantBatch,
  filterResources,
  selectMatches,
  type GrantResource,
  type ResourceFilter,
} from "./selection";

const rows: GrantResource[] = Array.from({ length: 879 }, (_, index) => ({
  id: `cap.${index}`,
  name: `能力 ${index}`,
  description: "搜索示例",
  category: index < 500 ? "development" : "sales",
  held: index < 10,
}));
const filter: ResourceFilter = {
  keyword: "",
  category: "",
  availability: "all",
  selectedOnly: false,
};

describe("catalog selection", () => {
  it("selects every eligible result across pages, without held resources", () => {
    const selected = selectMatches(new Set(), rows, true);
    expect(selected.size).toBe(869);
    expect(selected.has("cap.878")).toBe(true);
    expect(selected.has("cap.0")).toBe(false);
  });

  it("retains choices outside the filter when selecting and deselecting a category", () => {
    const matches = filterResources(
      rows,
      { ...filter, category: "development" },
      new Set(),
    );
    const selected = selectMatches(new Set(["cap.878"]), matches, true);
    expect(selected.size).toBe(491);
    expect([...selectMatches(selected, matches, false)]).toEqual(["cap.878"]);
  });

  it("combines keyword, category, authorization and selected-only filters", () => {
    const picked = new Set(["cap.15", "cap.16", "cap.515"]);
    const matches = filterResources(
      rows,
      {
        ...filter,
        category: "development",
        keyword: "  CAP.15 ",
        availability: "available",
        selectedOnly: true,
      },
      picked,
    );
    expect(matches.map((row) => row.id)).toEqual(["cap.15"]);
    expect(
      filterResources(rows, { ...filter, availability: "held" }, picked),
    ).toHaveLength(10);
  });

  it("deduplicates repeated selections and treats no matches as a no-op", () => {
    const selected = selectMatches(
      new Set(["cap.10"]),
      [rows[10]!, rows[10]!],
      true,
    );
    expect([...selected]).toEqual(["cap.10"]);
    expect([...selectMatches(selected, [], false)]).toEqual(["cap.10"]);
  });
});

describe("grant execution", () => {
  it("serializes writes, preserves failure reasons and retries only failures", async () => {
    let active = 0;
    let maximum = 0;
    const write = vi.fn(async (id: string) => {
      active++;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active--;
      if (id === "b") throw new Error("上游拒绝该授权");
    });
    const progress = vi.fn();
    const result = await executeGrantBatch(
      ["a", "b", "a", "c"],
      write,
      progress,
    );
    expect(result).toEqual({
      succeeded: ["a", "c"],
      failed: [{ id: "b", message: "上游拒绝该授权" }],
    });
    expect(maximum).toBe(1);
    expect(progress.mock.calls).toEqual([[1], [2], [3]]);
    const retry = vi.fn(async () => {});
    await executeGrantBatch(
      result.failed.map((failure) => failure.id),
      retry,
      () => {},
    );
    expect(retry.mock.calls).toEqual([["b"]]);
  });

  it("handles empty batches and unknown thrown values without losing results", async () => {
    const empty = await executeGrantBatch(
      [],
      async () => {},
      () => {},
    );
    expect(empty).toEqual({ succeeded: [], failed: [] });
    const result = await executeGrantBatch(
      ["a"],
      async () => {
        throw null;
      },
      () => {},
    );
    expect(result.failed[0]?.message).toBe("授权失败，请重试");
  });
});
