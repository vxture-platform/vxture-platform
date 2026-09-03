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
import type {
  CreateOrderInput,
  CreateOrderResult,
  OrderActor,
  OrderRecord,
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
    return this.orders.createOrder(input);
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
      const base = {
        tenantId: order.tenantId,
        workspaceId: order.workspaceId,
        planVersionId: order.planVersionId,
        cycleType: order.cycleUnit,
        cycleCount: order.cycleCount,
        startAt: now,
        endAt,
        autoRenew: false,
        payAmount: price,
        currency: order.currency,
        createdBy: order.createdById ?? actor.actorId ?? order.tenantId,
        status: "active",
        subscriptionKind: price > 0 ? "paid" : "free",
        activationMethod: "offline_purchase",
        createdByType: order.createdByType,
      };
      try {
        subscription = await this.subscriptions.createSubscription({
          ...base,
          orderNo: order.orderNo,
        });
      } catch (err) {
        // 旧模型的镜像行占着 order_no（uq_subscriptions_order_no）：不带 order_no 再建，
        // 订阅↔订单的真关联是 current_order_id。
        if ((err as { code?: string }).code === "23505") {
          subscription = await this.subscriptions.createSubscription(base);
        } else {
          throw err;
        }
      }
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
