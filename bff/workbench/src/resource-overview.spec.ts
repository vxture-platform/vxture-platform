/**
 * Resource projection regressions over real domain readers and isolated database responses.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-06
 */
import "reflect-metadata";
import { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { BillingService, PgBillingRepository } from "@vxture/service-billing"; // ⚠️ 跨层引用: test the public billing reader.
import {
  MeteringReadService,
  PgMeteringReadRepository,
} from "@vxture/service-subscription"; // ⚠️ 跨层引用: exercise canonical pool reset behavior.
import { ResourceOverview } from "./resource-overview";

// ============================================================================
// Domain reads retain real period-reset behavior; no network or production state.
// ============================================================================
function readers() {
  const pool = new Pool();
  const query = vi.spyOn(pool, "query");
  const metering = new MeteringReadService(new PgMeteringReadRepository(pool));
  const billing = new BillingService(new PgBillingRepository(pool));
  return {
    pool,
    query,
    metering,
    billing,
    overview: new ResourceOverview(metering, billing),
  };
}
const result = (rows: unknown[]) => ({
  rows,
  rowCount: rows.length,
  command: "SELECT",
  oid: 0,
  fields: [],
});

describe("workspace resource totals", () => {
  it("counts shared pools once, reads storage gauges, and reuses lazy period resets", async () => {
    const { query, overview } = readers();
    query.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes("from metering.quota_pools"))
        return result([
          {
            metric_key: "ai.credit",
            quota_limit: "1000",
            quota_used: "300",
            reset_period: "none",
            pool_source: "ws_base",
          },
          {
            metric_key: "ai.credit",
            quota_limit: "200",
            quota_used: "100",
            reset_period: "month",
            current_period_start: new Date("2020-01-01T00:00:00Z"),
            period_anchor: new Date("2020-01-01T00:00:00Z"),
            pool_source: "subscription",
          },
          {
            metric_key: "storage.bytes",
            quota_limit: "10000",
            quota_used: "9999",
            reset_period: "none",
          },
          {
            metric_key: "storage.bytes",
            quota_limit: "5000",
            quota_used: "7777",
            reset_period: "none",
          },
        ]);
      if (text.includes("from metering.usage_gauges"))
        return result([
          { metric_key: "storage.bytes", value: "2000" },
          { metric_key: "storage.bytes", value: "500" },
        ]);
      return result([]);
    });
    expect(await overview.resources("current-workspace")).toEqual({
      aiCredit: { used: 300, limit: 1200 },
      storage: { used: 2500, limit: 15000 },
    });
    for (const call of query.mock.calls)
      expect(call[1]).toEqual(["current-workspace"]);
  });
  it("distinguishes a successful empty pool read from dependency failure", async () => {
    const { query, overview } = readers();
    query.mockImplementation(async () => result([]));
    expect(await overview.resources("space")).toEqual({
      storage: { used: 0, limit: 0 },
      aiCredit: { used: 0, limit: 0 },
    });
    query.mockRejectedValue(new Error("database unavailable"));
    await expect(overview.resources("space")).rejects.toThrow(
      "database unavailable",
    );
  });
  it("preserves storage overshoot rather than hiding it", async () => {
    const { metering, overview } = readers();
    vi.spyOn(metering, "getQuotaOverviewRows").mockResolvedValue({
      pools: [],
      gauges: [
        {
          metricKey: "storage.bytes",
          productCode: "arda",
          productName: "Arda",
          value: 1024,
          observedAt: new Date(),
        },
      ],
      sharing: [],
    });
    expect((await overview.resources("space")).storage).toEqual({
      used: 1024,
      limit: 0,
    });
  });
});

describe("tenant billing views", () => {
  it("keeps the persisted balance and never turns a missing wallet into zero", async () => {
    const { query, overview } = readers();
    query.mockImplementation(async () =>
      result([{ balance: "123.45", currency: "CNY" }]),
    );
    expect(await overview.balance("tenant")).toEqual({
      balance: "123.45",
      currency: "CNY",
    });
    query.mockImplementation(async () => result([]));
    await expect(overview.balance("tenant")).rejects.toThrow();
  });
  it("reads the outstanding postpaid summary, including successful zero due", async () => {
    const { query, overview } = readers();
    query.mockImplementation(async () =>
      result([{ balance: "25.00", currency: "CNY" }]),
    );
    expect(await overview.monthlyBill("tenant")).toEqual({
      balance: "25.00",
      currency: "CNY",
    });
    expect(query.mock.calls[0]?.[1]).toEqual(["tenant"]);
    query.mockImplementation(async () => result([]));
    expect(await overview.monthlyBill("tenant")).toEqual({
      balance: "0.00",
      currency: "CNY",
    });
    query.mockRejectedValue(new Error("billing unavailable"));
    await expect(overview.monthlyBill("tenant")).rejects.toThrow(
      "billing unavailable",
    );
  });
  it("does not combine different currencies into one displayed amount", async () => {
    const { query, overview } = readers();
    query.mockImplementation(async () =>
      result([
        { balance: "1.00", currency: "CNY" },
        { balance: "2.00", currency: "USD" },
      ]),
    );
    await expect(overview.monthlyBill("tenant")).rejects.toThrow();
  });
});
