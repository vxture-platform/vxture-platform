/**
 * order.service.ts — 订单编排（product_330 P1-b2）：下单 / 申报 / 履约 / 取消 / 恢复 / 超时 / 自愈
 * @package @vxture/service-subscription
 *
 * 订单是钱与意图的载体，订阅是权益实例。本服务只改 billing.orders（经 PgOrderRepository），
 * 对订阅的一切改动都经 SubscriptionService（建行 / 换版本 / 延期 / 复活，连同 provisioning
 * 钩子），再由 PgOrderRepository.applySubscriptionTerms 把订单条款（周期 / 实付 / current_order_id）
 * 落到订阅上。履约（fulfill）幂等：订单已 fulfilled 直接返回；失败停在 paid，reconcile 重试。
 */
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  PromotionService,
  computeSettlement,
  centsToYuan,
  yuanToCents,
  type DiscountEffect,
  type ReservedVoucher,
} from "@vxture/service-promotion";
import { PgOrderRepository } from "../repository/pg-order.repository";
import { PgSubscriptionRepository } from "../repository/pg-subscription.repository";
import { SubscriptionService } from "./subscription.service";
import {
  DEFAULT_CONSUMABLE_SHARE,
  computeProration,
  cycleDays,
  daysLeftOf,
  type ProrationResult,
} from "../money/proration";
import type {
  CreateOrderInput,
  CreateOrderResult,
  OrderActor,
  OrderRecord,
  RefundEligibility,
  RefundIneligibleReason,
  RefundRecordView,
} from "../types/order.types";
import type {
  DeclarePaymentInput,
  DeclarePaymentResult,
  SubscriptionRecord,
} from "../types/subscription.types";

/** 权益在用的订阅状态（ACTIVATED 口径，与 SubscriptionService 一致）。 */
const LIVE = new Set(["active", "trialing"]);
/** 续订可作用的状态：在用 + 到期族（复活）。 */
const RENEWABLE = new Set([
  "active",
  "trialing",
  "expiring",
  "overdue",
  "expired",
]);

export interface FulfillResult {
  order: OrderRecord;
  subscription: SubscriptionRecord;
}

function addCycle(base: Date, unit: string, count: number): Date {
  const d = new Date(base.getTime());
  switch (unit) {
    case "day":
      d.setUTCDate(d.getUTCDate() + count);
      break;
    case "week":
      d.setUTCDate(d.getUTCDate() + 7 * count);
      break;
    case "month":
      d.setUTCMonth(d.getUTCMonth() + count);
      break;
    case "year":
      d.setUTCFullYear(d.getUTCFullYear() + count);
      break;
    default:
      break;
  }
  return d;
}

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);
  private readonly reconcileFailures = new Map<string, number>();
  private static readonly RECONCILE_FAILURE_LIMIT = 3;

  constructor(
    @Inject(PgOrderRepository) private readonly orders: PgOrderRepository,
    @Inject(PgSubscriptionRepository)
    private readonly subRepo: PgSubscriptionRepository,
    @Inject(SubscriptionService)
    private readonly subscriptions: SubscriptionService,
    @Inject(PromotionService) private readonly promotion: PromotionService,
  ) {}

  async getOrder(id: string): Promise<OrderRecord> {
    const order = await this.orders.getById(id);
    if (!order) throw new NotFoundException(`订单 ${id} 不存在`);
    return order;
  }

  async findOpenOrderForProduct(
    workspaceId: string,
    productCode: string,
  ): Promise<OrderRecord | null> {
    return this.orders.findOpenOrderForProduct(workspaceId, productCode);
  }

  /**
   * 下单。new：档位并存守卫；upgrade：原订阅须在用且目标版本不同；renew：原订阅须可续
   * （在用或到期族）且同套餐。不建订阅行。
   */
  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    if (input.intent === "new") {
      await this.subscriptions.assertTierAvailable(
        input.workspaceId,
        input.planVersionId,
      );
    } else {
      if (!input.fromSubscriptionId) {
        throw new ConflictException(`${input.intent} 需要指定原订阅`);
      }
      const from = await this.subscriptions.getSubscription(
        input.fromSubscriptionId,
      );
      if (from.workspaceId !== input.workspaceId) {
        throw new ConflictException("原订阅不属于本工作区");
      }
      if (input.intent === "upgrade") {
        if (!LIVE.has(from.status)) {
          throw new ConflictException("原订阅不在服务中，请重新订阅");
        }
        if (from.planVersionId === input.planVersionId) {
          throw new ConflictException(
            "目标套餐与当前订阅相同，无需升级（延长周期请使用续订）",
          );
        }
      } else {
        if (!RENEWABLE.has(from.status)) {
          throw new ConflictException("原订阅已终止，请重新订阅");
        }
        if (from.planVersionId !== input.planVersionId) {
          throw new ConflictException("续订须与当前套餐相同，换档请使用升级");
        }
      }
    }
    if (input.intent === "upgrade" && input.fromSubscriptionId) {
      // 折抵随单落库（P2-a）：确认页展示的报价与这里同一函数，同一时刻只差秒级。
      const quote = await this.quoteUpgrade(
        input.fromSubscriptionId,
        input.price,
      );
      return this.orders.createOrder({
        ...input,
        proration: {
          credit: quote.credit,
          payable: quote.payable,
          leftover: quote.leftover,
          snapshot: { ...quote, computedAt: new Date().toISOString() },
        },
      });
    }
    return this.orders.createOrder(input);
  }

  /**
   * 升级报价（product_330 §4.1，owner 决策 2）：credit = P_old × ((1−α)·r + α·u)。
   * P_old = 原订阅本周期实付；r = 剩余天数比；u = 消耗性池剩余比；α = 主组件 consumable_share
   * （默认 0.5，无消耗性池为 0）。原订阅无到期日（perpetual）→ 视为周期已用尽（r=0）。
   */
  async quoteUpgrade(
    fromSubscriptionId: string,
    pNew: number,
  ): Promise<ProrationResult> {
    const basis = await this.orders.getProrationBasis(fromSubscriptionId);
    if (!basis)
      throw new NotFoundException(`订阅 ${fromSubscriptionId} 不存在`);
    const now = new Date();
    const daysTotal = basis.endAt ? cycleDays(basis.startAt, basis.endAt) : 1;
    const daysLeft = basis.endAt ? daysLeftOf(basis.endAt, now) : 0;
    return computeProration({
      pOld: basis.paidAmount,
      pNew,
      daysTotal,
      daysLeft,
      usageRemainingRatio: basis.usageRemainingRatio,
      consumableShare: basis.consumableShare ?? DEFAULT_CONSUMABLE_SHARE,
    });
  }

  /**
   * 客户申报付款（product_321 P8，订单实体版）：锁订单行 → 券预留 → 计价 → 现金腿
   * pending_verify（cashDue>0）或全券 / ¥0 即时结清（cashDue=0，随后履约）。
   */
  async declarePayment(
    input: DeclarePaymentInput,
  ): Promise<DeclarePaymentResult> {
    const settled = await this.orders.withOrderTx(
      input.orderId,
      async ({ client, order, invoice }) => {
        if (!invoice) throw new ConflictException("订单缺少账单，无法申报");
        if (invoice.billStatus === "paid") {
          return {
            done: {
              outcome: "already_settled" as const,
              cashDue: "0.00",
              paymentId: null,
            },
          };
        }
        if (
          (order.status !== "pending_payment" &&
            order.status !== "pending_verify") ||
          !["unpaid", "partial"].includes(invoice.billStatus)
        ) {
          throw new ConflictException("订单不是待付款状态，无法申报付款");
        }
        const existingLeg = await this.subRepo.findPendingVerifyLegTx(
          client,
          invoice.id,
        );
        if (existingLeg) {
          return {
            done: {
              outcome: "already_declared" as const,
              cashDue: existingLeg.totalAmount,
              paymentId: existingLeg.id,
            },
          };
        }
        const cleaned = await this.subRepo.softDeleteDiscountItemsTx(
          client,
          invoice.id,
        );
        if (cleaned > 0) {
          this.logger.warn(
            `declare ${input.orderId}: cleaned ${cleaned} residual discount row(s) before settling`,
          );
        }
        const base = await this.subRepo.recomputeInvoiceTx(client, invoice.id);

        const scope = {
          tenantId: order.tenantId,
          workspaceId: order.workspaceId,
          userId: input.userId,
        };
        const reserved = await this.promotion.reserveForOrder(client, {
          scope,
          discountVoucherId: input.discountVoucherId ?? null,
          creditVoucherId: input.creditVoucherId ?? null,
        });
        const discount = reserved.find((v) => v.kind === "discount") ?? null;
        const credit =
          reserved.find((v) => v.kind === "credit_voucher") ?? null;
        let discountItemId: string | null = null;

        const quote = computeSettlement({
          listPriceCents: yuanToCents(base.totalAmount),
          paidCents: yuanToCents(invoice.paidAmount),
          discountEffect: discount ? (discount.effect as DiscountEffect) : null,
          creditVoucherCents: credit
            ? (credit.effect as { amountCents: number }).amountCents
            : null,
        });
        if (discount && !quote.discountApplicable) {
          throw new ConflictException(
            "折扣券不可用于该订单（折后应付低于已收款）",
          );
        }
        if (discount && quote.discountOffCents > 0) {
          discountItemId = await this.subRepo.insertDiscountItemTx(client, {
            invoiceId: invoice.id,
            tenantId: order.tenantId,
            workspaceId: order.workspaceId,
            subscriptionId: order.fromSubscriptionId,
            itemName: `折扣券抵扣 (${discount.voucherId})`,
            amountYuan: `-${centsToYuan(quote.discountOffCents)}`,
          });
          await this.subRepo.recomputeInvoiceTx(client, invoice.id);
        }

        const credential = {
          settlement: {
            discountVoucherId: discount?.voucherId ?? null,
            creditVoucherId: credit?.voucherId ?? null,
            voucherOff: centsToYuan(quote.voucherOffCents),
            cashDue: centsToYuan(quote.cashDueCents),
            reservedAt: new Date().toISOString(),
            released: false,
            discountItemId,
            discountEffectSnapshot: discount?.effectSnapshot ?? null,
            creditEffectSnapshot: credit?.effectSnapshot ?? null,
            declaredBy: input.userId,
          },
        };

        if (quote.cashDueCents === 0) {
          const { voucherLegId } = await this.subRepo.settleInvoiceByVouchersTx(
            client,
            {
              tenantId: order.tenantId,
              invoiceId: invoice.id,
              voucherLegYuan: centsToYuan(quote.voucherOffCents),
              currency: invoice.currency,
              actorId: input.userId,
            },
          );
          await this.promotion.finalizeReserved(
            client,
            reserved.map((v: ReservedVoucher) => ({
              voucherId: v.voucherId,
              kind: v.kind,
              scope,
              effectSnapshot: v.effectSnapshot,
              invoiceItemId: v.kind === "discount" ? discountItemId : null,
              paymentId: v.kind === "credit_voucher" ? voucherLegId : null,
            })),
          );
          await this.orders.markPaidTx(client, order.id);
          await this.orders.insertEventTx(client, {
            orderId: order.id,
            eventType: "payment_confirmed",
            fromStatus: order.status,
            toStatus: "paid",
            actorType: "customer",
            actorId: input.userId,
            remark: JSON.stringify({ ...credential.settlement, instant: true }),
            clientIp: input.clientIp ?? null,
          });
          return { settle: true };
        }

        const paymentId = await this.subRepo.insertCashLegTx(client, {
          tenantId: order.tenantId,
          invoiceId: invoice.id,
          payChannel: input.payChannel === "alipay" ? "alipay" : "bank",
          offlinePayType:
            input.payChannel === "bank_transfer" ? "bank_transfer" : null,
          payerName: input.payerName ?? null,
          transactionNo: input.transactionNo ?? null,
          remark: input.remark ?? null,
          amountYuan: centsToYuan(quote.cashDueCents),
          currency: invoice.currency,
          credential,
          actorId: input.userId,
        });
        await this.orders.markDeclaredTx(client, order.id);
        await this.orders.insertEventTx(client, {
          orderId: order.id,
          eventType: "payment_declared",
          fromStatus: order.status,
          toStatus: "pending_verify",
          actorType: "customer",
          actorId: input.userId,
          remark: JSON.stringify(credential.settlement),
          clientIp: input.clientIp ?? null,
        });
        return {
          done: {
            outcome: "declared" as const,
            cashDue: centsToYuan(quote.cashDueCents),
            paymentId,
          },
        };
      },
    );

    if ("done" in settled && settled.done) return settled.done;

    // cashDue=0：资金已提交，履约作为独立事务（崩溃窗口由 reconcile 兜底）。
    try {
      await this.fulfill(input.orderId, {
        actorType: "customer",
        actorId: input.userId,
        remark: "instant voucher settlement (declare)",
      });
      return { outcome: "activated", cashDue: "0.00", paymentId: null };
    } catch (err) {
      this.logger.error(
        `declare ${input.orderId}: fulfil failed after settle — reconcile will retry: ${String(err)}`,
      );
      return { outcome: "activating", cashDue: "0.00", paymentId: null };
    }
  }

  /**
   * 履约（product_330 §4）——订单→订阅的唯一入口，幂等：
   *  new     → 建订阅（active，start=now，end=now+周期，kind 按金额）
   *  upgrade → 原订阅换版本 + 搬条款（周期 / 到期 / 实付）；原订阅不在用 → 退化为 new
   *  renew   → 原订阅 end = max(end, now) + 周期（到期族复活为 active）；已取消 → 退化为 new
   */
  async fulfill(orderId: string, actor: OrderActor): Promise<FulfillResult> {
    const order = await this.getOrder(orderId);
    if (order.status === "fulfilled" && order.subscriptionId) {
      const subscription = await this.subscriptions.getSubscription(
        order.subscriptionId,
      );
      return { order, subscription };
    }
    if (order.status !== "paid") {
      throw new ConflictException("订单未收款，不能履约");
    }

    let subscription: SubscriptionRecord;
    let mode = order.intent;
    const from = order.fromSubscriptionId
      ? await this.subscriptions.getSubscription(order.fromSubscriptionId)
      : null;

    if (mode === "upgrade" && from && LIVE.has(from.status)) {
      if (from.planVersionId !== order.planVersionId) {
        await this.subscriptions.upgradeSubscription(
          from.id,
          order.planVersionId,
          actor.actorId ?? undefined,
          actor.remark ?? `order ${order.orderNo}`,
        );
      }
      await this.orders.applySubscriptionTerms(from.id, {
        mode: "upgrade",
        cycleUnit: order.cycleUnit,
        cycleCount: order.cycleCount,
        payAmount: order.payableAmount,
        orderId: order.id,
      });
      // 折抵溢出进预付款（幂等，按 order_no 去重）——放在订阅改完之后，钱的动作最后做。
      if (Number(order.leftoverAmount) > 0) {
        await this.orders.grantLeftoverToPrepaid(order, actor);
      }
      subscription = await this.subscriptions.getSubscription(from.id);
    } else if (mode === "renew" && from && RENEWABLE.has(from.status)) {
      const now = new Date();
      const base = from.endAt && from.endAt > now ? from.endAt : now;
      const endAt = addCycle(base, order.cycleUnit, order.cycleCount);
      await this.subscriptions.updateSubscription(from.id, {
        ...(LIVE.has(from.status) ? {} : { status: "active" }),
        endAt,
        operatorType: actor.actorType,
        ...(actor.actorId ? { operatorId: actor.actorId } : {}),
        operatorRemark: actor.remark ?? `renew order ${order.orderNo}`,
      });
      await this.orders.applySubscriptionTerms(from.id, {
        mode: "renew",
        cycleUnit: order.cycleUnit,
        cycleCount: order.cycleCount,
        payAmount: order.payableAmount,
        orderId: order.id,
      });
      subscription = await this.subscriptions.getSubscription(from.id);
    } else {
      mode = "new";
      const now = new Date();
      const endAt = addCycle(now, order.cycleUnit, order.cycleCount);
      const price = Number(order.payableAmount);
      // 订阅↔订单的关联是 current_order_id（下面 applySubscriptionTerms 落）；
      // subscriptions.order_no 已停写（product_330 P2）。
      subscription = await this.subscriptions.createSubscription({
        tenantId: order.tenantId,
        workspaceId: order.workspaceId,
        planVersionId: order.planVersionId,
        cycleType: order.cycleUnit,
        cycleCount: order.cycleCount,
        startAt: now,
        endAt,
        // owner 决策 5：free 与付费一样默认自动续期、可关闭（续费引擎 P2-c）。
        autoRenew: true,
        payAmount: price,
        currency: order.currency,
        createdBy: order.createdById ?? actor.actorId ?? order.tenantId,
        status: "active",
        subscriptionKind: price > 0 ? "paid" : "free",
        activationMethod: "offline_purchase",
        createdByType: order.createdByType,
      });
      await this.orders.applySubscriptionTerms(subscription.id, {
        mode: "new",
        cycleUnit: order.cycleUnit,
        cycleCount: order.cycleCount,
        payAmount: order.payableAmount,
        orderId: order.id,
      });
    }

    await this.orders.markFulfilled(order.id, subscription.id, {
      ...actor,
      remark: actor.remark ?? `${mode} → subscription ${subscription.id}`,
    });
    const fresh = await this.getOrder(order.id);
    return { order: fresh, subscription };
  }

  /**
   * 自动续费引擎（product_330 P2-c，线下收款世界）：到期前 leadDays 内、auto_renew 开的订阅
   *  - ¥0（free）：开 renew 单 → 同事务结清 → 立即履约（end_at 顺延一个周期，池重发）
   *  - 付费：开 renew 单（system 下单，TTL = 到期 + graceDays），客户在「我的订单」付款；
   *    到期未付 → 到期扫描翻 expired，付款履约再复活；TTL 到 → 单关闭
   *  - 无同周期价目（自定义/企业档）：跳过并记日志（运营手工续）
   * 每单独立事务、失败只记日志；重复保护在候选查询里（在途单 / lead 窗口内已开过）。
   */
  async runAutoRenewalPass(options: {
    leadDays: number;
    graceDays: number;
    limit?: number;
  }): Promise<{ created: number; fulfilled: number; skipped: number }> {
    const candidates = await this.orders.findAutoRenewCandidates(
      options.leadDays,
      options.limit ?? 100,
    );
    let created = 0;
    let fulfilled = 0;
    let skipped = 0;
    for (const c of candidates) {
      if (c.price === null) {
        skipped += 1;
        this.logger.warn(
          `auto-renew: subscription ${c.subscriptionId} has no ${c.cycleCount} ${c.cycleUnit} price row — skipped (manual renewal)`,
        );
        continue;
      }
      try {
        const ttlMinutes = Math.max(
          60,
          Math.ceil(
            (c.endAt.getTime() + options.graceDays * 86_400_000 - Date.now()) /
              60_000,
          ),
        );
        const { order, invoiceId } = await this.orders.createOrder({
          tenantId: c.tenantId,
          workspaceId: c.workspaceId,
          planVersionId: c.planVersionId,
          cycleUnit: c.cycleUnit,
          price: Number(c.price),
          currency: c.currency,
          createdBy: null,
          createdByType: "system",
          intent: "renew",
          fromSubscriptionId: c.subscriptionId,
          itemName: c.planName,
          paymentTtlMinutes: ttlMinutes,
        });
        created += 1;
        if (Number(c.price) > 0) continue;

        const actor: OrderActor = {
          actorType: "system",
          actorId: null,
          remark: "auto-renew (¥0)",
        };
        await this.orders.withOrderTx(
          order.id,
          async ({ client, order: locked }) => {
            if (locked.status !== "pending_payment") return;
            await this.orders.settleZeroOrderTx(
              client,
              locked,
              invoiceId,
              actor,
            );
          },
        );
        await this.fulfill(order.id, actor);
        fulfilled += 1;
      } catch (err) {
        this.logger.error(
          `auto-renew: subscription ${c.subscriptionId} failed — ${String(err)}`,
        );
      }
    }
    return { created, fulfilled, skipped };
  }

  // ── 退款（product_330 §5，owner 决策 3）──────────────────────────────────────

  /**
   * 24h 退款资格：已履约 new 单（折抵后的升级单不算首次）、该工作区×产品首笔、履约起
   * windowHours 内、消耗性配额使用率 < maxUsageRatio、实付 > 0、无在途退款单。
   */
  async getRefundEligibility(orderId: string): Promise<RefundEligibility> {
    const [order, policy, basis] = await Promise.all([
      this.getOrder(orderId),
      this.orders.getRefundPolicy(),
      this.orders.getRefundBasis(orderId),
    ]);
    const reasons: RefundIneligibleReason[] = [];
    const windowEndsAt = order.fulfilledAt
      ? new Date(order.fulfilledAt.getTime() + policy.windowHours * 3_600_000)
      : null;
    if (order.status !== "fulfilled" || !order.fulfilledAt) {
      reasons.push("not_fulfilled");
    }
    if (order.intent !== "new" || (basis && basis.earlierFulfilledCount > 0)) {
      reasons.push("not_first_purchase");
    }
    if (windowEndsAt && windowEndsAt.getTime() <= Date.now()) {
      reasons.push("window_elapsed");
    }
    const usageRatio = basis?.usageRatio ?? 0;
    if (usageRatio >= policy.maxUsageRatio)
      reasons.push("usage_over_threshold");
    if (!(Number(order.payableAmount) > 0)) reasons.push("zero_amount");
    if (basis?.existingRefundId) reasons.push("refund_exists");
    return {
      eligible: reasons.length === 0,
      reasons,
      amount: order.payableAmount,
      currency: order.currency,
      windowEndsAt,
      usageRatio: Math.round(usageRatio * 10000) / 10000,
      policy,
    };
  }

  async getRefundForOrder(orderId: string): Promise<RefundRecordView | null> {
    return this.orders.getRefundByOrder(orderId);
  }

  /** 客户申请退款：资格不满足 → 409（reasons 随消息带出）。 */
  async requestRefund(
    orderId: string,
    input: { userId: string; reason: string | null; clientIp?: string | null },
  ): Promise<RefundRecordView> {
    const eligibility = await this.getRefundEligibility(orderId);
    if (!eligibility.eligible) {
      throw new ConflictException({
        code: "REFUND_NOT_ELIGIBLE",
        reasons: eligibility.reasons,
        message: "该订单不符合退款条件",
      });
    }
    const [order, basis] = await Promise.all([
      this.getOrder(orderId),
      this.orders.getRefundBasis(orderId),
    ]);
    if (!basis?.payRecordId || !basis.invoiceId) {
      throw new ConflictException("订单没有可退的支付记录");
    }
    return this.orders.createRefundRequest({
      order,
      invoiceId: basis.invoiceId,
      payRecordId: basis.payRecordId,
      reason: input.reason,
      userId: input.userId,
      clientIp: input.clientIp ?? null,
    });
  }

  async auditRefund(
    refundId: string,
    input: {
      decision: "approved" | "rejected";
      remark: string;
      operatorId: string;
      clientIp?: string | null;
    },
  ): Promise<RefundRecordView> {
    const refund = await this.orders.getRefundById(refundId);
    if (!refund) throw new NotFoundException(`退款单 ${refundId} 不存在`);
    if (refund.auditStatus !== "pending") {
      throw new ConflictException("退款申请已审核");
    }
    const order = await this.getOrder(refund.orderId);
    return this.orders.auditRefund({ refund, order, ...input });
  }

  /**
   * 退款执行（运营已按原渠道打款）：钱的冲正 + 订单 refunded 一个事务，随后订阅整体回到
   * 未订阅（cancelled，end=now，含 free 前身——旧档价值已折进这张单）。订阅回滚失败不回滚
   * 钱：记日志、留给 reconcile / 人工（订单已 refunded，订阅仍 active 是可见的异常态）。
   */
  async executeRefund(
    refundId: string,
    actor: OrderActor,
  ): Promise<{ refund: RefundRecordView; order: OrderRecord }> {
    const refund = await this.orders.getRefundById(refundId);
    if (!refund) throw new NotFoundException(`退款单 ${refundId} 不存在`);
    if (refund.auditStatus !== "approved") {
      throw new ConflictException("退款申请未审核通过，不能执行");
    }
    if (refund.refundStatus === "success") {
      const order = await this.getOrder(refund.orderId);
      return { refund, order };
    }
    const order = await this.getOrder(refund.orderId);
    const done = await this.orders.executeRefund({ refund, order, actor });
    if (order.subscriptionId) {
      try {
        const sub = await this.subscriptions.getSubscription(
          order.subscriptionId,
        );
        if (sub.status !== "cancelled" && sub.status !== "expired") {
          await this.subscriptions.cancelSubscription(
            sub.id,
            actor.actorId ?? undefined,
            `refund ${refund.refundNo} (order ${order.orderNo})`,
            actor.actorType === "customer" ? "customer" : actor.actorType,
          );
        }
      } catch (err) {
        this.logger.error(
          `refund ${refund.refundNo}: subscription rollback failed — ${String(err)}`,
        );
      }
    }
    return done;
  }

  async listRefunds(status?: "pending" | "approved" | "rejected") {
    return this.orders.listRefunds(status);
  }

  async cancel(
    orderId: string,
    actor: OrderActor,
    kind: "cancelled" | "expired" = "cancelled",
  ): Promise<OrderRecord> {
    return this.orders.cancelOrder(orderId, actor, kind);
  }

  async restore(orderId: string, actor: OrderActor): Promise<OrderRecord> {
    return this.orders.restoreOrder(orderId, actor);
  }

  /** 超时关闭（§4.3 duty 1）：逐单失败只记日志。 */
  async sweepExpired(fallbackTtlMinutes: number, limit = 100): Promise<number> {
    const ids = await this.orders.findExpiredIds(fallbackTtlMinutes, limit);
    let closed = 0;
    for (const id of ids) {
      try {
        await this.cancel(
          id,
          {
            actorType: "system",
            actorId: null,
            remark: "payment window elapsed (P4 TTL)",
          },
          "expired",
        );
        closed += 1;
      } catch (err) {
        this.logger.error(
          `payment expiry sweep: order ${id} failed to close — ${String(err)}`,
        );
      }
    }
    return closed;
  }

  /** 已收款未履约自愈（§4.3 duty 2）：连续失败 3 次停止自动重试，转人工。 */
  async reconcileHungPaid(minAgeMinutes = 2, limit = 20): Promise<number> {
    const ids = await this.orders.findHungPaidIds(minAgeMinutes, limit);
    let healed = 0;
    for (const id of ids) {
      const failures = this.reconcileFailures.get(id) ?? 0;
      if (failures >= OrderService.RECONCILE_FAILURE_LIMIT) {
        this.logger.warn(
          `reconcile: order ${id} exceeded ${failures} failures — auto-retry stopped, operator action required`,
        );
        continue;
      }
      try {
        await this.fulfill(id, {
          actorType: "system",
          actorId: null,
          remark: "hung paid order self-heal",
        });
        healed += 1;
        this.reconcileFailures.delete(id);
      } catch (err) {
        this.reconcileFailures.set(id, failures + 1);
        this.logger.error(
          `reconcile: order ${id} failed (${failures + 1}/${OrderService.RECONCILE_FAILURE_LIMIT}) — ${String(err)}`,
        );
      }
    }
    return healed;
  }
}
