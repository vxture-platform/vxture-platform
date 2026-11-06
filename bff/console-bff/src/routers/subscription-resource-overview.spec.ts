/**
 * Guard workspace resource totals and tenant billing summaries against misleading fallbacks.
 * @package @vxture/bff-console
 * @layer Application
 * @category Test
 * @author AI-Generated
 * @date 2026-11-06
 */
import "reflect-metadata";
import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import type {
  QuotaOverviewRows,
  QuotaPoolRow,
} from "@vxture/service-subscription"; // ⚠️ 跨层引用: use the domain read contract in API regression tests.
import { describe, expect, it, vi } from "vitest";
import {
  ACCESS_POLICY,
  evaluateAccessPolicy,
  type AccessPolicy,
} from "../auth/capability";
import type { RequestContext } from "../types/console.types";
import { SubscriptionRouter } from "./subscription.router";

// ============================================================================
// Independent resource sources and verified request scope
// ============================================================================
const TENANT = "11111111-1111-4111-8111-111111111111";
const WORKSPACE = "22222222-2222-4222-8222-222222222222";
const OTHER_WORKSPACE = "33333333-3333-4333-8333-333333333333";
const request = (workspace = WORKSPACE): Request & RequestContext =>
  ({
    user: { id: "user" },
    tenant: { id: TENANT, workspace, mode: "tenant", name: "Organization" },
    capabilities: ["tenant.billing.read"],
  }) as unknown as Request & RequestContext;

function pool(overrides: Partial<QuotaPoolRow> = {}): QuotaPoolRow {
  return {
    metricKey: "ai.credit",
    poolSource: "ws_base",
    productCode: null,
    productName: null,
    quotaLimit: 1000,
    effectiveUsed: 300,
    resetPeriod: "month",
    expiresAt: null,
    platformKind: null,
    grantReason: null,
    effectiveAt: null,
    ...overrides,
  };
}

function setup(
  rows: QuotaOverviewRows = { pools: [], gauges: [], sharing: [] },
) {
  const query = vi.fn(async (_sql: string, params: unknown[]) => ({
    rows: [{ id: params[1] ?? WORKSPACE }],
  }));
  const getQuotaOverviewRows = vi.fn(async (_workspace: string) => rows);
  const resolveWorkspaceEntitlements = vi.fn();
  const getCreditBalance = vi.fn(
    async (
      _tenant: string,
    ): Promise<{ balance: string; currency: string } | null> => null,
  );
  const getMonthlyPostpaidDue = vi.fn(
    async (
      _tenant: string,
    ): Promise<{ balance: string; currency: string }[]> => [],
  );
  const none = undefined as never;
  const router = new SubscriptionRouter(
    none,
    none,
    none,
    { getCreditBalance, getMonthlyPostpaidDue } as never,
    none,
    { query } as unknown as Pool,
    { resolveWorkspaceEntitlements } as never,
    none,
    { getQuotaOverviewRows } as never,
  );
  return {
    router,
    query,
    getQuotaOverviewRows,
    resolveWorkspaceEntitlements,
    getCreditBalance,
    getMonthlyPostpaidDue,
  };
}

// ============================================================================
// Resource aggregation and failures
// ============================================================================
describe("Console header workspace resources", () => {
  it("counts shared source pools once and reads storage from gauges", async () => {
    const { router, getQuotaOverviewRows, resolveWorkspaceEntitlements } =
      setup({
        pools: [
          pool(),
          pool({
            metricKey: "storage.bytes",
            quotaLimit: 500,
            effectiveUsed: 499,
          }),
        ],
        gauges: [
          {
            metricKey: "storage.bytes",
            productCode: "a",
            productName: "A",
            value: 100,
            observedAt: new Date(),
          },
          {
            metricKey: "storage.bytes",
            productCode: "b",
            productName: "B",
            value: 50,
            observedAt: new Date(),
          },
        ],
        sharing: ["a", "b", "c"].map((productCode) => ({
          metricKey: "ai.credit",
          productCode,
          productName: productCode,
        })),
      });
    await expect(router.getQuotaUsage(request())).resolves.toEqual({
      aiCredit: { used: 300, limit: 1000 },
      storage: { used: 150, limit: 500 },
    });
    expect(getQuotaOverviewRows).toHaveBeenCalledWith(WORKSPACE);
    expect(resolveWorkspaceEntitlements).not.toHaveBeenCalled();
  });

  it("includes additive product and workspace pools while using domain effective usage", async () => {
    const { router } = setup({
      pools: [
        pool({ effectiveUsed: 0 }),
        pool({ productCode: "a", quotaLimit: 200, effectiveUsed: 40 }),
      ],
      gauges: [],
      sharing: [],
    });
    expect((await router.getQuotaUsage(request())).aiCredit).toEqual({
      limit: 1200,
      used: 40,
    });
  });

  it("returns genuine zero totals only after a successful empty source read", async () => {
    const { router } = setup();
    await expect(router.getQuotaUsage(request())).resolves.toEqual({
      storage: { limit: 0, used: 0 },
      aiCredit: { limit: 0, used: 0 },
    });
  });

  it("does not turn a failed resource read into zero", async () => {
    const { router, getQuotaOverviewRows } = setup();
    getQuotaOverviewRows.mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    await expect(router.getQuotaUsage(request())).rejects.toThrow(
      "database unavailable",
    );
  });

  it.each([-1, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    "rejects unsafe totals (%s)",
    async (quotaLimit) => {
      const { router } = setup({
        pools: [pool({ quotaLimit })],
        gauges: [],
        sharing: [],
      });
      await expect(router.getQuotaUsage(request())).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    },
  );

  it("reads a newly selected workspace instead of silently returning to the default", async () => {
    const { router, query, getQuotaOverviewRows } = setup();
    await router.getQuotaUsage(request(OTHER_WORKSPACE));
    expect(query).toHaveBeenCalledWith(expect.stringContaining("id = $2"), [
      TENANT,
      OTHER_WORKSPACE,
    ]);
    expect(getQuotaOverviewRows).toHaveBeenCalledWith(OTHER_WORKSPACE);
  });

  it("rejects inaccessible scope before reading any quota data", async () => {
    const { router, query, getQuotaOverviewRows } = setup();
    query.mockResolvedValueOnce({ rows: [] });
    await expect(router.getQuotaUsage(request())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(getQuotaOverviewRows).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Tenant-owned money and permission contracts
// ============================================================================
describe("Console header tenant billing", () => {
  it("keeps an absent wallet distinct from a persisted zero balance", async () => {
    const { router, getCreditBalance } = setup();
    await expect(router.getCredits(request())).resolves.toBeNull();
    getCreditBalance.mockResolvedValueOnce({
      balance: "0.00",
      currency: "CNY",
    });
    await expect(router.getCredits(request())).resolves.toEqual({
      balance: "0.00",
      currency: "CNY",
    });
    expect(getCreditBalance).toHaveBeenCalledWith(TENANT);
  });

  it("uses the existing outstanding-postpaid domain read for the authenticated tenant", async () => {
    const { router, getMonthlyPostpaidDue } = setup();
    getMonthlyPostpaidDue.mockResolvedValueOnce([
      { balance: "150.00", currency: "CNY" },
    ]);
    await expect(router.getMonthlyBill(request())).resolves.toEqual({
      balance: "150.00",
      currency: "CNY",
    });
    expect(getMonthlyPostpaidDue).toHaveBeenCalledWith(TENANT);
  });

  it("reports zero due for a successful empty postpaid query", async () => {
    const { router } = setup();
    await expect(router.getMonthlyBill(request())).resolves.toEqual({
      balance: "0.00",
      currency: "CNY",
    });
  });

  it("does not add amounts in different currencies", async () => {
    const { router, getMonthlyPostpaidDue } = setup();
    getMonthlyPostpaidDue.mockResolvedValueOnce([
      { balance: "10.00", currency: "CNY" },
      { balance: "2.00", currency: "USD" },
    ]);
    await expect(router.getMonthlyBill(request())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it("keeps failed billing reads unavailable", async () => {
    const { router, getMonthlyPostpaidDue } = setup();
    getMonthlyPostpaidDue.mockRejectedValueOnce(
      new Error("billing unavailable"),
    );
    await expect(router.getMonthlyBill(request())).rejects.toThrow(
      "billing unavailable",
    );
  });

  it.each(["getCredits", "getMonthlyBill", "getQuotaUsage"] as const)(
    "%s rejects missing tenant context",
    async (method) => {
      const { router } = setup();
      await expect(
        router[method]({} as Request & RequestContext),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    },
  );

  it.each(["getCredits", "getMonthlyBill"] as const)(
    "%s requires billing access rather than quota-only access",
    (method) => {
      const policy = Reflect.getMetadata(
        ACCESS_POLICY,
        SubscriptionRouter.prototype[method],
      ) as AccessPolicy;
      expect(policy).toEqual({
        kind: "capability",
        anyOf: ["tenant.billing.read"],
      });
      const quotaOnly = request();
      quotaOnly.capabilities = ["tenant.quota.read"];
      expect(() => evaluateAccessPolicy(policy, quotaOnly)).toThrow(
        ForbiddenException,
      );
      expect(evaluateAccessPolicy(policy, request())).toBe(true);
    },
  );
});
