/**
 * invoices.router.ts - 发票台账路由
 * @package @vxture/bff-admin
 *
 * Description: 发票台账只读接口，接 billing.invoice_receipts（18-schema）。
 *   全量 join billing.invoices 取账单头（账单号/状态/金额），
 *   join tenancy.tenants(+tenant_profiles) 取开票主体抬头/行业，
 *   left join admin.operator_account 取审核人姓名。
 *   写路径（线下发票同步/寄送/红冲）见 admin-app-completion-plan.md 商务模块。
 *
 * @author AI-Generated
 * @date 2026-07-04
 * @version 1.0
 *
 * @copyright Vxture Team
 *
 * @layer Application
 * @category Router
 */

import { Controller, Get, Inject, Req } from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { assertAnyCapability } from "../auth/capability";
import { ADMIN_BFF_RO_POOL } from "../tokens";
import type {
  BillingBillStatus,
  BillingBillType,
  BillingInvoiceLedgerRecord,
  BillingInvoiceStatus,
  BillingInvoiceTaxType,
  BillingInvoiceType,
  RequestContext,
  TenantOperationType,
} from "../types/console.types";
import { industryLabel } from "@vxture/core-utils";

@Controller("api/invoices")
export class InvoicesRouter {
  constructor(@Inject(ADMIN_BFF_RO_POOL) private readonly pool: Pool) {}

  @Get()
  async listInvoiceLedger(
    @Req() req: Request & RequestContext,
  ): Promise<BillingInvoiceLedgerRecord[]> {
    assertCanReadInvoices(req);

    const { rows } =
      await this.pool.query<InvoiceLedgerRow>(INVOICE_LEDGER_SQL);
    return rows.map(mapInvoiceLedgerRow);
  }
}

// TD-027: invoice ledger read (invoice writes live in billing.router).
function assertCanReadInvoices(req: Request & RequestContext): void {
  assertAnyCapability(req, [
    "commerce:invoice.read",
    "commerce:invoice.manage",
  ]);
}

function toIso(value: Date | string | null): string {
  if (!value) return new Date(0).toISOString();
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toIsoOrNull(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toNumber(value: string | number | null): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// DDL invoice_receipts.invoice_status ∈ applying/approved/issued/sent/rejected/voided
// → 前端 BillingInvoiceStatus（none/applying/auditing/issued/sending/finished/rejected/red）。
function mapInvoiceStatus(value: string): BillingInvoiceStatus {
  switch (value) {
    case "applying":
      return "applying";
    case "approved":
      return "auditing";
    case "issued":
      return "issued";
    case "sent":
      return "sending";
    case "rejected":
      return "rejected";
    case "voided":
      return "red";
    default:
      return "none";
  }
}

// DDL invoice_receipts.invoice_type ∈ electronic_general/electronic_special/paper_special
// → 前端 BillingInvoiceType（special_vat/normal_vat/electronic/paper/other）。
// 以税种维度为主分类：*_special=增值税专票，*_general=增值税普票，纸质另标 paper。
function mapInvoiceType(value: string): BillingInvoiceType {
  switch (value) {
    case "electronic_special":
      return "special_vat";
    case "electronic_general":
      return "normal_vat";
    case "paper_special":
      return "paper";
    default:
      return "other";
  }
}

// DDL invoice_receipts.invoice_tax_type ∈ general/special（普票/专票）
// → 前端 BillingInvoiceTaxType（enterprise/individual/government/other）无直接同义列，best-effort：
// 专票仅一般纳税人企业可开 → enterprise；普票主体不定 → other。
function mapInvoiceTaxType(value: string): BillingInvoiceTaxType {
  switch (value) {
    case "special":
      return "enterprise";
    default:
      return "other";
  }
}

// DDL invoices.bill_type ∈ normal/one_off/adjustment/prepaid_statement
// → 前端 BillingBillType（normal/adjust/supplement/prepaid）。
function mapBillType(value: string | null): BillingBillType {
  switch (value) {
    case "adjustment":
      return "adjust";
    case "one_off":
      return "supplement";
    case "prepaid_statement":
      return "prepaid";
    default:
      return "normal";
  }
}

// DDL invoices.bill_status 与前端 BillingBillStatus 同集（unpaid/paying/paid/partial/cancelled/overdue）。
function mapBillStatus(value: string): BillingBillStatus {
  switch (value) {
    case "unpaid":
    case "paying":
    case "paid":
    case "partial":
    case "cancelled":
    case "overdue":
      return value;
    default:
      return "unpaid";
  }
}

function mapTenantType(value: string): TenantOperationType {
  return value === "personal" ? "individual" : "company";
}

function mapInvoiceLedgerRow(
  row: InvoiceLedgerRow,
): BillingInvoiceLedgerRecord {
  return {
    id: row.id,
    billId: row.bill_id,
    invoiceNo: row.invoice_no,
    invoiceType: mapInvoiceType(row.invoice_type),
    invoiceTaxType: mapInvoiceTaxType(row.invoice_tax_type),
    invoiceTitle: row.invoice_title,
    taxNo: row.tax_no,
    invoiceAmount: toNumber(row.invoice_amount),
    taxAmount: toNumber(row.tax_amount),
    currency: row.currency ?? "CNY",
    invoiceStatus: mapInvoiceStatus(row.invoice_status),
    statusRemark: row.status_remark,
    invoiceCode: row.invoice_code,
    invoiceElectronicNo: row.invoice_electronic_no,
    invoiceFileUrl: row.invoice_file_url,
    issuedAt: toIsoOrNull(row.issued_at),
    expressCompany: row.express_company,
    expressNo: row.express_no,
    sendAt: toIsoOrNull(row.send_at),
    auditorName: row.auditor_name ?? "",
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    // 台账扩展（join 账单头 + 开票主体）
    billNo: row.bill_no,
    billStatus: mapBillStatus(row.bill_status),
    billType: mapBillType(row.bill_type),
    billPayableAmount: toNumber(row.payable_amount),
    billPaidAmount: toNumber(row.paid_amount),
    tenantId: row.tenant_id,
    tenantCode: String(row.tenant_no),
    tenantName: row.tenant_name,
    tenantType: mapTenantType(row.tenant_type),
    region: row.country_code ?? "未设置",
    // 所属行业:console 存的是 core-utils 清单码,这里翻成中文标签;历史自由文本原样显示
    industry: row.industry ? industryLabel(row.industry) : "未设置",
    subscriptionId: row.subscription_id,
    // 无对应真实列（订单/服务方案/档位不在 billing 台账链路）→ 空态兜底
    orderNo: null,
    servicePlanName: null,
    tierName: null,
    sourceLabel: "offline",
  };
}

// 18-schema：billing.invoice_receipts（发票申请/开具值快照）为主表，
// bill_id 域内 FK→billing.invoices（账单头），tenant_id 跨 schema→tenancy.tenants（开票主体）。
// auditor_id 恒为 operator（裸值→admin.operator_account）。软删 r.deleted_at is null；大表加 LIMIT。
const INVOICE_LEDGER_SQL = `
select
  r.id,
  r.bill_id,
  r.invoice_no,
  r.invoice_type,
  r.invoice_tax_type,
  r.invoice_title,
  r.tax_no,
  r.invoice_amount,
  r.tax_amount,
  r.currency,
  r.invoice_status,
  r.status_remark,
  r.invoice_code,
  r.invoice_electronic_no,
  r.invoice_file_url,
  r.issued_at,
  r.express_company,
  r.express_no,
  r.send_at,
  r.created_at,
  r.updated_at,
  b.bill_no,
  b.bill_status,
  b.bill_type,
  b.payable_amount,
  b.paid_amount,
  b.subscription_id,
  t.id as tenant_id,
  t.tenant_no,
  t.name as tenant_name,
  t.type as tenant_type,
  p.country_code,
  p.industry,
  op.display_name as auditor_name
from billing.invoice_receipts r
join billing.invoices b on b.id = r.bill_id
join tenancy.tenants t on t.id = r.tenant_id
left join tenancy.tenant_profiles p on p.tenant_id = t.id
left join admin.operator_account op on op.id = r.auditor_id
where r.deleted_at is null
order by r.created_at desc
limit 500
`;

interface InvoiceLedgerRow {
  id: string;
  bill_id: string;
  invoice_no: string;
  invoice_type: string;
  invoice_tax_type: string;
  invoice_title: string;
  tax_no: string | null;
  invoice_amount: string | number | null;
  tax_amount: string | number | null;
  currency: string | null;
  invoice_status: string;
  status_remark: string | null;
  invoice_code: string | null;
  invoice_electronic_no: string | null;
  invoice_file_url: string | null;
  issued_at: Date | string | null;
  express_company: string | null;
  express_no: string | null;
  send_at: Date | string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  bill_no: string;
  bill_status: string;
  bill_type: string | null;
  payable_amount: string | number | null;
  paid_amount: string | number | null;
  subscription_id: string | null;
  tenant_id: string;
  tenant_no: string | number;
  tenant_name: string;
  tenant_type: string;
  country_code: string | null;
  industry: string | null;
  auditor_name: string | null;
}
