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
  customerRecipients,
  formatNotifyDate,
  formatNotifyMoney,
  type CustomerNotifier,
  type CustomerNotifyInput,
} from "./customer-notifier";
import type { OpsAlerter } from "./ops-alerter";
import {
  DEFAULT_CONSUMABLE_SHARE,
  computeProration,
  cycleDays,
  daysLeftOf,
  type ProrationResult,
} from "../money/proration";
/* 档位高低序的唯一判据，与值域同处一份（见该文件头注）。 */
import { isTierUpgrade, tierRank } from "@vxture-platform/shared";
import type {
  CreateOrderInput,
  CreateOrderResult,
  OpsTodoOrderRow,
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

/**
 * 周期推进：到期日 = 起算日 + count 个 unit。**导出仅为可测**——它决定订阅到期日,
 * 算错直接影响收费与权益关断,而它此前一行都没被测到(2026-09-08 覆盖率清点)。
 *
 * 全程走 UTC 的 setUTC*：本地时区会让跨夏令时的月份多出/少掉一天。
 * 未知 unit 原样返回不推进——宁可到期日不动被人发现,也不要悄悄按某个默认单位算。
 */
export function addCycle(base: Date, unit: string, count: number): Date {
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
  /** 客户通知（P2-g）：装配处 setCustomerNotifier 注入；未注入 = 不发。 */
  private notifier: CustomerNotifier | null = null;
  /** 运营告警（#231）：装配处 setOpsAlerter 注入；未注入 = 不发。 */
  private opsAlerter: OpsAlerter | null = null;
  /** 自愈最后一次失败的原因，供放弃时报给运营（内存，随 reconcileFailures 同生命周期）。 */
  private readonly reconcileLastError = new Map<string, string>();

  constructor(
    @Inject(PgOrderRepository) private readonly orders: PgOrderRepository,
    @Inject(PgSubscriptionRepository)
    private readonly subRepo: PgSubscriptionRepository,
    @Inject(SubscriptionService)
    private readonly subscriptions: SubscriptionService,
    @Inject(PromotionService) private readonly promotion: PromotionService,
  ) {}

  setCustomerNotifier(notifier: CustomerNotifier | null): void {
    this.notifier = notifier;
  }

  setOpsAlerter(alerter: OpsAlerter | null): void {
    this.opsAlerter = alerter;
  }

  /** 运营待办告警的候选单（#231）；判据与注释见仓储层 findOpsTodoOrders。 */
  async listOpsTodoOrders(
    minAgeMinutes: number,
    limit = 50,
  ): Promise<OpsTodoOrderRow[]> {
    return this.orders.findOpsTodoOrders(minAgeMinutes, limit);
  }

  /**
   * 通知一律 best-effort：业务写已提交，通知失败只记日志、不回滚不抛。
   * build 延迟求值——未注入 notifier 时连展示数据都不查。
   */
  private async emit(
    label: string,
    build: () => Promise<CustomerNotifyInput | null>,
  ): Promise<void> {
    if (!this.notifier) return;
    try {
      /* build 返回 null = 展示数据取不到(订单被并发删了之类),不发也不报错。
         与 subscription.service 的 emit 同形——两个服务的这条纪律不该有两种写法。 */
      const input = await build();
      if (!input) return;
      await this.notifier.notify(input);
    } catch (err) {
      this.logger.warn(`notify ${label} failed — ${String(err)}`);
    }
  }

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
      /*
       * 判据是**套餐**，不是版本（owner 2026-09-22）。
       *
       * 原来两条都按 `planVersionId` 比。套餐一旦发布新版本，阶梯送的就是新版本
       * id，于是同一档的老客户想续期被判成升级——周期从现在重置、走折抵报价、订阅
       * 被重钉到新版，界面还写「升级」，全程不报错。续订问的是「还是不是这个套餐」，
       * 与它出到第几版无关。
       */
      const target = await this.orders.resolveRenewTarget(
        from.planVersionId,
        input.planVersionId,
      );
      if (!target) {
        throw new ConflictException("套餐版本不存在，请重新选择");
      }
      if (input.intent === "upgrade") {
        if (!LIVE.has(from.status)) {
          throw new ConflictException("原订阅不在服务中，请重新订阅");
        }
        if (target.samePlan) {
          throw new ConflictException(
            "已是该套餐，延长周期请使用续订（换档才是升级）",
          );
        }
        /*
         * **方向判定**（owner 2026-09-24：「降档完全不允许」）。
         *
         * 在此之前 upgrade 只判两件事：原订阅在用、目标套餐不同。**从不比较档位高低**，
         * 而客户端算 intent 的那一行是「在用且选了别的档 → upgrade」，同样不看方向。
         * 两处都不判，后果在生产上实撞（ORD-202609-63E0E32517）：一张 0 元 Free 单被当作
         * 升级，就地把付费 Starter 订阅改写成 Free、周期重置为下单日起算，`cashDue=0`
         * 即时结清，全程零报错。档位并存守卫（assertTierAvailable）也救不了——它只长在
         * `intent=new` 分支上，这条路根本走不到它。
         *
         * 判据是 shared 的 `TIERS` 序（低 → 高）。那个序早就在仓里，**直到这里才第一次
         * 有消费方**。
         *
         * **比不出高低就拒**：任一侧的 tier 为空或不在值域内（历史脏值、缺 primary 组件）
         * 都当拒绝。放行等于没有这道判定，而它管的是钱。两种情形给不同语义码，前端据此
         * 决定是「退回选择页让你重新挑」还是「这个套餐配置有问题」。
         */
        if (tierRank(target.fromTier) < 0 || tierRank(target.toTier) < 0) {
          throw new ConflictException({
            code: "TIER_NOT_COMPARABLE",
            message:
              "无法判断档位高低（套餐未登记档位），请联系我们处理后再变更",
          });
        }
        if (!isTierUpgrade(target.fromTier, target.toTier)) {
          throw new ConflictException({
            code: "NOT_AN_UPGRADE",
            message:
              `不支持降档：当前 ${target.fromTier}，所选 ${target.toTier}。` +
              `请重新选择更高的档位；如需降档，请让当前订阅到期后再改选。`,
          });
        }
      } else {
        if (!RENEWABLE.has(from.status)) {
          throw new ConflictException("原订阅已终止，请重新订阅");
        }
        if (!target.samePlan) {
          throw new ConflictException("续订须与当前套餐相同，换档请使用升级");
        }
        /* 退役 = 服务到本周期为止，不再续（owner 裁定）。阶梯里本就没有退役套餐，
           这里是服务端那一道——判据不能只长在客户端。 */
        if (target.toPlanStatus !== "active") {
          throw new ConflictException({
            code: "PLAN_RETIRED",
            message: `套餐 ${target.toPlanCode} 已下架，到期后需改选其他档`,
          });
        }
        if (!target.toIsCurrent) {
          throw new ConflictException("请选择该套餐当前在售的版本");
        }
        /*
         * 跨版本续订要客户**确认过差异**才放行（owner 2026-09-22：客户需要知情权与
         * 决策权，尤其价格增减、配额增加）。
         *
         * 确认钉住他看到的那个来源版本：期间若又发布了新版，`from` 已经变了，旧确认
         * 自然失效，必须重新看一遍。
         *
         * 这一条同时是**自动续订的护栏**：将来的自动续订作业送不出这个确认，于是
         * 天然跨不了版本——fail closed，而不是靠注释提醒后人。
         * （现状：auto_renew 只是个开关，`next_renewal_at` 全仓无写入方、无作业。）
         */
        if (
          from.planVersionId !== input.planVersionId &&
          input.acceptVersionChangeFrom !== from.planVersionId
        ) {
          throw new ConflictException({
            code: "VERSION_CHANGE_NOT_ACKNOWLEDGED",
            message: "该套餐已有新版本，请先确认新旧差异再续订",
          });
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

    if ("done" in settled && settled.done) {
      /* 只有「已申报、等人工核对」这一档发通知(owner 2026-09-09:「付费…都有操作」)。
         另外两档不发:already_settled 是重复提交(什么也没发生),而 activated /
         activating 那条路继续往下走,由 fulfill 发 order.fulfilled——
         在这里再发一条等于同一件事说两遍。

         发在事务**之后**:事务里发,回滚了消息还留着。 */
      if (settled.done.outcome === "declared") {
        const cashDue = settled.done.cashDue;
        await this.emit(`payment_declared ${input.orderId}`, async () => {
          const order = await this.orders.getById(input.orderId);
          if (!order) return null;
          const display = await this.orders.getPlanDisplay(order.planVersionId);
          return {
            tenantId: order.tenantId,
            templateCode: "order.payment_declared",
            reference: { type: "order", id: order.id },
            params: {
              orderNo: order.orderNo,
              productName: display.productName,
              planName: display.planName,
              amount: formatNotifyMoney(cashDue, order.currency),
            },
            recipients: customerRecipients(
              order.createdByType,
              order.createdById,
            ),
            link: `/subscribe/pay/${order.id}`,
          };
        });
      }
      return settled.done;
    }

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
      await this.applyOrderAutoRenew(from, order, actor);
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
        /* 续订 = 重新签一次，签的是现在在售的那一版（owner 2026-09-22）。不重钉的话
           「小改开新版本」永远触达不到存量客户——那正是 owner 最初想改已发布套餐的
           原因。跨版本那一步已在下单时要过客户确认。 */
        ...(order.planVersionId !== from.planVersionId
          ? { toPlanVersionId: order.planVersionId }
          : {}),
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
      await this.applyOrderAutoRenew(from, order, actor);
      subscription = await this.subscriptions.getSubscription(from.id);
    } else {
      mode = "new";
      const now = new Date();
      const endAt = addCycle(now, order.cycleUnit, order.cycleCount);
      const price = Number(order.payableAmount);
      // 幂等（2026-09-07 事故）：建订阅、回写条款、翻订单是三个独立事务，中间断掉
      // 就会留下一条已生效、但没有订单认领的订阅。此时**必须认领它**而不是再建一条：
      // 再建一定撞 uidx_subscriptions_live_per_product（一个 workspace × product 至多
      // 一条在用订阅），于是第一次尝试的副作用把后续所有重试——包括 reconcile 兜底和
      // 运营台「重试开通」——永久挡死。判据只认「没有订单认领」的行，不碰客户已有的
      // 正常订阅：那属于「买了已经拥有的产品」，是另一回事，下面单独报错。
      const orphan = await this.subscriptions.findUnclaimedLiveForProduct(
        order.workspaceId,
        order.planVersionId,
      );
      if (orphan) {
        this.logger.warn(
          `fulfill ${order.orderNo}: adopting subscription ${orphan.id} left behind by an interrupted attempt`,
        );
        subscription = orphan;
      } else {
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
          // owner 2026-09-03：自动续费默认关，客户在订单确认页显式开启——按订单值写。
          autoRenew: order.autoRenew,
          payAmount: price,
          currency: order.currency,
          createdBy: order.createdById ?? actor.actorId ?? order.tenantId,
          status: "active",
          subscriptionKind: price > 0 ? "paid" : "free",
          activationMethod: "offline_purchase",
          createdByType: order.createdByType,
        });
      }
      await this.orders.applySubscriptionTerms(subscription.id, {
        mode: "new",
        cycleUnit: order.cycleUnit,
        cycleCount: order.cycleCount,
        payAmount: order.payableAmount,
        orderId: order.id,
      });
    }

    // 翻订单是 CAS（where status = 'paid'）：0 行不是异常，但**也不是成功**。此前返回值
    // 被丢掉，订单没翻也照走通知、照返回「已履约」——调用方拿不到任何信号（2026-09-07
    // 事故的放大器之一）。并发履约先翻了是良性的，所以复读一次再判，只对真没翻的报错。
    const flipped = await this.orders.markFulfilled(order.id, subscription.id, {
      ...actor,
      remark: actor.remark ?? `${mode} → subscription ${subscription.id}`,
    });
    const fresh = await this.getOrder(order.id);
    if (!flipped && fresh.status !== "fulfilled") {
      throw new ConflictException(
        `订单 ${order.orderNo} 履约未落地：订阅 ${subscription.id} 已生效，但订单仍停在 ${fresh.status}`,
      );
    }
    const fulfilledSub = subscription;
    await this.emit(`fulfill ${order.orderNo}`, async () => {
      const display = await this.orders.getPlanDisplay(order.planVersionId);
      return {
        tenantId: order.tenantId,
        templateCode:
          mode === "renew" ? "subscription.renewed" : "order.fulfilled",
        reference: { type: "order", id: order.id },
        params: {
          productName: display.productName,
          planName: display.planName,
          orderNo: order.orderNo,
          endAt: formatNotifyDate(fulfilledSub.endAt),
          amount: formatNotifyMoney(order.payableAmount, order.currency),
        },
        recipients: customerRecipients(order.createdByType, order.createdById),
        link: `/subscribe/pay/${order.id}`,
      };
    });
    return { order: fresh, subscription };
  }

  /**
   * 续费 / 升级履约时把订单上的自动续费选择写回订阅（owner 2026-09-03：默认关、客户显式开启；
   * 确认页预填当前值，所以多数情况相等——不相等才写，并留 auto_renew_on/off 历史）。
   */
  private async applyOrderAutoRenew(
    from: SubscriptionRecord,
    order: OrderRecord,
    actor: OrderActor,
  ): Promise<void> {
    if (from.autoRenew === order.autoRenew) return;
    await this.subscriptions.setAutoRenew(from.id, order.autoRenew, {
      actorId: actor.actorId,
      actorType: actor.actorType,
      remark: `order ${order.orderNo}`,
    });
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
          // 系统续费单：正因为订阅开着自动续费才产生，履约后保持开。
          autoRenew: true,
        });
        created += 1;
        if (Number(c.price) > 0) {
          // 付费续费单：告诉客户去付（站内 + 邮件），逾期关闭、到期权益停止。
          await this.emit(`renewal_created ${order.orderNo}`, async () => {
            const display = await this.orders.getPlanDisplay(c.planVersionId);
            return {
              tenantId: c.tenantId,
              templateCode: "order.renewal_created",
              reference: { type: "order", id: order.id },
              params: {
                productName: display.productName,
                planName: display.planName,
                orderNo: order.orderNo,
                amount: formatNotifyMoney(order.payableAmount, order.currency),
                payBy: formatNotifyDate(
                  new Date(c.endAt.getTime() + options.graceDays * 86_400_000),
                ),
              },
              link: `/subscribe/pay/${order.id}`,
            };
          });
          continue;
        }

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

  /**
   * 退订之后的钱怎么办（owner 2026-09-25）。
   *
   * owner 的口径是「**站在客户视角，退订就是退款，毫无歧义**；差别在于能退 / 不能退
   * （过了限期）/ 无需退款（0 付费）」。在此之前这两件事互不相知：卡片上点「立即退订」
   * 只改订阅状态，订单不动、退款不提、消息不发——24 小时窗口就这么静静走完，而客户以为
   * 退订就等于退钱。
   *
   * 所以这个方法做两件事，**在同一处**：
   *   1. 够条件就**替客户发起退款**（不必他再去找入口——那正是窗口被走完的原因）；
   *   2. 无论结果如何都发一条消息，把「服务停了 + 钱怎么样了」一次说清。
   *
   * 当前策略：24 小时内全额退、超过不退（owner 2026-09-25 明确「当前简单模式」）。
   * 「24 小时内按配额消耗折算」是后续的事——那时改的是 `getRefundEligibility` 与金额，
   * 这里的三条分支与消息不用动。
   *
   * **放在服务层而不是某个 BFF**：退订有两条路（console 客户自助、admin 运营代操作），
   * 判定只长在一条上就等于给另一条留门。两处都调这一个方法。
   *
   * **永不抛**：退订本身已经成功提交了，钱与消息是它的后续。这里抛出去会让一次成功的
   * 退订在界面上看起来失败，而客户会再点一次。失败只记日志。
   */
  async settleAfterCancel(input: {
    subscriptionId: string;
    tenantId: string;
    actorUserId: string;
    clientIp?: string | null;
  }): Promise<{
    outcome: "refunded" | "no_charge" | "no_refund" | "no_order";
  }> {
    try {
      const orderId = await this.orders.findCurrentOrderIdForSubscription(
        input.subscriptionId,
      );
      /* 没有订单的订阅是正常的（历史数据 / 运营手工建）——不发消息，因为没有钱可说。 */
      if (!orderId) return { outcome: "no_order" };

      const order = await this.getOrder(orderId);
      const [eligibility, display] = await Promise.all([
        this.getRefundEligibility(orderId),
        /* 产品名 / 套餐名在这里自己取，不让两个 BFF 各传一份——那样两处迟早不一致，
           而消息标题上「哪个产品被退订了」是客户唯一能据以核对的东西。 */
        this.orders.getPlanDisplay(order.planVersionId),
      ]);

      const notify = (
        templateCode: CustomerNotifyInput["templateCode"],
        amount: string,
      ) =>
        this.emit(
          `subscription_cancelled ${input.subscriptionId}`,
          async () => ({
            tenantId: input.tenantId,
            templateCode,
            /* 去重键用订阅 id：同一条订阅只该为这件事发一次，重复退订不该刷屏。 */
            reference: {
              type: "subscription" as const,
              id: input.subscriptionId,
            },
            params: {
              productName: display.productName,
              planName: display.planName,
              orderNo: order.orderNo,
              amount: formatNotifyMoney(amount, order.currency),
            },
            recipients: [input.actorUserId],
            link: `/subscribe/pay/${order.id}`,
          }),
        );

      if (eligibility.eligible) {
        await this.requestRefund(orderId, {
          reason: "客户退订，24 小时内全额退款",
          userId: input.actorUserId,
          clientIp: input.clientIp ?? null,
        });
        await notify("subscription.cancelled_refunded", eligibility.amount);
        return { outcome: "refunded" };
      }

      /* 实付 0 与「过了窗口」对客户是两件事，必须分开说：前者本来就没付钱，
         后者是付了钱但不退。混成一条会让 0 元用户以为自己损失了什么。 */
      if (eligibility.reasons.includes("zero_amount")) {
        await notify("subscription.cancelled_no_charge", order.payableAmount);
        return { outcome: "no_charge" };
      }

      await notify("subscription.cancelled_no_refund", order.payableAmount);
      return { outcome: "no_refund" };
    } catch (err) {
      this.logger.error(
        `settleAfterCancel failed (subscription=${input.subscriptionId}): ${String(err)} — ` +
          `退订本身已生效，钱与消息需人工跟进`,
      );
      return { outcome: "no_order" };
    }
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
    const created = await this.orders.createRefundRequest({
      order,
      invoiceId: basis.invoiceId,
      payRecordId: basis.payRecordId,
      reason: input.reason,
      userId: input.userId,
      clientIp: input.clientIp ?? null,
    });
    await this.emit(`refund_requested ${created.refundNo}`, async () =>
      this.refundNotice("refund.requested", created, order, "requested", {
        recipients: [input.userId],
      }),
    );
    return created;
  }

  /**
   * 退款四阶段通知的共同形状：引用 = 退款单 × 阶段（去重键），金额 = 退款额，
   * 收件人缺省 = 租户 owner + 订单下单人。
   */
  private refundNotice(
    templateCode: CustomerNotifyInput["templateCode"],
    refund: Pick<RefundRecordView, "id" | "amount" | "currency">,
    order: OrderRecord,
    stage: string,
    extra: {
      params?: Record<string, string | number>;
      recipients?: string[];
    } = {},
  ): CustomerNotifyInput {
    return {
      tenantId: order.tenantId,
      templateCode,
      reference: { type: "refund", id: `${refund.id}:${stage}` },
      params: {
        orderNo: order.orderNo,
        amount: formatNotifyMoney(refund.amount, refund.currency),
        ...(extra.params ?? {}),
      },
      recipients:
        extra.recipients ??
        customerRecipients(order.createdByType, order.createdById),
      link: `/subscribe/pay/${order.id}`,
    };
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
    const audited = await this.orders.auditRefund({ refund, order, ...input });
    await this.emit(`refund_${input.decision} ${refund.refundNo}`, async () =>
      this.refundNotice(
        input.decision === "approved" ? "refund.approved" : "refund.rejected",
        refund,
        order,
        input.decision,
        { params: { reason: input.remark } },
      ),
    );
    return audited;
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
    await this.emit(`refund_completed ${refund.refundNo}`, async () =>
      this.refundNotice("refund.completed", refund, order, "completed"),
    );
    return done;
  }

  async listRefunds(status?: "pending" | "approved" | "rejected") {
    return this.orders.listRefunds(status);
  }

  /**
   * 取消 / 逾期关闭。两态**同一条路**,只是 kind 不同,所以通知也在这一处发。
   *
   * owner 2026-09-09:「订单取消…都有操作」——此前这两条终态一句话都不发,
   * 客户只能自己去订单页发现它没了。
   *
   * 通知在业务写**之后**:cancelOrder 抛异常就不该发「已取消」。
   */
  async cancel(
    orderId: string,
    actor: OrderActor,
    kind: "cancelled" | "expired" = "cancelled",
  ): Promise<OrderRecord> {
    const cancelled = await this.orders.cancelOrder(orderId, actor, kind);
    await this.emit(`${kind} ${cancelled.orderNo}`, async () => {
      const display = await this.orders.getPlanDisplay(cancelled.planVersionId);
      return {
        tenantId: cancelled.tenantId,
        templateCode: kind === "expired" ? "order.expired" : "order.cancelled",
        reference: { type: "order", id: cancelled.id },
        params: {
          orderNo: cancelled.orderNo,
          productName: display.productName,
          planName: display.planName,
        },
        recipients: customerRecipients(
          cancelled.createdByType,
          cancelled.createdById,
        ),
        link: "/subscription",
      };
    });
    return cancelled;
  }

  /**
   * 申报被驳回的通知（2026-09-25）。
   *
   * 驳回本身在 admin-bff 的那条裸 SQL 事务里（券释放 + 计价回滚 + TTL 重锚要在同一个事务
   * 里，搬不动），这里只补「告诉客户」那一半：此前唯一的出口是付款页顶部的横幅，客户不
   * 回那一页就永远不知道要重新申报，而倒计时已经重新开始走了。
   *
   * 事务提交后调用；发不出去只记日志，不回滚人家的事务（emit 本身不抛）。
   */
  async notifyPaymentRejected(orderId: string, reason: string): Promise<void> {
    await this.emit(`payment_rejected ${orderId}`, async () => {
      const order = await this.orders.getById(orderId);
      if (!order) return null;
      const display = await this.orders.getPlanDisplay(order.planVersionId);
      return {
        tenantId: order.tenantId,
        templateCode: "order.payment_rejected",
        reference: { type: "order", id: order.id },
        params: {
          orderNo: order.orderNo,
          productName: display.productName,
          planName: display.planName,
          reason,
        },
        recipients: customerRecipients(order.createdByType, order.createdById),
        link: `/subscribe/pay/${order.id}`,
      };
    });
  }

  async restore(orderId: string, actor: OrderActor): Promise<OrderRecord> {
    const restored = await this.orders.restoreOrder(orderId, actor);
    // 运营把已取消 / 已超时关闭的单救回来——客户那边不知道这张单又能付了，倒计时也重新
    // 开始走。此前这一步一句话都不发（cancel 那一侧一直有通知，恢复这一侧没有）。
    await this.emit(`restored ${restored.orderNo}`, async () => {
      const display = await this.orders.getPlanDisplay(restored.planVersionId);
      return {
        tenantId: restored.tenantId,
        templateCode: "order.restored",
        reference: { type: "order", id: restored.id },
        params: {
          orderNo: restored.orderNo,
          productName: display.productName,
          planName: display.planName,
          amount: formatNotifyMoney(restored.payableAmount, restored.currency),
        },
        recipients: customerRecipients(
          restored.createdByType,
          restored.createdById,
        ),
        link: `/subscribe/pay/${restored.id}`,
      };
    });
    return restored;
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
        // 放弃状态是**持续**的：这条分支每 tick 都会走到，所以每 tick 都报一次，
        // 由告警侧的 4h 静默窗口收敛。不只在「刚放弃」那一刻报——进程重启会清空
        // reconcileFailures，那个瞬间没人接得住（#231 的病根就是「只报一次、漏看就没了」）。
        await this.reportGaveUp(id, failures);
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
        this.reconcileLastError.delete(id);
      } catch (err) {
        this.reconcileFailures.set(id, failures + 1);
        this.reconcileLastError.set(id, String(err));
        this.logger.error(
          `reconcile: order ${id} failed (${failures + 1}/${OrderService.RECONCILE_FAILURE_LIMIT}) — ${String(err)}`,
        );
        // 撞到上限的这一次就报，别等下一个 tick——单据已经彻底不动了。
        if (failures + 1 >= OrderService.RECONCILE_FAILURE_LIMIT) {
          await this.reportGaveUp(id, failures + 1);
        }
      }
    }
    return healed;
  }

  /**
   * 自愈放弃 → 报运营（#231）。best-effort：告警本身失败只记日志，
   * 绝不能让它把 reconcile 这一轮打断——后面还有别的单等着自愈。
   */
  private async reportGaveUp(orderId: string, attempts: number): Promise<void> {
    if (!this.opsAlerter) return;
    try {
      const order = await this.getOrder(orderId);
      await this.opsAlerter.orderSelfHealGaveUp({
        orderId,
        orderNo: order.orderNo,
        attempts,
        lastError: this.reconcileLastError.get(orderId) ?? null,
      });
    } catch (err) {
      this.logger.warn(
        `reconcile: order ${orderId} 放弃告警发送失败 — ${String(err)}`,
      );
    }
  }
}
