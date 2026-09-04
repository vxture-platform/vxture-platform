import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { COMMERCE_PG_POOL } from "../tokens";
import type {
  InvoiceRecord,
  InvoiceItemRecord,
  InvoiceDetail,
  CreditRecord,
  ListInvoicesParams,
  ListInvoicesResult,
  CreateInvoiceInput,
  TenantBillingOverview,
  UpdateInvoiceStatusInput,
} from "../types/billing.types";

interface InvoiceRow {
  id: string;
  tenant_id: string;
  bill_no: string;
  subscription_id: string | null;
  bill_cycle: string;
  cycle_start_date: Date;
  cycle_end_date: Date;
  total_amount: string;
  discount_amount: string;
  payable_amount: string;
  paid_amount: string;
  currency: string;
  bill_status: string;
  bill_type: string | null;
  paid_at: Date | null;
  payment_method: string | null;
  transaction_no: string | null;
  operator_id: string | null;
  operate_remark: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

interface InvoiceItemRow {
  id: string;
  bill_id: string;
  tenant_id: string;
  workspace_id: string | null;
  product_id: string | null;
  metric_key: string | null;
  subscription_id: string | null;
  item_name: string;
  item_type: string;
  item_unit: string | null;
  quantity: string;
  unit_price: string;
  total_amount: string;
  usage_summary_ref: string | null;
  remark: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

interface CreditRow {
  id: string;
  tenant_id: string;
  currency: string;
  balance: string;
  total_granted: string;
  total_consumed: string;
  version: number;
  updated_at: Date;
}

@Injectable()
export class PgBillingRepository {
  constructor(@Inject(COMMERCE_PG_POOL) private readonly pool: Pool) {}

  /** 租户账单概览:状态计数 + 累计实收 + 本月实付,一次往返、库内聚合。 */
  async getTenantBillingOverview(
    tenantId: string,
  ): Promise<TenantBillingOverview> {
    const res = await this.pool.query<{
      total: string;
      paid: string;
      unpaid: string;
      overdue: string;
      cancelled: string;
      paid_total: string;
      paid_this_month: string;
      currency: string | null;
    }>(
      `select count(*)::text as total,
              count(*) filter (where i.bill_status = 'paid')::text as paid,
              count(*) filter (where i.bill_status in ('unpaid', 'paying', 'partial'))::text as unpaid,
              count(*) filter (where i.bill_status = 'overdue')::text as overdue,
              count(*) filter (where i.bill_status = 'cancelled')::text as cancelled,
              coalesce(sum(i.paid_amount), 0)::numeric(14,2)::text as paid_total,
              (select coalesce(sum(p.paid_amount), 0)::numeric(14,2)::text
                 from billing.payments p
                where p.tenant_id = $1 and p.pay_status = 'paid'
                  and p.paid_at >= date_trunc('month', now())
                  and p.paid_at <  date_trunc('month', now()) + interval '1 month') as paid_this_month,
              (select i2.currency from billing.invoices i2
                where i2.tenant_id = $1 and i2.deleted_at is null
                order by i2.created_at desc limit 1) as currency
         from billing.invoices i
        where i.tenant_id = $1 and i.deleted_at is null`,
      [tenantId],
    );
    const r = res.rows[0];
    return {
      total: Number(r?.total ?? 0),
      paid: Number(r?.paid ?? 0),
      unpaid: Number(r?.unpaid ?? 0),
      overdue: Number(r?.overdue ?? 0),
      cancelled: Number(r?.cancelled ?? 0),
      paidTotal: r?.paid_total ?? "0.00",
      paidThisMonth: r?.paid_this_month ?? "0.00",
      currency: r?.currency ?? null,
    };
  }

  async listInvoices(params: ListInvoicesParams): Promise<ListInvoicesResult> {
    const conditions: string[] = ["i.deleted_at is null"];
    const values: unknown[] = [];
    let idx = 1;

    if (params.tenantId) {
      conditions.push(`i.tenant_id = $${idx++}`);
      values.push(params.tenantId);
    }
    if (params.billStatus) {
      conditions.push(`i.bill_status = $${idx++}`);
      values.push(params.billStatus);
    }
    if (params.billCycle) {
      conditions.push(`i.bill_cycle = $${idx++}`);
      values.push(params.billCycle);
    }
    if (params.billType) {
      conditions.push(`i.bill_type = $${idx++}`);
      values.push(params.billType);
    }

    const where = conditions.join(" and ");
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const [countResult, rowsResult] = await Promise.all([
      this.pool.query<{ count: string }>(
        `select count(*) as count from billing.invoices i where ${where}`,
        values,
      ),
      this.pool.query<InvoiceRow>(
        `select i.*
         from billing.invoices i
         where ${where}
         order by i.created_at desc
         limit $${idx} offset $${idx + 1}`,
        [...values, pageSize, offset],
      ),
    ]);

    return {
      total: parseInt(countResult.rows[0]?.count ?? "0", 10),
      items: rowsResult.rows.map(this.mapInvoice),
    };
  }

  async getInvoiceById(id: string): Promise<InvoiceRecord | null> {
    const result = await this.pool.query<InvoiceRow>(
      `select * from billing.invoices where id = $1 and deleted_at is null limit 1`,
      [id],
    );
    const row = result.rows[0];
    return row ? this.mapInvoice(row) : null;
  }

  async getInvoiceDetail(id: string): Promise<InvoiceDetail | null> {
    const [invoiceResult, itemsResult] = await Promise.all([
      this.pool.query<InvoiceRow>(
        `select * from billing.invoices where id = $1 and deleted_at is null limit 1`,
        [id],
      ),
      this.pool.query<InvoiceItemRow>(
        `select * from billing.invoice_items where bill_id = $1 and deleted_at is null order by created_at`,
        [id],
      ),
    ]);

    const invoice = invoiceResult.rows[0];
    if (!invoice) return null;

    return {
      ...this.mapInvoice(invoice),
      items: itemsResult.rows.map(this.mapItem),
    };
  }

  async createInvoice(input: CreateInvoiceInput): Promise<InvoiceDetail> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");

      const totalAmount = input.items.reduce((s, i) => s + i.totalAmount, 0);
      const billNo = generateBillNo(input.billCycle);

      const invoiceResult = await client.query<InvoiceRow>(
        `insert into billing.invoices (
          tenant_id, bill_no, subscription_id, bill_cycle,
          cycle_start_date, cycle_end_date,
          total_amount, discount_amount, payable_amount, paid_amount,
          currency, bill_status, bill_type, created_by_type, created_by_id, created_at, updated_at
        ) values (
          $1, $2, $3, $4, $5, $6,
          $7, 0, $7, 0,
          $8, 'unpaid', $9, 'system', $10, now(), now()
        ) returning *`,
        [
          input.tenantId,
          billNo,
          input.subscriptionId ?? null,
          input.billCycle,
          input.cycleStartDate,
          input.cycleEndDate,
          totalAmount,
          input.currency ?? "CNY",
          input.billType ?? "normal",
          input.createdBy ?? null,
        ],
      );

      const invoice = invoiceResult.rows[0]!;

      const items: InvoiceItemRecord[] = [];
      for (const item of input.items) {
        const itemResult = await client.query<InvoiceItemRow>(
          `insert into billing.invoice_items (
            bill_id, tenant_id, workspace_id, product_id, metric_key, subscription_id,
            item_name, item_type, item_unit, quantity, unit_price, total_amount,
            remark, created_at, updated_at
          ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), now())
          returning *`,
          [
            invoice.id,
            input.tenantId,
            item.workspaceId ?? null,
            item.productId ?? null,
            item.metricKey ?? null,
            item.subscriptionId ?? null,
            item.itemName,
            item.itemType,
            item.itemUnit ?? null,
            item.quantity,
            item.unitPrice,
            item.totalAmount,
            item.remark ?? null,
          ],
        );
        items.push(this.mapItem(itemResult.rows[0]!));
      }

      await client.query("commit");
      return { ...this.mapInvoice(invoice), items };
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  async updateInvoiceStatus(
    id: string,
    input: UpdateInvoiceStatusInput,
  ): Promise<InvoiceRecord | null> {
    // transaction_no 不在 SET 列表里：它是 `_no` 锚点列（98_column_locks 规则②），
    // 应用角色 platform_svc 对它没有 UPDATE 权限——列级权限按 SET 列表判，哪怕值是
    // NULL/coalesce 也会整条 42501。流水↔账单的关联在 transactions.bill_id 上，
    // 读侧按它派生；input.transactionNo 仅用于流水行，不再回写账单。
    const result = await this.pool.query<InvoiceRow>(
      `update billing.invoices set
        bill_status   = $2,
        paid_at       = coalesce($3, paid_at),
        payment_method = coalesce($4, payment_method),
        operate_remark = coalesce($5, operate_remark),
        paid_amount   = coalesce($6, paid_amount),
        updated_at    = now()
       where id = $1 and deleted_at is null
       returning *`,
      [
        id,
        input.billStatus,
        input.paidAt ?? null,
        input.paymentMethod ?? null,
        input.operateRemark ?? null,
        input.paidAmount ?? null,
      ],
    );
    const row = result.rows[0];
    return row ? this.mapInvoice(row) : null;
  }

  async getCreditByTenantId(tenantId: string): Promise<CreditRecord | null> {
    const result = await this.pool.query<CreditRow>(
      `select * from billing.credits where tenant_id = $1 limit 1`,
      [tenantId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      tenantId: row.tenant_id,
      currency: row.currency,
      balance: row.balance,
      totalGranted: row.total_granted,
      totalConsumed: row.total_consumed,
      version: row.version,
      updatedAt: row.updated_at,
    };
  }

  private mapInvoice(row: InvoiceRow): InvoiceRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      billNo: row.bill_no,
      subscriptionId: row.subscription_id,
      billCycle: row.bill_cycle,
      cycleStartDate: row.cycle_start_date,
      cycleEndDate: row.cycle_end_date,
      totalAmount: row.total_amount,
      discountAmount: row.discount_amount,
      payableAmount: row.payable_amount,
      paidAmount: row.paid_amount,
      currency: row.currency,
      billStatus: row.bill_status,
      billType: row.bill_type,
      paidAt: row.paid_at,
      paymentMethod: row.payment_method,
      transactionNo: row.transaction_no,
      operatorId: row.operator_id,
      operateRemark: row.operate_remark,
      createdBy: row.created_by,
      updatedBy: row.updated_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    };
  }

  private mapItem(row: InvoiceItemRow): InvoiceItemRecord {
    return {
      id: row.id,
      billId: row.bill_id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      productId: row.product_id,
      metricKey: row.metric_key,
      subscriptionId: row.subscription_id,
      itemName: row.item_name,
      itemType: row.item_type,
      itemUnit: row.item_unit,
      quantity: row.quantity,
      unitPrice: row.unit_price,
      totalAmount: row.total_amount,
      usageSummaryRef: row.usage_summary_ref,
      remark: row.remark,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    };
  }
}

function generateBillNo(billCycle: string): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `INV-${billCycle}-${ts}${rand}`;
}
