/**
 * payments.router.ts - 支付流水运营路由
 * @package @vxture/bff-admin
 *
 * Description: 支付流水读接口，接 billing.payments join billing.invoices（取账单号/状态/金额）
 *   + join tenancy.tenants（取租户码/名/类型）+ left join tenancy.tenant_profiles（行业）。
 *   前端契约见 portals/admin/src/api/admin-bff.ts::fetchPaymentOperations → GET /api/payments。
 *   核销等写路径（POST /api/payments/:id/verify）不在本只读 router 范围。
 *
 * 18-schema remap（cutover 后）：commerce→billing（表复数）；tenant.tenant→tenancy.tenants，
 *   展示字段迁 tenancy.tenant_profiles。金融例外：billing.payments 无 deleted_at（作废走 pay_status），
 *   故列表不加软删过滤；billing.invoices 有 deleted_at 但仍内联（bill_id NOT NULL，行仍在）。
 *   新库无 province/city → region 走空态兜底；operatorName 无来源（actor_id 裸值）→ 默认兜底。
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

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool, PoolClient } from "pg";
import { assertAnyCapability } from "../auth/capability";
import { RequireStepUp } from "../auth/step-up.decorator";
import { ADMIN_BFF_RO_POOL, ADMIN_BFF_RW_POOL } from "../tokens";
import type {
  BillingBillStatus,
  BillingBillType,
  OrderOfflinePaymentType,
  OrderPaySource,
  OrderPaymentStatus,
  PaymentOperationRecord,
  PaymentReconciliationStatus,
  RequestContext,
  TenantOperationType,
} from "../types/console.types";

@Controller("api/payments")
export class PaymentsRouter {
  constructor(
    @Inject(ADMIN_BFF_RO_POOL) private readonly pool: Pool,
    @Inject(ADMIN_BFF_RW_POOL) private readonly rwPool: Pool,
  ) {}

  @Get()
  async listPayments(
    @Req() req: Request & RequestContext,
  ): Promise<PaymentOperationRecord[]> {
    assertCanReadPayments(req);

    const { rows } = await this.pool.query<PaymentRow>(PAYMENTS_SQL);
    return rows.map(mapPaymentRow);
  }

  // POST /api/payments/:paymentId/verify —— 线下支付核销（事务）。
  // 前置/幂等：仅 pending / pending_verify 可核销；已 paid/failed/closed/refunding 拒绝重复核销。
  // 写：① append-only insert billing.transactions（结算流水，预付池余额快照不变=postpaid 结算不动池）；
  //     ② billing.payments → paid + paid_at + transaction_id + actor；
  //     ③ 回写 billing.invoices(paid_amount 累加 / bill_status paid|partial / paid_at)。
  @Post(":paymentId/verify")
  @RequireStepUp()
  async verifyPayment(
    @Req() req: Request & RequestContext,
    @Param("paymentId") paymentId: string,
    @Body() body: PaymentActionBody,
  ): Promise<PaymentOperationRecord> {
    assertCanSettlePayments(req);
    const actorId = requireUuid(
      req.user?.id,
      "Invalid platform admin principal",
    );
    const targetId = requireUuid(paymentId, "Invalid payment id");
    const remark = normalizeRemark(body?.remark);

    const client = await this.rwPool.connect();
    try {
      await client.query("begin");

      const payResult = await client.query<PaymentLockRow>(
        `select id, tenant_id, bill_id, pay_status, pay_source, pay_channel,
                total_amount, paid_amount, currency, pay_order_no
           from billing.payments
          where id = $1
          for update`,
        [targetId],
      );
      const payment = payResult.rows[0];
      if (!payment) {
        throw new NotFoundException("Payment not found");
      }
      if (
        payment.pay_status !== "pending" &&
        payment.pay_status !== "pending_verify"
      ) {
        throw new BadRequestException(
          `Payment in status ${payment.pay_status} cannot be verified`,
        );
      }

      // In-flight-order fencing (product_321 P9): the ledger's verify only
      // settles money — it never activates the subscription nor finalizes
      // reserved vouchers, so a ledger-side verify of an order bill is the
      // O6.1-class bypass (invoice partial + voucher stuck reserved + sweep
      // livelock). Route these through the order-side confirm.
      await assertNotInFlightOrderBill(client, payment.bill_id);

      const invoiceResult = await client.query<InvoiceLockRow>(
        `select id, payable_amount, paid_amount, bill_status
           from billing.invoices
          where id = $1 and deleted_at is null
          for update`,
        [payment.bill_id],
      );
      const invoice = invoiceResult.rows[0];
      if (!invoice) {
        throw new BadRequestException("Related invoice not found");
      }

      const settleAmount = payment.total_amount;

      // 结算流水（append-only）。trade_type=recharge（客户入账结算）；balance_before/after 取预付池
      // 现值快照——postpaid 发票结算不改变预付池，故 before=after，不污染重建对账链。
      const txnResult = await client.query<{ id: string }>(
        `insert into billing.transactions (
            tenant_id, bill_id, transaction_no, trade_type, source_method,
            amount, currency, balance_before, balance_after, trade_status,
            related_no, remark, actor_type, actor_id
         ) values (
            $1, $2,
            'TXN-' || to_char(now(), 'YYYYMM') || '-' ||
              lpad((floor(random() * 100000000))::bigint::text, 8, '0'),
            'recharge', $3, $4::numeric, $5,
            coalesce((select balance from billing.credits where tenant_id = $1), 0),
            coalesce((select balance from billing.credits where tenant_id = $1), 0),
            'success', $6, $7, 'operator', $8
         )
         returning id`,
        [
          payment.tenant_id,
          payment.bill_id,
          normalizeSourceMethod(payment.pay_source),
          settleAmount,
          payment.currency ?? "CNY",
          payment.pay_order_no,
          remark ?? "线下支付核销",
          actorId,
        ],
      );
      const transactionId = txnResult.rows[0]?.id ?? null;

      await client.query(
        `update billing.payments set
            pay_status     = 'paid',
            paid_amount    = total_amount,
            paid_at        = now(),
            transaction_id = $2,
            actor_type     = 'operator',
            actor_id       = $3,
            operate_remark = coalesce($4, operate_remark),
            status_msg     = coalesce($4, status_msg),
            updated_at     = now()
          where id = $1`,
        [targetId, transactionId, actorId, remark],
      );

      // 发票回写：paid_amount 累加本笔；全额清偿→paid+paid_at，否则 partial（幂等键在支付前置态）。
      await client.query(
        `update billing.invoices set
            paid_amount = paid_amount + $2::numeric,
            bill_status = case
              when (paid_amount + $2::numeric) >= payable_amount then 'paid'
              else 'partial'
            end,
            paid_at = case
              when (paid_amount + $2::numeric) >= payable_amount then now()
              else paid_at
            end,
            updated_at = now()
          where id = $1`,
        [payment.bill_id, settleAmount],
      );

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }

    return this.loadPaymentRecord(targetId);
  }

  // POST /api/payments/:paymentId/reject —— 线下支付驳回（事务）。
  // 前置：仅 pending / pending_verify 可驳回。写：billing.payments → failed + closed_at +
  //   status_msg/operate_remark + actor。不写发票/流水（驳回不产生资金入账）。
  @Post(":paymentId/reject")
  async rejectPayment(
    @Req() req: Request & RequestContext,
    @Param("paymentId") paymentId: string,
    @Body() body: PaymentActionBody,
  ): Promise<PaymentOperationRecord> {
    assertCanManagePayments(req);
    const actorId = requireUuid(
      req.user?.id,
      "Invalid platform admin principal",
    );
    const targetId = requireUuid(paymentId, "Invalid payment id");
    const remark = normalizeRemark(body?.remark);

    const client = await this.rwPool.connect();
    try {
      await client.query("begin");

      const payResult = await client.query<{
        pay_status: string;
        bill_id: string;
      }>(
        `select pay_status, bill_id from billing.payments where id = $1 for update`,
        [targetId],
      );
      const payment = payResult.rows[0];
      if (!payment) {
        throw new NotFoundException("Payment not found");
      }
      if (
        payment.pay_status !== "pending" &&
        payment.pay_status !== "pending_verify"
      ) {
        throw new BadRequestException(
          `Payment in status ${payment.pay_status} cannot be rejected`,
        );
      }

      // In-flight-order fencing (product_321 P9): a ledger-side reject of a
      // declared order leg would strip the P8b release orchestration (voucher
      // stuck reserved, no pricing rollback, no payment_rejected history, no
      // step-up). Route these through the order-side payment-reject.
      await assertNotInFlightOrderBill(client, payment.bill_id);

      await client.query(
        `update billing.payments set
            pay_status     = 'failed',
            status_msg     = coalesce($2, status_msg),
            operate_remark = coalesce($2, operate_remark),
            closed_at      = now(),
            actor_type     = 'operator',
            actor_id       = $3,
            updated_at     = now()
          where id = $1`,
        [targetId, remark, actorId],
      );

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }

    return this.loadPaymentRecord(targetId);
  }

  // 写后回读单条支付明细（RO 池，同库读己写；与 admin-roles.router 回读约定一致），复用列表映射。
  private async loadPaymentRecord(
    paymentId: string,
  ): Promise<PaymentOperationRecord> {
    const { rows } = await this.pool.query<PaymentRow>(PAYMENT_DETAIL_SQL, [
      paymentId,
    ]);
    const row = rows[0];
    if (!row) {
      throw new NotFoundException("Payment not found");
    }
    return mapPaymentRow(row);
  }
}

// TD-027: payment domain codes. reject = routine manage (no money movement).
// verify (核销) = 危 payment.settle: confirms cash received, appends the
// append-only transaction ledger and marks the invoice paid — effectively
// irreversible, hence a dedicated code + @RequireStepUp.
function assertCanReadPayments(req: Request & RequestContext): void {
  assertAnyCapability(req, [
    "commerce:payment.read",
    "commerce:payment.manage",
  ]);
}

function assertCanManagePayments(req: Request & RequestContext): void {
  assertAnyCapability(req, ["commerce:payment.manage"]);
}

function assertCanSettlePayments(req: Request & RequestContext): void {
  assertAnyCapability(req, ["commerce:payment.settle"]);
}

function toIso(value: Date | string | null): string {
  if (!value) return new Date(0).toISOString();
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toIsoNullable(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toNumber(value: string | number | null): number {
  if (value === null) return 0;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// billing.invoices.bill_status → BillingBillStatus（同集，兜底 unpaid）
const BILL_STATUSES: ReadonlySet<BillingBillStatus> = new Set([
  "unpaid",
  "paying",
  "paid",
  "partial",
  "cancelled",
  "overdue",
]);
function normalizeBillStatus(value: string | null): BillingBillStatus | null {
  if (!value) return null;
  return BILL_STATUSES.has(value as BillingBillStatus)
    ? (value as BillingBillStatus)
    : "unpaid";
}

// billing.invoices.bill_type（normal/one_off/adjustment/prepaid_statement）
// → BillingBillType（normal/adjust/supplement/prepaid）
function normalizeBillType(value: string | null): BillingBillType | null {
  if (!value) return null;
  if (value === "adjustment") return "adjust";
  if (value === "prepaid_statement") return "prepaid";
  if (value === "one_off") return "supplement";
  return "normal";
}

// billing.payments.pay_source（online/offline）→ OrderPaySource（online/offline/none）
function normalizePaySource(value: string | null): OrderPaySource {
  if (value === "online" || value === "offline") return value;
  return "none";
}

// billing.payments.offline_pay_type（bank_transfer/cash/check）
// → OrderOfflinePaymentType（bank_transfer/cash/other）
function normalizeOfflinePayType(
  value: string | null,
): OrderOfflinePaymentType | null {
  if (!value) return null;
  if (value === "bank_transfer" || value === "cash") return value;
  return "other";
}

// billing.payments.pay_status（pending/pending_verify/paid/failed/closed/refunding）
// 皆属 OrderPaymentStatus 超集，直接透传（兜底 pending）
const PAYMENT_STATUSES: ReadonlySet<OrderPaymentStatus> = new Set([
  "not_required",
  "unpaid",
  "pending",
  "pending_verify",
  "paid",
  "partial",
  "failed",
  "closed",
  "refunding",
]);
function normalizePaymentStatus(value: string | null): OrderPaymentStatus {
  if (!value) return "pending";
  return PAYMENT_STATUSES.has(value as OrderPaymentStatus)
    ? (value as OrderPaymentStatus)
    : "pending";
}

// 对账状态派生：无独立列，由账单状态 + 支付状态 + 金额比对推导。
function deriveReconciliationStatus(
  payStatus: OrderPaymentStatus,
  billStatus: BillingBillStatus | null,
  paidAmount: number,
  payableAmount: number,
): PaymentReconciliationStatus {
  if (billStatus === "cancelled") return "bill_cancelled";
  if (payStatus === "failed") return "failed";
  if (payStatus === "pending_verify") return "pending_verify";
  if (payableAmount > 0 && paidAmount > payableAmount) return "overpaid";
  if (payStatus === "paid" && payableAmount > 0 && paidAmount < payableAmount)
    return "partial";
  return "normal";
}

function mapPaymentRow(row: PaymentRow): PaymentOperationRecord {
  const billStatus = normalizeBillStatus(row.bill_status);
  const paymentStatus = normalizePaymentStatus(row.pay_status);
  const paidAmount = toNumber(row.paid_amount);
  const billPayableAmount = toNumber(row.bill_payable_amount);
  return {
    id: row.id,
    paymentNo: row.pay_order_no,
    tenantId: row.tenant_id,
    tenantCode: row.tenant_code,
    tenantName: row.tenant_name,
    tenantType: normalizeTenantType(row.tenant_type),
    region: "未设置",
    industry: row.industry ?? "未设置",
    billId: row.bill_id,
    billNo: row.bill_no,
    billStatus,
    billType: normalizeBillType(row.bill_type),
    billPayableAmount,
    billPaidAmount: toNumber(row.bill_paid_amount),
    subscriptionId: row.subscription_id,
    orderNo: null,
    servicePlanName: null,
    tierName: null,
    paySource: normalizePaySource(row.pay_source),
    payChannel: row.pay_channel,
    payMethod: row.pay_method,
    offlinePayType: normalizeOfflinePayType(row.offline_pay_type),
    offlinePayerName: row.offline_payer_name,
    totalAmount: toNumber(row.total_amount),
    paidAmount,
    currency: row.currency ?? "CNY",
    paymentStatus,
    reconciliationStatus: deriveReconciliationStatus(
      paymentStatus,
      billStatus,
      paidAmount,
      billPayableAmount,
    ),
    transactionId: row.transaction_id,
    channelOrderNo: row.channel_order_no,
    channelTransactionNo: row.channel_transaction_no,
    offlineEvidenceUrl: row.offline_evidence_url,
    statusMessage: row.status_msg,
    remark: row.operate_remark,
    operatorName: "系统",
    paidAt: toIsoNullable(row.paid_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function normalizeTenantType(value: string | null): TenantOperationType {
  return value === "personal" ? "individual" : "company";
}

const PAYMENTS_SQL = `
select
  p.id,
  p.pay_order_no,
  p.tenant_id,
  t.tenant_no::text                as tenant_code,
  t.name                           as tenant_name,
  t.type                           as tenant_type,
  profile.industry,
  p.bill_id,
  inv.bill_no,
  inv.bill_status,
  inv.bill_type,
  inv.payable_amount               as bill_payable_amount,
  inv.paid_amount                  as bill_paid_amount,
  inv.subscription_id,
  p.pay_source,
  p.pay_channel,
  p.pay_method,
  p.offline_pay_type,
  p.offline_payer_name,
  p.total_amount,
  p.paid_amount,
  p.currency,
  p.pay_status,
  p.status_msg,
  p.transaction_id,
  p.channel_order_no,
  p.channel_transaction_no,
  p.offline_evidence_url,
  p.operate_remark,
  p.paid_at,
  p.created_at,
  p.updated_at
from billing.payments p
join billing.invoices inv on inv.id = p.bill_id
join tenancy.tenants t on t.id = p.tenant_id
left join tenancy.tenant_profiles profile on profile.tenant_id = t.id
order by p.created_at desc
limit 500
`;

// ── 写路径辅助（核销/驳回） ──────────────────────────────────────────────────

// 版本位/变体位刻意不卡：判据与理由见 governance.shared.ts 的 `UUID_RE` 注释
//（校验器不该比存储层更严；种子 id 的变体位是段值本身，如 …-4000-d000-…）。
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(value: string | undefined, message: string): string {
  if (!value || !UUID_RE.test(value)) {
    throw new UnauthorizedException(message);
  }
  return value;
}

// 备注归一：去空白，空串→null，截断到 transactions.remark(varchar 512) 上限。
/**
 * In-flight-order bill fencing (product_321 P9): bills of a pending order
 * must be settled/rejected from the order side — the ledger endpoints lack
 * fulfilment, voucher finalize/release and the payment_rejected trail. 409
 * with a pointer, not a silent bypass. 在途 = billing.orders 未终态
 * （product_330 P1-b2：订单实体是唯一判据）。
 */
async function assertNotInFlightOrderBill(
  client: PoolClient,
  billId: string | null,
): Promise<void> {
  if (!billId) return;
  const res = await client.query<{ order_no: string }>(
    `select o.order_no
       from billing.invoices i
       join billing.orders o on o.id = i.order_id
      where i.id = $1
        and o.status in ('pending_payment', 'pending_verify', 'paid')
      limit 1`,
    [billId],
  );
  const hit = res.rows[0];
  if (hit) {
    throw new ConflictException(
      `该账单关联在途订单（${hit.order_no}），请从订单侧处理：确认收款走 offline-payment-confirm，驳回申报走 payment-reject`,
    );
  }
}

function normalizeRemark(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > 512 ? trimmed.slice(0, 512) : trimmed;
}

// billing.payments.pay_source(online/offline) → transactions.source_method CHECK 集，兜底 operator。
function normalizeSourceMethod(value: string | null): string {
  if (value === "online" || value === "offline") return value;
  return "operator";
}

interface PaymentActionBody {
  remark?: unknown;
}

interface PaymentLockRow {
  id: string;
  tenant_id: string;
  bill_id: string;
  pay_status: string;
  pay_source: string | null;
  pay_channel: string | null;
  total_amount: string;
  paid_amount: string | null;
  currency: string | null;
  pay_order_no: string;
}

interface InvoiceLockRow {
  id: string;
  payable_amount: string;
  paid_amount: string | null;
  bill_status: string;
}

// 单条回读：与 PAYMENTS_SQL 同列同 join，仅按 p.id 过滤（不改动既有列表 SQL）。
const PAYMENT_DETAIL_SQL = `
select
  p.id,
  p.pay_order_no,
  p.tenant_id,
  t.tenant_no::text                as tenant_code,
  t.name                           as tenant_name,
  t.type                           as tenant_type,
  profile.industry,
  p.bill_id,
  inv.bill_no,
  inv.bill_status,
  inv.bill_type,
  inv.payable_amount               as bill_payable_amount,
  inv.paid_amount                  as bill_paid_amount,
  inv.subscription_id,
  p.pay_source,
  p.pay_channel,
  p.pay_method,
  p.offline_pay_type,
  p.offline_payer_name,
  p.total_amount,
  p.paid_amount,
  p.currency,
  p.pay_status,
  p.status_msg,
  p.transaction_id,
  p.channel_order_no,
  p.channel_transaction_no,
  p.offline_evidence_url,
  p.operate_remark,
  p.paid_at,
  p.created_at,
  p.updated_at
from billing.payments p
join billing.invoices inv on inv.id = p.bill_id
join tenancy.tenants t on t.id = p.tenant_id
left join tenancy.tenant_profiles profile on profile.tenant_id = t.id
where p.id = $1
limit 1
`;

interface PaymentRow {
  id: string;
  pay_order_no: string;
  tenant_id: string;
  tenant_code: string;
  tenant_name: string;
  tenant_type: string | null;
  industry: string | null;
  bill_id: string | null;
  bill_no: string | null;
  bill_status: string | null;
  bill_type: string | null;
  bill_payable_amount: string | number | null;
  bill_paid_amount: string | number | null;
  subscription_id: string | null;
  pay_source: string | null;
  pay_channel: string | null;
  pay_method: string | null;
  offline_pay_type: string | null;
  offline_payer_name: string | null;
  total_amount: string | number | null;
  paid_amount: string | number | null;
  currency: string | null;
  pay_status: string | null;
  status_msg: string | null;
  transaction_id: string | null;
  channel_order_no: string | null;
  channel_transaction_no: string | null;
  offline_evidence_url: string | null;
  operate_remark: string | null;
  paid_at: Date | string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
}
