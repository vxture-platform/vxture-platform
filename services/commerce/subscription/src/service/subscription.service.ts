import { randomUUID } from "node:crypto";
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { ProvisioningService } from "@vxture/service-provisioning";
import { PgSubscriptionRepository } from "../repository/pg-subscription.repository";
import type {
  SubscriptionRecord,
  SubscriptionHistoryRecord,
  ListSubscriptionsParams,
  ListSubscriptionsResult,
  CreateSubscriptionInput,
  UpdateSubscriptionInput,
} from "../types/subscription.types";

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

  constructor(
    @Inject(PgSubscriptionRepository)
    private readonly repo: PgSubscriptionRepository,
    @Inject(ProvisioningService)
    private readonly provisioning: ProvisioningService,
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
    return this.sweepToExpired(
      ids.map((id) => ({ id, status: "trialing" })),
      "trial expiry sweep",
      "trial ended without conversion (expiry sweep)",
    );
  }

  /**
   * 共享的"→ expired"扫描循环（trial 与付费/免费到期共用）：每行 CAS 到读到的当前状态，
   * 输了竞态的行 0 行 no-op 静默跳过；单行失败只记日志，趟不中断。
   */
  private async sweepToExpired(
    rows: { id: string; status: string }[],
    label: string,
    remark: string,
  ): Promise<number> {
    let transitioned = 0;
    for (const { id, status } of rows) {
      try {
        const before = await this.getSubscription(id);
        if (before.status !== status) continue; // moved since the scan
        const result = await this.repo.update(id, before, {
          status: "expired",
          operatorType: "system",
          operatorRemark: remark,
          expectedStatus: status,
        });
        if (!result) {
          this.logger.debug(
            `${label}: subscription ${id} changed under us, skipped (lost race)`,
          );
          continue;
        }
        await this.applyTransitionHooks(`sweep:${id}`, id, before, result);
        transitioned += 1;
      } catch (err) {
        this.logger.error(
          `${label}: subscription ${id} failed to transition — ${String(err)}`,
        );
      }
    }
    return transitioned;
  }

  /**
   * 付费/免费订阅到期扫描（product_330 P2-c）：end_at 已过的在用订阅 → expired，走与
   * updateSubscription 相同的写完成尾（deprovision-if-uncovered + C2 invalidate）。
   * CAS：expectedStatus = 读到的当前状态，与并发的续订履约（updateSubscription 延长
   * end_at / 复活）互不清 clobber——输了的一方 0 行 no-op。
   */
  async sweepExpiredSubscriptions(limit = 100): Promise<number> {
    const rows = await this.repo.findExpiredSubscriptionIds(limit);
    return this.sweepToExpired(
      rows,
      "expiry sweep",
      "cycle ended without renewal (expiry sweep)",
    );
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
  /**
   * 对外暴露给 OrderService（product_330 P1-b2）：下单 / 履约前的档位并存守卫。
   * 与内部 assertNoTierConflict 同一实现。
   */
  async assertTierAvailable(
    workspaceId: string,
    planVersionId: string,
    excludeSubscriptionId?: string,
  ): Promise<void> {
    return this.assertNoTierConflict(
      workspaceId,
      planVersionId,
      excludeSubscriptionId,
    );
  }

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
