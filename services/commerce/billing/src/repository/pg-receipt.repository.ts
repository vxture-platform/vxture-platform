import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { COMMERCE_PG_POOL } from "../tokens";
import type {
  ApplyInvoiceReceiptInput,
  BillingAddressRecord,
  InvoiceReceiptRecord,
  UpsertBillingAddressInput,
} from "../types/receipt.types";

/**
 * Customer-side invoicing (发票) writes — 抬头簿 CRUD + 申请开票
 * (billing_addresses / invoice_receipts, 52_billing.sql):
 *   apply → invoice_receipts 'applying' with the address SNAPSHOTTED into
 *   company_info/bank_info/address_info (地址三层 SoT 第三层:值快照非外键 —
 *   later address edits never move a filed application). The operator side
 *   (admin 发票台账,已在产) drives applying → approved/issued/sent.
 *
 * Eligibility: the bill is the tenant's, undeleted, bill_status='paid' —
 * ANY bill_type (直接订阅付款 normal/one_off 与 预付款扣费 prepaid_statement
 * 两个来源同栈,owner 2026-08-21)。v1 整单开票不拆票:同一账单已有
 * 非 rejected/voided 申请即拒(DDL 支持拆票,拆票面登记后置)。
 */
@Injectable()
export class PgReceiptRepository {
  constructor(@Inject(COMMERCE_PG_POOL) private readonly pool: Pool) {}

  // ── 抬头簿 ────────────────────────────────────────────────────────────────

  async listAddresses(tenantId: string): Promise<BillingAddressRecord[]> {
    const res = await this.pool.query<AddressRow>(
      `${ADDRESS_SELECT}
        where ba.tenant_id = $1 and ba.deleted_at is null
        order by ba.is_default desc, ba.created_at desc`,
      [tenantId],
    );
    return res.rows.map(mapAddress);
  }

  async createAddress(
    input: UpsertBillingAddressInput,
  ): Promise<BillingAddressRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      // 首条抬头自动成为默认(申请弹窗有默认可选);显式 isDefault 则挤掉旧默认。
      const hasAny = await client.query(
        `select 1 from billing.billing_addresses
          where tenant_id = $1 and deleted_at is null limit 1`,
        [input.tenantId],
      );
      const makeDefault = input.isDefault || (hasAny.rowCount ?? 0) === 0;
      if (makeDefault) await this.clearDefaultTx(client, input.tenantId);
      const res = await client.query<{ id: string }>(
        `insert into billing.billing_addresses (
           tenant_id, invoice_tax_type, title, tax_no, phone, address,
           bank_name, bank_account, is_default, created_by, created_at, updated_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), now())
         returning id`,
        [
          input.tenantId,
          input.invoiceTaxType,
          input.title,
          input.taxNo ?? null,
          input.phone ?? null,
          input.address ?? null,
          input.bankName ?? null,
          input.bankAccount ?? null,
          makeDefault,
          input.userId,
        ],
      );
      await client.query("commit");
      return (await this.getAddress(res.rows[0]!.id, input.tenantId))!;
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  async updateAddress(
    id: string,
    input: UpsertBillingAddressInput,
  ): Promise<BillingAddressRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      if (input.isDefault) await this.clearDefaultTx(client, input.tenantId);
      const res = await client.query(
        `update billing.billing_addresses set
           invoice_tax_type = $3, title = $4, tax_no = $5, phone = $6,
           address = $7, bank_name = $8, bank_account = $9,
           is_default = (is_default or $10), updated_by = $11, updated_at = now()
         where id = $1 and tenant_id = $2 and deleted_at is null`,
        [
          id,
          input.tenantId,
          input.invoiceTaxType,
          input.title,
          input.taxNo ?? null,
          input.phone ?? null,
          input.address ?? null,
          input.bankName ?? null,
          input.bankAccount ?? null,
          input.isDefault ?? false,
          input.userId,
        ],
      );
      await client.query("commit");
      if ((res.rowCount ?? 0) === 0) return null;
      return this.getAddress(id, input.tenantId);
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  async setDefaultAddress(
    id: string,
    tenantId: string,
    userId: string,
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await this.clearDefaultTx(client, tenantId);
      const res = await client.query(
        `update billing.billing_addresses
            set is_default = true, updated_by = $3, updated_at = now()
          where id = $1 and tenant_id = $2 and deleted_at is null`,
        [id, tenantId, userId],
      );
      await client.query("commit");
      return (res.rowCount ?? 0) > 0;
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  /** 软删(申请单已快照抬头,删除不影响历史)。 */
  async deleteAddress(
    id: string,
    tenantId: string,
    userId: string,
  ): Promise<boolean> {
    const res = await this.pool.query(
      `update billing.billing_addresses
          set deleted_at = now(), is_default = false, updated_by = $3, updated_at = now()
        where id = $1 and tenant_id = $2 and deleted_at is null`,
      [id, tenantId, userId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  private async getAddress(
    id: string,
    tenantId: string,
  ): Promise<BillingAddressRecord | null> {
    const res = await this.pool.query<AddressRow>(
      `${ADDRESS_SELECT} where ba.id = $1 and ba.tenant_id = $2 and ba.deleted_at is null`,
      [id, tenantId],
    );
    const row = res.rows[0];
    return row ? mapAddress(row) : null;
  }

  private async clearDefaultTx(
    client: PoolClient,
    tenantId: string,
  ): Promise<void> {
    await client.query(
      `update billing.billing_addresses set is_default = false, updated_at = now()
        where tenant_id = $1 and is_default and deleted_at is null`,
      [tenantId],
    );
  }

  // ── 发票申请 ──────────────────────────────────────────────────────────────

  async listReceipts(
    tenantId: string,
    limit = 100,
  ): Promise<InvoiceReceiptRecord[]> {
    const res = await this.pool.query<ReceiptRow>(
      `${RECEIPT_SELECT}
        where ir.tenant_id = $1 and ir.deleted_at is null
        order by ir.created_at desc
        limit $2`,
      [tenantId, limit],
    );
    return res.rows.map(mapReceipt);
  }

  /**
   * Customer application. Coded errors the service maps to HTTP:
   *   receipt_bill_not_found / receipt_bill_not_paid /
   *   receipt_already_applied / receipt_address_not_found /
   *   receipt_type_mismatch / receipt_special_needs_tax_no
   */
  async applyReceipt(
    input: ApplyInvoiceReceiptInput,
  ): Promise<InvoiceReceiptRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");

      const billRes = await client.query<{
        id: string;
        payable_amount: string;
        currency: string;
        bill_status: string;
      }>(
        `select id, payable_amount::text as payable_amount,
                coalesce(currency, 'CNY') as currency, bill_status
           from billing.invoices
          where id = $1 and tenant_id = $2 and deleted_at is null
          for update`,
        [input.billId, input.tenantId],
      );
      const bill = billRes.rows[0];
      if (!bill) throw new Error("receipt_bill_not_found");
      if (bill.bill_status !== "paid") throw new Error("receipt_bill_not_paid");

      // v1 整单开票不拆票:活跃申请(非 rejected/voided)存在即拒
      const dup = await client.query(
        `select 1 from billing.invoice_receipts
          where bill_id = $1 and deleted_at is null
            and invoice_status not in ('rejected', 'voided')
          limit 1`,
        [input.billId],
      );
      if ((dup.rowCount ?? 0) > 0) throw new Error("receipt_already_applied");

      const addrRes = await client.query<AddressRow>(
        `${ADDRESS_SELECT} where ba.id = $1 and ba.tenant_id = $2 and ba.deleted_at is null`,
        [input.addressId, input.tenantId],
      );
      const addr = addrRes.rows[0];
      if (!addr) throw new Error("receipt_address_not_found");

      // 类型约束:专票类别(electronic_special/paper_special)只能用专票抬头,
      // 普票(electronic_general)只能用普票抬头;专票抬头必须有税号+开户信息。
      const wantsSpecial = input.invoiceType !== "electronic_general";
      if (wantsSpecial !== (addr.invoice_tax_type === "special")) {
        throw new Error("receipt_type_mismatch");
      }
      if (
        wantsSpecial &&
        (!addr.tax_no || !addr.bank_name || !addr.bank_account)
      ) {
        throw new Error("receipt_special_needs_tax_no");
      }

      const companyInfo = {
        title: addr.title,
        taxNo: addr.tax_no,
        phone: addr.phone,
        address: addr.address,
        bankName: addr.bank_name,
        bankAccount: addr.bank_account,
      };
      const bankInfo = wantsSpecial
        ? { bankName: addr.bank_name, bankAccount: addr.bank_account }
        : null;
      const addressInfo =
        input.invoiceType === "paper_special"
          ? { address: addr.address, phone: addr.phone }
          : null;

      const res = await client.query<{ id: string }>(
        `insert into billing.invoice_receipts (
           tenant_id, bill_id, invoice_no, invoice_type, invoice_tax_type,
           invoice_title, tax_no, company_info, bank_info, address_info,
           invoice_amount, tax_amount, currency, invoice_status,
           created_by_type, created_by_id, created_at, updated_at
         ) values (
           $1, $2, $3, $4, $5,
           $6, $7, $8::jsonb, $9::jsonb, $10::jsonb,
           $11, 0, $12, 'applying',
           'customer', $13, now(), now()
         ) returning id`,
        [
          input.tenantId,
          input.billId,
          visibleCode("FAP"),
          input.invoiceType,
          addr.invoice_tax_type,
          addr.title,
          addr.tax_no,
          JSON.stringify(companyInfo),
          bankInfo ? JSON.stringify(bankInfo) : null,
          addressInfo ? JSON.stringify(addressInfo) : null,
          bill.payable_amount,
          bill.currency,
          input.userId,
        ],
      );
      await client.query("commit");
      const record = await this.getReceipt(res.rows[0]!.id, input.tenantId);
      if (!record) throw new Error("receipt_readback_failed");
      return record;
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  private async getReceipt(
    id: string,
    tenantId: string,
  ): Promise<InvoiceReceiptRecord | null> {
    const res = await this.pool.query<ReceiptRow>(
      `${RECEIPT_SELECT} where ir.id = $1 and ir.tenant_id = $2 and ir.deleted_at is null`,
      [id, tenantId],
    );
    const row = res.rows[0];
    return row ? mapReceipt(row) : null;
  }
}

interface AddressRow {
  id: string;
  invoice_tax_type: "general" | "special";
  title: string;
  tax_no: string | null;
  phone: string | null;
  address: string | null;
  bank_name: string | null;
  bank_account: string | null;
  is_default: boolean;
  created_at: Date;
}

const ADDRESS_SELECT = `
  select ba.id, ba.invoice_tax_type, ba.title, ba.tax_no, ba.phone, ba.address,
         ba.bank_name, ba.bank_account, ba.is_default, ba.created_at
    from billing.billing_addresses ba`;

function mapAddress(r: AddressRow): BillingAddressRecord {
  return {
    id: r.id,
    invoiceTaxType: r.invoice_tax_type,
    title: r.title,
    taxNo: r.tax_no,
    phone: r.phone,
    address: r.address,
    bankName: r.bank_name,
    bankAccount: r.bank_account,
    isDefault: r.is_default,
    createdAt: r.created_at,
  };
}

interface ReceiptRow {
  id: string;
  invoice_no: string;
  bill_id: string;
  bill_no: string | null;
  invoice_type: InvoiceReceiptRecord["invoiceType"];
  invoice_tax_type: "general" | "special";
  invoice_title: string;
  invoice_amount: string;
  currency: string;
  invoice_status: InvoiceReceiptRecord["invoiceStatus"];
  status_remark: string | null;
  invoice_file_url: string | null;
  express_company: string | null;
  express_no: string | null;
  issued_at: Date | null;
  send_at: Date | null;
  created_at: Date;
}

const RECEIPT_SELECT = `
  select ir.id, ir.invoice_no, ir.bill_id, inv.bill_no,
         ir.invoice_type, ir.invoice_tax_type, ir.invoice_title,
         ir.invoice_amount::text as invoice_amount,
         coalesce(ir.currency, 'CNY') as currency,
         ir.invoice_status, ir.status_remark, ir.invoice_file_url,
         ir.express_company, ir.express_no, ir.issued_at, ir.send_at,
         ir.created_at
    from billing.invoice_receipts ir
    left join billing.invoices inv on inv.id = ir.bill_id`;

function mapReceipt(r: ReceiptRow): InvoiceReceiptRecord {
  return {
    id: r.id,
    invoiceNo: r.invoice_no,
    billId: r.bill_id,
    billNo: r.bill_no,
    invoiceType: r.invoice_type,
    invoiceTaxType: r.invoice_tax_type,
    invoiceTitle: r.invoice_title,
    invoiceAmount: r.invoice_amount,
    currency: r.currency,
    invoiceStatus: r.invoice_status,
    statusRemark: r.status_remark,
    invoiceFileUrl: r.invoice_file_url,
    expressCompany: r.express_company,
    expressNo: r.express_no,
    issuedAt: r.issued_at,
    sendAt: r.send_at,
    createdAt: r.created_at,
  };
}

// 可视码:{PREFIX}-{YYYYMM}-{10位},与 ORD/INV/PAY/TXN 同规(唯一约束兜底防重)。
function visibleCode(prefix: string): string {
  const now = new Date();
  const ym = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const suffix = randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
  return `${prefix}-${ym}-${suffix}`;
}
