/**
 * invite-voucher.spec.ts - Invitation validation and operator command guards.
 * @package @vxture/bff-admin
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-19
 */
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { Request } from "express";
import { CommercialRouter } from "./commercial.router";
import type { RequestContext } from "../types/console.types";
import { REQUIRE_STEP_UP } from "../auth/step-up.decorator";
import { HEADERS_METADATA } from "@nestjs/common/constants";

// ===========================================================================
// Transaction fixtures; production SQL and concurrency run in the opt-in suite.
// ===========================================================================
const OPERATOR = "11111111-1111-4111-8111-111111111111";
const BATCH = "22222222-2222-4222-8222-222222222222";
function request(capabilities = ["promotion:campaign.manage"]) {
  return { user: { id: OPERATOR }, capabilities } as unknown as Request &
    RequestContext;
}
const body = {
  kind: "invite" as const,
  name: "Invitation draft",
  effect: { planCode: "arda-private" },
  totalCount: 10,
  validFrom: "2026-01-01T00:00:00Z",
  validUntil: "2099-01-01T00:00:00Z",
  idempotencyKey: "create-1",
  reason: "Private preview",
};
function fixture(plan: object | undefined, kind = "invite") {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("from product.plans"))
      return { rows: plan ? [plan] : [], rowCount: plan ? 1 : 0 };
    if (sql.includes("from promotion.voucher_batches where id"))
      return {
        rows: [
          {
            id: BATCH,
            kind,
            name: "Batch",
            status: "active",
            tenant_id: OPERATOR,
            code_prefix: null,
            effect: { amount_cents: 1000 },
            total_count: 10,
            issued_count: 0,
            per_user_limit: 1,
            valid_from: new Date("2026-01-01"),
            valid_until: new Date("2099-01-01"),
          },
        ],
        rowCount: 1,
      };
    if (sql.includes("from tenancy.tenants"))
      return { rows: [{ id: OPERATOR }], rowCount: 1 };
    if (sql.includes("filter (where assigned_user_id"))
      return {
        rows: [{ users: "0", workspaces: "0", tenants: "0" }],
        rowCount: 1,
      };
    return { rows: [], rowCount: 1 };
  });
  const release = vi.fn();
  const pool = {
    query,
    connect: vi.fn(async () => ({ query, release })),
  } as unknown as Pool;
  return { query, release, pool, router: new CommercialRouter(pool, pool) };
}

// ===========================================================================
// Validation must fail before durable effects; successful creates remain draft.
// ===========================================================================
describe("operator voucher commands", () => {
  it("retains step-up on every lifecycle write", () => {
    for (const handler of [
      CommercialRouter.prototype.createVoucherBatch,
      CommercialRouter.prototype.actOnVoucherBatch,
      CommercialRouter.prototype.assignVouchers,
      CommercialRouter.prototype.issueVoucherCredentials,
      CommercialRouter.prototype.revokeVoucher,
    ])
      expect(Reflect.getMetadata(REQUIRE_STEP_UP, handler)).toBe(true);
  });
  it("prevents caching the one-time credential response", () => {
    expect(
      Reflect.getMetadata(
        HEADERS_METADATA,
        CommercialRouter.prototype.issueVoucherCredentials,
      ),
    ).toContainEqual({ name: "Cache-Control", value: "no-store" });
  });
  it("requires management capability before issuing credentials", async () => {
    const f = fixture(undefined);
    await expect(
      f.router.issueVoucherCredentials(request([]), BATCH, {
        count: 1,
        idempotencyKey: "issue-1",
        reason: "Customer claim",
      }),
    ).rejects.toThrow();
    expect(f.pool.connect).not.toHaveBeenCalled();
  });
  it("fails closed before storage when the claim key ring is missing", async () => {
    const f = fixture(undefined);
    await expect(
      f.router.issueVoucherCredentials(request(), BATCH, {
        count: 1,
        idempotencyKey: "issue-1",
        reason: "Customer claim",
      }),
    ).rejects.toThrow("凭证配置不可用");
    expect(f.pool.connect).not.toHaveBeenCalled();
  });
  it("rejects a nonexistent invitation plan and rolls back", async () => {
    const f = fixture(undefined);
    await expect(f.router.createVoucherBatch(request(), body)).rejects.toThrow(
      "找不到套餐",
    );
    expect(
      f.query.mock.calls.some(([sql]) =>
        sql.includes("insert into promotion.voucher_batches"),
      ),
    ).toBe(false);
    expect(f.query).toHaveBeenCalledWith("rollback");
    expect(f.release).toHaveBeenCalled();
  });
  it("rejects invitations to public plans", async () => {
    const f = fixture({ plan_code: "arda-private", is_public: true });
    await expect(f.router.createVoucherBatch(request(), body)).rejects.toThrow(
      "本来就对外开放",
    );
  });
  it("creates a private invitation draft with receipt and audit", async () => {
    const f = fixture({ plan_code: "arda-private", is_public: false });
    const result = await f.router.createVoucherBatch(request(), body);
    expect(result.batchId).toMatch(/^[0-9a-f-]{36}$/);
    expect(f.query.mock.calls.some(([sql]) => sql.includes("'draft'"))).toBe(
      true,
    );
    expect(
      f.query.mock.calls.some(([sql]) =>
        sql.includes("insert into promotion.voucher_operations"),
      ),
    ).toBe(true);
    expect(
      f.query.mock.calls.some(([sql]) =>
        sql.includes("insert into promotion.voucher_events"),
      ),
    ).toBe(true);
  });
  it("rejects an empty invitation selector before connecting", async () => {
    const f = fixture(undefined);
    await expect(
      f.router.createVoucherBatch(request(), { ...body, effect: {} }),
    ).rejects.toThrow("planCode");
    expect(f.pool.connect).not.toHaveBeenCalled();
  });
  it("requires a personal or workspace target for invitations", async () => {
    const f = fixture(undefined);
    await expect(
      f.router.assignVouchers(request(), {
        batchId: BATCH,
        count: 1,
        idempotencyKey: "assign-1",
        reason: "Invite",
      }),
    ).rejects.toThrow("必须定向");
    expect(
      f.query.mock.calls.some(([sql]) =>
        sql.includes("insert into promotion.vouchers"),
      ),
    ).toBe(false);
  });
  it("keeps tenant shared credit vouchers supported", async () => {
    const f = fixture(undefined, "credit_voucher");
    const result = await f.router.assignVouchers(request(), {
      batchId: BATCH,
      count: 1,
      idempotencyKey: "assign-1",
      reason: "Tenant benefit",
    });
    expect(result.codes).toHaveLength(1);
    expect(f.query).toHaveBeenCalledWith("commit");
  });
  it("blocks writes without campaign management capability before storage", async () => {
    const f = fixture(undefined);
    await expect(
      f.router.actOnVoucherBatch(request(["commerce:billing.read"]), BATCH, {
        action: "review",
        expectedRevision: "1.000000",
        idempotencyKey: "review",
        reason: "Review",
      }),
    ).rejects.toThrow();
    await expect(
      f.router.revokeVoucher(request([]), BATCH, {
        idempotencyKey: "revoke",
        reason: "Withdraw",
      }),
    ).rejects.toThrow();
    expect(f.pool.connect).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Reporting distinguishes subscription benefits from paid invoice redemptions.
// ===========================================================================
describe("operator non-cash voucher reporting", () => {
  it.each([
    ["extension", { extend_days: 30 }, "展期 30 天"],
    ["redemption", { duration_days: 90 }, "兑换 90 天"],
  ])("shows the %s duration in the batch list", async (kind, effect, label) => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [{ id: BATCH, kind, effect, status: "active" }],
      })),
    } as unknown as Pool;
    const rows = await new CommercialRouter(pool, pool).listPromotions(
      request(["commerce:billing.read"]),
    );
    expect(rows[0]?.discountLabel).toContain(label);
  });
  it("does not turn an absent bill into a paid cash redemption", async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [
          {
            id: BATCH,
            redemption_no: "EV-B09",
            kind: "extension",
            effect_snapshot: { extend_days: 30 },
            subscription_id: OPERATOR,
            bill_id: null,
            bill_status: null,
            order_no: null,
          },
        ],
      })),
    } as unknown as Pool;
    const rows = await new CommercialRouter(
      pool,
      pool,
    ).listPromotionRedemptions(request(["commerce:billing.read"]));
    expect(rows[0]).toMatchObject({
      kind: "extension",
      benefitLabel: "展期 30 天",
      subscriptionId: OPERATOR,
      billId: "",
      billNo: "",
      billStatus: null,
      orderNo: null,
    });
  });
});
