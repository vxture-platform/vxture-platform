/**
 * orders.router.ts - 订单运营路由
 * @package @vxture/bff-admin
 *
 * Description: 订单主体是 billing.orders（product_330 P1-b2 起，订单与订阅彻底分离）。
 *   left join billing.invoices（按 order_id 关联最近一张账单）与 billing.payments（按 bill_id
 *   关联该账单代表性一笔支付）合成订单视图；套餐名取 product.plan_versions → plans；
 *   履约后的订阅经 orders.subscription_id。详情附账单明细 billing.invoice_items、全部支付
 *   记录 billing.payments、时间线 = billing.order_events ∪ 履约订阅的 subscription_histories。
 *   写路径：确认收款（段1 资金裸 SQL + 段2 OrderService.fulfill）、驳回申报、作废、恢复。
 *
 * @author AI-Generated
 * @date 2026-07-04
 * @version 2.0
 *
 * @copyright Vxture Team
 *
 * @layer Application
 * @category Router
 */

import {
  BadRequestException,
  Body,
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
import { extractClientIp } from "@vxture/core-utils";
import type { PromotionService } from "@vxture/service-promotion";
import type { OrderService } from "@vxture/service-subscription";
import { assertAnyCapability } from "../auth/capability";
import { RequireStepUp } from "../auth/step-up.decorator";
import { ADMIN_BFF_RO_POOL, ADMIN_BFF_RW_POOL } from "../tokens";
import {
  ADMIN_ORDER_SERVICE,
  ADMIN_PROMOTION_SERVICE,
} from "../providers/commerce-services.provider";
import type {
  OrderInvoiceItemRecord,
  OrderOfflinePaymentType,
  OrderOperationDetailRecord,
  OrderOperationEvent,
  OrderOperationRecord,
  OrderOperationStatus,
  OrderPaymentRecord,
  OrderPaymentStatus,
  OrderPaySource,
  RequestContext,
  SubscriptionOperationCycle,
  SubscriptionOperationStatus,
  TenantOperationType,
} from "../types/console.types";

@Controller("api/orders")
export class OrdersRouter {
  constructor(
    @Inject(ADMIN_BFF_RO_POOL) private readonly pool: Pool,
    @Inject(ADMIN_BFF_RW_POOL) private readonly rwPool: Pool,
    @Inject(ADMIN_ORDER_SERVICE)
    private readonly orders: OrderService,
    @Inject(ADMIN_PROMOTION_SERVICE)
    private readonly promotion: PromotionService,
  ) {}

  /**
   * 路由参数是**面向用户的订单编号**（`order_no`，如 `ORD-202609-XXXX`），不是内部
   * UUID——地址栏是可见面，UUID 不在任何场景对外展示。同时仍接受 UUID：存量
   * 书签、审计日志里记的 id、内部工具都还在传它。
   *
   * 订单实体键是 `billing.orders.id`，可读码是同表的 `order_no`（库级唯一）。
   * 解不出来 → 404，与「传了个不存在的 UUID」同一个结果。
   */
  private async resolveOrderId(value: string): Promise<string> {
    if (!value) throw new NotFoundException("Order not found");
    const { rows } = await this.pool.query<{ id: string }>(
      UUID_RE.test(value)
        ? `select id from billing.orders where id = $1 limit 1`
        : `select id from billing.orders where order_no = $1 limit 1`,
      [value],
    );
    if (!rows[0]) throw new NotFoundException("Order not found");
    return rows[0].id;
  }

  @Get()
  async listOrders(
    @Req() req: Request & RequestContext,
  ): Promise<OrderOperationRecord[]> {
    assertCanReadOrders(req);

    const { rows } = await this.pool.query<OrderRow>(`${ORDER_BASE_SQL}
      order by ord.created_at desc
      limit 500`);
    return rows.map(mapOrderRow);
  }

  @Get(":orderId")
  async getOrder(
    @Req() req: Request & RequestContext,
    @Param("orderId") orderId: string,
  ): Promise<OrderOperationDetailRecord | null> {
    assertCanReadOrders(req);

    const { rows } = await this.pool.query<OrderRow>(
      `${ORDER_BASE_SQL} and ord.id = $1 limit 1`,
      [await this.resolveOrderId(orderId)],
    );
    const base = rows[0];
    if (!base) return null;

    const [items, payments, timeline] = await Promise.all([
      base.bill_id
        ? this.pool.query<InvoiceItemRow>(INVOICE_ITEMS_SQL, [base.bill_id])
        : Promise.resolve({ rows: [] as InvoiceItemRow[] }),
      base.bill_id
        ? this.pool.query<PaymentRow>(PAYMENTS_SQL, [base.bill_id])
        : Promise.resolve({ rows: [] as PaymentRow[] }),
      this.pool.query<HistoryRow>(TIMELINE_SQL, [
        base.id,
        base.fulfilled_subscription_id,
      ]),
    ]);

    return {
      ...mapOrderRow(base),
      invoiceItems: items.rows.map(mapInvoiceItemRow),
      paymentRecords: payments.rows.map(mapPaymentRow),
      operationTimeline: timeline.rows.map(mapHistoryRow),
    };
  }

  // 线下支付确认，两段幂等（product_320 §4.3 → product_330 P1-b2 订单实体版）：
  //   段1（资金，本方法内裸 SQL 事务）：锁 billing.orders 行 → 锁账单（invoices.order_id）→
  //     payments(offline/paid) → invoices(累加 paid_amount、足额转 paid) → transactions(append-only
  //     流水) → orders.status='paid' + order_events(payment_confirmed)。订单已 paid（上次确认在段2前
  //     中断）时跳过段1，直接重驱动段2——同一订单可安全重复调用本端点。
  //   段2（履约，OrderService.fulfill，独立事务）：按 orders.intent 建订阅 / 换版本 / 延期，经
  //     SubscriptionService 触发 provisioning webhook 通知产品侧。失败停在 paid，reconcile 兜底。
  //   orderId = billing.orders.id 或 order_no（resolveOrderId）。
  @Post(":orderId/offline-payment-confirm")
  @RequireStepUp()
  async confirmOfflinePayment(
    @Req() req: Request & RequestContext,
    @Param("orderId") orderId: string,
    @Body() body: OfflinePaymentConfirmBody,
  ): Promise<OrderOperationDetailRecord> {
    assertCanSettleOrderPayment(req);

    const actorId = requireOperatorId(req.user?.id);
    const orderEntityId = await this.resolveOrderId(orderId);

    let runStage2 = false;
    // Body validation is deferred INTO the transaction (product_321 P8 ③):
    // a stage-2 re-drive on a hung paid order has no cash to declare, so
    // forcing paidAmount>0/payerName up front made the re-drive unreachable
    // (round-3 review). The re-drive/strict decision is made under the row
    // lock — no probe race, no extra read path.
    let input: NormalizedOfflinePayment | undefined;

    const client = await this.rwPool.connect();
    try {
      await client.query("begin");

      // ① 锁定订单实体（锁序 §7：订单 → 账单 → 券）
      const ordResult = await client.query<OrderLockRow>(
        `select id, tenant_id, workspace_id, status, currency
           from billing.orders
          where id = $1
          for update`,
        [orderEntityId],
      );
      const ord = ordResult.rows[0];
      if (!ord) {
        throw new NotFoundException("Order not found");
      }
      if (ord.status === "fulfilled") {
        throw new BadRequestException("Order is already fulfilled");
      }
      if (!OPEN_ORDER_STATUSES.has(ord.status)) {
        throw new BadRequestException(
          "订单已关闭，不能确认收款（如需重开请先 restore）",
        );
      }

      // ② 锁定该订单最近一张未删账单（订单视图口径一致）
      const invoiceResult = await client.query<InvoiceLockRow>(
        `select id, tenant_id, payable_amount, paid_amount, bill_status, currency
           from billing.invoices
          where order_id = $1 and deleted_at is null
          order by created_at desc
          limit 1
          for update`,
        [ord.id],
      );
      const invoice = invoiceResult.rows[0];
      if (!invoice) {
        throw new BadRequestException(
          "Order has no billable invoice to settle",
        );
      }
      if (invoice.bill_status === "cancelled") {
        throw new BadRequestException("Cancelled invoice cannot be settled");
      }

      // 段1 是否已完成（可重驱动判定）：账单已足额付清 / 订单已 paid = 段1完成 →
      // 跳过段1，直接重驱动段2（履约）。
      const stage1Done =
        invoice.bill_status === "paid" || ord.status === "paid";
      runStage2 = stage1Done;
      input = runStage2
        ? relaxedRedriveInput(body)
        : normalizeOfflinePaymentBody(body);

      if (!stage1Done) {
        const payable = toNumber(invoice.payable_amount);
        const alreadyPaid = toNumber(invoice.paid_amount);
        const remaining = round2(payable - alreadyPaid);
        if (remaining <= 0) {
          throw new BadRequestException("Invoice has no outstanding balance");
        }

        // Declared-leg branch (product_321 P9): a customer-declared
        // pending_verify cash leg exists → the confirm FLIPS that leg (never
        // inserts a second row) and the amount must equal the declared amount
        // EXACTLY — mismatched real income goes through payment-reject.
        const legResult = await client.query<DeclaredLegRow>(
          `select id, total_amount, actor_id, channel_raw_data
             from billing.payments
            where bill_id = $1 and pay_status = 'pending_verify'
            order by created_at desc
            limit 1
            for update`,
          [invoice.id],
        );
        const declaredLeg = legResult.rows[0] ?? null;
        const credential = parseLegCredential(declaredLeg?.channel_raw_data);
        let voucherOff = 0;

        if (declaredLeg) {
          const declaredAmount = toNumber(declaredLeg.total_amount);
          if (round2(input.paidAmount) !== declaredAmount) {
            throw new BadRequestException(
              `确认金额必须等于申报金额 ${declaredAmount.toFixed(2)}；实收不符请驳回申报（payment-reject）`,
            );
          }
          voucherOff = toNumber(credential?.voucherOff ?? 0);
        } else if (round2(input.paidAmount) !== remaining) {
          // No declared leg (legacy / post-reject manual settle): the same
          // full-amount rule — ≤ would keep breeding unterminable partial
          // orders through this side door (P9, round-3 review).
          throw new BadRequestException(
            `确认金额必须等于剩余应收 ${remaining.toFixed(2)}（系统不再受理部分到账；实收不符请线下协商退回/补齐）`,
          );
        }

        const tenantId = invoice.tenant_id;
        const currency = invoice.currency ?? ord.currency ?? "CNY";
        const payOrderNo = billingCode("PAY");
        const transactionNo = billingCode("TXN");

        // ③ append-only 资金流水。线下账单结算不改动预付款池，快照 before==after（池余额不变）。
        const poolBalance = await currentCreditsBalance(client, tenantId);
        const transactionResult = await client.query<InsertedIdRow>(
          `insert into billing.transactions (
             tenant_id, bill_id, transaction_no, trade_type, amount, currency,
             balance_before, balance_after, trade_status, related_no, remark,
             actor_type, actor_id, client_ip
           ) values (
             $1, $2, $3, 'adjust', $4, $5,
             $6, $6, 'success', $7, $8,
             'operator', $9, $10
           )
           returning id`,
          [
            tenantId,
            invoice.id,
            transactionNo,
            input.paidAmount,
            currency,
            poolBalance,
            input.transactionNo ?? payOrderNo,
            input.reason,
            actorId,
            extractClientIp(req),
          ],
        );
        const transactionId = transactionResult.rows[0]?.id ?? null;

        if (declaredLeg) {
          // ④a 翻转申报腿（pending_verify → paid，回填实收与流水）。
          await client.query(
            `update billing.payments
               set pay_status = 'paid',
                   paid_amount = $2,
                   transaction_id = $3,
                   paid_at = $4,
                   offline_pay_type = $5,
                   offline_payer_name = coalesce($6, offline_payer_name),
                   offline_pay_time = $4,
                   offline_evidence_url = coalesce($7, offline_evidence_url),
                   operate_remark = $8,
                   updated_at = now()
             where id = $1`,
            [
              declaredLeg.id,
              input.paidAmount,
              transactionId,
              input.paidAt,
              input.offlinePayType,
              input.payerName,
              input.evidenceUrl,
              input.reason,
            ],
          );

          // ④b 券 finalize（P7 终态）：代金券先落结算腿（pay_source='voucher'），
          // redemption 回填 payment_id / 折扣券回填申报时的负额行 id。凭据随腿
          // 携带（P10），此处不回查 promotion 配置。
          if (credential) {
            let voucherLegId: string | null = null;
            if (credential.creditVoucherId && voucherOff > 0) {
              const voucherLeg = await client.query<InsertedIdRow>(
                `insert into billing.payments (
                   tenant_id, bill_id, pay_order_no, pay_source,
                   total_amount, paid_amount, currency, pay_status, paid_at,
                   actor_type, actor_id, operate_remark
                 ) values ($1, $2, $3, 'voucher', $4, $4, $5, 'paid', $6,
                           'operator', $7, $8)
                 returning id`,
                [
                  tenantId,
                  invoice.id,
                  billingCode("PAY"),
                  voucherOff,
                  currency,
                  input.paidAt,
                  actorId,
                  input.reason,
                ],
              );
              voucherLegId = voucherLeg.rows[0]?.id ?? null;
            }
            const redemptionUser =
              credential.declaredBy ?? declaredLeg.actor_id;
            if (
              (credential.discountVoucherId || credential.creditVoucherId) &&
              !redemptionUser
            ) {
              // voucher_redemptions.user_id is NOT NULL FK→account.users; an
              // operator id is not a customer user — refuse rather than
              // corrupt the redemption ledger.
              throw new BadRequestException(
                "申报凭据缺少核销人，无法核销券（请驳回申报后由客户重新申报）",
              );
            }
            // Guard above ensures non-null whenever a voucher participates.
            const scope = {
              tenantId,
              workspaceId: ord.workspace_id,
              userId: redemptionUser as string,
            };
            const finalizeInputs = [];
            if (credential.discountVoucherId) {
              finalizeInputs.push({
                voucherId: credential.discountVoucherId,
                kind: "discount" as const,
                scope,
                effectSnapshot: credential.discountEffectSnapshot ?? {},
                invoiceItemId: credential.discountItemId ?? null,
              });
            }
            if (credential.creditVoucherId) {
              finalizeInputs.push({
                voucherId: credential.creditVoucherId,
                kind: "credit_voucher" as const,
                scope,
                effectSnapshot: credential.creditEffectSnapshot ?? {},
                paymentId: voucherLegId,
              });
            }
            if (finalizeInputs.length > 0) {
              await this.promotion.finalizeReserved(client, finalizeInputs);
            }
          }
        } else {
          // ④c 无申报腿：保留原插行路径（历史遗留订单向后兼容）。
          await client.query(
            `insert into billing.payments (
               tenant_id, bill_id, transaction_id, pay_order_no, pay_source,
               offline_pay_type, offline_payer_name, offline_pay_time, offline_evidence_url,
               total_amount, paid_amount, currency, pay_status, paid_at,
               actor_type, actor_id, operate_remark
             ) values (
               $1, $2, $3, $4, 'offline',
               $5, $6, $7, $8,
               $9, $9, $10, 'paid', $7,
               'operator', $11, $12
             )`,
            [
              tenantId,
              invoice.id,
              transactionId,
              payOrderNo,
              input.offlinePayType,
              input.payerName,
              input.paidAt,
              input.evidenceUrl,
              input.paidAmount,
              currency,
              actorId,
              input.reason,
            ],
          );
        }

        // ⑤ 回写账单：累加实收（现金 + 券腿），足额转 paid（并落 paid_at）。
        // 恒等校验下必然足额；条件保留为防御。
        //
        // 不写 invoices.transaction_no：它是 `_no` 锚点列（98_column_locks 规则②），
        // platform_svc 对它没有 UPDATE 权限——2026-09-02 生产实测整条确认收款事务因
        // 此 42501 回滚（开发库以 owner 连库，列锁对 owner 无效，从没炸过）。流水与
        // 账单的关联本就在 transactions.bill_id 上，账单侧读时按它派生（billing.router）。
        const newPaid = round2(alreadyPaid + input.paidAmount + voucherOff);
        const fullySettled = newPaid >= payable;
        await client.query(
          `update billing.invoices
           set paid_amount = $2,
               bill_status = case when $3 then 'paid' else 'partial' end,
               paid_at = case when $3 then $4 else paid_at end,
               payment_method = 'offline',
               updated_at = now()
           where id = $1`,
          [invoice.id, newPaid, fullySettled, input.paidAt],
        );

        // ⑥ 订单实体：足额 → paid（段2 履约再翻 fulfilled）；部分到账停在原态、不履约，只留事件。
        if (fullySettled) {
          await client.query(
            `update billing.orders
                set status = 'paid', paid_at = coalesce($2, paid_at, now()), updated_at = now()
              where id = $1 and status in ('pending_payment', 'pending_verify')`,
            [ord.id, input.paidAt],
          );
          runStage2 = true;
        }
        await client.query(
          `insert into billing.order_events (
             order_id, event_type, from_status, to_status, actor_type, actor_id, remark, client_ip
           ) values ($1, 'payment_confirmed', $2, $3, 'operator', $4, $5, $6)`,
          [
            ord.id,
            ord.status,
            fullySettled ? "paid" : ord.status,
            actorId,
            input.reason,
            extractClientIp(req),
          ],
        );
      }

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }

    // 段2：履约走 OrderService（独立事务）——按 intent 建订阅 / 换版本 / 延期，
    // 经 SubscriptionService 触发 provisioning webhook（product_330 §4）。
    if (runStage2) {
      await this.orders.fulfill(orderEntityId, {
        actorType: "operator",
        actorId,
        remark: input?.reason ?? "manual stage-2 re-drive",
        clientIp: extractClientIp(req),
      });
    }

    // 复用只读链路合成最新订单详情返回（前端期望 OrderOperationDetailRecord）。
    const detail = await this.getOrder(req, orderEntityId);
    if (!detail) {
      throw new NotFoundException("Order not found after confirmation");
    }
    return detail;
  }

  // 驳回付款申报（product_321 P9/P8b）：现金腿 pending_verify → failed（原因落 status_msg，
  //   透传用户付款页横幅）+ 完整释放编排（券回 assigned + 计价层回滚 + 凭据 released）+
  //   histories payment_rejected（TTL 重锚）。与确认同码同级（commerce:payment.settle +
  //   step-up）——驳回申报与确认收款是同一职责的正反面。
  @Post(":orderId/payment-reject")
  @RequireStepUp()
  async rejectPaymentDeclaration(
    @Req() req: Request & RequestContext,
    @Param("orderId") orderId: string,
    @Body() body: VoidOrderBody,
  ): Promise<OrderOperationDetailRecord> {
    assertCanSettleOrderPayment(req);

    const actorId = requireOperatorId(req.user?.id);
    const orderEntityId = await this.resolveOrderId(orderId);
    const reason = normalizeVoidReason(body);

    const client = await this.rwPool.connect();
    try {
      await client.query("begin");

      // 锁序 §7：先订单行，再账单，再券。
      const ordResult = await client.query<OrderLockRow>(
        `select id, tenant_id, workspace_id, status, currency
           from billing.orders
          where id = $1
          for update`,
        [orderEntityId],
      );
      const ord = ordResult.rows[0];
      if (!ord) throw new NotFoundException("Order not found");
      if (ord.status !== "pending_verify") {
        throw new BadRequestException("订单不是待核验状态，无法驳回申报");
      }

      const invoiceResult = await client.query<InvoiceLockRow>(
        `select id, tenant_id, payable_amount, paid_amount, bill_status, currency
           from billing.invoices
          where order_id = $1 and deleted_at is null
          order by created_at desc
          limit 1
          for update`,
        [ord.id],
      );
      const invoice = invoiceResult.rows[0];
      if (!invoice) {
        throw new BadRequestException("Order has no invoice");
      }

      const legResult = await client.query<DeclaredLegRow>(
        `select id, total_amount, actor_id, channel_raw_data
           from billing.payments
          where bill_id = $1 and pay_status = 'pending_verify'
          order by created_at desc
          limit 1
          for update`,
        [invoice.id],
      );
      const declaredLeg = legResult.rows[0];
      if (!declaredLeg) {
        throw new BadRequestException("该订单没有待确认的付款申报");
      }
      const credential = parseLegCredential(declaredLeg.channel_raw_data);

      // P8b 前置守卫：本单已有 redemption（券已 finalize）说明状态错乱，拒绝
      // 自动回滚（会断 redemption FK / 事后追折），转人工。
      if (credential?.discountVoucherId || credential?.creditVoucherId) {
        const redeemed = await client.query(
          `select 1 from promotion.voucher_redemptions
            where voucher_id = any($1::uuid[]) limit 1`,
          [
            [credential.discountVoucherId, credential.creditVoucherId].filter(
              Boolean,
            ),
          ],
        );
        if (redeemed.rows[0]) {
          throw new BadRequestException(
            "该申报的券已核销，不能自动驳回（状态异常，请人工处理）",
          );
        }
      }

      // ① 现金腿 → failed（status_msg=原因，付款页横幅取 histories remark）。
      await client.query(
        `update billing.payments
            set pay_status = 'failed', status_msg = $2, closed_at = now(),
                updated_at = now()
          where id = $1`,
        [declaredLeg.id, reason],
      );

      // ② 券释放（reserved → assigned 退 used_count；stale 凭据由 status 守卫兜住）。
      if (credential?.discountVoucherId || credential?.creditVoucherId) {
        await this.promotion.releaseReserved(client, {
          discountVoucherId: credential.discountVoucherId,
          creditVoucherId: credential.creditVoucherId,
        });
      }

      // ③ 计价层回滚（P8b 步 2）：软删折扣负额行 + 归还原价（缺此步 = 驳回后
      // 重申报少付差额 / 换券双重折扣，round-1 blocker）。
      await client.query(
        `update billing.invoice_items
            set deleted_at = now(), updated_at = now()
          where bill_id = $1 and item_type = 'discount' and deleted_at is null`,
        [invoice.id],
      );
      await client.query(
        `update billing.invoices i set
           total_amount = agg.total,
           payable_amount = agg.total,
           discount_amount = agg.discount_off,
           updated_at = now()
          from (
            select coalesce(sum(total_amount), 0) as total,
                   coalesce(abs(sum(total_amount) filter (where item_type = 'discount')), 0) as discount_off
              from billing.invoice_items
             where bill_id = $1 and deleted_at is null
          ) agg
         where i.id = $1`,
        [invoice.id],
      );

      // ④ 凭据 released=true（P10 防重放）。
      await client.query(
        `update billing.payments
            set channel_raw_data = jsonb_set(coalesce(channel_raw_data, '{}'::jsonb),
                                             '{settlement,released}', 'true'::jsonb),
                updated_at = now()
          where id = $1`,
        [declaredLeg.id],
      );

      // ⑤ 订单实体回到 pending_payment + order_events payment_rejected
      //   （P4 TTL 重锚 + 付款页横幅来源，remark = 驳回原因）。
      await client.query(
        `update billing.orders
            set status = 'pending_payment', declared_at = null, updated_at = now()
          where id = $1 and status = 'pending_verify'`,
        [ord.id],
      );
      await client.query(
        `insert into billing.order_events (
           order_id, event_type, from_status, to_status, actor_type, actor_id, remark, client_ip
         ) values ($1, 'payment_rejected', 'pending_verify', 'pending_payment', 'operator', $2, $3, $4)`,
        [ord.id, actorId, reason, extractClientIp(req)],
      );

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }

    const detail = await this.getOrder(req, orderEntityId);
    if (!detail) {
      throw new NotFoundException("Order not found after reject");
    }
    return detail;
  }

  // 作废未付订单（product_320 §4.3）：仅限 pending_payment / pending_verify 且尚无实收；
  //   已收款的订单请走结算而非作废。危码 commerce:order.void。
  //   product_321 P2：存在 pending_verify 申报腿时 repo 守卫 409（先驳回申报再作废）。
  @Post(":orderId/void")
  @RequireStepUp()
  async voidOrder(
    @Req() req: Request & RequestContext,
    @Param("orderId") orderId: string,
    @Body() body: VoidOrderBody,
  ): Promise<OrderOperationDetailRecord> {
    assertCanVoidOrder(req);

    const actorId = requireOperatorId(req.user?.id);
    const orderEntityId = await this.resolveOrderId(orderId);
    const reason = normalizeVoidReason(body);

    await this.orders.cancel(orderEntityId, {
      actorType: "operator",
      actorId,
      remark: reason,
      clientIp: extractClientIp(req),
    });

    const detail = await this.getOrder(req, orderEntityId);
    if (!detail) {
      throw new NotFoundException("Order not found after void");
    }
    return detail;
  }

  // 恢复被作废/超时关闭的未付订单（撤销 void/expire）：cancelled / expired 且无实收
  // 才可恢复（repo 守卫）；已履约订单的退量走退款（P2），不在本端点范围内。
  // 危码独立 commerce:order.restore。
  @Post(":orderId/restore")
  @RequireStepUp()
  async restoreOrder(
    @Req() req: Request & RequestContext,
    @Param("orderId") orderId: string,
    @Body() body: VoidOrderBody,
  ): Promise<OrderOperationDetailRecord> {
    assertCanRestoreOrder(req);

    const actorId = requireOperatorId(req.user?.id);
    const orderEntityId = await this.resolveOrderId(orderId);
    const reason = normalizeVoidReason(body);

    await this.orders.restore(orderEntityId, {
      actorType: "operator",
      actorId,
      remark: reason,
      clientIp: extractClientIp(req),
    });

    const detail = await this.getOrder(req, orderEntityId);
    if (!detail) {
      throw new NotFoundException("Order not found after restore");
    }
    return detail;
  }
}

// 读取租户预付款池当前余额（无池视为 0）——供流水 balance 快照。
async function currentCreditsBalance(
  client: PoolClient,
  tenantId: string,
): Promise<number> {
  const { rows } = await client.query<{ balance: string | number | null }>(
    `select balance from billing.credits where tenant_id = $1`,
    [tenantId],
  );
  return round2(toNumber(rows[0]?.balance ?? 0));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// 可视码：{PREFIX}-{YYYYMM}-{10位}。唯一约束（uq_payments_pay_order_no / uq_transactions_transaction_no）兜底防重。
function billingCode(prefix: string): string {
  const now = new Date();
  const ym = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const suffix = randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
  return `${prefix}-${ym}-${suffix}`;
}

// 版本位/变体位刻意不卡：判据与理由见 governance.shared.ts 的 `UUID_RE` 注释
//（校验器不该比存储层更严；种子 id 的变体位是段值本身，如 …-4000-d000-…）。
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireOperatorId(value: string | undefined): string {
  if (!value || !UUID_RE.test(value)) {
    throw new UnauthorizedException("Invalid platform admin principal");
  }
  return value;
}

const OFFLINE_PAY_TYPES: ReadonlySet<OrderOfflinePaymentType> = new Set([
  "bank_transfer",
  "cash",
  "other",
]);

function normalizeOfflinePaymentBody(
  body: OfflinePaymentConfirmBody,
): NormalizedOfflinePayment {
  if (!body || typeof body !== "object") {
    throw new BadRequestException("Request body is required");
  }

  const rawPaidAmount = Number(body.paidAmount);
  if (!Number.isFinite(rawPaidAmount) || rawPaidAmount <= 0) {
    throw new BadRequestException("paidAmount must be a positive number");
  }
  // 资金类有且只有两位小数（owner 2026-09-03）：不再 round2 静默改数，多出来的小数直接拒绝。
  if (round2(rawPaidAmount) !== rawPaidAmount) {
    throw new BadRequestException("paidAmount 最多两位小数");
  }
  const paidAmount = rawPaidAmount;

  const offlinePayType = body.offlinePayType;
  if (!OFFLINE_PAY_TYPES.has(offlinePayType)) {
    throw new BadRequestException("Invalid offlinePayType");
  }

  const payerName =
    typeof body.payerName === "string" ? body.payerName.trim() : "";
  if (!payerName) {
    throw new BadRequestException("payerName is required");
  }

  const paidAt = parseTimestamp(body.paidAt);
  if (!paidAt) {
    throw new BadRequestException("paidAt must be a valid timestamp");
  }

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    throw new BadRequestException("reason is required");
  }

  return {
    paidAmount,
    offlinePayType,
    payerName,
    paidAt,
    transactionNo: trimOrNull(body.transactionNo),
    evidenceUrl: trimOrNull(body.evidenceUrl),
    reason,
  };
}

// Stage-2 re-drive body (product_321 P8 ③): money already settled — only an
// optional reason is meaningful; declaration fields are not required.
function relaxedRedriveInput(
  body: OfflinePaymentConfirmBody | undefined,
): NormalizedOfflinePayment {
  const reason =
    body && typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim()
      : "manual stage-2 re-drive";
  return {
    paidAmount: 0,
    offlinePayType: "other",
    payerName: "",
    paidAt: new Date().toISOString(),
    transactionNo: null,
    evidenceUrl: null,
    reason,
  };
}

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeVoidReason(body: VoidOrderBody): string {
  const reason =
    body && typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 4) {
    throw new BadRequestException("reason must be at least 4 characters");
  }
  return reason;
}

interface VoidOrderBody {
  reason: string;
}

function parseTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

interface OfflinePaymentConfirmBody {
  paidAmount: number;
  offlinePayType: OrderOfflinePaymentType;
  payerName: string;
  paidAt: string;
  transactionNo?: string | null;
  evidenceUrl?: string | null;
  reason: string;
}

interface NormalizedOfflinePayment {
  paidAmount: number;
  offlinePayType: OrderOfflinePaymentType;
  payerName: string;
  paidAt: string;
  transactionNo: string | null;
  evidenceUrl: string | null;
  reason: string;
}

/** billing.orders 行锁投影（product_330 P1-b2）。 */
interface OrderLockRow {
  id: string;
  tenant_id: string;
  workspace_id: string;
  status: string;
  currency: string | null;
}

/** 可确认收款的订单态：未付 / 已申报 / 已收款未履约（重驱动）。 */
const OPEN_ORDER_STATUSES: ReadonlySet<string> = new Set([
  "pending_payment",
  "pending_verify",
  "paid",
]);

interface DeclaredLegRow {
  id: string;
  total_amount: string | number | null;
  actor_id: string | null;
  channel_raw_data: unknown;
}

/** Settlement credential carried on the declared cash leg (product_321 P10). */
interface LegCredential {
  discountVoucherId: string | null;
  creditVoucherId: string | null;
  voucherOff: string | number | null;
  released: boolean;
  discountItemId: string | null;
  discountEffectSnapshot: Record<string, unknown> | null;
  creditEffectSnapshot: Record<string, unknown> | null;
  declaredBy: string | null;
}

function parseLegCredential(raw: unknown): LegCredential | null {
  if (!raw || typeof raw !== "object") return null;
  const settlement = (raw as { settlement?: unknown }).settlement;
  if (!settlement || typeof settlement !== "object") return null;
  const s = settlement as Record<string, unknown>;
  return {
    discountVoucherId:
      typeof s.discountVoucherId === "string" ? s.discountVoucherId : null,
    creditVoucherId:
      typeof s.creditVoucherId === "string" ? s.creditVoucherId : null,
    voucherOff:
      typeof s.voucherOff === "string" || typeof s.voucherOff === "number"
        ? s.voucherOff
        : null,
    released: s.released === true,
    discountItemId:
      typeof s.discountItemId === "string" ? s.discountItemId : null,
    discountEffectSnapshot:
      s.discountEffectSnapshot && typeof s.discountEffectSnapshot === "object"
        ? (s.discountEffectSnapshot as Record<string, unknown>)
        : null,
    creditEffectSnapshot:
      s.creditEffectSnapshot && typeof s.creditEffectSnapshot === "object"
        ? (s.creditEffectSnapshot as Record<string, unknown>)
        : null,
    declaredBy: typeof s.declaredBy === "string" ? s.declaredBy : null,
  };
}

interface InvoiceLockRow {
  id: string;
  tenant_id: string;
  payable_amount: string | number | null;
  paid_amount: string | number | null;
  bill_status: string;
  currency: string | null;
}

interface InsertedIdRow {
  id: string;
}

// TD-027: order is a read-only synthetic view (no order table) — order.read.
// Its one write (offline-payment-confirm) is money-in confirmation, gated as the
// 危 commerce:payment.settle (same class as payments verify) + @RequireStepUp.
function assertCanReadOrders(req: Request & RequestContext): void {
  assertAnyCapability(req, ["commerce:order.read"]);
}

function assertCanSettleOrderPayment(req: Request & RequestContext): void {
  assertAnyCapability(req, ["commerce:payment.settle"]);
}

// Void rejects an UNPAID order (no money moves) — distinct danger class from
// settle, gated on its own commerce:order.void code (product_320 §4.3).
function assertCanVoidOrder(req: Request & RequestContext): void {
  assertAnyCapability(req, ["commerce:order.void"]);
}

// Restore undoes a void/expire on a never-activated pending order — its own
// danger class (reopens a closed bill), gated on commerce:order.restore.
function assertCanRestoreOrder(req: Request & RequestContext): void {
  assertAnyCapability(req, ["commerce:order.restore"]);
}

// ── 合成主 SELECT（product_330 P1-b2）：billing.orders 为订单主体，横向取最近账单/支付（LATERAL），
//   套餐名取 plan_versions→plans；履约后的订阅经 ord.subscription_id。
//   region 无 province/city 源列 → 空态兜底；operatorName 按 created_by_type 解 admin.operator_account。
const ORDER_BASE_SQL = `
select
  ord.id,
  ord.order_no,
  ord.status                       as order_entity_status,
  ord.intent                       as order_intent,
  ord.cycle_unit,
  ord.payable_amount               as order_payable_amount,
  ord.currency,
  ord.created_by_type,
  ord.created_at,
  ord.updated_at,
  ord.subscription_id              as fulfilled_subscription_id,
  tsub.status                      as target_subscription_status,
  tenant.id                        as tenant_id,
  tenant.tenant_no::text           as tenant_code,
  tenant.name                      as tenant_name,
  tenant.type                      as tenant_type,
  profile.industry                 as industry,
  plan.plan_code                   as plan_code,
  plan.plan_name                   as plan_name,
  op.display_name                  as operator_name,
  inv.id                           as bill_id,
  inv.bill_no                      as bill_no,
  inv.bill_status                  as bill_status,
  inv.payable_amount               as bill_payable_amount,
  inv.paid_amount                  as bill_paid_amount,
  inv.paid_at                      as bill_paid_at,
  pay.id                           as payment_id,
  pay.pay_order_no                 as payment_no,
  pay.pay_source                   as pay_source,
  pay.pay_method                   as pay_method,
  pay.pay_status                   as pay_status,
  pay.paid_amount                  as payment_paid_amount,
  pay.paid_at                      as payment_paid_at
from billing.orders ord
join tenancy.tenants tenant on tenant.id = ord.tenant_id
-- 履约后的订阅（new：新建；upgrade/renew：被升级 / 被续订的那条）
left join metering.subscriptions tsub on tsub.id = ord.subscription_id
left join tenancy.tenant_profiles profile on profile.tenant_id = tenant.id
left join product.plan_versions pv on pv.id = ord.plan_version_id
left join product.plans plan on plan.id = pv.plan_id
left join admin.operator_account op
  on op.id = ord.created_by_id and ord.created_by_type = 'operator'
left join lateral (
  select i.id, i.bill_no, i.bill_status, i.payable_amount, i.paid_amount, i.paid_at
  from billing.invoices i
  where i.order_id = ord.id and i.deleted_at is null
  order by i.created_at desc
  limit 1
) inv on true
left join lateral (
  select p.id, p.pay_order_no, p.pay_source, p.pay_method, p.pay_status, p.paid_amount, p.paid_at
  from billing.payments p
  where p.bill_id = inv.id
  -- Representative leg: cash before voucher (product_321 §4.2 — a paid
  -- voucher leg is newest after confirm and would shadow the cash leg,
  -- showing the reduction amount as "paid").
  order by (p.pay_source = 'voucher') asc, p.created_at desc
  limit 1
) pay on true
left join lateral (
  select p.pay_channel   as declared_channel,
         p.offline_payer_name as declared_payer,
         p.channel_transaction_no as declared_transaction_no,
         p.operate_remark as declared_remark,
         p.total_amount   as declared_amount,
         p.created_at     as declared_at
  from billing.payments p
  where p.bill_id = inv.id and p.pay_status = 'pending_verify'
  order by p.created_at desc
  limit 1
) declared on true
where true
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
where bill_id = $1 and deleted_at is null
order by created_at asc
`;

const PAYMENTS_SQL = `
select
  pay.id,
  pay.pay_order_no,
  pay.pay_source,
  pay.pay_method,
  pay.offline_pay_type,
  pay.offline_payer_name,
  pay.paid_amount,
  pay.currency,
  pay.pay_status,
  pay.paid_at,
  pay.actor_type,
  op.display_name as operator_name
from billing.payments pay
left join admin.operator_account op
  on op.id = pay.actor_id and pay.actor_type = 'operator'
where pay.bill_id = $1
order by pay.created_at desc
`;

// 时间线 = 订单阶段事件（billing.order_events）∪ 履约订阅的变更历史（subscription_histories）。
// $2 = ord.subscription_id，未履约时为 null → 只有订单事件。
const TIMELINE_SQL = `
select id, event_type as change_type, from_status, to_status, remark, actor_type, actor_id, created_at
  from billing.order_events
 where order_id = $1
union all
select id, change_type, from_status, to_status, remark, actor_type, actor_id, created_at
  from metering.subscription_histories
 where $2::uuid is not null and subscription_id = $2::uuid
order by created_at desc
limit 200
`;

// ────────────────────────────── 映射器 ──────────────────────────────

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
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function mapTenantType(type: string): TenantOperationType {
  return type === "personal" ? "individual" : "company";
}

function mapSubscriptionStatus(status: string): SubscriptionOperationStatus {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "expired":
      return "expired";
    case "cancelled":
      return "cancelled";
    case "suspended":
      return "suspended";
    default:
      return "active";
  }
}

function mapCycle(cycleUnit: string): SubscriptionOperationCycle {
  if (cycleUnit === "month") return "monthly";
  if (cycleUnit === "year") return "yearly";
  return "once";
}

function mapPaySource(source: string | null): OrderPaySource {
  if (source === "online") return "online";
  if (source === "offline") return "offline";
  if (source === "voucher") return "voucher";
  return "none";
}

function mapPaymentStatus(
  payStatus: string | null,
  hasInvoice: boolean,
): OrderPaymentStatus {
  switch (payStatus) {
    case "paid":
      return "paid";
    case "pending_verify":
      return "pending_verify";
    case "pending":
      return "pending";
    case "failed":
      return "failed";
    case "closed":
      return "closed";
    case "refunding":
      return "refunding";
    default:
      // 无支付行：有账单=待支付，无账单=无需支付
      return hasInvoice ? "unpaid" : "not_required";
  }
}

function operatorDisplay(
  operatorName: string | null,
  createdByType: string | null,
): string {
  if (operatorName) return operatorName;
  if (createdByType === "system") return "系统";
  if (createdByType === "customer") return "客户";
  return "未设置";
}

// 订单实体状态 → 运营视图状态（product_330）。partial 仍由账单态判（实体不分部分到账）。
// paid（已收款未履约）以独立态浮出（置顶集），绝不并入 confirmed——否则悬挂单在运营
// 视角"已完结"，永不被发现（product_321 §4.2 同款盲区）。
function mapEntityOrderStatus(
  entityStatus: string,
  billStatus: string | null,
): OrderOperationStatus {
  switch (entityStatus) {
    case "pending_verify":
      return "pending_verify";
    case "paid":
      return "paid_unprovisioned";
    case "fulfilled":
      return "confirmed";
    case "cancelled":
    case "expired":
    case "refunded":
      return "closed";
    case "pending_payment":
    default:
      return billStatus === "partial" ? "partial_pending" : "pending";
  }
}

function mapOrderRow(row: OrderRow): OrderOperationRecord {
  const hasInvoice = Boolean(row.bill_id);
  // 订单金额 = 订单实体的应付（product_330）——不看订阅行 pay_amount（它是"本周期实付"，
  // 升级/续订履约后会被改写，不再代表这张单）。
  const amount = toNumber(row.order_payable_amount);
  // Invoice truth for money collected (product_321 §4.2) — the representative
  // leg's paid_amount is one leg, not the order's total income.
  const paidAmount = toNumber(row.bill_paid_amount ?? row.payment_paid_amount);
  const orderStatus = mapEntityOrderStatus(
    row.order_entity_status,
    row.bill_status,
  );
  const closed = orderStatus === "closed";
  // 未履约的订单没有订阅：在途 → suspended（权益未开）；已关闭 → cancelled。
  // 履约后看被建 / 被升级 / 被续订的那条订阅。
  const subscriptionStatus: SubscriptionOperationStatus =
    row.target_subscription_status
      ? mapSubscriptionStatus(row.target_subscription_status)
      : closed
        ? "cancelled"
        : "suspended";
  // Restorable = an unpaid order that was voided/expired (never fulfilled).
  // paidAmount>0 also blocks it defensively, mirroring the write-path guard.
  const restorable =
    (row.order_entity_status === "cancelled" ||
      row.order_entity_status === "expired") &&
    paidAmount === 0;
  return {
    id: row.id,
    orderNo: row.order_no,
    tenantId: row.tenant_id,
    tenantCode: row.tenant_code,
    tenantName: row.tenant_name,
    tenantType: mapTenantType(row.tenant_type),
    region: "未设置",
    industry: row.industry ?? "未设置",
    solutionCode: null,
    solutionName: "未设置",
    servicePlanCode: row.plan_code ?? "",
    servicePlanName: row.plan_name ?? "未设置",
    tierName: "未设置",
    // 未履约订单没有订阅 → 空串（前端按空值不渲染订阅入口）。
    subscriptionId: row.fulfilled_subscription_id ?? "",
    subscriptionStatus,
    cycleType: mapCycle(row.cycle_unit),
    orderStatus,
    restorable,
    paymentStatus: mapPaymentStatus(row.pay_status, hasInvoice),
    paySource: mapPaySource(row.pay_source),
    payMethod: row.pay_method,
    billId: row.bill_id,
    billNo: row.bill_no,
    billStatus: row.bill_status,
    paymentId: row.payment_id,
    paymentNo: row.payment_no,
    amount,
    paidAmount,
    currency: row.currency ?? "CNY",
    operatorName: operatorDisplay(row.operator_name, row.created_by_type),
    operationHint: OPERATION_HINTS[orderStatus] ?? "",
    declaredPayment: row.declared_at
      ? {
          channel: row.declared_channel,
          payerName: row.declared_payer,
          transactionNo: row.declared_transaction_no,
          remark: row.declared_remark,
          amount: toNumber(row.declared_amount),
          declaredAt: toIso(row.declared_at),
        }
      : null,
    createdAt: toIso(row.created_at),
    confirmedAt: toIsoOrNull(row.payment_paid_at ?? row.bill_paid_at),
    updatedAt: toIso(row.updated_at),
  };
}

const OPERATION_HINTS: Partial<Record<OrderOperationStatus, string>> = {
  pending: "待客户完成支付",
  pending_verify: "客户已申报付款，请核对到账后确认或驳回",
  paid_unprovisioned: "已收款未开通（自愈中/需人工重驱动）",
  partial_pending: "部分收款挂账，待客户申报剩余或线下协商",
};

function mapInvoiceItemRow(row: InvoiceItemRow): OrderInvoiceItemRecord {
  return {
    id: row.id,
    itemName: row.item_name,
    itemType: row.item_type,
    itemUnit: row.item_unit,
    quantity: toNumber(row.quantity),
    unitPrice: toNumber(row.unit_price),
    totalAmount: toNumber(row.total_amount),
    remark: row.remark,
  };
}

function mapOfflinePayType(
  value: string | null,
): OrderOfflinePaymentType | null {
  if (value === "bank_transfer") return "bank_transfer";
  if (value === "cash") return "cash";
  if (!value) return null;
  return "other";
}

function mapPaymentRow(row: PaymentRow): OrderPaymentRecord {
  return {
    id: row.id,
    paymentNo: row.pay_order_no,
    paySource: mapPaySource(row.pay_source),
    payMethod: row.pay_method,
    offlinePayType: mapOfflinePayType(row.offline_pay_type),
    offlinePayerName: row.offline_payer_name,
    paidAmount: toNumber(row.paid_amount),
    currency: row.currency ?? "CNY",
    paymentStatus: mapPaymentStatus(row.pay_status, true),
    paidAt: toIsoOrNull(row.paid_at),
    operatorName: operatorDisplay(row.operator_name, row.actor_type),
    remark: null,
  };
}

const TIMELINE_TONES: Record<string, OrderOperationEvent["tone"]> = {
  // 订单阶段（billing.order_events）
  cancelled: "danger",
  order_expired: "danger",
  payment_rejected: "warning",
  payment_declared: "neutral",
  payment_confirmed: "success",
  fulfilled: "success",
  restored: "neutral",
  // 订阅阶段（subscription_histories）
  created: "success",
  renewed: "success",
  upgraded: "success",
  activated: "success",
  downgraded: "warning",
};

function mapHistoryRow(row: HistoryRow): OrderOperationEvent {
  const tone: OrderOperationEvent["tone"] =
    TIMELINE_TONES[row.change_type] ?? "neutral";
  return {
    id: row.id,
    title: row.change_type,
    description:
      row.remark ??
      [row.from_status, row.to_status].filter(Boolean).join(" → "),
    actor: row.actor_type,
    at: toIso(row.created_at),
    tone,
  };
}

// ────────────────────────────── 行接口 ──────────────────────────────

interface OrderRow {
  id: string;
  order_no: string;
  /** billing.orders.status（product_330 订单实体状态机） */
  order_entity_status: string;
  order_intent: string;
  cycle_unit: string;
  order_payable_amount: string | number | null;
  currency: string | null;
  created_by_type: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  /** 履约后指向的订阅（new 新建 / upgrade、renew 原订阅）；未履约 null */
  fulfilled_subscription_id: string | null;
  target_subscription_status: string | null;
  tenant_id: string;
  tenant_code: string;
  tenant_name: string;
  tenant_type: string;
  industry: string | null;
  plan_code: string | null;
  plan_name: string | null;
  operator_name: string | null;
  bill_id: string | null;
  bill_no: string | null;
  bill_status: string | null;
  bill_payable_amount: string | number | null;
  bill_paid_amount: string | number | null;
  bill_paid_at: Date | string | null;
  payment_id: string | null;
  payment_no: string | null;
  pay_source: string | null;
  pay_method: string | null;
  pay_status: string | null;
  payment_paid_amount: string | number | null;
  payment_paid_at: Date | string | null;
  declared_channel: string | null;
  declared_payer: string | null;
  declared_transaction_no: string | null;
  declared_remark: string | null;
  declared_amount: string | number | null;
  declared_at: Date | string | null;
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
  actor_type: string | null;
  operator_name: string | null;
}

interface HistoryRow {
  id: string;
  change_type: string;
  from_status: string | null;
  to_status: string | null;
  remark: string | null;
  actor_type: string;
  actor_id: string | null;
  created_at: Date | string | null;
}
