/**
 * Monitoring override serialization and literal upstream error rendering.
 * @package @vxture/opera
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-10-20
 */
import { describe, expect, it } from "vitest";
import { healthSettingsDraft, healthSettingsPatch } from "./health-settings";
import { atlasLogError } from "./log-error";

describe("health monitoring partial updates", () => {
  it("leaves inherited defaults untouched and clears only an existing override", () => {
    const empty = healthSettingsDraft();
    expect(healthSettingsPatch(empty, empty, true)).toEqual({});
    const original = { ...empty, probeIntervalMinutes: "15" };
    expect(healthSettingsPatch(empty, original, true)).toEqual({
      probeIntervalMinutes: null,
    });
  });
  it("preserves explicit zero and disabled values", () => {
    const empty = healthSettingsDraft();
    expect(
      healthSettingsPatch(
        {
          ...empty,
          balanceMinAmount: "0",
          balanceMinDays: "0",
          probeEnabled: "false",
        },
        empty,
        true,
      ),
    ).toEqual({ balanceMinAmount: 0, balanceMinDays: 0, probeEnabled: false });
  });
  it("never sends balance fields when balance monitoring is unsupported", () => {
    const empty = healthSettingsDraft();
    expect(
      healthSettingsPatch(
        {
          ...empty,
          balanceMinAmount: "99",
          balanceMinDays: "3",
          balancePollMinutes: "15",
        },
        empty,
        false,
      ),
    ).toEqual({});
  });
  it.each(["Infinity", "NaN", "abc"])(
    "rejects invalid numeric input %s",
    (raw) => {
      const empty = healthSettingsDraft();
      expect(() =>
        healthSettingsPatch(
          { ...empty, probeIntervalMinutes: raw },
          empty,
          false,
        ),
      ).toThrow();
    },
  );
  it("rejects an invalid toggle instead of silently turning probing off", () => {
    const empty = healthSettingsDraft();
    expect(() =>
      healthSettingsPatch({ ...empty, probeEnabled: "yes" }, empty, false),
    ).toThrow();
  });
  it("keeps raw upstream messages as literal text and handles absent errors", () => {
    expect(
      atlasLogError({
        errorCode: "HTTP_429",
        errorMessage: "<script>alert(1)</script>\n限流",
      }),
    ).toEqual({ code: "HTTP_429", message: "<script>alert(1)</script>\n限流" });
    expect(atlasLogError(null)).toEqual({ code: "—", message: "—" });
  });
});
