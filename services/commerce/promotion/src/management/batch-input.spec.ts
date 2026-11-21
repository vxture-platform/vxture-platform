/**
 * batch-input.spec.ts - Economic configuration and unsupported capability boundaries.
 * @package @vxture/service-promotion
 * @layer Domain
 * @category test
 * @author AI-Generated
 * @date 2026-11-19
 */
import { describe, it, expect } from "vitest";
import { normalizeBatch, type BatchConfiguration } from "./batch-input";

// ===========================================================================
// Configuration fixture
// ===========================================================================
const base: BatchConfiguration = {
  kind: "credit_voucher",
  name: "B06 boundary",
  effect: { amount_cents: 1000 },
  totalCount: 10,
  validFrom: "2026-11-19T00:00:00Z",
  validUntil: "2026-12-19T00:00:00Z",
};

// ===========================================================================
// Economic configuration boundaries
// ===========================================================================
describe("batch configuration boundaries", () => {
  it("keeps product scopes canonical across input order without mutating requests", () => {
    const codes = Object.freeze([
      "z",
      "karda",
      "_internal",
      "2",
      "Arda",
      "arda",
      "-feature",
      "0",
      "a",
      "Z",
      "10",
    ]);
    const original = JSON.stringify(codes);
    const expected = {
      effect_version: 1,
      currency: "CNY",
      extend_days: 30,
      applicable_product_codes: [
        "-feature",
        "0",
        "10",
        "2",
        "Arda",
        "Z",
        "_internal",
        "a",
        "arda",
        "karda",
        "z",
      ],
    };
    for (const scopeCodes of [codes, [...codes].reverse()]) {
      expect(
        normalizeBatch({
          ...base,
          kind: "extension",
          effect: { extend_days: 30, applicable_product_codes: scopeCodes },
        }).effect,
      ).toEqual(expected);
    }
    expect(JSON.stringify(codes)).toBe(original);
  });
  it("accepts bounded extensions and rejects unsupported or ambiguous scopes", () => {
    expect(
      normalizeBatch({
        ...base,
        kind: "extension",
        effect: {
          extend_days: 30,
          applicable_product_codes: ["karda", "arda"],
        },
      }).effect,
    ).toEqual({
      effect_version: 1,
      currency: "CNY",
      extend_days: 30,
      applicable_product_codes: ["arda", "karda"],
    });
    expect(
      normalizeBatch({ ...base, kind: "extension", effect: { extend_days: 1 } })
        .returnPolicy,
    ).toBe("none");
    for (const effect of [
      { extend_days: 0 },
      { extend_days: 1.1 },
      { extend_days: 3651 },
      { extend_days: "30" },
      { extend_days: 30, reset_quota: true },
      { extend_days: 30, applicable_product_codes: [] },
      { extend_days: 30, applicable_product_codes: ["arda", "arda"] },
      { extend_days: 30, applicable_product_codes: [null] },
      { extend_days: 30, applicable_product_codes: null },
      { extend_days: 30, applicable_product_codes: ["bad code"] },
    ])
      expect(() =>
        normalizeBatch({ ...base, kind: "extension", effect }),
      ).toThrow();
    expect(() =>
      normalizeBatch({
        ...base,
        kind: "extension",
        effect: { extend_days: 30 },
        returnPolicy: "full_reversal_only",
      }),
    ).toThrow();
  });
  it("requires a fixed published-version selector, bounded days and noncash funding", () => {
    const effect = {
      plan_version_id: "11111111-1111-4111-8111-111111111111",
      duration_days: 30,
      funding_source: "operator_grant",
    };
    expect(
      normalizeBatch({ ...base, kind: "redemption", effect }).effect,
    ).toMatchObject(effect);
    for (const change of [
      { duration_days: 0 },
      { duration_days: 1.5 },
      { duration_days: 3651 },
      { funding_source: "offline" },
      { offline_payment_required: true },
      { payment_id: "arbitrary" },
      { plan_version_id: "bad" },
      { durationDays: 30 },
    ])
      expect(() =>
        normalizeBatch({
          ...base,
          kind: "redemption",
          effect: { ...effect, ...change },
        }),
      ).toThrow();
    expect(() =>
      normalizeBatch({
        ...base,
        kind: "redemption",
        effect,
        returnPolicy: "full_reversal_only",
      }),
    ).toThrow();
  });
  it("normalizes supported legacy aliases into versioned snake_case", () => {
    expect(normalizeBatch({ ...base, effect: { amountCents: 1000 } })).toEqual(
      normalizeBatch(base),
    );
    expect(normalizeBatch(base).effect).toEqual({
      effect_version: 1,
      currency: "CNY",
      amount_cents: 1000,
    });
    expect(normalizeBatch(base).returnPolicy).toBe("none");
  });
  it.each([0, -1, 1.01, Number.POSITIVE_INFINITY, 1_000_000_000_000])(
    "rejects invalid monetary face %s",
    (amount) => {
      expect(() =>
        normalizeBatch({ ...base, effect: { amount_cents: amount } }),
      ).toThrow();
    },
  );
  it("refuses conflicting aliases, unknown versions, currencies and unsupported gates", () => {
    for (const effect of [
      { amount_cents: 1000, amountCents: 2000 },
      { amount_cents: 1000, effect_version: 2 },
      { amount_cents: 1000, currency: "USD" },
      { amount_cents: 1000, min_user_level: 1 },
    ])
      expect(() => normalizeBatch({ ...base, effect })).toThrow();
  });
  it("requires claim deadlines within the batch window and positive relative limits", () => {
    for (const claimUntil of [base.validFrom, "2026-12-20T00:00:00Z"])
      expect(() => normalizeBatch({ ...base, claimUntil })).toThrow();
    expect(() =>
      normalizeBatch({ ...base, claimUntil: base.validUntil }),
    ).not.toThrow();
    expect(() => normalizeBatch({ ...base, useValidDays: 0 })).toThrow();
    expect(() => normalizeBatch({ ...base, perWorkspaceLimit: -1 })).toThrow();
    expect(() => normalizeBatch({ ...base, perTenantLimit: 1.5 })).toThrow();
  });
  it("rejects legacy recharge effects and keeps invitations nonfinancial", () => {
    expect(() =>
      normalizeBatch({
        ...base,
        kind: "recharge_card" as BatchConfiguration["kind"],
      }),
    ).toThrow("未启用");
    expect(() =>
      normalizeBatch({
        ...base,
        kind: "invite",
        effect: { plan_code: "arda-private" },
        returnPolicy: "full_reversal_only",
      }),
    ).toThrow("返券政策");
    expect(() =>
      normalizeBatch({
        ...base,
        kind: "invite",
        effect: { plan_version_id: "not-a-uuid" },
      }),
    ).toThrow("非法");
  });
});

// ===========================================================================
// Principal and gift input gates protect cash classification.
// ===========================================================================
describe("recharge configuration", () => {
  it.each([
    { face_value_cents: -1, bonus_cents: 100 },
    { face_value_cents: 1.5, bonus_cents: 100 },
    { face_value_cents: 0, bonus_cents: 0 },
    { face_value_cents: 1, bonus_cents: -1 },
    { face_value_cents: 1, bonus_cents: 0, bonus_expires_in_days: 90 },
    { face_value_cents: 1, bonus_cents: 1, bonus_expires_in_days: 0 },
    { face_value_cents: 1, bonus_cents: 1, bonus_expires_in_days: 1.5 },
    { face_value_cents: 1, bonus_cents: 1, currency: "USD" },
    { face_value_cents: 1, bonus_cents: 1, effect_version: 2 },
    { face_value_cents: 1, bonus_cents: 1, payment_id: "forged" },
    { face_value_cents: 999999999999, bonus_cents: 1 },
  ])("rejects unsupported or ambiguous money %j", (effect) => {
    expect(() =>
      normalizeBatch({ ...base, kind: "recharge_card", effect }),
    ).toThrow();
  });
  it("allows a gift without reclassifying it as principal", () => {
    expect(
      normalizeBatch({
        ...base,
        kind: "recharge_card",
        effect: {
          face_value_cents: 0,
          bonus_cents: 100,
          bonus_expires_in_days: 90,
        },
      }).effect,
    ).toEqual({
      effect_version: 1,
      currency: "CNY",
      face_value_cents: 0,
      bonus_cents: 100,
      bonus_expires_in_days: 90,
    });
  });
});
