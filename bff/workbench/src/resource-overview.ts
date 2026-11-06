/**
 * Narrow resource and billing views over the existing domain read services.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category aggregator
 * @author AI-Generated
 * @date 2026-11-06
 */
import type { BillingService } from "@vxture/service-billing"; // ⚠️ 跨层引用: reuse tenant-owned billing reads.
import type { MeteringReadService } from "@vxture/service-subscription"; // ⚠️ 跨层引用: reuse period-aware pool and gauge reads.
import { failure } from "./errors";

type Money = { balance: string; currency: string };
type Metric = { used: number; limit: number };

// ============================================================================
// Workspace totals count each source once; tenant money stays a separate axis.
// ============================================================================
export class ResourceOverview {
  constructor(
    private readonly metering: Pick<
      MeteringReadService,
      "getQuotaOverviewRows"
    >,
    private readonly billing: Pick<
      BillingService,
      "getCreditBalance" | "getMonthlyPostpaidDue"
    >,
  ) {}

  /**
   * Project total quota and effective usage across the current workspace.
   * @param workspaceId - Workspace already authorized by the router.
   * @returns Storage water level and AI counter totals, without product-view duplication.
   * @throws When domain data is unavailable or outside the numeric display range.
   */
  async resources(
    workspaceId: string,
  ): Promise<{ storage: Metric; aiCredit: Metric }> {
    const { pools, gauges } =
      await this.metering.getQuotaOverviewRows(workspaceId);
    const metric = (key: string, gauge: boolean): Metric => {
      const rows = pools.filter((pool) => pool.metricKey === key);
      const result = {
        limit: rows.reduce((sum, pool) => sum + pool.quotaLimit, 0),
        used: gauge
          ? gauges
              .filter((row) => row.metricKey === key)
              .reduce((sum, row) => sum + row.value, 0)
          : rows.reduce((sum, pool) => sum + pool.effectiveUsed, 0),
      };
      if (
        Object.values(result).some(
          (value) => !Number.isSafeInteger(value) || value < 0,
        )
      )
        throw failure(
          503,
          "WORKBENCH_RESOURCE_UNAVAILABLE",
          "Resource overview is unavailable",
        );
      return result;
    };
    return {
      storage: metric("storage.bytes", true),
      aiCredit: metric("ai.credit", false),
    };
  }

  /**
   * Project a persisted tenant wallet balance; missing wallets remain unknown.
   * @param tenantId - Tenant authorized for billing reads.
   * @returns Actual balance and currency.
   * @throws When no wallet record exists.
   */
  async balance(tenantId: string): Promise<Money> {
    const row = await this.billing.getCreditBalance(tenantId);
    if (!row)
      throw failure(
        503,
        "WORKBENCH_BALANCE_UNAVAILABLE",
        "Account balance is unavailable",
      );
    return { balance: row.balance, currency: row.currency };
  }

  /**
   * Project current-month outstanding postpaid bills, excluding all paid business.
   * @param tenantId - Tenant authorized for billing reads.
   * @returns Amount still payable; a successful empty receivables query means zero due.
   * @throws When multiple currencies cannot be represented by this single-value panel.
   */
  async monthlyBill(tenantId: string): Promise<Money> {
    const rows = await this.billing.getMonthlyPostpaidDue(tenantId);
    if (rows.length > 1)
      throw failure(
        503,
        "WORKBENCH_BILL_UNAVAILABLE",
        "Multiple billing currencies require Console",
      );
    return rows[0] ?? { balance: "0.00", currency: "CNY" };
  }
}
