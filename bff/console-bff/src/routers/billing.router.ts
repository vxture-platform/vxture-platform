/**
 * billing.router.ts - 租户账单路由
 * @package @vxture/bff-console
 * @layer Application
 * @category Router
 *
 * 提供当前租户的账单数据查询接口：
 *   GET /api/billing/invoices — 旧发票列表透传（dashboard 仍在用，保持不动）
 *   GET /api/billing/bills    — 账单管理页视图（可视码/账期/金额三段/状态，日期 ISO）
 *   GET /api/billing/overview — 账单概览统计（product_331 重写：按真实
 *                               bill_status 值域 unpaid|paying|paid|partial|
 *                               cancelled|overdue 聚合——旧版数 "pending" 导致
 *                               待付恒为 0）
 *
 * 全部接口需要租户上下文（由 TenantMiddleware 保证 req.tenant 已填充）。
 *
 * @author AI-Generated
 * @date 2026-05-03
 */

import {
  Controller,
  Get,
  Inject,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { BillingService } from "@vxture/service-billing";
import type { InvoiceRecord } from "@vxture/service-billing";
import type { RequestContext } from "../types/console.types";

// ============================================================================
// BillingRouter
// ============================================================================

export interface BillingOverview {
  total: number;
  paid: number;
  /** 待收款合集：unpaid + paying + partial（订阅制下都是「还差钱」态）。 */
  unpaid: number;
  overdue: number;
  cancelled: number;
  /** 累计实收（元字符串，paid_amount 求和——含部分收款）。 */
  paidTotal: string;
  currency: string;
}

/** 账单管理页行视图：可视码 + 账期 + 金额三段 + 状态，日期一律 ISO 字符串。 */
export interface ConsoleBillView {
  id: string;
  billNo: string;
  billCycle: string;
  cycleStartDate: string | null;
  cycleEndDate: string | null;
  billType: string | null;
  totalAmount: string;
  discountAmount: string;
  payableAmount: string;
  paidAmount: string;
  currency: string;
  billStatus: string;
  paidAt: string | null;
  createdAt: string;
}

const OPEN_STATUSES = new Set(["unpaid", "paying", "partial"]);

function toIso(d: Date | null | undefined): string | null {
  return d ? new Date(d).toISOString() : null;
}

function mapBill(r: InvoiceRecord): ConsoleBillView {
  return {
    id: r.id,
    billNo: r.billNo,
    billCycle: r.billCycle,
    cycleStartDate: toIso(r.cycleStartDate),
    cycleEndDate: toIso(r.cycleEndDate),
    billType: r.billType,
    totalAmount: r.totalAmount,
    discountAmount: r.discountAmount,
    payableAmount: r.payableAmount,
    paidAmount: r.paidAmount,
    currency: r.currency,
    billStatus: r.billStatus,
    paidAt: toIso(r.paidAt),
    createdAt: toIso(r.createdAt) ?? "",
  };
}

@Controller("api/billing")
export class BillingRouter {
  constructor(
    @Inject(BillingService)
    private readonly billingService: BillingService,
  ) {}

  // ── GET /api/billing/invoices（旧透传，dashboard 消费，保持不动）───────────

  /**
   * 返回当前租户最近的发票列表。
   * 默认最多返回 20 条，可通过 ?limit=N 调整（上限 100）。
   */
  @Get("invoices")
  async getInvoices(
    @Req() req: Request & RequestContext,
    @Query("limit") limit?: string,
  ): Promise<InvoiceRecord[]> {
    if (!req.tenant) {
      throw new UnauthorizedException("租户上下文缺失");
    }

    const pageSize = Math.min(Number(limit) || 20, 100);
    const result = await this.billingService.listInvoices({
      tenantId: req.tenant.id,
      pageSize,
    });
    return result.items;
  }

  // ── GET /api/billing/bills（账单管理页，product_331）──────────────────────

  @Get("bills")
  async getBills(
    @Req() req: Request & RequestContext,
    @Query("limit") limit?: string,
  ): Promise<ConsoleBillView[]> {
    if (!req.tenant) {
      throw new UnauthorizedException("租户上下文缺失");
    }
    const pageSize = Math.min(Number(limit) || 50, 100);
    const result = await this.billingService.listInvoices({
      tenantId: req.tenant.id,
      pageSize,
    });
    return result.items.map(mapBill);
  }

  // ── GET /api/billing/overview ──────────────────────────────────────────────

  /**
   * 账单概览：按真实 bill_status 值域聚合 + 累计实收。
   * 量级 = 租户自身账单数（假数据阶段远小于 200），全取聚合即可。
   */
  @Get("overview")
  async getOverview(
    @Req() req: Request & RequestContext,
  ): Promise<BillingOverview> {
    if (!req.tenant) {
      throw new UnauthorizedException("租户上下文缺失");
    }

    const result = await this.billingService.listInvoices({
      tenantId: req.tenant.id,
      pageSize: 200,
    });

    const items = result.items;
    // 金额走分账避免浮点渐进误差（与 promotion 的 cents 口径一致）。
    const paidCents = items.reduce(
      (sum, i) =>
        sum + Math.round(Number.parseFloat(i.paidAmount || "0") * 100),
      0,
    );
    return {
      total: items.length,
      paid: items.filter((i) => i.billStatus === "paid").length,
      unpaid: items.filter((i) => OPEN_STATUSES.has(i.billStatus)).length,
      overdue: items.filter((i) => i.billStatus === "overdue").length,
      cancelled: items.filter((i) => i.billStatus === "cancelled").length,
      paidTotal: (paidCents / 100).toFixed(2),
      currency: items[0]?.currency ?? "CNY",
    };
  }
}
