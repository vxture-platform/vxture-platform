/**
 * billing.router.ts - 账单运营路由
 * @package @vxture/bff-admin
 *
 * Description: 平台账单只读接口，接 billing schema（52_billing.sql，18-schema cutover 后）。
 *   列表 = billing.invoices join tenancy.tenants 取结算主体展示；
 *   详情 = 聚合 billing.invoice_items 行项 + billing.invoice_receipts 开票 + billing.payments 支付。
 *   写路径（作废/折扣/线下开票同步/审核）见 admin-app-completion-plan.md 商业化章节。
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
import { randomUUID } from "node:crypto";
import type { Request } from "express";
import type { Pool, PoolClient } from "pg";
import { assertAnyCapability } from "../auth/capability";
import { RequireStepUp } from "../auth/step-up.decorator";
import { ADMIN_BFF_RO_POOL, ADMIN_BFF_RW_POOL } from "../tokens";
import type {
  BillingBillStatus,
  BillingBillType,
  BillingDetailRecord,
  BillingInvoiceReceiptRecord,
  BillingInvoiceStatus,
  BillingInvoiceTaxType,
  BillingInvoiceType,
  BillingRecord,
  OrderInvoiceItemRecord,
  OrderOfflinePaymentType,
  OrderPaymentRecord,
  OrderPaymentStatus,
  OrderPaySource,
  RequestContext,
} from "../types/console.types";

@Controller("api/billing")
export class BillingRouter {
  constructor(
    @Inject(ADMIN_BFF_RO_POOL) private readonly pool: Pool,
    @Inject(ADMIN_BFF_RW_POOL) private readonly rwPool: Pool,
  ) {}

  @Get()
  async listBilling(
    @Req() req: Request & RequestContext,
  ): Promise<BillingRecord[]> {
    assertCanReadBilling(req);

    const { rows } = await this.pool.query<BillingListRow>(BILLING_LIST_SQL);
    return rows.map(mapBillingRow);
  }

  @Get(":billId")
  async getBilling(
    @Req() req: Request & RequestContext,
    @Param("billId") billId: string,
  ): Promise<BillingDetailRecord | null> {
    assertCanReadBilling(req);

    const headResult = await this.pool.query<BillingListRow>(
      BILLING_DETAIL_SQL,
      [billId],
    );
    const head = headResult.rows[0];
    if (!head) return null;

    const [itemsResult, receiptsResult, paymentsResult] = await Promise.all([
      this.pool.query<InvoiceItemRow>(INVOICE_ITEMS_SQL, [head.id]),
      this.pool.query<InvoiceReceiptRow>(INVOICE_RECEIPTS_SQL, [head.id]),
      this.pool.query<PaymentRow>(PAYMENTS_SQL, [head.id]),
    ]);

    return {
      ...mapBillingRow(head),
      invoiceItems: itemsResult.rows.map(mapInvoiceItemRow),
      paymentRecords: paymentsResult.rows.map(mapPaymentRow),
      invoiceReceipts: receiptsResult.rows.map(mapInvoiceReceiptRow),
      // 运营时间线无独立事件表来源，暂返回空数组（写路径落地后再回填）。
      operationTimeline: [],
    };
  }

  // ── 写路径（RW 池 + 事务）────────────────────────────────────────────────
  // TD-027 域码：账单 routine=billing.manage、发票 routine=invoice.manage；危码
  // discount/void 拆独立端点（(2b)/(3b)，billing.discount/invoice.void + step-up）。

  // (1) 线下开票同步：向 billing.invoice_receipts 追加一条运营手工登记的发票记录。
  @Post(":billId/offline-invoice-sync")
  async syncOfflineInvoice(
    @Req() req: Request & RequestContext,
    @Param("billId") billId: string,
    @Body() body: OfflineInvoiceSyncBody,
  ): Promise<BillingDetailRecord> {
    assertCanManageInvoiceReceipts(req);
    const operatorId = requireOperatorId(req);

    const invoiceNo = requireText(body?.invoiceNo, "invoiceNo", 64);
    const invoiceTitle = requireText(body?.invoiceTitle, "invoiceTitle", 256);
    const invoiceAmount = requireAmount(body?.invoiceAmount, "invoiceAmount");
    const taxAmount = optionalAmount(body?.taxAmount);
    const issuedAt = requireIso(body?.issuedAt, "issuedAt");
    const invoiceType = denormInvoiceType(body?.invoiceType);
    const invoiceTaxType = denormInvoiceTaxType(body?.invoiceTaxType);
    const invoiceStatus = denormOfflineInvoiceStatus(body?.invoiceStatus);
    const companyInfo = JSON.stringify({
      title: invoiceTitle,
      taxNo: body?.taxNo ?? null,
      source: "offline_operator_sync",
    });

    const client = await this.rwPool.connect();
    try {
      await client.query("begin");

      const bill = await this.lockBillForAction(client, billId);

      await client.query(INSERT_OFFLINE_RECEIPT_SQL, [
        bill.tenant_id,
        bill.id,
        invoiceNo,
        invoiceType,
        invoiceTaxType,
        invoiceTitle,
        emptyToNull(body?.taxNo),
        companyInfo,
        invoiceAmount,
        taxAmount,
        invoiceStatus,
        emptyToNull(body?.statusRemark),
        emptyToNull(body?.invoiceCode),
        emptyToNull(body?.invoiceElectronicNo),
        emptyToNull(body?.invoiceFileUrl),
        issuedAt,
        emptyToNull(body?.expressCompany),
        emptyToNull(body?.expressNo),
        optionalIso(body?.sendAt),
        operatorId,
      ]);

      const detail = await this.loadBillingDetail(client, bill.id);
      await client.query("commit");
      return detail as BillingDetailRecord;
    } catch (e) {
      await client.query("rollback");
      throw translateWriteError(e, "invoice_no 已存在，无法重复登记同步。");
    } finally {
      client.release();
    }
  }

  // (2) 账单动作：cancel/mark_overdue 原地改本账单；create_adjustment/create_supplement
  //     新建独立账单并返回新账单详情（前端据 id 差异跳转）。discount（减免应收）是危码，
  //     单独走 POST :billId/discount（billing.discount + step-up）。
  @Post(":billId/actions")
  async runBillAction(
    @Req() req: Request & RequestContext,
    @Param("billId") billId: string,
    @Body() body: BillActionBody,
  ): Promise<BillingDetailRecord> {
    assertCanManageBilling(req);
    const operatorId = requireOperatorId(req);
    const action = body?.action;
    // Fail-fast, server-side allow-list: the 危 discount action was split to
    // POST :billId/discount (billing.discount + step-up). Reject it here BEFORE
    // any DB work so a billing.manage holder cannot bypass step-up via this route.
    if (!action || !ROUTINE_BILL_ACTIONS.has(action)) {
      throw new BadRequestException(
        `不支持的账单动作: ${String(action)}（减免请走 POST :billId/discount）`,
      );
    }
    const reason = requireText(body?.reason, "reason", 512);

    const client = await this.rwPool.connect();
    try {
      await client.query("begin");

      const bill = await this.lockBillForAction(client, billId);
      const paid = toNum(bill.paid_amount);
      const invoiced = toNum(bill.invoiced_amount);
      let resultBillId = bill.id;

      // In-flight-order fencing (product_321 P5/P10): cancel/mark_overdue
      // overwrite operate_remark wholesale — on an order bill that wipes the
      // machine-readable intent (upgrade orders would mis-activate) and the
      // pricing channel must stay unique. Route order bills through the order
      // side (void / payment-reject).
      if (action === "cancel" || action === "mark_overdue") {
        await assertNotInFlightOrderBill(client, bill.id);
      }

      switch (action) {
        case "cancel": {
          if (bill.bill_status === "cancelled")
            throw new ConflictException("账单已作废，无需重复操作。");
          if (paid > 0)
            throw new ConflictException("已有收款的账单不能直接作废。");
          if (invoiced > 0)
            throw new ConflictException(
              "已有有效发票的账单需先完成红冲/作废登记。",
            );
          await client.query(BILL_CANCEL_SQL, [bill.id, reason]);
          break;
        }
        case "mark_overdue": {
          if (bill.bill_status === "cancelled")
            throw new ConflictException("已作废账单不能标记逾期。");
          if (bill.bill_status === "paid")
            throw new ConflictException("已结清账单不能标记逾期。");
          await client.query(BILL_MARK_OVERDUE_SQL, [bill.id, reason]);
          break;
        }
        case "create_adjustment":
        case "create_supplement": {
          const amount = requireAmount(body?.amount, "amount");
          const itemName = requireText(body?.itemName, "itemName", 128);
          if (amount <= 0)
            throw new BadRequestException("账单金额必须大于 0。");
          const cycleStart = optionalDate(body?.cycleStartDate);
          const cycleEnd = optionalDate(body?.cycleEndDate);
          if (
            cycleStart &&
            cycleEnd &&
            new Date(cycleEnd).getTime() < new Date(cycleStart).getTime()
          )
            throw new BadRequestException("账期结束不能早于账期开始。");

          const startDate = cycleStart ?? toDateStr(bill.cycle_start_date);
          const endDate = cycleEnd ?? toDateStr(bill.cycle_end_date);
          const billCycle =
            (startDate ? startDate.slice(0, 7).replace("-", "") : "") ||
            bill.bill_cycle;
          const billType =
            action === "create_adjustment" ? "adjustment" : "one_off";

          const wsResult = await client.query<{ workspace_id: string | null }>(
            RESOLVE_WORKSPACE_SQL,
            [bill.id, bill.tenant_id],
          );
          const workspaceId = wsResult.rows[0]?.workspace_id ?? null;
          if (!workspaceId)
            throw new BadRequestException(
              "该结算主体下没有可归集的工作空间，无法新建账单。",
            );

          const newBillNo = `${
            action === "create_adjustment" ? "ADJ" : "SUP"
          }-${billCycle}-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;

          const insertBill = await client.query<{ id: string }>(
            INSERT_EXCEPTION_BILL_SQL,
            [
              bill.tenant_id,
              newBillNo,
              billCycle,
              startDate,
              endDate,
              amount,
              billType,
              operatorId,
              reason,
            ],
          );
          const newBillId = insertBill.rows[0]?.id;
          if (!newBillId) throw new BadRequestException("新账单创建失败。");

          await client.query(INSERT_EXCEPTION_ITEM_SQL, [
            newBillId,
            bill.tenant_id,
            workspaceId,
            itemName,
            amount,
            reason,
          ]);
          resultBillId = newBillId;
          break;
        }
        default:
          throw new BadRequestException(`未知账单动作: ${String(action)}`);
      }

      const detail = await this.loadBillingDetail(client, resultBillId);
      await client.query("commit");
      return detail as BillingDetailRecord;
    } catch (e) {
      await client.query("rollback");
      throw translateWriteError(e, "账单编号冲突，请重试。");
    } finally {
      client.release();
    }
  }

  // (2b) 账单减免（危码 commerce:billing.discount + step-up）：直接减少应收，
  //      与 (2) 的常规账单动作分开，独立端点承载强认证。
  @Post(":billId/discount")
  @RequireStepUp()
  async discountBill(
    @Req() req: Request & RequestContext,
    @Param("billId") billId: string,
    @Body() body: BillDiscountBody,
  ): Promise<BillingDetailRecord> {
    assertCanDiscountBilling(req);
    requireOperatorId(req);
    const reason = requireText(body?.reason, "reason", 512);
    const discount = requireAmount(body?.discountAmount, "discountAmount");

    const client = await this.rwPool.connect();
    try {
      await client.query("begin");

      const bill = await this.lockBillForAction(client, billId);
      // In-flight-order fencing (product_321 P5): the manual write-off is a
      // second discount channel that de-syncs payable from the item ledger —
      // order bills discount exclusively via voucher negative rows.
      await assertNotInFlightOrderBill(client, bill.id);
      if (bill.bill_status === "cancelled") {
        throw new ConflictException("已作废账单不能继续处理。");
      }
      const paid = toNum(bill.paid_amount);
      const invoiced = toNum(bill.invoiced_amount);
      const payable = toNum(bill.payable_amount);
      const maxDiscount = Math.max(
        0,
        Math.min(payable, payable - paid, payable - invoiced),
      );
      if (discount <= 0 || discount > maxDiscount + 0.01) {
        throw new BadRequestException("减免金额需大于 0 且不超过可减免上限。");
      }

      await client.query(BILL_DISCOUNT_SQL, [bill.id, discount, reason]);

      const detail = await this.loadBillingDetail(client, bill.id);
      await client.query("commit");
      return detail as BillingDetailRecord;
    } catch (e) {
      await client.query("rollback");
      throw translateWriteError(e, "账单减免失败，请重试。");
    } finally {
      client.release();
    }
  }

  // (3) 开票动作：update_shipping/finish 更新 billing.invoice_receipts 状态、
  //     快递字段与审核人回填。红冲（red/void）是危码，单独走 (3b)。
  @Post(":billId/invoice-receipts/:receiptId/actions")
  async runInvoiceReceiptAction(
    @Req() req: Request & RequestContext,
    @Param("billId") billId: string,
    @Param("receiptId") receiptId: string,
    @Body() body: InvoiceReceiptActionBody,
  ): Promise<BillingDetailRecord> {
    assertCanManageInvoiceReceipts(req);
    const operatorId = requireOperatorId(req);
    const action = body?.action;
    // Fail-fast, server-side allow-list: the 危 red/void action was split to
    // POST .../invoice-receipts/:receiptId/void (invoice.void + step-up). Reject it
    // here BEFORE any DB work so an invoice.manage holder cannot bypass step-up.
    if (!action || !ROUTINE_RECEIPT_ACTIONS.has(action)) {
      throw new BadRequestException(
        `不支持的发票动作: ${String(action)}（红冲请走 POST .../invoice-receipts/:receiptId/void）`,
      );
    }
    const statusRemark = requireText(body?.statusRemark, "statusRemark", 512);
    const targetReceiptId = requireUuid(receiptId, "Invalid receipt id");

    const client = await this.rwPool.connect();
    try {
      await client.query("begin");

      const receiptResult = await client.query<InvoiceReceiptLockRow>(
        LOCK_RECEIPT_SQL,
        [targetReceiptId, billId],
      );
      const receipt = receiptResult.rows[0];
      if (!receipt) {
        throw new NotFoundException("Invoice receipt not found for this bill");
      }
      if (
        receipt.invoice_status === "voided" ||
        receipt.invoice_status === "rejected"
      ) {
        throw new ConflictException("已红冲/驳回发票不能继续操作。");
      }

      let nextStatus: string;
      if (action === "finish") {
        if (receipt.invoice_status !== "issued")
          throw new ConflictException("当前发票状态不支持确认完成。");
        nextStatus = "sent";
      } else if (action === "update_shipping") {
        if (
          receipt.invoice_status !== "issued" &&
          receipt.invoice_status !== "sent"
        )
          throw new ConflictException("当前发票状态不支持更新寄送。");
        nextStatus = "sent";
      } else {
        throw new BadRequestException(`未知发票动作: ${String(action)}`);
      }

      await client.query(UPDATE_RECEIPT_ACTION_SQL, [
        receipt.id,
        nextStatus,
        statusRemark,
        emptyToNull(body?.expressCompany),
        emptyToNull(body?.expressNo),
        optionalIso(body?.sendAt),
        operatorId,
      ]);

      const detail = await this.loadBillingDetail(client, receipt.bill_id);
      await client.query("commit");
      return detail as BillingDetailRecord;
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  }

  // (3b) 发票红冲（危码 commerce:invoice.void + step-up）：作废已出账发票，法定不可逆，
  //      独立端点承载强认证。
  @Post(":billId/invoice-receipts/:receiptId/void")
  @RequireStepUp()
  async voidInvoiceReceipt(
    @Req() req: Request & RequestContext,
    @Param("billId") billId: string,
    @Param("receiptId") receiptId: string,
    @Body() body: InvoiceReceiptVoidBody,
  ): Promise<BillingDetailRecord> {
    assertCanVoidInvoice(req);
    const operatorId = requireOperatorId(req);
    const statusRemark = requireText(body?.statusRemark, "statusRemark", 512);
    const targetReceiptId = requireUuid(receiptId, "Invalid receipt id");

    const client = await this.rwPool.connect();
    try {
      await client.query("begin");

      const receiptResult = await client.query<InvoiceReceiptLockRow>(
        LOCK_RECEIPT_SQL,
        [targetReceiptId, billId],
      );
      const receipt = receiptResult.rows[0];
      if (!receipt) {
        throw new NotFoundException("Invoice receipt not found for this bill");
      }
      if (
        receipt.invoice_status === "voided" ||
        receipt.invoice_status === "rejected"
      ) {
        throw new ConflictException("已红冲/驳回发票不能继续操作。");
      }

      await client.query(UPDATE_RECEIPT_ACTION_SQL, [
        receipt.id,
        "voided",
        statusRemark,
        emptyToNull(body?.expressCompany),
        emptyToNull(body?.expressNo),
        optionalIso(body?.sendAt),
        operatorId,
      ]);

      const detail = await this.loadBillingDetail(client, receipt.bill_id);
      await client.query("commit");
      return detail as BillingDetailRecord;
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  }

  // 复用读侧 SQL/映射，从写事务的 client 读回账单详情（反映本次写入）。
  private async loadBillingDetail(
    db: Pool | PoolClient,
    billId: string,
  ): Promise<BillingDetailRecord | null> {
    const headResult = await db.query<BillingListRow>(BILLING_DETAIL_SQL, [
      billId,
    ]);
    const head = headResult.rows[0];
    if (!head) return null;

    const [itemsResult, receiptsResult, paymentsResult] = await Promise.all([
      db.query<InvoiceItemRow>(INVOICE_ITEMS_SQL, [head.id]),
      db.query<InvoiceReceiptRow>(INVOICE_RECEIPTS_SQL, [head.id]),
      db.query<PaymentRow>(PAYMENTS_SQL, [head.id]),
    ]);

    return {
      ...mapBillingRow(head),
      invoiceItems: itemsResult.rows.map(mapInvoiceItemRow),
      paymentRecords: paymentsResult.rows.map(mapPaymentRow),
      invoiceReceipts: receiptsResult.rows.map(mapInvoiceReceiptRow),
      operationTimeline: [],
    };
  }

  // 锁定并读取待操作账单头（含 invoiced_amount 派生），供前置状态校验。
  private async lockBillForAction(
    client: PoolClient,
    billId: string,
  ): Promise<BillActionLockRow> {
    const result = await client.query<BillActionLockRow>(LOCK_BILL_SQL, [
      billId,
    ]);
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException("Billing record not found");
    }
    return row;
  }
}

// TD-027 billing/invoice domain codes.
//  - read:            billing.read | billing.manage
//  - bill routine:    billing.manage  (cancel[已守卫未收未开票]/mark_overdue/adjustment/supplement)
//  - bill discount:   billing.discount (危 — 减免应收，dedicated endpoint + step-up)
//  - invoice routine: invoice.manage  (offline-sync/update_shipping/finish)
//  - invoice void:    invoice.void    (危 — 红冲已出账发票，dedicated endpoint + step-up)
// Routine action allow-lists for the shared multi-action endpoints. The 危 actions
// (discount, red/void) are intentionally absent — they live on dedicated step-up
// endpoints and must be rejected here (see the fail-fast checks in the handlers).
const ROUTINE_BILL_ACTIONS: ReadonlySet<string> = new Set([
  "cancel",
  "mark_overdue",
  "create_adjustment",
  "create_supplement",
]);

const ROUTINE_RECEIPT_ACTIONS: ReadonlySet<string> = new Set([
  "update_shipping",
  "finish",
]);

function assertCanReadBilling(req: Request & RequestContext): void {
  assertAnyCapability(req, [
    "commerce:billing.read",
    "commerce:billing.manage",
  ]);
}

function assertCanManageBilling(req: Request & RequestContext): void {
  assertAnyCapability(req, ["commerce:billing.manage"]);
}

function assertCanDiscountBilling(req: Request & RequestContext): void {
  assertAnyCapability(req, ["commerce:billing.discount"]);
}

function assertCanManageInvoiceReceipts(req: Request & RequestContext): void {
  assertAnyCapability(req, ["commerce:invoice.manage"]);
}

function assertCanVoidInvoice(req: Request & RequestContext): void {
  assertAnyCapability(req, ["commerce:invoice.void"]);
}

// ── 值域归一：DDL check 约束 → 前端 union 口径 ──────────────────────────────

function normalizeBillStatus(value: string | null): BillingBillStatus {
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

// DDL bill_type: normal/one_off/adjustment/prepaid_statement → 前端 normal/adjust/supplement/prepaid
function normalizeBillType(value: string | null): BillingBillType {
  switch (value) {
    case "adjustment":
      return "adjust";
    case "one_off":
      return "supplement";
    case "prepaid_statement":
      return "prepaid";
    case "normal":
      return "normal";
    default:
      return "normal";
  }
}

// DDL invoice_status: applying/approved/issued/sent/rejected/voided → 前端 none/applying/auditing/issued/sending/finished/rejected/red
function normalizeInvoiceStatus(value: string | null): BillingInvoiceStatus {
  switch (value) {
    case "applying":
      return "applying";
    case "approved":
      return "auditing";
    case "issued":
      return "issued";
    case "sent":
      return "finished";
    case "rejected":
      return "rejected";
    case "voided":
      return "red";
    default:
      return "none";
  }
}

// DDL invoice_type: electronic_general/electronic_special/paper_special → 前端 special_vat/normal_vat/electronic/paper/other
function normalizeInvoiceType(value: string | null): BillingInvoiceType {
  switch (value) {
    case "electronic_special":
      return "special_vat";
    case "electronic_general":
      return "electronic";
    case "paper_special":
      return "paper";
    default:
      return "other";
  }
}

// DDL invoice_tax_type: general/special（普票/专票）→ 前端 enterprise/individual/government/other（无精确映射，取近似兜底）
function normalizeInvoiceTaxType(value: string | null): BillingInvoiceTaxType {
  switch (value) {
    case "special":
      return "enterprise";
    case "general":
      return "other";
    default:
      return "other";
  }
}

function normalizePaySource(value: string | null): OrderPaySource {
  if (value === "online" || value === "offline") return value;
  return "none";
}

// DDL offline_pay_type: bank_transfer/cash/check → 前端 bank_transfer/cash/other
function normalizeOfflinePayType(
  value: string | null,
): OrderOfflinePaymentType | null {
  if (!value) return null;
  if (value === "bank_transfer" || value === "cash") return value;
  return "other";
}

function normalizePaymentStatus(value: string | null): OrderPaymentStatus {
  switch (value) {
    case "not_required":
    case "unpaid":
    case "pending":
    case "pending_verify":
    case "paid":
    case "partial":
    case "failed":
    case "closed":
    case "refunding":
      return value;
    default:
      return "unpaid";
  }
}

function normalizeTenantType(
  value: string | null,
): BillingRecord["tenantType"] {
  return value === "personal" ? "individual" : "company";
}

// ── 标量转换 ────────────────────────────────────────────────────────────────

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

/**
 * In-flight-order bill fencing (product_321 P5/P10): bills of a pending
 * offline order must not be cancelled / marked overdue / written off from the
 * billing side — those overwrite operate_remark (killing the machine intent)
 * and open a second discount channel. Order-side endpoints own these bills.
 */
async function assertNotInFlightOrderBill(
  client: PoolClient,
  billId: string,
): Promise<void> {
  const res = await client.query<{ subscription_id: string }>(
    `select s.id as subscription_id
       from billing.invoices i
       join metering.subscriptions s on s.id = i.subscription_id
      where i.id = $1
        and s.status = 'suspended'
        and s.activation_method = 'offline_purchase'
        and s.deleted_at is null
      limit 1`,
    [billId],
  );
  const hit = res.rows[0];
  if (hit) {
    throw new ConflictException(
      `该账单关联在途订单（${hit.subscription_id}），请从订单侧处理（作废走 void，实收不符走 payment-reject）`,
    );
  }
}

function toNum(value: string | number | null): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toDateStr(value: Date | string | null): string {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

// ── 行映射 ──────────────────────────────────────────────────────────────────

function mapBillingRow(row: BillingListRow): BillingRecord {
  return {
    id: row.id,
    billNo: row.bill_no,
    tenantId: row.tenant_id,
    tenantCode: row.tenant_no === null ? "" : String(row.tenant_no),
    tenantName: row.tenant_name,
    tenantType: normalizeTenantType(row.tenant_type),
    region: "未设置",
    industry: row.industry ?? "未设置",
    subscriptionId: row.subscription_id,
    orderNo: null,
    servicePlanName: null,
    tierName: null,
    billCycle: row.bill_cycle,
    cycleStartDate: toDateStr(row.cycle_start_date),
    cycleEndDate: toDateStr(row.cycle_end_date),
    billStatus: normalizeBillStatus(row.bill_status),
    billType: normalizeBillType(row.bill_type),
    invoiceStatus: normalizeInvoiceStatus(row.latest_invoice_status),
    invoiceNo: row.latest_invoice_no,
    totalAmount: toNum(row.total_amount),
    discountAmount: toNum(row.discount_amount),
    payableAmount: toNum(row.payable_amount),
    paidAmount: toNum(row.paid_amount),
    invoicedAmount: toNum(row.invoiced_amount),
    currency: row.currency ?? "CNY",
    paymentMethod: row.payment_method,
    transactionNo: row.transaction_no,
    operationRemark: row.operate_remark,
    operatorName: "系统",
    paidAt: toIsoOrNull(row.paid_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapInvoiceItemRow(row: InvoiceItemRow): OrderInvoiceItemRecord {
  return {
    id: row.id,
    itemName: row.item_name,
    itemType: row.item_type,
    itemUnit: row.item_unit,
    quantity: toNum(row.quantity),
    unitPrice: toNum(row.unit_price),
    totalAmount: toNum(row.total_amount),
    remark: row.remark,
  };
}

function mapPaymentRow(row: PaymentRow): OrderPaymentRecord {
  return {
    id: row.id,
    paymentNo: row.pay_order_no,
    paySource: normalizePaySource(row.pay_source),
    payMethod: row.pay_method,
    offlinePayType: normalizeOfflinePayType(row.offline_pay_type),
    offlinePayerName: row.offline_payer_name,
    paidAmount: toNum(row.paid_amount),
    currency: row.currency ?? "CNY",
    paymentStatus: normalizePaymentStatus(row.pay_status),
    paidAt: toIsoOrNull(row.paid_at),
    operatorName: "系统",
    remark: row.operate_remark,
  };
}

function mapInvoiceReceiptRow(
  row: InvoiceReceiptRow,
): BillingInvoiceReceiptRecord {
  return {
    id: row.id,
    billId: row.bill_id,
    invoiceNo: row.invoice_no,
    invoiceType: normalizeInvoiceType(row.invoice_type),
    invoiceTaxType: normalizeInvoiceTaxType(row.invoice_tax_type),
    invoiceTitle: row.invoice_title,
    taxNo: row.tax_no,
    invoiceAmount: toNum(row.invoice_amount),
    taxAmount: toNum(row.tax_amount),
    currency: row.currency ?? "CNY",
    invoiceStatus: normalizeInvoiceStatus(row.invoice_status),
    statusRemark: row.status_remark,
    invoiceCode: row.invoice_code,
    invoiceElectronicNo: row.invoice_electronic_no,
    invoiceFileUrl: row.invoice_file_url,
    issuedAt: toIsoOrNull(row.issued_at),
    expressCompany: row.express_company,
    expressNo: row.express_no,
    sendAt: toIsoOrNull(row.send_at),
    auditorName: "系统",
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

// ── SQL ─────────────────────────────────────────────────────────────────────
// 列名逐条对照 52_billing.sql / 20_tenancy.sql（18-schema）核对。
// tenancy.tenants 无 province/city/display_name → region 空态兜底、名取 tenants.name。
// invoiced_amount = 未作废发票申请价税合计求和；latest_invoice_* 取最近一张开票记录。

const BILLING_SELECT = `
  i.id,
  i.bill_no,
  i.tenant_id,
  t.tenant_no,
  t.name as tenant_name,
  t.type as tenant_type,
  p.industry,
  i.subscription_id,
  i.bill_cycle,
  i.cycle_start_date,
  i.cycle_end_date,
  i.total_amount,
  i.discount_amount,
  i.payable_amount,
  i.paid_amount,
  i.currency,
  i.bill_status,
  i.bill_type,
  i.payment_method,
  -- 流水号按 transactions.bill_id 派生（最近一笔成功流水）；invoices.transaction_no
  -- 是 _no 锚点列，写侧 2026-09-02 起不再回写它，coalesce 只为兼容存量行。
  coalesce(i.transaction_no, tx.transaction_no) as transaction_no,
  i.operate_remark,
  i.paid_at,
  i.created_at,
  i.updated_at,
  coalesce((
    select sum(ir.invoice_amount)
    from billing.invoice_receipts ir
    where ir.bill_id = i.id
      and ir.deleted_at is null
      and ir.invoice_status <> 'voided'
  ), 0) as invoiced_amount,
  lr.invoice_no as latest_invoice_no,
  lr.invoice_status as latest_invoice_status
from billing.invoices i
join tenancy.tenants t on t.id = i.tenant_id
left join tenancy.tenant_profiles p on p.tenant_id = i.tenant_id
left join lateral (
  select r.invoice_no, r.invoice_status
  from billing.invoice_receipts r
  where r.bill_id = i.id and r.deleted_at is null
  order by r.created_at desc
  limit 1
) lr on true
left join lateral (
  select x.transaction_no
  from billing.transactions x
  where x.bill_id = i.id and x.trade_status = 'success'
  order by x.created_at desc
  limit 1
) tx on true
`;

const BILLING_LIST_SQL = `
select ${BILLING_SELECT}
where i.deleted_at is null
order by i.created_at desc
limit 500
`;

const BILLING_DETAIL_SQL = `
select ${BILLING_SELECT}
where i.deleted_at is null
  and (i.id::text = $1 or i.bill_no = $1)
limit 1
`;

const INVOICE_ITEMS_SQL = `
select
  id,
  item_name,
  item_type,
  item_unit,
  quantity,
  unit_price,
  total_amount,
  remark
from billing.invoice_items
where bill_id = $1
  and deleted_at is null
order by created_at asc
`;

const INVOICE_RECEIPTS_SQL = `
select
  id,
  bill_id,
  invoice_no,
  invoice_type,
  invoice_tax_type,
  invoice_title,
  tax_no,
  invoice_amount,
  tax_amount,
  currency,
  invoice_status,
  status_remark,
  invoice_code,
  invoice_electronic_no,
  invoice_file_url,
  issued_at,
  express_company,
  express_no,
  send_at,
  created_at,
  updated_at
from billing.invoice_receipts
where bill_id = $1
  and deleted_at is null
order by created_at desc
`;

// billing.payments 金融例外：无 deleted_at（作废走 pay_status）。
const PAYMENTS_SQL = `
select
  id,
  pay_order_no,
  pay_source,
  pay_method,
  offline_pay_type,
  offline_payer_name,
  paid_amount,
  currency,
  pay_status,
  paid_at,
  operate_remark
from billing.payments
where bill_id = $1
order by created_at desc
`;

// ── 行类型 ──────────────────────────────────────────────────────────────────

interface BillingListRow {
  id: string;
  bill_no: string;
  tenant_id: string;
  tenant_no: string | number | null;
  tenant_name: string;
  tenant_type: string | null;
  industry: string | null;
  subscription_id: string | null;
  bill_cycle: string;
  cycle_start_date: Date | string | null;
  cycle_end_date: Date | string | null;
  total_amount: string | number | null;
  discount_amount: string | number | null;
  payable_amount: string | number | null;
  paid_amount: string | number | null;
  currency: string | null;
  bill_status: string | null;
  bill_type: string | null;
  payment_method: string | null;
  transaction_no: string | null;
  operate_remark: string | null;
  paid_at: Date | string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  invoiced_amount: string | number | null;
  latest_invoice_no: string | null;
  latest_invoice_status: string | null;
}

interface InvoiceItemRow {
  id: string;
  item_name: string;
  item_type: string;
  item_unit: string | null;
  quantity: string | number | null;
  unit_price: string | number | null;
  total_amount: string | number | null;
  remark: string | null;
}

interface InvoiceReceiptRow {
  id: string;
  bill_id: string;
  invoice_no: string;
  invoice_type: string | null;
  invoice_tax_type: string | null;
  invoice_title: string;
  tax_no: string | null;
  invoice_amount: string | number | null;
  tax_amount: string | number | null;
  currency: string | null;
  invoice_status: string | null;
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
}

interface PaymentRow {
  id: string;
  pay_order_no: string;
  pay_source: string | null;
  pay_method: string | null;
  offline_pay_type: string | null;
  offline_payer_name: string | null;
  paid_amount: string | number | null;
  currency: string | null;
  pay_status: string | null;
  paid_at: Date | string | null;
  operate_remark: string | null;
}

// ── 写路径 SQL（列名逐条对照 52_billing.sql / 20_tenancy.sql 核对）─────────────

// 锁定账单头 + 派生 invoiced_amount（未作废发票价税合计），供前置状态校验。
const LOCK_BILL_SQL = `
select
  i.id,
  i.tenant_id,
  i.bill_status,
  i.bill_cycle,
  i.cycle_start_date,
  i.cycle_end_date,
  i.total_amount,
  i.discount_amount,
  i.payable_amount,
  i.paid_amount,
  coalesce((
    select sum(ir.invoice_amount)
    from billing.invoice_receipts ir
    where ir.bill_id = i.id
      and ir.deleted_at is null
      and ir.invoice_status <> 'voided'
  ), 0) as invoiced_amount
from billing.invoices i
where i.deleted_at is null
  and (i.id::text = $1 or i.bill_no = $1)
for update
`;

// (1) 线下开票同步：append 一条运营手工登记发票（created_by/auditor 均为 operator）。
const INSERT_OFFLINE_RECEIPT_SQL = `
insert into billing.invoice_receipts (
  tenant_id, bill_id, invoice_no, invoice_type, invoice_tax_type, invoice_title,
  tax_no, company_info, invoice_amount, tax_amount, invoice_status, status_remark,
  invoice_code, invoice_electronic_no, invoice_file_url, issued_at,
  express_company, express_no, send_at,
  created_by_type, created_by_id, auditor_id, audit_at, created_at, updated_at
) values (
  $1, $2, $3, $4, $5, $6,
  $7, $8::jsonb, $9, coalesce($10, 0), $11, $12,
  $13, $14, $15, $16,
  $17, $18, $19,
  'operator', $20, $20, now(), now(), now()
)
returning id
`;

// (2a) 作废账单。
const BILL_CANCEL_SQL = `
update billing.invoices
set bill_status = 'cancelled', operate_remark = $2, updated_at = now()
where id = $1
`;

// (2b) 标记逾期。
const BILL_MARK_OVERDUE_SQL = `
update billing.invoices
set bill_status = 'overdue', operate_remark = $2, updated_at = now()
where id = $1
`;

// (2c) 应收减免：只降 payable_amount、镜像累加 discount_amount，不动 total_amount。
const BILL_DISCOUNT_SQL = `
update billing.invoices
set discount_amount = coalesce(discount_amount, 0) + $2,
    payable_amount = payable_amount - $2,
    operate_remark = $3,
    updated_at = now()
where id = $1
`;

// (2d) 新建调整/补录账单的归集工作空间：优先源账单已用 ws，否则取该主体默认/首个 ws。
const RESOLVE_WORKSPACE_SQL = `
select coalesce(
  (
    select ii.workspace_id
    from billing.invoice_items ii
    where ii.bill_id = $1 and ii.deleted_at is null
    order by ii.created_at asc
    limit 1
  ),
  (
    select w.id
    from tenancy.workspaces w
    where w.tenant_id = $2 and w.deleted_at is null
    order by w.is_default desc, w.created_at asc
    limit 1
  )
) as workspace_id
`;

// (2e) 新建独立账单（adjustment / one_off）。payable_amount = total_amount。
const INSERT_EXCEPTION_BILL_SQL = `
insert into billing.invoices (
  tenant_id, bill_no, bill_cycle, cycle_start_date, cycle_end_date,
  total_amount, payable_amount, bill_status, bill_type,
  created_by_type, created_by_id, operate_remark, created_at, updated_at
) values (
  $1, $2, $3, $4, $5,
  $6, $6, 'unpaid', $7,
  'operator', $8, $9, now(), now()
)
returning id
`;

// (2f) 新账单的单行明细（运营手工项）。
const INSERT_EXCEPTION_ITEM_SQL = `
insert into billing.invoice_items (
  bill_id, tenant_id, workspace_id, item_name, item_type,
  quantity, unit_price, total_amount, remark, created_at, updated_at
) values (
  $1, $2, $3, $4, 'credit_adjustment',
  1, $5, $5, $6, now(), now()
)
`;

// (3a) 锁定待操作发票并校验归属账单。
const LOCK_RECEIPT_SQL = `
select r.id, r.bill_id, r.invoice_status
from billing.invoice_receipts r
join billing.invoices i on i.id = r.bill_id
where r.id = $1
  and r.deleted_at is null
  and i.deleted_at is null
  and (i.id::text = $2 or i.bill_no = $2)
for update of r
`;

// (3b) 更新发票状态/快递字段/审核人回填（express/send_at 仅在传入时覆盖）。
const UPDATE_RECEIPT_ACTION_SQL = `
update billing.invoice_receipts
set invoice_status = $2,
    status_remark = $3,
    express_company = coalesce($4, express_company),
    express_no = coalesce($5, express_no),
    send_at = coalesce($6, send_at),
    auditor_id = $7,
    audit_at = now(),
    updated_at = now()
where id = $1
`;

// ── 反向值域归一：前端 union → DDL check 约束 ──────────────────────────────

// 前端 special_vat/normal_vat/electronic/paper/other → DDL electronic_general/electronic_special/paper_special
function denormInvoiceType(value: BillingInvoiceType | undefined): string {
  switch (value) {
    case "special_vat":
      return "electronic_special";
    case "paper":
      return "paper_special";
    case "normal_vat":
    case "electronic":
    case "other":
    default:
      return "electronic_general";
  }
}

// 前端 enterprise/individual/government/other → DDL general/special（专票=enterprise）
function denormInvoiceTaxType(
  value: BillingInvoiceTaxType | undefined,
): string {
  return value === "enterprise" ? "special" : "general";
}

// 前端 issued/sending/finished → DDL issued/sent（DDL 无 sending，寄送/完成均落 sent）
function denormOfflineInvoiceStatus(
  value: BillingInvoiceStatus | undefined,
): string {
  return value === "issued" ? "issued" : "sent";
}

// ── 写入参数校验 ──────────────────────────────────────────────────────────────

function requireOperatorId(req: Request & RequestContext): string {
  return requireUuid(req.user?.id, "Invalid platform admin principal");
}

function requireUuid(value: string | undefined, message: string): string {
  if (
    !value ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new UnauthorizedException(message);
  }
  return value;
}

function requireText(
  value: string | null | undefined,
  field: string,
  maxLen: number,
): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new BadRequestException(`${field} is required`);
  if (text.length > maxLen)
    throw new BadRequestException(`${field} exceeds ${maxLen} characters`);
  return text;
}

/**
 * 资金类输入：有且只有两位小数（owner 2026-09-03）。多出来的小数不再静默
 * Math.round 到分——那等于改了运营录入的数、库里存的和界面填的不是同一个金额；
 * 直接 400 让录入方改。列本身已是 numeric(12,2)。
 */
function requireAmount(value: unknown, field: string): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n))
    throw new BadRequestException(`${field} must be a number`);
  if (Math.round(n * 100) !== n * 100)
    throw new BadRequestException(`${field} 最多两位小数`);
  return n;
}

function optionalAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  if (Math.round(n * 100) !== n * 100)
    throw new BadRequestException("金额最多两位小数");
  return n;
}

function requireIso(value: string | null | undefined, field: string): string {
  if (!value) throw new BadRequestException(`${field} is required`);
  const d = new Date(value);
  if (!Number.isFinite(d.getTime()))
    throw new BadRequestException(`${field} must be a valid datetime`);
  return d.toISOString();
}

function optionalIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function optionalDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

// pg unique violation → 409（其余原样抛出）。
function translateWriteError(e: unknown, message: string): unknown {
  if (
    e &&
    typeof e === "object" &&
    "code" in e &&
    (e as { code?: string }).code === "23505"
  ) {
    return new ConflictException(message);
  }
  return e;
}

// ── 写路径请求体 / 锁行类型 ────────────────────────────────────────────────

interface OfflineInvoiceSyncBody {
  invoiceNo?: string;
  invoiceType?: BillingInvoiceType;
  invoiceTaxType?: BillingInvoiceTaxType;
  invoiceTitle?: string;
  taxNo?: string | null;
  invoiceAmount?: number;
  taxAmount?: number | null;
  invoiceStatus?: BillingInvoiceStatus;
  statusRemark?: string;
  invoiceCode?: string | null;
  invoiceElectronicNo?: string | null;
  invoiceFileUrl?: string | null;
  issuedAt?: string;
  expressCompany?: string | null;
  expressNo?: string | null;
  sendAt?: string | null;
}

interface BillActionBody {
  action?:
    | "cancel"
    | "mark_overdue"
    | "create_adjustment"
    | "create_supplement";
  reason?: string;
  amount?: number | null;
  itemName?: string | null;
  cycleStartDate?: string | null;
  cycleEndDate?: string | null;
}

// Split out of BillActionBody: discount is a 危 write on its own endpoint.
interface BillDiscountBody {
  reason?: string;
  discountAmount?: number | null;
}

interface InvoiceReceiptActionBody {
  action?: "update_shipping" | "finish";
  statusRemark?: string;
  expressCompany?: string | null;
  expressNo?: string | null;
  sendAt?: string | null;
}

// Split out of InvoiceReceiptActionBody: red/void is a 危 write on its own endpoint.
interface InvoiceReceiptVoidBody {
  statusRemark?: string;
  expressCompany?: string | null;
  expressNo?: string | null;
  sendAt?: string | null;
}

interface BillActionLockRow {
  id: string;
  tenant_id: string;
  bill_status: string | null;
  bill_cycle: string;
  cycle_start_date: Date | string | null;
  cycle_end_date: Date | string | null;
  total_amount: string | number | null;
  discount_amount: string | number | null;
  payable_amount: string | number | null;
  paid_amount: string | number | null;
  invoiced_amount: string | number | null;
}

interface InvoiceReceiptLockRow {
  id: string;
  bill_id: string;
  invoice_status: string | null;
}
