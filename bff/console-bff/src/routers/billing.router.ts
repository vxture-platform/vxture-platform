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
 *   /api/billing/addresses*   — 开票抬头簿 CRUD + 设默认（owner 2026-08-21
 *                               发票归集账单管理）
 *   GET/POST /api/billing/receipts — 发票记录 / 对已结清账单申请开票
 *                               （运营侧 admin 发票台账负责后续开具/寄送）
 *
 * 全部接口需要租户上下文（由 TenantMiddleware 保证 req.tenant 已填充）。
 *
 * @author AI-Generated
 * @date 2026-05-03
 */

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { BillingService, InvoiceReceiptService } from "@vxture/service-billing";
import type {
  BillingAddressRecord,
  InvoiceReceiptRecord,
  InvoiceRecord,
  UpsertBillingAddressInput,
} from "@vxture/service-billing";
import type { RequestContext } from "../types/console.types";
import { auditCustomerAction } from "../audit/audit-log";

// Inline the DI token (repo-wide pattern): SubscriptionModule provides the pool.
const COMMERCE_PG_POOL = "COMMERCE_PG_POOL";

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
  /**
   * 本自然月实付（元字符串）：billing.payments pay_status='paid' 且 paid_at 落在本月的
   * paid_amount 合计。收付实现制（owner 2026-09-03）：钱在哪个月到就记哪个月，年付
   * 之后的十一个月为 0 是对的，不做分摊。
   */
  paidThisMonth: string;
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

// ── 发票视图(与前端 console-bff.ts 镜像;日期一律 ISO)──────────────────────

export interface ConsoleBillingAddressView {
  id: string;
  invoiceTaxType: "general" | "special";
  title: string;
  taxNo: string | null;
  phone: string | null;
  address: string | null;
  bankName: string | null;
  bankAccount: string | null;
  isDefault: boolean;
}

export interface ConsoleInvoiceReceiptView {
  id: string;
  invoiceNo: string;
  billId: string;
  billNo: string | null;
  invoiceType: string;
  invoiceTaxType: string;
  invoiceTitle: string;
  invoiceAmount: string;
  currency: string;
  invoiceStatus: string;
  statusRemark: string | null;
  invoiceFileUrl: string | null;
  expressCompany: string | null;
  expressNo: string | null;
  issuedAt: string | null;
  sendAt: string | null;
  createdAt: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVOICE_TYPES = new Set([
  "electronic_general",
  "electronic_special",
  "paper_special",
]);

function mapAddressView(r: BillingAddressRecord): ConsoleBillingAddressView {
  return {
    id: r.id,
    invoiceTaxType: r.invoiceTaxType,
    title: r.title,
    taxNo: r.taxNo,
    phone: r.phone,
    address: r.address,
    bankName: r.bankName,
    bankAccount: r.bankAccount,
    isDefault: r.isDefault,
  };
}

function mapReceiptView(r: InvoiceReceiptRecord): ConsoleInvoiceReceiptView {
  return {
    id: r.id,
    invoiceNo: r.invoiceNo,
    billId: r.billId,
    billNo: r.billNo,
    invoiceType: r.invoiceType,
    invoiceTaxType: r.invoiceTaxType,
    invoiceTitle: r.invoiceTitle,
    invoiceAmount: r.invoiceAmount,
    currency: r.currency,
    invoiceStatus: r.invoiceStatus,
    statusRemark: r.statusRemark,
    invoiceFileUrl: r.invoiceFileUrl,
    expressCompany: r.expressCompany,
    expressNo: r.expressNo,
    issuedAt: toIso(r.issuedAt),
    sendAt: toIso(r.sendAt),
    createdAt: toIso(r.createdAt) ?? "",
  };
}

/** 抬头表单入参校验(专票必填项由 service 复核;这里做形状与长度)。 */
function parseAddressBody(
  body: Record<string, unknown>,
  ctx: { tenantId: string; userId: string },
): UpsertBillingAddressInput {
  const str = (v: unknown, max: number): string | undefined =>
    typeof v === "string" && v.trim() !== ""
      ? v.trim().slice(0, max)
      : undefined;
  const taxType = body.invoiceTaxType;
  if (taxType !== "general" && taxType !== "special") {
    throw new BadRequestException("invoiceTaxType 非法");
  }
  const title = str(body.title, 256);
  if (!title) throw new BadRequestException("抬头不能为空");
  return {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    invoiceTaxType: taxType,
    title,
    ...(str(body.taxNo, 128) ? { taxNo: str(body.taxNo, 128)! } : {}),
    ...(str(body.phone, 32) ? { phone: str(body.phone, 32)! } : {}),
    ...(str(body.address, 512) ? { address: str(body.address, 512)! } : {}),
    ...(str(body.bankName, 256) ? { bankName: str(body.bankName, 256)! } : {}),
    ...(str(body.bankAccount, 256)
      ? { bankAccount: str(body.bankAccount, 256)! }
      : {}),
    ...(body.isDefault === true ? { isDefault: true } : {}),
  };
}

@Controller("api/billing")
export class BillingRouter {
  constructor(
    @Inject(BillingService)
    private readonly billingService: BillingService,
    @Inject(InvoiceReceiptService)
    private readonly receipts: InvoiceReceiptService,
    /** 仅供租户审计写钩子。 */
    @Inject(COMMERCE_PG_POOL) private readonly pool: Pool,
  ) {}

  // ── 发票(归集在账单管理,owner 2026-08-21):抬头簿 + 申请 + 记录 ──────────
  // 开票资格 = 已结清账单(bill_status='paid'),不限 bill_type——直接订阅付款
  // (normal/one_off)与预付款扣费对账单(prepaid_statement)两个来源同栈。

  @Get("addresses")
  async listAddresses(
    @Req() req: Request & RequestContext,
  ): Promise<ConsoleBillingAddressView[]> {
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    const rows = await this.receipts.listAddresses(req.tenant.id);
    return rows.map(mapAddressView);
  }

  @Post("addresses")
  async createAddress(
    @Req() req: Request & RequestContext,
    @Body() body: Record<string, unknown>,
  ): Promise<ConsoleBillingAddressView> {
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    if (!req.user) throw new UnauthorizedException("No active session");
    const input = parseAddressBody(body, {
      tenantId: req.tenant.id,
      userId: req.user.id,
    });
    const created = mapAddressView(await this.receipts.createAddress(input));
    auditCustomerAction(this.pool, req, {
      action: "billing.address.create",
      resourceType: "billing_address",
      resourceId: created.title,
    });
    return created;
  }

  @Patch("addresses/:id")
  async updateAddress(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<ConsoleBillingAddressView> {
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    if (!req.user) throw new UnauthorizedException("No active session");
    if (!UUID_RE.test(id)) throw new BadRequestException("抬头 id 非法");
    const input = parseAddressBody(body, {
      tenantId: req.tenant.id,
      userId: req.user.id,
    });
    const updated = mapAddressView(
      await this.receipts.updateAddress(id, input),
    );
    auditCustomerAction(this.pool, req, {
      action: "billing.address.update",
      resourceType: "billing_address",
      resourceId: updated.title,
    });
    return updated;
  }

  @Post("addresses/:id/default")
  async setDefaultAddress(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<{ ok: true }> {
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    if (!req.user) throw new UnauthorizedException("No active session");
    if (!UUID_RE.test(id)) throw new BadRequestException("抬头 id 非法");
    await this.receipts.setDefaultAddress(id, req.tenant.id, req.user.id);
    return { ok: true };
  }

  @Delete("addresses/:id")
  async deleteAddress(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<{ ok: true }> {
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    if (!req.user) throw new UnauthorizedException("No active session");
    if (!UUID_RE.test(id)) throw new BadRequestException("抬头 id 非法");
    await this.receipts.deleteAddress(id, req.tenant.id, req.user.id);
    auditCustomerAction(this.pool, req, {
      action: "billing.address.delete",
      resourceType: "billing_address",
      resourceId: id,
    });
    return { ok: true };
  }

  @Get("receipts")
  async listReceipts(
    @Req() req: Request & RequestContext,
  ): Promise<ConsoleInvoiceReceiptView[]> {
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    const rows = await this.receipts.listReceipts(req.tenant.id);
    return rows.map(mapReceiptView);
  }

  @Post("receipts")
  async applyReceipt(
    @Req() req: Request & RequestContext,
    @Body()
    body: { billId?: unknown; addressId?: unknown; invoiceType?: unknown },
  ): Promise<ConsoleInvoiceReceiptView> {
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    if (!req.user) throw new UnauthorizedException("No active session");
    const billId = typeof body.billId === "string" ? body.billId : "";
    const addressId = typeof body.addressId === "string" ? body.addressId : "";
    const invoiceType =
      typeof body.invoiceType === "string" ? body.invoiceType : "";
    if (!UUID_RE.test(billId)) throw new BadRequestException("billId 非法");
    if (!UUID_RE.test(addressId))
      throw new BadRequestException("addressId 非法");
    if (!INVOICE_TYPES.has(invoiceType)) {
      throw new BadRequestException("invoiceType 非法");
    }
    const record = await this.receipts.applyReceipt({
      tenantId: req.tenant.id,
      userId: req.user.id,
      billId,
      addressId,
      invoiceType: invoiceType as
        | "electronic_general"
        | "electronic_special"
        | "paper_special",
    });
    auditCustomerAction(this.pool, req, {
      action: "billing.invoice.apply",
      resourceType: "invoice_receipt",
      resourceId: record.invoiceNo,
      after: { billNo: record.billNo, type: record.invoiceType },
    });
    return mapReceiptView(record);
  }

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
    // 本月实付：与 admin 租户「本月收入」同一口径（库会话时区的自然月，毛额不冲退款）。
    const month = await this.pool.query<{ paid: string }>(
      `select coalesce(sum(p.paid_amount), 0)::numeric(12,2)::text as paid
         from billing.payments p
        where p.tenant_id = $1 and p.pay_status = 'paid'
          and p.paid_at >= date_trunc('month', now())
          and p.paid_at <  date_trunc('month', now()) + interval '1 month'`,
      [req.tenant.id],
    );
    return {
      total: items.length,
      paid: items.filter((i) => i.billStatus === "paid").length,
      unpaid: items.filter((i) => OPEN_STATUSES.has(i.billStatus)).length,
      overdue: items.filter((i) => i.billStatus === "overdue").length,
      cancelled: items.filter((i) => i.billStatus === "cancelled").length,
      paidTotal: (paidCents / 100).toFixed(2),
      paidThisMonth: month.rows[0]?.paid ?? "0.00",
      currency: items[0]?.currency ?? "CNY",
    };
  }
}
