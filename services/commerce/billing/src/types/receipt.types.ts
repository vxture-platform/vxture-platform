// Invoice-receipt (发票) contracts — customer-side application flow over
// billing.billing_addresses (开票抬头簿) + billing.invoice_receipts (申请单,
// 52_billing.sql). Eligibility is bill_status='paid' regardless of bill_type
// (owner 2026-08-21: 发票两个来源 — 直接订阅付款 + 预付款扣费对账单 — 都是
// 已结清账单,不按类型设限)。

export interface BillingAddressRecord {
  id: string;
  /** general(普票) / special(专票) */
  invoiceTaxType: "general" | "special";
  title: string;
  taxNo: string | null;
  phone: string | null;
  address: string | null;
  bankName: string | null;
  bankAccount: string | null;
  isDefault: boolean;
  createdAt: Date;
}

export interface InvoiceReceiptRecord {
  id: string;
  /** 平台内部发票申请号 FAP-{YYYYMM}-{10hex}(可视码) */
  invoiceNo: string;
  billId: string;
  /** joined 账单可视码 */
  billNo: string | null;
  invoiceType: "electronic_general" | "electronic_special" | "paper_special";
  invoiceTaxType: "general" | "special";
  invoiceTitle: string;
  /** NUMERIC(12,2) yuan string,价税合计 */
  invoiceAmount: string;
  currency: string;
  invoiceStatus:
    | "applying"
    | "approved"
    | "issued"
    | "sent"
    | "rejected"
    | "voided";
  statusRemark: string | null;
  invoiceFileUrl: string | null;
  expressCompany: string | null;
  expressNo: string | null;
  issuedAt: Date | null;
  sendAt: Date | null;
  createdAt: Date;
}

export interface UpsertBillingAddressInput {
  tenantId: string;
  /** account.users.id of the acting customer */
  userId: string;
  invoiceTaxType: "general" | "special";
  title: string;
  taxNo?: string;
  phone?: string;
  address?: string;
  bankName?: string;
  bankAccount?: string;
  isDefault?: boolean;
}

export interface ApplyInvoiceReceiptInput {
  tenantId: string;
  userId: string;
  billId: string;
  addressId: string;
  invoiceType: "electronic_general" | "electronic_special" | "paper_special";
}
