/**
 * promotion.router.spec.ts - Customer voucher read contract and monetary units.
 * @package @vxture/bff-console
 * @layer Application
 * @category Test
 * @author AI-Generated
 * @date 2026-11-19
 */
import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import type { Pool } from "pg";
import type Redis from "ioredis";
import type { VxConfigService } from "@vxture/core-config";
// ⚠️ 跨层引用: the BFF consumes the public domain service and ledger DTO.
import type {
  PromotionService,
  TenantVoucherRecord,
} from "@vxture/service-promotion";
import type { RequestContext } from "../types/console.types";
import { PromotionRouter } from "./promotion.router";
import { HEADERS_METADATA } from "@nestjs/common/constants";
import { ACCESS_POLICY, evaluateAccessPolicy } from "../auth/capability";

// ============================================================================
// Read-only route fixture
// ============================================================================

const request = {
  tenant: { id: "tenant" },
  user: { id: "user" },
} as unknown as Request & RequestContext;

const record = (
  overrides: Partial<TenantVoucherRecord> = {},
): TenantVoucherRecord => ({
  voucherId: "voucher",
  code: "VX-TEST",
  kind: "credit_voucher",
  batchName: "Batch",
  effect: { amount_cents: 5000, currency: "CNY" },
  status: "assigned",
  displayStatus: "available",
  availabilityStatus: "available",
  usedCount: 0,
  maxUses: 1,
  validFrom: new Date("2026-11-01T00:00:00Z"),
  expiresAt: new Date("2026-12-01T00:00:00Z"),
  redeemedAt: null,
  redemptionNo: null,
  ...overrides,
});

async function readVoucher(overrides: Partial<TenantVoucherRecord> = {}) {
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: [{ id: "workspace" }] })
    .mockResolvedValue({ rows: [] });
  const listTenantVouchers = vi.fn().mockResolvedValue([record(overrides)]);
  const router = new PromotionRouter(
    { query } as unknown as Pool,
    { listTenantVouchers } as unknown as PromotionService,
  );
  const rows = await router.listVouchers(request);
  expect(listTenantVouchers).toHaveBeenCalledWith({
    tenantId: "tenant",
    workspaceId: "workspace",
    userId: "user",
  });
  return rows[0]!;
}

// ============================================================================
// Amounts are converted once, at the BFF boundary
// ============================================================================

describe("voucher monetary DTO", () => {
  it("converts stored snake_case credit cents to yuan", async () => {
    expect(await readVoucher()).toMatchObject({
      amount: "50.00",
      currency: "CNY",
    });
  });

  it("keeps percent reductions as percent and converts the cap to yuan", async () => {
    expect(
      await readVoucher({
        kind: "discount",
        effect: { discount_type: "percent", value: 20, max_off_cents: 12345 },
      }),
    ).toMatchObject({
      discountType: "percent",
      discountValue: 20,
      maxOff: "123.45",
      currency: "CNY",
    });
  });

  it("converts fixed reduction cents to yuan exactly once", async () => {
    expect(
      await readVoucher({
        kind: "discount",
        effect: { discount_type: "fixed", value: 1250 },
      }),
    ).toMatchObject({
      discountType: "fixed",
      discountValue: 12.5,
      maxOff: null,
    });
  });

  it("supports legacy camelCase fields without overriding canonical fields", async () => {
    expect(await readVoucher({ effect: { amountCents: 999 } })).toMatchObject({
      amount: "9.99",
    });
    expect(
      await readVoucher({ effect: { amount_cents: 1200, amountCents: 999 } }),
    ).toMatchObject({ amount: "12.00" });
    expect(
      await readVoucher({
        kind: "discount",
        effect: { discountType: "fixed", value: 1000, maxOffCents: 500 },
      }),
    ).toMatchObject({
      discountType: "fixed",
      discountValue: 10,
      maxOff: "5.00",
    });
  });

  it("reads recharge face value and explicit currency without enabling redemption", async () => {
    expect(
      await readVoucher({
        kind: "recharge_card",
        availabilityStatus: "unavailable",
        effect: { face_value_cents: 12000, bonus_cents: 1000, currency: "USD" },
      }),
    ).toMatchObject({
      amount: "120.00",
      currency: "USD",
      availabilityStatus: "unavailable",
    });
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "1000"])(
    "does not throw or publish invalid cents %s",
    async (amount) => {
      expect(
        await readVoucher({ effect: { amount_cents: amount } }),
      ).not.toHaveProperty("amount");
    },
  );

  it("omits malformed discount amounts instead of breaking the whole ledger", async () => {
    const view = await readVoucher({
      kind: "discount",
      effect: { discount_type: "fixed", value: -100, max_off_cents: -1 },
    });
    expect(view).not.toHaveProperty("discountValue");
    expect(view.maxOff).toBeNull();
  });
});

// ============================================================================
// Additive states and all six voucher kinds
// ============================================================================

describe("voucher presentation contract", () => {
  it("prevents caching claim credentials, results and the scoped ledger", () => {
    for (const handler of [
      PromotionRouter.prototype.previewClaim,
      PromotionRouter.prototype.claimVoucher,
      PromotionRouter.prototype.claimResult,
      PromotionRouter.prototype.voucherPage,
      PromotionRouter.prototype.previewRedemption,
      PromotionRouter.prototype.redeemSubscription,
      PromotionRouter.prototype.redemptionResult,
      PromotionRouter.prototype.previewExtension,
      PromotionRouter.prototype.extendSubscription,
      PromotionRouter.prototype.previewRecharge,
      PromotionRouter.prototype.redeemRecharge,
      PromotionRouter.prototype.rechargeResult,
      PromotionRouter.prototype.extensionResult,
    ])
      expect(Reflect.getMetadata(HEADERS_METADATA, handler)).toContainEqual({
        name: "Cache-Control",
        value: "no-store",
      });
  });
  it("uses the verified active workspace instead of the default workspace", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const listTenantVouchers = vi.fn().mockResolvedValue([]);
    await new PromotionRouter(
      { query } as unknown as Pool,
      { listTenantVouchers } as unknown as PromotionService,
    ).listVouchers({
      ...request,
      activeWorkspaceId: "actual-workspace",
    } as unknown as Request & RequestContext);
    expect(query).not.toHaveBeenCalled();
    expect(listTenantVouchers).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "actual-workspace" }),
    );
  });
  it.each(["not_started", "paused", "archived"] as const)(
    "adds %s without expanding legacy status",
    async (availabilityStatus) => {
      expect(
        await readVoucher({ displayStatus: "expired", availabilityStatus }),
      ).toMatchObject({
        status: "expired",
        availabilityStatus,
        validFrom: "2026-11-01T00:00:00.000Z",
      });
    },
  );

  it("shows invitations as purchase access rather than a monetary coupon", async () => {
    const view = await readVoucher({
      kind: "invite",
      effect: { planCode: "private-pro" },
    });
    expect(view.kind).toBe("invite");
    expect(view).not.toHaveProperty("amount");
    expect(view).not.toHaveProperty("discountValue");
  });

  it.each([
    {
      kind: "redemption" as const,
      effect: { duration_days: 365 },
      expected: { durationDays: 365 },
    },
    {
      kind: "extension" as const,
      effect: { extend_days: 30 },
      expected: { extendDays: 30 },
    },
  ])(
    "presents the non-cash effect for $kind",
    async ({ kind, effect, expected }) => {
      expect(
        await readVoucher({ kind, effect, availabilityStatus: "unavailable" }),
      ).toMatchObject({ ...expected, availabilityStatus: "unavailable" });
    },
  );

  it("retains terminal state and historical references", async () => {
    expect(
      await readVoucher({
        status: "redeemed",
        displayStatus: "redeemed",
        availabilityStatus: "redeemed",
        redeemedAt: new Date("2026-11-10T08:00:00Z"),
        redemptionNo: "RDM-TEST",
      }),
    ).toMatchObject({
      status: "redeemed",
      availabilityStatus: "redeemed",
      redemptionNo: "RDM-TEST",
      redeemedAt: "2026-11-10T08:00:00.000Z",
    });
  });
});

// ===========================================================================
// Shared user/source throttling runs before credential lookups and fails closed.
// ===========================================================================
describe("claim endpoint guards", () => {
  it("requires billing management for subscription preview and confirmation", () => {
    for (const handler of [
      PromotionRouter.prototype.previewRedemption,
      PromotionRouter.prototype.redeemSubscription,
      PromotionRouter.prototype.previewExtension,
      PromotionRouter.prototype.extendSubscription,
    ]) {
      const policy = Reflect.getMetadata(ACCESS_POLICY, handler);
      expect(policy).toEqual({
        kind: "capability",
        anyOf: ["tenant.billing.manage"],
      });
      expect(() =>
        evaluateAccessPolicy(policy, {
          ...request,
          capabilities: ["tenant.billing.read"],
        } as Request & RequestContext),
      ).toThrow("Missing capability");
      expect(
        evaluateAccessPolicy(policy, {
          ...request,
          capabilities: ["tenant.billing.manage"],
        } as Request & RequestContext),
      ).toBe(true);
    }
  });
  const req = {
    ...request,
    activeWorkspaceId: "33333333-3333-4333-8333-333333333333",
    ip: "127.0.0.1",
  } as Request & RequestContext;
  const config = {
    auth: {
      VOUCHER_CLAIM_ACTIVE_KEY: "k1",
      VOUCHER_CLAIM_KEYS: JSON.stringify({ k1: "ab".repeat(32) }),
    },
  } as unknown as VxConfigService;
  it("requires an authenticated tenant context before consulting rate storage", async () => {
    const evalRate = vi.fn(),
      query = vi.fn();
    const router = new PromotionRouter(
      { query } as unknown as Pool,
      {} as PromotionService,
      config,
      { eval: evalRate } as unknown as Redis,
    );
    await expect(
      router.previewClaim({} as Request & RequestContext, {
        secret: "VX-visible",
      }),
    ).rejects.toThrow("session");
    expect(evalRate).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
  it("applies distributed user and source limits without storing the secret", async () => {
    const evalRate = vi.fn().mockResolvedValue(0),
      query = vi.fn();
    const router = new PromotionRouter(
      { query } as unknown as Pool,
      {} as PromotionService,
      config,
      { eval: evalRate } as unknown as Redis,
    );
    await expect(
      router.previewClaim(req, { secret: "confidential-example" }),
    ).rejects.toMatchObject({ status: 429 });
    expect(evalRate.mock.calls[0]![1]).toBe(2);
    expect(JSON.stringify(evalRate.mock.calls)).not.toContain(
      "confidential-example",
    );
    expect(query).not.toHaveBeenCalled();
  });
  it("fails closed when rate storage is unavailable", async () => {
    const router = new PromotionRouter(
      { query: vi.fn() } as unknown as Pool,
      {} as PromotionService,
      config,
      {
        eval: vi.fn().mockRejectedValue(new Error("offline")),
      } as unknown as Redis,
    );
    await expect(
      router.previewClaim(req, { secret: "x" }),
    ).rejects.toMatchObject({ status: 503 });
  });
});
