import { randomUUID } from "node:crypto";
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { ProvisioningService } from "@vxture/service-provisioning";
import {
  PromotionService,
  computeSettlement,
  centsToYuan,
  yuanToCents,
  type DiscountEffect,
  type ReservedVoucher,
} from "@vxture/service-promotion";
import { PgSubscriptionRepository } from "../repository/pg-subscription.repository";
import type {
  SubscriptionRecord,
  SubscriptionHistoryRecord,
  ListSubscriptionsParams,
  ListSubscriptionsResult,
  CreateSubscriptionInput,
  UpdateSubscriptionInput,
  CreateOfflineOrderInput,
  OfflineOrderRecord,
  DeclarePaymentInput,
  DeclarePaymentResult,
} from "../types/subscription.types";

/** Machine-readable order intent stored in invoices.operate_remark (320). */
const parseOrderIntent = (
  remark: string | null,
): { intent: "new" | "renew" | "upgrade"; upgradeOf: string | null } => {
  try {
    const parsed = JSON.parse(remark ?? "{}") as {
      intent?: string;
      upgrade_of?: string;
    };
    if (
      parsed.intent === "new" ||
      parsed.intent === "renew" ||
      parsed.intent === "upgrade"
    ) {
      return { intent: parsed.intent, upgradeOf: parsed.upgrade_of ?? null };
    }
  } catch {
    /* fall through — degrade to 'new' (mirrors admin stage-2 behavior) */
  }
  return { intent: "new", upgradeOf: null };
};

/**
 * Statuses that count as "the workspace holds this product" (ADR-11 §11.3/§11.4).
 * When the payment plane lands, "overdue" (dunning grace, entitlements RETAINED
 * — product_220 §3) must join this set AND every active/trialing live-coverage
 * predicate (C2 entitlement queries, quota-pool gates) in the same change.
 */
const ACTIVATED = new Set(["active", "trialing"]);
/** Terminal statuses that trigger the per-component deprovision check. */
const DEACTIVATED = new Set(["cancelled", "expired"]);

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  // Explicit tokens: bff bundles (esbuild) emit no decorator metadata, so an
  // implicit constructor type silently injects undefined (repo-wide pattern).
  // Reconcile-pass failure ledger (product_321 §4.3): per-order consecutive
  // failure count; at the threshold the job stops auto-retrying and the order
  // surfaces to operators ("自愈失败"). In-memory is deliberate — the job runs
  // in one platform-api instance and a restart re-arming retries is desired.
  private readonly reconcileFailures = new Map<string, number>();
  private static readonly RECONCILE_FAILURE_LIMIT = 3;

  constructor(
    @Inject(PgSubscriptionRepository)
    private readonly repo: PgSubscriptionRepository,
    @Inject(ProvisioningService)
    private readonly provisioning: ProvisioningService,
    @Inject(PromotionService)
    private readonly promotion: PromotionService,
  ) {}

  async listSubscriptions(
    params: ListSubscriptionsParams,
  ): Promise<ListSubscriptionsResult> {
    return this.repo.listSubscriptions(params);
  }

  async getSubscription(id: string): Promise<SubscriptionRecord> {
    const record = await this.repo.getById(id);
    if (!record) throw new NotFoundException(`订阅 ${id} 不存在`);
    return record;
  }

  async getActiveSubscription(
    workspaceId: string,
  ): Promise<SubscriptionRecord | null> {
    return this.repo.getActiveByWorkspaceId(workspaceId);
  }

  async createSubscription(
    input: CreateSubscriptionInput,
  ): Promise<SubscriptionRecord> {
    // Multiple subscriptions per workspace are allowed (ADR-11 §8: a product can be
    // bundled + separately subscribed) — no single-active constraint. quota_pool
    // rows are materialized from the plan_version's components on create.
    await this.assertNoTierConflict(input.workspaceId, input.planVersionId);
    const record = await this.repo.create(input);
    if (ACTIVATED.has(record.status)) {
      await this.safeProvisioningHook("create", record.id, () =>
        this.fireProvisioned(record, record.planVersionId),
      );
    }
    await this.safeProvisioningHook("create:invalidate", record.id, () =>
      this.fireEntitlementInvalidate(record, [record.planVersionId]),
    );
    return record;
  }

  // ── offline order primitives (product_320 §2) ─────────────────────────────
  // A pending order is a suspended subscription row + an unpaid invoice —
  // see the repo methods' docs for the tx-level detail. These four methods
  // are the only entry points that should ever touch that pair.

  /**
   * Places a pending offline order. Skips the tier-conflict guard for
   * intent='upgrade' (a live different-tier subscription is the EXPECTED
   * precondition there — assertNoTierConflict would always reject it); 'new'
   * and 'renew' still check, so a duplicate-tier order can't be placed
   * alongside a live subscription (the caller should offer renew/upgrade
   * instead — product_320 §2 O4/O5).
   */
  async createOfflineOrder(
    input: CreateOfflineOrderInput,
  ): Promise<OfflineOrderRecord> {
    if (input.intent !== "upgrade") {
      await this.assertNoTierConflict(input.workspaceId, input.planVersionId);
    } else if (input.upgradeOfSubscriptionId) {
      // 同套餐"升级"在 applyUpgradeOrder 是幂等 no-op（关单但不改档、不延期），
      // 放行等于让客户为零变更付全款——下单前拒绝。
      const target = await this.getSubscription(input.upgradeOfSubscriptionId);
      if (target.planVersionId === input.planVersionId) {
        throw new ConflictException(
          "目标套餐与当前订阅相同，无需升级（延长周期请使用 renew）",
        );
      }
    }
    const order = await this.repo.createOfflineOrder(input);
    // suspended → never fires fireProvisioned; the invalidate fires
    // regardless of activation status, matching createSubscription's own
    // pattern (a pending order becomes the tenant's representative
    // subscription in C2/console reads, so its cache entry must bust too).
    await this.safeProvisioningHook(
      "create-order:invalidate",
      order.subscription.id,
      () =>
        this.fireEntitlementInvalidate(order.subscription, [
          order.subscription.planVersionId,
        ]),
    );
    return order;
  }

  /**
   * Confirm-time activation of a pending order (admin offline-payment-confirm,
   * product_320 §4.3). Re-checks the tier-conflict guard immediately before
   * the write — a live conflicting subscription could have appeared through
   * another channel between order placement and confirmation. Returns null
   * when the CAS in the repo loses (already activated) so admin-bff's
   * two-stage confirm can treat a re-drive as a safe no-op instead of erroring.
   */
  async activatePendingOrder(
    orderId: string,
    params: {
      operatorId: string | null;
      remark?: string;
      clientIp?: string;
      actorType?: "operator" | "customer" | "system";
    },
  ): Promise<SubscriptionRecord | null> {
    const before = await this.getSubscription(orderId);
    if (
      before.status !== "suspended" ||
      before.activationMethod !== "offline_purchase"
    ) {
      throw new ConflictException("订单不是待支付状态，无法激活");
    }
    await this.assertNoTierConflict(
      before.workspaceId,
      before.planVersionId,
      orderId,
    );
    const after = await this.repo.activateOrder(orderId, params);
    if (!after) return null;
    await this.applyTransitionHooks("activate-order", orderId, before, after);
    return after;
  }

  /**
   * Confirms an upgrade order: applies the target plan_version to the LIVE
   * subscription being upgraded (in-place, D12 stacking ruling) via the
   * existing upgradeSubscription() — full hook/conflict/pool-rematerialize
   * behavior reused — then closes the order row as a plain cancel (never
   * live, so fireStatusTransition's wasActive guard fires zero webhooks for
   * it). When the target subscription is no longer active (expired/cancelled
   * between order and confirm), falls back to activating the order as a
   * fresh subscription instead (product_320 §2 O4).
   */
  async applyUpgradeOrder(
    orderId: string,
    upgradeOfSubscriptionId: string,
    params: {
      operatorId: string | null;
      remark?: string;
      actorType?: "operator" | "customer" | "system";
    },
  ): Promise<SubscriptionRecord | null> {
    const order = await this.getSubscription(orderId);
    if (
      order.status !== "suspended" ||
      order.activationMethod !== "offline_purchase"
    ) {
      throw new ConflictException("订单不是待支付状态，无法激活");
    }
    const target = await this.getSubscription(upgradeOfSubscriptionId);
    // Idempotency guard (product_321 §4.3 upgrade arm): a re-drive after the
    // crash window "upgradeSubscription committed, order row not yet closed"
    // must NOT re-run the version switch — repo.update would re-materialize
    // the quota pools (wiping quota_used) and re-fire webhooks. Target already
    // on the order's version = the switch is done; only close the order row.
    if (
      target.status === "active" &&
      target.planVersionId === order.planVersionId
    ) {
      await this.updateSubscription(orderId, {
        status: "cancelled",
        operatorType: params.actorType ?? "operator",
        ...(params.operatorId ? { operatorId: params.operatorId } : {}),
        operatorRemark: `upgrade already applied to ${upgradeOfSubscriptionId} (re-drive close)`,
      });
      return target;
    }
    if (target.status === "active") {
      const upgraded = await this.upgradeSubscription(
        upgradeOfSubscriptionId,
        order.planVersionId,
        params.operatorId ?? undefined,
        params.remark,
      );
      await this.updateSubscription(orderId, {
        status: "cancelled",
        operatorType: params.actorType ?? "operator",
        ...(params.operatorId ? { operatorId: params.operatorId } : {}),
        operatorRemark: `upgrade applied to ${upgradeOfSubscriptionId}`,
      });
      return upgraded;
    }
    return this.activatePendingOrder(orderId, params);
  }

  /**
   * Cancels an unpaid pending order (customer self-service or admin void,
   * product_320 §2 O5). Deliberately does NOT call cancelSubscription() —
   * that method's fireDeprovisionIfUncovered runs unconditionally and would
   * misfire tenant.deprovisioned for a workspace that was never actually
   * provisioned. The order was never ACTIVATED, so only the (harmless, cheap)
   * C2 cache-bust fires.
   */
  async cancelPendingOrder(
    orderId: string,
    params: {
      actorType: "customer" | "operator" | "system";
      actorId: string | null;
      remark?: string;
      clientIp?: string;
      changeType?: "cancelled" | "order_expired";
    },
  ): Promise<SubscriptionRecord> {
    const before = await this.getSubscription(orderId);
    const after = await this.repo.cancelOfflineOrder(orderId, params);
    await this.safeProvisioningHook("cancel-order:invalidate", orderId, () =>
      this.fireEntitlementInvalidate(after, [before.planVersionId]),
    );
    return after;
  }

  /**
   * Restore a voided/expired pending offline order back to `suspended`
   * (admin-only undo of cancelPendingOrder). See repo.restoreOfflineOrder for
   * why this can never reach a once-activated, later-cancelled subscription.
   */
  async restoreOfflineOrder(
    orderId: string,
    params: {
      actorType: "operator" | "system";
      actorId: string | null;
      remark?: string;
      clientIp?: string;
    },
  ): Promise<SubscriptionRecord> {
    const before = await this.getSubscription(orderId);
    const after = await this.repo.restoreOfflineOrder(orderId, params);
    await this.safeProvisioningHook("restore-order:invalidate", orderId, () =>
      this.fireEntitlementInvalidate(after, [before.planVersionId]),
    );
    return after;
  }

  // ── payment declaration + jobs (product_321 P8/§4.3) ──────────────────────

  /**
   * Customer payment declaration (P8): one funds transaction under the order's
   * row lock — voucher reserve (discount then credit, §7), pricing write +
   * invoice recompute, then either a pending_verify cash leg (cashDue>0) or an
   * instant voucher settlement (cashDue=0). The cashDue=0 path triggers
   * stage-2 activation AFTER commit (admin-confirm-identical two-phase shape —
   * an in-tx activation would self-deadlock on the row lock); a hung stage 2
   * degrades to 'activating' and the reconcile pass finishes it.
   */
  async declarePayment(
    input: DeclarePaymentInput,
  ): Promise<DeclarePaymentResult> {
    const settled = await this.repo.withPendingOrderTx(
      input.orderId,
      async ({ client, order, invoice }) => {
        if (!invoice) throw new ConflictException("订单缺少账单，无法申报");

        // Hang-window re-submit (§7 rule 2): invoice already cleared → report
        // the current state instead of double-settling.
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
          order.status !== "suspended" ||
          order.activationMethod !== "offline_purchase" ||
          !["unpaid", "partial"].includes(invoice.billStatus)
        ) {
          throw new ConflictException("订单不是待付款状态，无法申报付款");
        }

        // Idempotent re-submit: one in-flight declared leg per order.
        const existingLeg = await this.repo.findPendingVerifyLegTx(
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

        // Defensive pricing reset (P8 precondition) — a residual discount row
        // means an earlier release missed the pricing rollback; self-heal.
        const cleaned = await this.repo.softDeleteDiscountItemsTx(
          client,
          invoice.id,
        );
        if (cleaned > 0) {
          this.logger.warn(
            `declare ${input.orderId}: cleaned ${cleaned} residual discount row(s) before settling`,
          );
        }
        const base = await this.repo.recomputeInvoiceTx(client, invoice.id);

        // Reserve vouchers (discount before credit — §7 voucher order).
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

        // Pricing layer: discount negative row + invoice recompute (P7).
        if (discount && quote.discountOffCents > 0) {
          const itemId = await this.repo.insertDiscountItemTx(client, {
            invoiceId: invoice.id,
            tenantId: order.tenantId,
            workspaceId: order.workspaceId,
            subscriptionId: order.id,
            itemName: `折扣券抵扣 (${discount.voucherId})`,
            amountYuan: `-${centsToYuan(quote.discountOffCents)}`,
          });
          discountItemId = itemId;
          await this.repo.recomputeInvoiceTx(client, invoice.id);
        }

        // Everything admin confirm's stage 1 needs to finalize the vouchers
        // rides on the leg (P10): voucher ids, the discount item FK, reserve-
        // time effect snapshots and the declaring customer (redemption user).
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
          // Instant settle: finalize vouchers + clear the invoice; stage 2
          // runs after commit.
          const { voucherLegId } = await this.repo.settleInvoiceByVouchersTx(
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
          await this.repo.insertHistoryTx(client, {
            tenantId: order.tenantId,
            subscriptionId: order.id,
            changeType: "payment_declared",
            fromStatus: "suspended",
            toStatus: "suspended",
            actorType: "customer",
            actorId: input.userId,
            remark: JSON.stringify({ ...credential.settlement, instant: true }),
            clientIp: input.clientIp ?? null,
          });
          return {
            settle: { operateRemark: invoice.operateRemark },
          };
        }

        // Declared path: pending_verify cash leg with the credential (P10).
        const paymentId = await this.repo.insertCashLegTx(client, {
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
        await this.repo.insertHistoryTx(client, {
          tenantId: order.tenantId,
          subscriptionId: order.id,
          changeType: "payment_declared",
          fromStatus: "suspended",
          toStatus: "suspended",
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

    // cashDue=0: funds committed — run stage 2 as its own transaction (P8).
    const { intent, upgradeOf } = parseOrderIntent(
      "settle" in settled ? (settled.settle?.operateRemark ?? null) : null,
    );
    try {
      const activated =
        intent === "upgrade" && upgradeOf
          ? await this.applyUpgradeOrder(input.orderId, upgradeOf, {
              operatorId: input.userId,
              remark: "instant voucher settlement (declare)",
              actorType: "customer",
            })
          : await this.activatePendingOrder(input.orderId, {
              operatorId: input.userId,
              remark: "instant voucher settlement (declare)",
              actorType: "customer",
            });
      return {
        outcome: activated ? "activated" : "activating",
        cashDue: "0.00",
        paymentId: null,
      };
    } catch (err) {
      // Funds are safe (committed); the reconcile pass / admin re-drive will
      // finish activation. Surface the transitional state, not an error.
      this.logger.error(
        `declare ${input.orderId}: stage-2 activation failed after settle — reconcile will retry: ${String(err)}`,
      );
      return { outcome: "activating", cashDue: "0.00", paymentId: null };
    }
  }

  /**
   * Timeout sweep (§4.3 duty 1): close pending orders past the TTL. The
   * repo predicate carries the full P4 guard (no declared leg, zero income);
   * per-order failures log and continue — never kill the pass.
   *
   * TTL is per-order (subscriptions.payment_ttl_minutes, fixed at creation
   * by tenant type — P4 rev. 2026-08-20); the parameter is only the fallback
   * for legacy rows where the column is NULL.
   */
  async sweepExpiredPaymentOrders(
    fallbackTtlMinutes: number,
    limit = 100,
  ): Promise<number> {
    const ids = await this.repo.findExpiredPaymentOrderIds(
      fallbackTtlMinutes,
      limit,
    );
    let closed = 0;
    for (const id of ids) {
      try {
        await this.cancelPendingOrder(id, {
          actorType: "system",
          actorId: null,
          changeType: "order_expired",
          remark: "payment window elapsed (P4 TTL)",
        });
        closed += 1;
      } catch (err) {
        this.logger.error(
          `payment expiry sweep: order ${id} failed to close — ${String(err)}`,
        );
      }
    }
    return closed;
  }

  /**
   * Hung-order reconcile (§4.3 duty 2, P8 self-heal): finish stage 2 for
   * invoice-cleared orders whose activation never landed. Per-order
   * consecutive-failure ledger stops auto-retry at the limit (operator takes
   * over); a success clears the ledger entry.
   */
  async reconcileHungPaidOrders(
    minAgeMinutes = 2,
    limit = 20,
  ): Promise<number> {
    const candidates = await this.repo.findHungPaidOrders(minAgeMinutes, limit);
    let healed = 0;
    for (const { id, operateRemark } of candidates) {
      const failures = this.reconcileFailures.get(id) ?? 0;
      if (failures >= SubscriptionService.RECONCILE_FAILURE_LIMIT) {
        this.logger.warn(
          `reconcile: order ${id} exceeded ${failures} failures — auto-retry stopped, operator action required`,
        );
        continue;
      }
      try {
        const { intent, upgradeOf } = parseOrderIntent(operateRemark);
        const result =
          intent === "upgrade" && upgradeOf
            ? await this.applyUpgradeOrder(id, upgradeOf, {
                operatorId: null,
                remark: "hung paid order self-heal",
                actorType: "system",
              })
            : await this.activatePendingOrder(id, {
                operatorId: null,
                remark: "hung paid order self-heal",
                actorType: "system",
              });
        if (result) healed += 1;
        this.reconcileFailures.delete(id);
      } catch (err) {
        this.reconcileFailures.set(id, failures + 1);
        this.logger.error(
          `reconcile: order ${id} failed (${failures + 1}/${SubscriptionService.RECONCILE_FAILURE_LIMIT}) — ${String(err)}`,
        );
      }
    }
    return healed;
  }

  async cancelSubscription(
    id: string,
    operatorId?: string,
    remark?: string,
    /** 发起方(缺省 operator,保持既有调用不变);customer = 租户自助退订。 */
    actorType: "operator" | "customer" | "system" = "operator",
  ): Promise<SubscriptionRecord> {
    const subscription = await this.getSubscription(id);
    if (subscription.status === "cancelled")
      throw new ConflictException("订阅已取消");
    if (subscription.status === "expired")
      throw new ConflictException("订阅已过期");

    const result = await this.repo.update(id, subscription, {
      status: "cancelled",
      endAt: new Date(),
      // 取消同时关自动续费(对齐 admin 侧 SQL 的既有行为;此前 service 路径
      // 漏掉这一步,取消件仍挂 auto_renew=true 的矛盾态)。
      autoRenew: false,
      operatorType: actorType,
      ...(operatorId !== undefined
        ? { operatorId, updatedBy: operatorId }
        : {}),
      ...(remark !== undefined ? { operatorRemark: remark } : {}),
    });
    await this.safeProvisioningHook("cancel", id, () =>
      this.fireDeprovisionIfUncovered(result!, subscription.planVersionId),
    );
    await this.safeProvisioningHook("cancel:invalidate", id, () =>
      this.fireEntitlementInvalidate(result!, [subscription.planVersionId]),
    );
    return result!;
  }

  /**
   * 到期不续 / 恢复续费(owner 2026-08-21 P0:订阅自助收尾)。
   * 「到期不续」没有独立列——契约口径即 active ∧ 有界 ∧ auto_renew=false
   * (product_220 §3 cancel_at_period_end 的派生定义),本方法只翻 auto_renew。
   * 挡两类非法态:trial 禁开续费(DDL chk_subscriptions_trial_no_renew),
   * 终态订阅(cancelled/expired)不接受翻转。
   */
  async setAutoRenew(
    id: string,
    enabled: boolean,
    params: {
      actorId: string | null;
      actorType?: "operator" | "customer" | "system";
      remark?: string;
    },
  ): Promise<SubscriptionRecord> {
    const subscription = await this.getSubscription(id);
    if (
      subscription.status === "cancelled" ||
      subscription.status === "expired"
    ) {
      throw new ConflictException("订阅已终止,无法变更续费设置");
    }
    if (enabled && subscription.subscriptionKind === "trial") {
      throw new ConflictException("试用订阅不支持自动续费");
    }
    if (subscription.autoRenew === enabled) return subscription;

    const result = await this.repo.update(id, subscription, {
      autoRenew: enabled,
      operatorType: params.actorType ?? "customer",
      ...(params.actorId !== null
        ? { operatorId: params.actorId, updatedBy: params.actorId }
        : {}),
      operatorRemark:
        params.remark ??
        (enabled
          ? "customer resumed auto-renew"
          : "customer opted out of renewal"),
    });
    // 纯路由/续费策略变化,不触发 deprovision;C2 信封的 cancel_at_period_end
    // 派生字段随之翻转,失效一次缓存让产品侧尽快看到。
    await this.safeProvisioningHook("auto-renew:invalidate", id, () =>
      this.fireEntitlementInvalidate(result!, [subscription.planVersionId]),
    );
    return result!;
  }

  async upgradeSubscription(
    id: string,
    newPlanVersionId: string,
    operatorId?: string,
    remark?: string,
  ): Promise<SubscriptionRecord> {
    const subscription = await this.getSubscription(id);
    if (subscription.status !== "active")
      throw new ConflictException("只有活跃订阅可以升级");
    await this.assertNoTierConflict(
      subscription.workspaceId,
      newPlanVersionId,
      id,
    );

    const result = await this.repo.update(id, subscription, {
      toPlanVersionId: newPlanVersionId,
      operatorType: "operator",
      ...(operatorId !== undefined
        ? { operatorId, updatedBy: operatorId }
        : {}),
      ...(remark !== undefined ? { operatorRemark: remark } : {}),
    });
    await this.safeProvisioningHook("upgrade", id, () =>
      this.fireVersionChange(result!, subscription.planVersionId),
    );
    await this.safeProvisioningHook("upgrade:invalidate", id, () =>
      this.fireEntitlementInvalidate(result!, [
        subscription.planVersionId,
        result!.planVersionId,
      ]),
    );
    return result!;
  }

  async updateSubscription(
    id: string,
    input: UpdateSubscriptionInput,
  ): Promise<SubscriptionRecord> {
    const subscription = await this.getSubscription(id);
    // Stacking guardrail on every write that creates/expands live coverage:
    // a plan change, or a revival transition into a live status (resume /
    // admin renew) — both can otherwise smuggle a second tier in.
    const targetVersion = input.toPlanVersionId ?? subscription.planVersionId;
    const becomesLive =
      input.status !== undefined &&
      ACTIVATED.has(input.status) &&
      !ACTIVATED.has(subscription.status);
    if (input.toPlanVersionId !== undefined || becomesLive) {
      await this.assertNoTierConflict(
        subscription.workspaceId,
        targetVersion,
        id,
      );
    }
    const result = await this.repo.update(id, subscription, input);
    if (!result) throw new NotFoundException(`订阅 ${id} 不存在`);
    await this.applyTransitionHooks("update", id, subscription, result);
    return result;
  }

  /**
   * Shared write-completion tail for updateSubscription() and
   * sweepLapsedTrials() (post-review dedup, 2026-07-12 — the two used to
   * hand-copy this sequence): fire the status-transition hook, then — only
   * when status or plan_version actually changed — the entitlement-
   * invalidate hook. `hookPrefix` becomes each safeProvisioningHook op
   * label ("update"/"update:invalidate" vs "sweep:<id>"/"sweep:<id>:invalidate"),
   * unchanged from each caller's prior inline behavior.
   */
  private async applyTransitionHooks(
    hookPrefix: string,
    id: string,
    before: SubscriptionRecord,
    result: SubscriptionRecord,
  ): Promise<void> {
    await this.safeProvisioningHook(hookPrefix, id, () =>
      this.fireStatusTransition(before, result),
    );
    if (
      before.status !== result.status ||
      before.planVersionId !== result.planVersionId
    ) {
      await this.safeProvisioningHook(`${hookPrefix}:invalidate`, id, () =>
        this.fireEntitlementInvalidate(result, [
          before.planVersionId,
          result.planVersionId,
        ]),
      );
    }
  }

  /**
   * Trial-expiry sweep (product_310 D10): transition lapsed never-paid trials
   * trialing → expired through the same write-completion tail as
   * updateSubscription() (applyTransitionHooks), so the existing status-
   * transition wiring fires for free (deprovision-if-uncovered + the
   * subscription_changed C2 invalidate). DB keeps the truthful 'expired'
   * (value domain has no 'none'); "trial leaves as null" is a C2
   * representative-selection rule on the read side (product_220 §3).
   *
   * Doesn't call updateSubscription() directly because that method throws
   * NotFoundException on ANY 0-row repo.update() result, conflating "row
   * truly gone" with "the CAS guard below lost a race" — the sweep wants
   * the latter to be a silent, expected skip (debug log), not an error.
   *
   * expectedStatus: "trialing" makes the write a compare-and-set: a
   * concurrent admin action (renew/resume, FOR UPDATE-locked) between this
   * pass's read and write loses the race harmlessly — repo.update no-ops
   * (0 rows) instead of clobbering the just-activated row back to expired.
   * Two truly concurrent sweep instances are safe by the same guard:
   * whichever commits first wins, the other no-ops.
   */
  async sweepLapsedTrials(limit = 100): Promise<number> {
    const ids = await this.repo.findLapsedTrialIds(limit);
    let transitioned = 0;
    for (const id of ids) {
      try {
        const before = await this.getSubscription(id);
        const result = await this.repo.update(id, before, {
          status: "expired",
          operatorType: "system",
          operatorRemark: "trial ended without conversion (expiry sweep)",
          expectedStatus: "trialing",
        });
        if (!result) {
          this.logger.debug(
            `trial expiry sweep: subscription ${id} no longer trialing, skipped (lost race)`,
          );
          continue;
        }
        await this.applyTransitionHooks(`sweep:${id}`, id, before, result);
        transitioned += 1;
      } catch (err) {
        this.logger.error(
          `trial expiry sweep: subscription ${id} failed to transition — ${String(err)}`,
        );
      }
    }
    return transitioned;
  }

  /**
   * WS base storage pool ensure (owner 2026-08-20, usage-quota line): create
   * the `ws_base` storage.bytes pool for every live workspace that has none,
   * and reconcile active base pools to the configured platform default. Thin
   * passthrough — the idempotent SQL (and its retire-sticks semantics) lives
   * in the repository; the platform-api sweep job is the driver.
   */
  async ensureWorkspaceStorageBasePools(
    baseBytes: string,
  ): Promise<{ created: number; reconciled: number }> {
    return this.repo.ensureWorkspaceStorageBasePools(baseBytes);
  }

  async getHistory(id: string): Promise<SubscriptionHistoryRecord[]> {
    await this.getSubscription(id);
    return this.repo.getHistory(id);
  }

  // ── provisioning wire (product_310 P2.3b) ──────────────────────────────────
  // The subscription lifecycle is the enqueue caller (engine contract). Events
  // fan out per plan_component product; deprovisioning is per-component fallout
  // (§11.4): only when no other active/trialing subscription still covers the
  // product. Hooks are best-effort: the subscription write is already committed,
  // so an enqueue failure logs loudly (manual replay) instead of failing the
  // request — retrying the request would duplicate the subscription itself.

  /**
   * D12 stacking invariant (arda reply-07 §3, owner ruling 2026-07-14): one
   * product never holds several live subscriptions at DIFFERENT tiers — an
   * upgrade modifies the original row; stacking is operator misconfiguration.
   * `tier` stays a merge-side axis exactly BECAUSE this invariant makes the
   * merge degenerate (at most one distinct tier per product). Same-tier
   * concurrency and bundled+standalone coexistence stay legal (ADR-11 §8).
   */
  private async assertNoTierConflict(
    workspaceId: string,
    planVersionId: string,
    excludeSubscriptionId?: string,
  ): Promise<void> {
    const conflicts = await this.repo.findTierConflicts(
      workspaceId,
      planVersionId,
      excludeSubscriptionId,
    );
    if (conflicts.length > 0) {
      const detail = conflicts
        .map(
          (c) => `${c.productCode}(现存 ${c.existingTier} / 新 ${c.newTier})`,
        )
        .join("、");
      throw new ConflictException(
        `同一产品不允许并存档位不同的订阅(升档请变更原订阅):${detail}`,
      );
    }
  }

  private async safeProvisioningHook(
    op: string,
    subscriptionId: string,
    fn: () => Promise<void>,
  ): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.error(
        `provisioning enqueue failed (op=${op} subscription=${subscriptionId}) — ` +
          `state committed without webhook, needs manual replay: ${String(err)}`,
      );
    }
  }

  /** tenant.provisioned for every product bundled by the (new) plan_version. */
  private async fireProvisioned(
    sub: SubscriptionRecord,
    planVersionId: string,
  ): Promise<void> {
    const products = await this.repo.listVersionProducts(planVersionId);
    for (const p of products) {
      await this.provisioning.onSubscriptionActivated({
        workspaceId: sub.workspaceId,
        tenantId: sub.tenantId,
        applicationId: p.productId,
        appCode: p.productCode,
        plan: p.planCode,
      });
    }
  }

  /** tenant.deprovisioned for each product with no surviving coverage. */
  private async fireDeprovisionIfUncovered(
    sub: SubscriptionRecord,
    planVersionId: string,
  ): Promise<void> {
    const products = await this.repo.listVersionProducts(planVersionId);
    for (const p of products) {
      const covered = await this.repo.hasOtherActiveCoverage(
        sub.workspaceId,
        p.productId,
        sub.id,
      );
      if (covered) continue;
      await this.provisioning.onSubscriptionDeactivated({
        workspaceId: sub.workspaceId,
        tenantId: sub.tenantId,
        applicationId: p.productId,
        appCode: p.productCode,
      });
    }
  }

  /** Version change: provision the new set, deprovision-check products dropped. */
  private async fireVersionChange(
    sub: SubscriptionRecord,
    oldPlanVersionId: string,
  ): Promise<void> {
    if (!ACTIVATED.has(sub.status)) return;
    await this.fireProvisioned(sub, sub.planVersionId);
    const [oldProducts, newProducts] = await Promise.all([
      this.repo.listVersionProducts(oldPlanVersionId),
      this.repo.listVersionProducts(sub.planVersionId),
    ]);
    const kept = new Set(newProducts.map((p) => p.productId));
    for (const p of oldProducts) {
      if (kept.has(p.productId)) continue;
      const covered = await this.repo.hasOtherActiveCoverage(
        sub.workspaceId,
        p.productId,
        sub.id,
      );
      if (covered) continue;
      await this.provisioning.onSubscriptionDeactivated({
        workspaceId: sub.workspaceId,
        tenantId: sub.tenantId,
        applicationId: p.productId,
        appCode: p.productCode,
      });
    }
  }

  /**
   * subscription_changed for every product touched by the write — the C2
   * entitlement cache-bust (product_200 §4.2, closes the P2.4 downgrade debt).
   * Fires regardless of whether a provisioning event fired: entitlements can
   * change (quota merge, tier) even when coverage/deprovisioning does not.
   * One changeId per write op keeps the fan-out keys unique per logical event
   * (version-less events need an instance discriminator, data_commerce_220 §2);
   * enqueueEvent no-ops for products without a webhook registration.
   */
  private async fireEntitlementInvalidate(
    sub: SubscriptionRecord,
    planVersionIds: string[],
  ): Promise<void> {
    const changeId = randomUUID();
    const seen = new Set<string>();
    for (const versionId of new Set(planVersionIds)) {
      const products = await this.repo.listVersionProducts(versionId);
      for (const p of products) {
        if (seen.has(p.productId)) continue;
        seen.add(p.productId);
        await this.provisioning.enqueueEvent({
          workspaceId: sub.workspaceId,
          tenantId: sub.tenantId,
          applicationId: p.productId,
          appCode: p.productCode,
          event: "subscription_changed",
          // "subchg:" keeps it under the varchar(128) key column (four joined
          // uuids overflow it); subscription id is globally unique, so no
          // cross-workspace collision without carrying workspace_id here.
          idempotencyKey: `subchg:${sub.id}:${p.productId}:${changeId}`,
          data: {
            products: [p.productCode],
            subscription_id: sub.id,
          },
        });
      }
    }
  }

  /** Generic update: derive events from the status/version transition. */
  private async fireStatusTransition(
    before: SubscriptionRecord,
    after: SubscriptionRecord,
  ): Promise<void> {
    if (before.planVersionId !== after.planVersionId) {
      await this.fireVersionChange(after, before.planVersionId);
      return;
    }
    const wasActive = ACTIVATED.has(before.status);
    const isActive = ACTIVATED.has(after.status);
    if (!wasActive && isActive) {
      await this.fireProvisioned(after, after.planVersionId);
    } else if (wasActive && DEACTIVATED.has(after.status)) {
      await this.fireDeprovisionIfUncovered(after, after.planVersionId);
    }
  }
}
