import { describe, expect, it } from "vitest";
import {
  buildQuotaPoolView,
  buildSubscriptionFacts,
  EXPIRED_DATA_RETENTION_DAYS,
  mergeSaleAxes,
  needsReset,
  parseEntitlementQuery,
  pickRepresentative,
  strategyKey,
  type ComponentRow,
  type PoolRow,
  type SubscriptionFactsRow,
} from "./entitlement-view";

const row = (partial: Partial<ComponentRow>): ComponentRow => ({
  productCode: "arda",
  tierCode: "free",
  role: "primary",
  features: null,
  quota: null,
  ...partial,
});

describe("mergeSaleAxes (v2 sale axes, §11.3 heritage)", () => {
  it("returns the never-covered fallback for zero components (§11.4)", () => {
    expect(mergeSaleAxes([], {})).toEqual({
      tier: null,
      bundled: false,
      limits: {},
    });
  });

  it("merges tier to the highest rank across components", () => {
    const axes = mergeSaleAxes(
      [
        row({ tierCode: "free" }),
        row({ tierCode: "pro" }),
        row({ tierCode: "starter" }),
      ],
      {},
    );
    expect(axes.tier).toBe("pro");
  });

  it("keeps an unknown tier code only when nothing ranked beats it", () => {
    expect(mergeSaleAxes([row({ tierCode: "mystery" })], {}).tier).toBe(
      "mystery",
    );
    expect(
      mergeSaleAxes(
        [row({ tierCode: "mystery" }), row({ tierCode: "free" })],
        {},
      ).tier,
    ).toBe("free");
  });

  it("bundled (D6): tier=null carries the bundled flag, not a tier value", () => {
    // bundled-only coverage: tier stays null, bundled flag raised
    const b = mergeSaleAxes([row({ role: "bundled", tierCode: null })], {});
    expect(b.tier).toBeNull();
    expect(b.bundled).toBe(true);
    // standalone free: tier=free, not bundled
    const f = mergeSaleAxes([row({ role: "primary", tierCode: "free" })], {});
    expect(f.tier).toBe("free");
    expect(f.bundled).toBe(false);
    // coexistence: both facts survive (tier from primary, bundled=true)
    const both = mergeSaleAxes(
      [
        row({ role: "bundled", tierCode: null, quota: { "dataset.max": 500 } }),
        row({
          role: "primary",
          tierCode: "free",
          quota: { "dataset.max": 50 },
        }),
      ],
      {},
    );
    expect(both.tier).toBe("free");
    expect(both.bundled).toBe(true);
    expect(both.limits["dataset.max"]).toBe(500); // max merges across both components
    // member.max = max(0 bundled, 1 primary) = 1 — seat comes from the standalone
    const seats = mergeSaleAxes(
      [
        row({ role: "bundled", tierCode: null, quota: { "member.max": 0 } }),
        row({ role: "primary", tierCode: "free", quota: { "member.max": 1 } }),
      ],
      {},
    );
    expect(seats.limits["member.max"]).toBe(1);
  });

  it("-1 is the unlimited sentinel and beats any finite max", () => {
    const axes = mergeSaleAxes(
      [
        row({ tierCode: "business", quota: { "dataset.max": -1 } }),
        row({ tierCode: "starter", quota: { "dataset.max": 500 } }),
      ],
      {},
    );
    expect(axes.limits["dataset.max"]).toBe(-1);
    // order-independent
    const axes2 = mergeSaleAxes(
      [
        row({ tierCode: "starter", quota: { "dataset.max": 500 } }),
        row({ tierCode: "business", quota: { "dataset.max": -1 } }),
      ],
      {},
    );
    expect(axes2.limits["dataset.max"]).toBe(-1);
  });

  it("takes the numeric max for max-strategy limits", () => {
    const axes = mergeSaleAxes(
      [
        row({ quota: { "storage.max": 10, "member.max": 20 } }),
        row({ quota: { "storage.max": 100, "member.max": 5 } }),
      ],
      { [strategyKey("arda", "storage.max")]: "max" },
    );
    expect(axes.limits["storage.max"]).toBe(100);
    expect(axes.limits["member.max"]).toBe(20); // absent strategy defaults to max
  });

  it("excludes pool-strategy metrics from limits", () => {
    const axes = mergeSaleAxes(
      [row({ quota: { "doc.words": 500000, "member.max": 5 } })],
      { [strategyKey("arda", "doc.words")]: "pool" },
    );
    expect(axes.limits).not.toHaveProperty("doc.words");
    expect(axes.limits["member.max"]).toBe(5);
  });

  it("D12: functional keys (union/tiered strategies, features) never leave the platform", () => {
    const axes = mergeSaleAxes(
      [
        row({
          tierCode: "business",
          features: ["a.enabled"],
          quota: {
            "sync.frequency": "realtime",
            regions: ["cn", "sg"],
            "member.max": 20,
          },
        }),
      ],
      {
        [strategyKey("arda", "sync.frequency")]: "tiered",
        [strategyKey("arda", "regions")]: "union",
      },
    );
    expect(axes.limits).toEqual({ "member.max": 20 });
    expect(axes).not.toHaveProperty("features");
  });
});

describe("pickRepresentative + buildSubscriptionFacts (v2 subscription facts)", () => {
  const sub = (
    partial: Partial<SubscriptionFactsRow>,
  ): SubscriptionFactsRow => ({
    productCode: "arda",
    status: "active",
    trialEndAt: null,
    endAt: new Date("2026-08-01T00:00:00Z"),
    autoRenew: true,
    ...partial,
  });

  it("no rows → the never-subscribed projection (all null, D10)", () => {
    expect(buildSubscriptionFacts(pickRepresentative([]))).toEqual({
      status: null,
      trial_ends_at: null,
      current_period_end: null,
      cancel_at_period_end: false,
      data_retention_until: null,
    });
  });

  it("precedence = the @shared array order (active beats trialing beats expired)", () => {
    expect(
      pickRepresentative([
        sub({ status: "expired" }),
        sub({ status: "trialing" }),
        sub({ status: "active" }),
      ])?.status,
    ).toBe("active");
    // suspended outranks expired on purpose: an operator freeze is not
    // masked by an older lapsed row.
    expect(
      pickRepresentative([
        sub({ status: "expired" }),
        sub({ status: "suspended" }),
      ])?.status,
    ).toBe("suspended");
  });

  it("tie on status → latest period end wins; open end counts as latest", () => {
    expect(
      pickRepresentative([
        sub({ status: "active", endAt: new Date("2026-08-01T00:00:00Z") }),
        sub({ status: "active", endAt: new Date("2026-09-01T00:00:00Z") }),
      ])?.endAt?.toISOString(),
    ).toBe("2026-09-01T00:00:00.000Z");
    expect(
      pickRepresentative([
        sub({ status: "active", endAt: new Date("2026-09-01T00:00:00Z") }),
        sub({ status: "active", endAt: null }),
      ])?.endAt,
    ).toBeNull();
  });

  it("facts come from ONE representative — a lower-precedence trial leaks no timestamp", () => {
    const facts = buildSubscriptionFacts(
      pickRepresentative([
        sub({ status: "active", endAt: new Date("2026-08-01T00:00:00Z") }),
        sub({
          status: "trialing",
          trialEndAt: new Date("2026-07-20T00:00:00Z"),
        }),
      ]),
    );
    expect(facts.status).toBe("active");
    expect(facts.current_period_end).toBe("2026-08-01T00:00:00.000Z");
    expect(facts.trial_ends_at).toBeNull(); // no mixed-subscription story
  });

  it("trialing → trial_ends_at; active bounded no-renew → cancel_at_period_end", () => {
    const trial = buildSubscriptionFacts(
      sub({
        status: "trialing",
        trialEndAt: new Date("2026-07-20T00:00:00Z"),
        autoRenew: false,
      }),
    );
    expect(trial.trial_ends_at).toBe("2026-07-20T00:00:00.000Z");
    expect(trial.current_period_end).toBeNull();
    expect(trial.cancel_at_period_end).toBe(false); // trials never auto-renew; the flag is an active-state fact

    const cancelling = buildSubscriptionFacts(
      sub({ status: "active", autoRenew: false }),
    );
    expect(cancelling.cancel_at_period_end).toBe(true);
    const perpetual = buildSubscriptionFacts(
      sub({ status: "active", endAt: null, autoRenew: false }),
    );
    expect(perpetual.cancel_at_period_end).toBe(false); // nothing scheduled to lapse
  });

  it("expired → data_retention_until = lapse + 90d (promise floor)", () => {
    const facts = buildSubscriptionFacts(
      sub({ status: "expired", endAt: new Date("2026-07-01T00:00:00Z") }),
    );
    const expected = new Date(
      Date.UTC(2026, 6, 1) + EXPIRED_DATA_RETENTION_DAYS * 86_400_000,
    ).toISOString();
    expect(facts.data_retention_until).toBe(expected);
    expect(facts.current_period_end).toBeNull();
  });
});

describe("buildQuotaPoolView (§11.3 path B, period-aware read)", () => {
  const pool = (partial: Partial<PoolRow>): PoolRow => ({
    productCode: "arda",
    metricKey: "doc.words",
    quotaLimit: "1000",
    quotaUsed: "400",
    priority: 10,
    resetPeriod: "none",
    currentPeriodStart: null,
    ...partial,
  });

  it("computes remaining = limit - used for non-resetting pools", () => {
    expect(buildQuotaPoolView([pool({})])).toEqual([
      { metric: "doc.words", limit: 1000, remaining: 600, priority: 10 },
    ]);
  });

  it("clamps remaining at zero", () => {
    expect(
      buildQuotaPoolView([pool({ quotaUsed: "1500" })])[0]!.remaining,
    ).toBe(0);
  });

  it("reads a rolled-over monthly pool as full without writing", () => {
    const now = new Date("2026-07-07T00:00:00Z");
    const views = buildQuotaPoolView(
      [
        pool({
          resetPeriod: "month",
          currentPeriodStart: new Date("2026-06-01T00:00:00Z"),
        }),
      ],
      now,
    );
    expect(views[0]!.remaining).toBe(1000);
  });

  it("keeps used amounts inside the current period", () => {
    const now = new Date("2026-07-07T10:00:00Z");
    const views = buildQuotaPoolView(
      [
        pool({
          resetPeriod: "day",
          currentPeriodStart: new Date("2026-07-07T00:00:00Z"),
        }),
      ],
      now,
    );
    expect(views[0]!.remaining).toBe(600);
  });
});

describe("needsReset parity with the consume path", () => {
  const now = new Date("2026-07-07T12:00:00Z");
  it("null period start always resets", () => {
    expect(needsReset("day", null, now)).toBe(true);
  });
  it("day: different UTC date resets", () => {
    expect(needsReset("day", new Date("2026-07-06T23:59:59Z"), now)).toBe(true);
    expect(needsReset("day", new Date("2026-07-07T00:00:00Z"), now)).toBe(
      false,
    );
  });
  it("month: same month holds, previous month resets", () => {
    expect(needsReset("month", new Date("2026-07-01T00:00:00Z"), now)).toBe(
      false,
    );
    expect(needsReset("month", new Date("2026-06-30T00:00:00Z"), now)).toBe(
      true,
    );
  });
});

describe("parseEntitlementQuery (§11.7 params)", () => {
  const W = "11111111-2222-3333-4444-555555555555";

  it("parses the single-product form", () => {
    expect(parseEntitlementQuery({ workspace_id: W, product: "arda" })).toEqual(
      { workspaceId: W, productCodes: ["arda"], single: true },
    );
  });

  it("parses the batch form and dedupes", () => {
    expect(
      parseEntitlementQuery({ workspace_id: W, products: "arda,runos,arda" }),
    ).toEqual({
      workspaceId: W,
      productCodes: ["arda", "runos"],
      single: false,
    });
  });

  it("rejects a malformed workspace_id", () => {
    expect(() =>
      parseEntitlementQuery({ workspace_id: "not-a-uuid", product: "arda" }),
    ).toThrow("invalid_workspace_id");
  });

  it("requires exactly one of product / products", () => {
    expect(() => parseEntitlementQuery({ workspace_id: W })).toThrow(
      "product_or_products_required",
    );
    expect(() =>
      parseEntitlementQuery({
        workspace_id: W,
        product: "arda",
        products: "runos",
      }),
    ).toThrow("product_or_products_required");
  });

  it("rejects malformed product codes", () => {
    expect(() =>
      parseEntitlementQuery({ workspace_id: W, product: "Arda!" }),
    ).toThrow("invalid_product_code");
  });

  it("caps the batch size", () => {
    const many = Array.from({ length: 21 }, (_, i) => `p${i}`).join(",");
    expect(() =>
      parseEntitlementQuery({ workspace_id: W, products: many }),
    ).toThrow("too_many_products");
  });
});
