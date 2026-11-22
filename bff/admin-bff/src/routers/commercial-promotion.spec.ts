/**
 * commercial-promotion.spec.ts - Compatible, structured promotion list projections.
 * @package @vxture/bff-admin
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-22
 */
import { describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import type { Pool } from "pg";
import type { RequestContext } from "../types/console.types";
import { CommercialRouter } from "./commercial.router";

// ===========================================================================
// Read projections use deterministic rows and never connect to a database.
// ===========================================================================
const BATCH = "22222222-2222-4222-8222-222222222222";
const row = {
  id: BATCH,
  tenant_id: null,
  kind: "discount",
  name: "自建测试批次",
  code_prefix: "VX26-",
  effect: { discount_type: "percent", value: 20, max_off_cents: 1500 },
  total_count: "100",
  issued_count: "1",
  status: "active",
  redemption_count: "0",
  tenant_count: "0",
  owner_name: "Operator",
  valid_from: "2026-01-01T00:00:00Z",
  valid_until: "2099-01-01T00:00:00Z",
  updated_at: "2026-11-22T00:00:00Z",
};
function request(capabilities = ["promotion:campaign.read"]) {
  return {
    user: { id: "11111111-1111-4111-8111-111111111111" },
    capabilities,
  } as unknown as Request & RequestContext;
}
function fixture(overrides: Record<string, unknown> = {}) {
  const source = { ...row, ...overrides };
  const read = vi.fn(async (sql: string) => ({
    rows: sql.includes("select count(*)::int total")
      ? [{ total: 1, active: 1, redemptions: 0, tenants: 0, coupons: 0 }]
      : [source],
  }));
  const write = vi.fn();
  const connect = vi.fn();
  const router = new CommercialRouter(
    { query: read } as unknown as Pool,
    { query: write, connect } as unknown as Pool,
  );
  return { router, read, write, connect, source };
}

// ===========================================================================
// Both list endpoints retain legacy fields while adding language-neutral data.
// ===========================================================================
describe("structured promotion list projection", () => {
  it.each([
    ["discount", { discount_type: "percent", value: 20 }],
    ["credit_voucher", { amount_cents: 1234 }],
    ["invite", { planCode: "arda-private" }],
    ["redemption", { duration_days: 30 }],
    ["extension", { extend_days: 7, applicable_product_codes: ["karda"] }],
    ["recharge_card", { face_value_cents: 1000, bonus_cents: 500 }],
  ])(
    "returns structured %s effects on both existing lists",
    async (kind, effect) => {
      const f = fixture({ kind, effect });
      const page = await f.router.listPromotionsPage(request());
      const all = await f.router.listPromotions(
        request(["commerce:billing.read"]),
      );
      for (const record of [page.items[0], all[0]])
        expect(record).toMatchObject({
          id: BATCH,
          promotionCode: "VX26-",
          codePrefix: "VX26-",
          promotionName: row.name,
          kind,
          effect,
          tenantId: null,
          scopeLabel: "平台级",
          issuedCount: 1,
          totalCount: 100,
        });
      expect(page).toMatchObject({ total: 1, page: 1, pageSize: 20 });
      expect(f.write).not.toHaveBeenCalled();
      expect(f.connect).not.toHaveBeenCalled();
    },
  );

  it("retains legacy Chinese labels without using them as structured effects", async () => {
    const f = fixture();
    const page = await f.router.listPromotionsPage(request());
    expect(page.items[0]).toMatchObject({
      discountLabel: "折扣券 · 立减 20%（封顶 ¥15.00）",
      description: "折扣券 立减 20%（封顶 ¥15.00） · 已发 1/100",
      requiresCashFunding: false,
    });
  });

  it("distinguishes a missing prefix from the legacy UUID fallback", async () => {
    const f = fixture({ code_prefix: null, tenant_id: "target-tenant" });
    const page = await f.router.listPromotionsPage(request());
    expect(page.items[0]).toMatchObject({
      promotionCode: BATCH,
      codePrefix: null,
      tenantId: "target-tenant",
      scopeLabel: "定向租户",
    });
  });

  it.each([null, "invalid", [1000]])(
    "marks non-object effects %j as unavailable",
    async (effect) => {
      const f = fixture({ effect });
      expect(
        (await f.router.listPromotionsPage(request())).items[0]?.effect,
      ).toBeNull();
    },
  );

  it("preserves paid-card funding flags and zero-principal bonus semantics", async () => {
    for (const principal of [0, 1000]) {
      const f = fixture({
        kind: "recharge_card",
        effect: { face_value_cents: principal, bonus_cents: 500 },
      });
      expect(
        (await f.router.listPromotionsPage(request())).items[0]
          ?.requiresCashFunding,
      ).toBe(principal > 0);
    }
  });

  it("rejects unauthenticated, unauthorized and invalid reads before storage", async () => {
    const f = fixture();
    await expect(
      f.router.listPromotionsPage({ capabilities: [] } as unknown as Request &
        RequestContext),
    ).rejects.toThrow("No active session");
    await expect(f.router.listPromotionsPage(request([]))).rejects.toThrow(
      "Missing capability",
    );
    await expect(f.router.listPromotionsPage(request(), "0")).rejects.toThrow(
      "分页或筛选参数非法",
    );
    expect(f.read).not.toHaveBeenCalled();
    expect(f.write).not.toHaveBeenCalled();
    expect(f.connect).not.toHaveBeenCalled();
  });
});
