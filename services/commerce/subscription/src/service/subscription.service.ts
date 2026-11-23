import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { ProvisioningService } from "@vxture/service-provisioning";
import {
  SUSPENSION_REASON_EXTENDS_TERM,
  type SubscriptionStatus,
} from "@vxture-platform/shared";
import {
  PgSubscriptionRepository,
  type NotifyDisplay,
} from "../repository/pg-subscription.repository";
import {
  formatNotifyDate,
  type CustomerNotifier,
  type CustomerNotifyInput,
} from "./customer-notifier";
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
const ACTIVATED: ReadonlySet<string> = new Set<SubscriptionStatus>([
  "active",
  "trialing",
]);
/** Terminal statuses that trigger the per-component deprovision check. */
const DEACTIVATED: ReadonlySet<string> = new Set<SubscriptionStatus>([
  "cancelled",
  "expired",
]);

/**
 * 每一档状态在「这个工作区还占着这个产品吗」这根轴上的归类（2026-10-03 修）。
 *
 * ── 修的是什么 ──
 * 撤销开通的判据原先写的是 `ACTIVATED.has(before.status)`，而 ACTIVATED 只有
 * active / trialing 两档。值域有七档，DEACTIVATED 占两档 —— 剩下的
 * **expiring / overdue / suspended 三档落在两个集合的缝里**，于是：
 *
 *   active →(到期前 3 天那一趟) expiring →(到期扫描) expired
 *     第二步 before.status = 'expiring' ⇒ 不在 ACTIVATED ⇒ **一个 tenant.deprovisioned 都不发**
 *
 * 而没经过 expiring 的那批（直接 active → expired）发得到。**同一个终态、产品侧
 * 收到的东西不同**，而产品侧是靠这个硬信号停服务的。overdue（宽限，权益不变）与
 * suspended（冻结）两条路一模一样：进去时不发、出来进终态时也不发。
 *
 * ── 为什么做成 Record 而不是再加一个 Set ──
 * `Record<SubscriptionStatus, …>` 让「加一档状态却忘了归类」变成**编译错误**，
 * 由 type-check:all 当场拦下。再加一个 Set 只会把今天这三档补上，而下一档新状态
 * 仍然会掉进缝里不报错 —— 本次的缺陷形状正是「掉进缝里且零信号」。
 *
 * 开通方向仍只认 ACTIVATED：expiring / overdue / suspended 不是「刚开通」，
 * 它们是「还占着」。两根轴不是一回事，所以不合并。
 */
type CoverageClass = "held" | "terminal";
const STATUS_COVERAGE: Record<SubscriptionStatus, CoverageClass> = {
  active: "held",
  trialing: "held",
  // 到期前提醒写的那一档：服务照常，只是 end_at 近了。
  expiring: "held",
  // 宽限：续费单在途未付，权益不变（product_220 §3）。
  overdue: "held",
  // 冻结：平台动作或产品维护窗口；订阅还在，顺延在走。
  suspended: "held",
  expired: "terminal",
  cancelled: "terminal",
};

/**
 * 进终态之前是否仍占着这个产品 —— 撤销方向的判据，比 ACTIVATED 宽。
 *
 * 入参收 `string` 而不是 `SubscriptionStatus`：`SubscriptionRecord.status` 今天是
 * `string`（从库里的行直接来），把那个类型收窄会波及所有构造它的地方，不是这个
 * 缺陷该带的改动。所以类型安全放在 STATUS_COVERAGE 那张表上（漏归类 = 编译错），
 * 这里只负责**遇到没见过的值要吵**：
 * 默认成「没占着」正是本次修的那个形状 —— 掉进缝里、零信号、没人知道。
 * 调用点在 safeProvisioningHook 里，抛出来会被记成
 * 「state committed without webhook, needs manual replay」：写入不受影响，信号不静默。
 * 库里有 CHECK 约束、值域又与 SUBSCRIPTION_STATUSES 同源，所以这一支按构造不可达。
 */
function heldCoverage(status: string): boolean {
  const cls = (STATUS_COVERAGE as Record<string, CoverageClass | undefined>)[
    status
  ];
  if (!cls) {
    throw new Error(
      `[subscription] 未归类的订阅状态 ${status} —— 先在 STATUS_COVERAGE 里决定它算「还占着」还是「终态」，` +
        `不要让它默认成不发信号`,
    );
  }
  return cls === "held";
}

/**
 * 运营代客动作的三档（`notifyOperatorStatusChange` 的入参）。
 *
 * 导出是为了让 `.d.ts` 能指名这个联合（本类型不进包 barrel，调用方传字面量即可）。
 */
export type OperatorSubscriptionAction = "suspended" | "resumed" | "renewed";

/**
 * 动作 → 客户模板。用 `Record` 而不是三目：加一档忘了配模板**编译不过**，不会静默
 * 落进某个兜底（与 dispatch 侧 TOPIC_OF 同一手法）。
 *
 * 续期这一档另立模板码：`subscription.renewed` 的正文要说「实付 {{amount}}」，而代客
 * 续期是订阅侧的直接动作，没有订单也没有付款——那个字段没有诚实的值可填。
 */
const OPERATOR_ACTION_TEMPLATE: Record<
  OperatorSubscriptionAction,
  CustomerNotifyInput["templateCode"]
> = {
  suspended: "subscription.suspended",
  resumed: "subscription.resumed",
  renewed: "subscription.renewed_by_operator",
};

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

  /** 客户通知（P2-g）：装配处注入；未注入 = 不发。通知 best-effort，失败只记日志。 */
  private notifier: CustomerNotifier | null = null;

  setCustomerNotifier(notifier: CustomerNotifier | null): void {
    this.notifier = notifier;
  }

  private async emit(
    label: string,
    build: () => Promise<CustomerNotifyInput | null>,
  ): Promise<boolean> {
    if (!this.notifier) return false;
    try {
      const input = await build();
      if (!input) return false;
      await this.notifier.notify(input);
      return true;
    } catch (err) {
      this.logger.warn(`notify ${label} failed — ${String(err)}`);
      return false;
    }
  }

  /** 订阅生命周期通知的共同形状：引用 = 订阅 × 到期日（去重键），链接去「我的订阅」。 */
  private subscriptionNotice(
    templateCode: CustomerNotifyInput["templateCode"],
    d: {
      id: string;
      tenantId: string;
      endAt: Date | null;
      productName: string;
      planName: string;
    },
    extraParams: Record<string, string | number> = {},
  ): CustomerNotifyInput {
    return {
      tenantId: d.tenantId,
      templateCode,
      reference: {
        type: "subscription",
        id: `${d.id}:${(d.endAt ?? new Date()).toISOString().slice(0, 10)}`,
      },
      params: {
        productName: d.productName,
        planName: d.planName,
        endAt: formatNotifyDate(d.endAt),
        ...extraParams,
      },
      link: "/subscription",
    };
  }

  /**
   * 产品升级维护那条暂停通知的形状（2026-09-28 收尾）。
   *
   * 为什么不复用 `subscription.suspended`：那条正文写着「如需恢复请联系客服」——对**人工**
   * 暂停是对的（只有运营放得开），对产品维护是假话：`sweepProductMaintenance` 的第 2 段
   * 自己把订阅放回 active、闭合 episode、结算顺延、发恢复通知。让客户去问一件系统自己会
   * 做完的事，既错，又白造工单。
   *
   * 去重锚换成「订阅 × **预计恢复日期**」而不是共同形状的「订阅 × 到期日」：窗口被延长时
   * （第 3 段的 `syncMaintenanceExpectedResume` 把未闭合 episode 的预计恢复改掉），日期变了，
   * 收件箱那个唯一键（account × 模板 × 引用类型 × 引用 id）就不再命中，同一条模板自然再发
   * 一条带新日期的——所以**第 3 段不必自己发通知**，「承诺的回来时间变了而当事人不知道」
   * 这个洞由键的粒度补掉。与 `notifyExpiringSoon`（订阅 × 到期日，窗口内每趟重扫同一批行）
   * 是同一个机关。
   *
   * 键里那个日期与文案里那个日期**必须是同一个字符串**（都过 `formatNotifyDate`）：各算一次
   * 的话（一个 UTC 一个 Asia/Shanghai），跨日那几个小时会出现「屏幕上的日子变了却不再通知」
   * ——那正是这条键要防的事。
   */
  private maintenancePauseNotice(
    d: NotifyDisplay,
    expectedResumeAt: Date,
  ): CustomerNotifyInput {
    const resumeAt = formatNotifyDate(expectedResumeAt);
    return {
      ...this.subscriptionNotice("subscription.suspended_maintenance", d, {
        resumeAt,
      }),
      reference: { type: "subscription", id: `${d.id}:${resumeAt}` },
    };
  }

  async listSubscriptions(
    params: ListSubscriptionsParams,
  ): Promise<ListSubscriptionsResult> {
    return this.repo.listSubscriptions(params);
  }

  async getSubscription(
    id: string,
    client?: PoolClient,
    lock = false,
  ): Promise<SubscriptionRecord> {
    const record = lock
      ? await this.repo.getById(id, client, true)
      : await this.repo.getById(id, client);
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
    transaction?: PoolClient,
  ): Promise<SubscriptionRecord> {
    // Multiple subscriptions per workspace are allowed (ADR-11 §8: a product can be
    // bundled + separately subscribed) — no single-active constraint. quota_pool
    // rows are materialized from the plan_version's components on create.
    const create = async (client: PoolClient) => {
      await this.assertNoTierConflict(
        input.workspaceId,
        input.planVersionId,
        undefined,
        client,
      );
      const record = await this.repo.create(input, client);
      if (ACTIVATED.has(record.status)) {
        await this.fireProvisioned(record, record.planVersionId, client);
      }
      await this.fireEntitlementInvalidate(
        record,
        [record.planVersionId],
        client,
      );
      return record;
    };
    return transaction
      ? create(transaction)
      : this.repo.withTransaction(create);
  }

  async cancelSubscription(
    id: string,
    operatorId?: string,
    remark?: string,
    /** 发起方(缺省 operator,保持既有调用不变);customer = 租户自助退订。 */
    actorType: "operator" | "customer" | "system" = "operator",
    expectedCurrentOrderId?: string,
  ): Promise<SubscriptionRecord> {
    return this.repo.withLockedSubscription(
      id,
      async (subscription, client) => {
        if (!subscription) throw new NotFoundException(`订阅 ${id} 不存在`);
        if (subscription.status === "cancelled")
          throw new ConflictException("订阅已取消");
        if (subscription.status === "expired")
          throw new ConflictException("订阅已过期");

        const result = await this.repo.update(
          id,
          subscription,
          {
            ...(expectedCurrentOrderId
              ? { expectedCurrentOrderId, expectedStatus: subscription.status }
              : {}),
            status: "cancelled",
            // Perpetual subscriptions have no end date even in a terminal state.
            ...(subscription.cycleType === "perpetual"
              ? {}
              : { endAt: new Date() }),
            // Cancellation also disables renewal, matching the existing admin path.
            autoRenew: false,
            operatorType: actorType,
            ...(operatorId !== undefined
              ? { operatorId, updatedBy: operatorId }
              : {}),
            ...(remark !== undefined ? { operatorRemark: remark } : {}),
          },
          client,
        );
        if (!result)
          throw new ConflictException("订阅已发生后续变更，退款撤销需人工核对");
        await this.fireDeprovisionIfUncovered(
          result,
          subscription.planVersionId,
          client,
        );
        await this.fireEntitlementInvalidate(
          result,
          [subscription.planVersionId],
          client,
        );
        return result;
      },
    );
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
    transaction?: PoolClient,
  ): Promise<SubscriptionRecord> {
    return this.repo.withLockedSubscription(
      id,
      async (subscription, client) => {
        if (!subscription) throw new NotFoundException(`订阅 ${id} 不存在`);
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

        const result = await this.repo.update(
          id,
          subscription,
          {
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
          },
          client,
        );
        if (!result) throw new NotFoundException(`订阅 ${id} 不存在`);
        // Renewal policy invalidates C2 without sending lifecycle provisioning.
        await this.fireEntitlementInvalidate(
          result,
          [subscription.planVersionId],
          client,
        );
        return result;
      },
      ...(transaction ? [transaction] : []),
    );
  }

  async upgradeSubscription(
    id: string,
    newPlanVersionId: string,
    operatorId?: string,
    remark?: string,
    transaction?: PoolClient,
  ): Promise<SubscriptionRecord> {
    return this.repo.withLockedSubscription(
      id,
      async (subscription, client) => {
        if (!subscription) throw new NotFoundException(`订阅 ${id} 不存在`);
        if (
          !["active", "trialing", "expiring", "overdue"].includes(
            subscription.status,
          )
        )
          throw new ConflictException("只有服务中的订阅可以升级");
        await this.assertNoTierConflict(
          subscription.workspaceId,
          newPlanVersionId,
          id,
          client,
        );

        const result = await this.repo.update(
          id,
          subscription,
          {
            toPlanVersionId: newPlanVersionId,
            status: "active",
            expectedStatus: subscription.status,
            operatorType: "operator",
            ...(operatorId !== undefined
              ? { operatorId, updatedBy: operatorId }
              : {}),
            ...(remark !== undefined ? { operatorRemark: remark } : {}),
          },
          client,
        );
        if (!result) {
          throw new ConflictException("订阅状态已变化，请刷新后重新确认升级");
        }
        await this.fireVersionChange(
          result,
          subscription.planVersionId,
          client,
        );
        await this.fireEntitlementInvalidate(
          result,
          [subscription.planVersionId, result.planVersionId],
          client,
        );
        return result;
      },
      ...(transaction ? [transaction] : []),
    );
  }

  async updateSubscription(
    id: string,
    input: UpdateSubscriptionInput,
    transaction?: PoolClient,
  ): Promise<SubscriptionRecord> {
    return this.repo.withLockedSubscription(
      id,
      async (subscription, client) => {
        if (!subscription) throw new NotFoundException(`订阅 ${id} 不存在`);
        // Stacking guardrail on every write that creates/expands live coverage:
        // a plan change, or a revival transition into a live status (resume /
        // admin renew) — both can otherwise smuggle a second tier in.
        const targetVersion =
          input.toPlanVersionId ?? subscription.planVersionId;
        const becomesLive =
          input.status !== undefined &&
          ACTIVATED.has(input.status) &&
          !ACTIVATED.has(subscription.status);
        if (input.toPlanVersionId !== undefined || becomesLive) {
          await this.assertNoTierConflict(
            subscription.workspaceId,
            targetVersion,
            id,
            client,
          );
        }
        const result = await this.repo.update(id, subscription, input, client);
        if (!result) throw new NotFoundException(`订阅 ${id} 不存在`);
        await this.applyTransitionHooks(
          "update",
          id,
          subscription,
          result,
          client,
        );
        return result;
      },
      ...(transaction ? [transaction] : []),
    );
  }

  /**
   * Invalidate entitlements after order terms change without a version switch.
   * @param subscription - Final subscription state read on the order transaction.
   * @param transaction - Caller-owned fulfillment transaction.
   * @returns Resolves after the required cache invalidation is persisted.
   * @throws {Error} When persisting the required product notification fails.
   */
  async notifyOrderTermsChanged(
    subscription: SubscriptionRecord,
    transaction: PoolClient,
  ): Promise<void> {
    await this.fireEntitlementInvalidate(
      subscription,
      [subscription.planVersionId],
      transaction,
    );
  }

  /**
   * Shared write-completion tail for updateSubscription() and
   * sweepLapsedTrials() (post-review dedup, 2026-07-12 — the two used to
   * hand-copy this sequence): fire the status-transition hook, then — only
   * when status, plan_version or a known term end actually changed — the entitlement-
   * invalidate hook. `hookPrefix` becomes each safeProvisioningHook op
   * label ("update"/"update:invalidate" vs "sweep:<id>"/"sweep:<id>:invalidate"),
   * unchanged from each caller's prior inline behavior. A caller transaction
   * makes enqueue failures fatal so that no subscription update commits alone;
   * legacy post-commit writers retain their existing logged-failure behavior.
   */
  /**
   * External status writers provide only status/version. A missing prior endAt
   * is unknown, not an unlimited term; compare dates only for complete snapshots.
   */
  private async applyTransitionHooks(
    hookPrefix: string,
    id: string,
    before: Pick<SubscriptionRecord, "status" | "planVersionId"> &
      Partial<Pick<SubscriptionRecord, "endAt">>,
    result: SubscriptionRecord,
    transaction?: PoolClient,
  ): Promise<void> {
    const transition = () =>
      this.fireStatusTransition(before, result, transaction);
    if (transaction) await transition();
    else await this.safeProvisioningHook(hookPrefix, id, transition);
    if (
      before.status !== result.status ||
      before.planVersionId !== result.planVersionId ||
      (before.endAt !== undefined &&
        (before.endAt?.getTime() ?? null) !== (result.endAt?.getTime() ?? null))
    ) {
      const invalidate = () =>
        this.fireEntitlementInvalidate(
          result,
          [before.planVersionId, result.planVersionId],
          transaction,
        );
      if (transaction) await invalidate();
      else
        await this.safeProvisioningHook(
          `${hookPrefix}:invalidate`,
          id,
          invalidate,
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
    const done = await this.sweepToExpired(
      ids.map((id) => ({ id, status: "trialing" })),
      "trial expiry sweep",
      "trial ended without conversion (expiry sweep)",
      true,
    );
    /*
     * 试用到期通知（2026-09-28 批 5）。此前这一趟把 rows 丢掉只返回条数，于是
     * **试用结束客户一句话都收不到**——付费到期那一支（sweepExpiredSubscriptions）
     * 早就在发了。照抄那一支：只对**真的发生了转移**的行发（`done` 里的行都过了 CAS），
     * 单行失败只记日志不中断（emit 自己吞），去重靠 dispatcher 的唯一键。
     *
     * 这里没有「从哪一档来的」这道过滤：本趟扫描的候选谓词写死 status='trialing'
     * （findLapsedTrialIds），`from` 恒为 trialing，不存在付费那侧「冻结中到期不通知」
     * 那种要分辨来源的情形。
     */
    for (const { id } of done) {
      await this.emit(`trial expired ${id}`, async () => {
        const d = await this.repo.getNotifyDisplay(id);
        if (!d) return null;
        /* 试用的那个日子在 trial_end_at 上（试用行的 end_at 常为 NULL），
           所以显式换掉展示与去重键里的日期，而不是让它落成「—」+「今天」。 */
        return this.subscriptionNotice("subscription.trial_expired", {
          ...d,
          endAt: d.trialEndAt ?? d.endAt,
        });
      });
    }
    return done.length;
  }

  /**
   * Expire each scanned row and persist its product notifications together.
   * A lost CAS is a no-op; a failed row rolls back without aborting the pass.
   */
  private async sweepToExpired(
    rows: { id: string; status: string; endAt?: Date | null }[],
    label: string,
    remark: string,
    trialExpiry = false,
  ): Promise<{ id: string; from: string }[]> {
    const transitioned: { id: string; from: string }[] = [];
    for (const { id, status, endAt } of rows) {
      try {
        const changed = await this.repo.withLockedSubscription(
          id,
          async (before, client) => {
            if (!before) throw new NotFoundException(`订阅 ${id} 不存在`);
            if (before.status !== status) return false;
            // Trial candidates carry ids only. Recheck their current cutoff under
            // the lock so an extended or converted trial cannot expire from a stale scan.
            if (
              trialExpiry &&
              (before.subscriptionKind !== "trial" ||
                before.trialEndAt === null ||
                before.trialEndAt.getTime() > Date.now())
            )
              return false;
            if (!trialExpiry && before.subscriptionKind === "trial")
              return false;
            const result = await this.repo.update(
              id,
              before,
              {
                status: "expired",
                operatorType: "system",
                operatorRemark: remark,
                expectedStatus: status,
                ...(endAt !== undefined ? { expectedEndAt: endAt } : {}),
              },
              client,
            );
            if (!result) {
              this.logger.debug(
                `${label}: subscription ${id} changed under us, skipped (lost race)`,
              );
              return false;
            }
            await this.applyTransitionHooks(
              `sweep:${id}`,
              id,
              before,
              result,
              client,
            );
            return true;
          },
        );
        if (!changed) continue;
        // Count only committed rows; callers retain the suspended-notice policy.
        transitioned.push({ id, from: status });
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
  async sweepExpiredSubscriptions(limit = 100, graceDays = 0): Promise<number> {
    const rows = await this.repo.findExpiredSubscriptionIds(limit, graceDays);
    const expired = await this.sweepToExpired(
      rows,
      "expiry sweep",
      "cycle ended without renewal (expiry sweep)",
    );
    // P2-g：到期通知（站内 + 邮件），按订阅 × 到期日去重；付款履约复活后再到期会再通知。
    for (const { id, from } of expired) {
      // 冻结中到期不通知（2026-09-25）：服务在被暂停那一刻就停了，客户已经知道。此刻再
      // 发一封「订阅已到期」只会让人以为又出了新状况。留 histories 就够，那是给运营看的。
      // 这条也是 suspended 进扫描集合的前提——否则存量里所有过期的冻结行会在第一趟之后
      // 一次性把邮件发出去。
      if (from === "suspended") continue;
      await this.emit(`expired ${id}`, async () => {
        const d = await this.repo.getNotifyDisplay(id);
        return d ? this.subscriptionNotice("subscription.expired", d) : null;
      });
    }
    return expired.length;
  }

  /**
   * 服务期重起时把配额周期锚点拨到现在（2026-09-26，owner 决策）。
   *
   * 给 admin「续期确认」那条裸 SQL 路径用：它不走订单履约，所以此前**从不重锚**——
   * 在用续期恰好对（不该重锚），但过期后续期是错的（该重锚而没重）。
   *
   * 判据由调用方用 `@shared` 的 `renewalRestartsPeriod` 给，与订单履约那侧同一份：
   * 配额锚点 ≡ 服务期起点，没动起点的不许动锚点。
   *
   * 自己吞异常：续期本身已经生效，重锚失败不该让那个请求失败——下次续期或消费会自愈。
   */
  async reanchorAfterPeriodRestart(subscriptionId: string): Promise<number> {
    try {
      const n = await this.repo.reanchorPeriodicPools(subscriptionId);
      if (n > 0) {
        this.logger.log(
          `reanchor: subscription ${subscriptionId} — ${n} periodic pool(s) re-anchored (service period restarted)`,
        );
      }
      return n;
    } catch (err) {
      this.logger.error(`reanchor ${subscriptionId} failed — ${String(err)}`);
      return 0;
    }
  }

  /** Read-only visibility of historical half states; this method never repairs them. */
  async countSuspensionHalfStates(): Promise<{
    suspendedWithoutEpisode: number;
    resumedWithOpenEpisode: number;
    samples: { shape: "no_episode" | "open_episode"; subscriptionId: string }[];
  }> {
    return this.repo.countSuspensionHalfStates();
  }

  /**
   * Settle at most 100 selected episodes, with compensation and required invalidation
   * committed together for each subscription. Failures remain eligible next pass.
   * @param subscriptionId - Restrict immediate settlement to this subscription when set.
   * @returns Committed episode count; a failed group does not stop later groups.
   */
  async settleSuspensionExtension(subscriptionId?: string): Promise<number> {
    try {
      const candidates = await this.repo.findUnsettledSuspensions(
        subscriptionId ? { subscriptionId, limit: 100 } : { limit: 100 },
      );
      const groups = new Map<string, string[]>();
      for (const row of candidates) {
        const ids = groups.get(row.subscriptionId) ?? [];
        ids.push(row.id);
        groups.set(row.subscriptionId, ids);
      }
      let count = 0;
      for (const [id, episodeIds] of groups) {
        try {
          const result = await this.repo.withLockedSubscription(
            id,
            async (before, client) => {
              if (!before) throw new NotFoundException(`订阅 ${id} 不存在`);
              const terms = await this.settleSuspensionTerms(
                before,
                client,
                episodeIds,
              );
              await this.applyTransitionHooks(
                `suspension-settle:${id}`,
                id,
                before,
                terms.after,
                client,
              );
              return terms;
            },
          );
          count += result.settled.length;
          this.logUnappliedSuspensions(result.settled);
        } catch (error) {
          this.logger.error(
            `suspension settle ${id} failed — ${String(error)}`,
          );
        }
      }
      return count;
    } catch (error) {
      this.logger.error(`suspension settle failed — ${String(error)}`);
      return 0;
    }
  }

  /**
   * Keep existing compensation math inside the caller's subscription transaction.
   * @throws {NotFoundException} When the locked subscription cannot be reread.
   */
  private async settleSuspensionTerms(
    subscription: SubscriptionRecord,
    client: PoolClient,
    episodeIds?: string[],
  ) {
    const settled = await this.repo.settleResumedSuspensions(
      {
        subscriptionId: subscription.id,
        limit: 100,
        ...(episodeIds ? { episodeIds } : {}),
      },
      client,
    );
    const after = settled.some((row) => row.extended)
      ? await this.repo.getById(subscription.id, client)
      : subscription;
    if (!after) throw new NotFoundException(`订阅 ${subscription.id} 不存在`);
    return { after, settled };
  }

  /** Report unapplied compensation only after its transaction has committed. */
  private logUnappliedSuspensions(
    rows: {
      subscriptionId: string;
      grantedSeconds: number;
      extended: boolean;
    }[],
  ): void {
    for (const row of rows) {
      if (row.grantedSeconds > 0 && !row.extended)
        this.logger.log(
          `suspension settle: subscription ${row.subscriptionId} has no end_at, ${row.grantedSeconds}s recorded but not applied`,
        );
    }
  }

  /**
   * 到点处置（2026-09-25 步骤三）：暂停超过 `subscription.max_suspend_days` 还没恢复的，
   * 平台必须动一下。
   *
   * 为什么必须有：顺延让有效到期日随暂停时长一直往后走。没有上限的话那条订阅永不到期、
   * 永不释放、也永不再计费——批 2 刚修掉的死胡同会以另一种形态回来。
   *
   * 动作按**原因**分，这是三条前提推出来的：
   *   · 平台自己的原因（运维 / 争议审查 / 其他）→ **强制恢复**。拖着不查是平台的问题，
   *     不该让客户一直停着；顺延照算，客户不亏那些天。
   *   · 客户违规 → **终止**。查实了就该结束，而不是无限期挂着占着位子。
   *
   * 恢复时把 `auto_renew` 还原成暂停那一刻的值（`auto_renew_before`）。存量 episode 该
   * 列为 NULL ⇒ 不动它：那是「按设计没有」，猜一个比不动更糟。
   *
   * 走 `repo.update` + `applyTransitionHooks`，与到期扫描同一条路——产品侧的
   * provisioning / 权益缓存由同一套钩子对齐，不另写一份。
   */
  async sweepOverdueSuspensions(): Promise<{
    resumed: number;
    terminated: number;
  }> {
    // 天数从 admin.settings 读（运营台可改，不用发版）；读不到用代码侧默认 60。
    const maxDays = await this.repo.getMaxSuspendDays();
    const rows = await this.repo.findOverdueSuspensions(maxDays);
    let resumed = 0;
    let terminated = 0;
    for (const row of rows) {
      /*
       * 到点处置读的是 episode 上的**快照** `extends_term`，不是拿 `row.reason` 去查
       * 当下的政策 —— 这是有意的，别"顺手改成按 reason 算"（2026-10-03 复核过一轮）。
       *
       * 仓储那边的注释写「处置动作按**原因**分……所以这里把 reason 与 extends_term
       * 一起带出去」，读起来像是这里该用 reason。两者今天**是同一个函数**：
       * `SUSPENSION_REASON_EXTENDS_TERM` 里只有 `customer_violation` 为 false，
       * 所以 `!extendsTerm` 恰好等于「客户违规 → 终止，平台原因 → 强制恢复」。
       *
       * 而它们将来**可能**不等，那时也仍然该用快照：
       * `catalog-domains.constants` 自己写明「`extends_term` 是暂停那一刻拍在 episode 上的，
       * 不在读取时派生：政策可以改，但**已经发生的那次暂停不许被改写**」。
       * 到点处置是终止还是恢复，对客户的影响比顺延更大 —— 用今天的新政策去处置一次
       * 按旧政策承诺过的暂停，正是那句话要防的事。
       *
       * 所以：**快照管承诺（顺延与结算），reason 只进备注给人看。**
       * 真要让处置与顺延分家（比如新增一个原因，或者处置不再等于 `!extendsTerm`），
       * 那需要一张自己的处置映射表 + owner 裁定，不是在这里改一个取值。
       */
      try {
        const committed = await this.repo.withLockedSubscription(
          row.subscriptionId,
          async (before, client) => {
            if (!before)
              throw new NotFoundException(`订阅 ${row.subscriptionId} 不存在`);
            if (before.status !== "suspended") return null;
            const current = (
              await this.repo.findOverdueSuspensions(maxDays, 1, client, row.id)
            ).find(
              (candidate) =>
                candidate.id === row.id &&
                candidate.subscriptionId === row.subscriptionId,
            );
            if (
              !current ||
              current.id !== row.id ||
              current.subscriptionId !== row.subscriptionId
            )
              return null;
            const terminate = !current.extendsTerm;
            const autoRenew = terminate ? false : current.autoRenewBefore;
            const result = await this.repo.update(
              row.subscriptionId,
              before,
              {
                status: terminate ? "cancelled" : "active",
                ...(autoRenew === null ? {} : { autoRenew }),
                operatorType: "system",
                operatorRemark: terminate
                  ? `suspension exceeded ${maxDays} days (reason=${current.reason}) — terminated`
                  : `suspension exceeded ${maxDays} days (reason=${current.reason}) — force resumed`,
                expectedStatus: "suspended",
              },
              client,
            );
            if (!result) return null;
            await this.repo.closeSuspension(
              row.subscriptionId,
              client,
              current.id,
            );
            const terms = await this.settleSuspensionTerms(result, client);
            await this.applyTransitionHooks(
              `suspension-deadline:${row.subscriptionId}`,
              row.subscriptionId,
              before,
              terms.after,
              client,
            );
            return { ...terms, terminate };
          },
        );
        if (!committed) continue;
        this.logUnappliedSuspensions(committed.settled);
        if (committed.terminate) terminated += 1;
        else resumed += 1;
        await this.emit(
          `suspension deadline ${row.subscriptionId}`,
          async () => {
            const d = await this.repo.getNotifyDisplay(row.subscriptionId);
            return d
              ? this.subscriptionNotice(
                  committed.terminate
                    ? "subscription.suspension_ended"
                    : "subscription.resumed",
                  d,
                )
              : null;
          },
        );
      } catch (err) {
        this.logger.error(
          `suspension deadline: subscription ${row.subscriptionId} failed — ${String(err)}`,
        );
      }
    }
    return { resumed, terminated };
  }

  /**
   * Reconcile product maintenance without touching manual suspension episodes.
   * Entry commits the status, renewal snapshot, episode and required invalidation.
   * Release commits the restored status, episode closure, compensation and product
   * events together. Locked predicates reject stale window or episode identities.
   * Customer notices run after commit; expected-resume synchronization keeps its
   * existing single-statement update and date-based notification deduplication.
   * One row's failure never aborts the remaining candidates.
   */
  async sweepProductMaintenance(): Promise<{
    suspended: number;
    resumed: number;
    synced: number;
  }> {
    let suspended = 0;
    let resumed = 0;

    // 1. 进窗口
    const candidates = await this.repo.findMaintenanceCandidates();
    for (const c of candidates) {
      try {
        const committed = await this.repo.withLockedSubscription(
          c.subscriptionId,
          async (before, client) => {
            if (!before)
              throw new NotFoundException(`订阅 ${c.subscriptionId} 不存在`);
            if (before.status !== c.status) return null;
            const current = (
              await this.repo.findMaintenanceCandidates(
                1,
                client,
                c.subscriptionId,
              )
            ).find(
              (candidate) => candidate.subscriptionId === c.subscriptionId,
            );
            if (
              !current ||
              current.subscriptionId !== c.subscriptionId ||
              current.productId !== c.productId ||
              current.maintenanceWindowId !== c.maintenanceWindowId
            )
              return null;
            const result = await this.repo.update(
              c.subscriptionId,
              before,
              {
                status: "suspended",
                autoRenew: false,
                operatorType: "system",
                operatorRemark: `product maintenance window ${current.maintenanceWindowId}`,
                expectedStatus: c.status,
              },
              client,
            );
            if (!result) return null;
            await this.repo.openSuspension(
              {
                subscriptionId: c.subscriptionId,
                tenantId: before.tenantId,
                reason: "platform_ops",
                extendsTerm: SUSPENSION_REASON_EXTENDS_TERM.platform_ops,
                autoRenewBefore: before.autoRenew,
                expectedResumeAt: current.maintenanceUntil,
                actorType: "system",
                maintenanceWindowId: current.maintenanceWindowId,
              },
              client,
            );
            await this.applyTransitionHooks(
              `maintenance:${c.subscriptionId}`,
              c.subscriptionId,
              before,
              result,
              client,
            );
            return current;
          },
        );
        if (!committed) continue;
        suspended += 1;
        await this.emit(
          `maintenance suspended ${c.subscriptionId}`,
          async () => {
            const d = await this.repo.getNotifyDisplay(c.subscriptionId);
            return d
              ? this.maintenancePauseNotice(d, committed.maintenanceUntil)
              : null;
          },
        );
      } catch (err) {
        this.logger.error(
          `product maintenance: subscription ${c.subscriptionId} failed to suspend — ${String(err)}`,
        );
      }
    }

    // 2. 出窗口
    const releases = await this.repo.findMaintenanceReleases();
    for (const r of releases) {
      try {
        const committed = await this.repo.withLockedSubscription(
          r.subscriptionId,
          async (before, client) => {
            if (!before)
              throw new NotFoundException(`订阅 ${r.subscriptionId} 不存在`);
            if (before.status !== "suspended") return null;
            const current = (
              await this.repo.findMaintenanceReleases(1, client, {
                subscriptionId: r.subscriptionId,
                episodeId: r.id,
              })
            ).find(
              (candidate) =>
                candidate.id === r.id &&
                candidate.subscriptionId === r.subscriptionId,
            );
            if (
              !current ||
              current.id !== r.id ||
              current.maintenanceWindowId !== r.maintenanceWindowId
            )
              return null;
            const result = await this.repo.update(
              r.subscriptionId,
              before,
              {
                status: "active",
                ...(current.autoRenewBefore === null
                  ? {}
                  : { autoRenew: current.autoRenewBefore }),
                operatorType: "system",
                operatorRemark: `product maintenance window ${current.maintenanceWindowId} ended — resumed`,
                expectedStatus: "suspended",
              },
              client,
            );
            if (!result) return null;
            await this.repo.closeSuspension(
              r.subscriptionId,
              client,
              current.id,
            );
            const terms = await this.settleSuspensionTerms(result, client);
            await this.applyTransitionHooks(
              `maintenance-release:${r.subscriptionId}`,
              r.subscriptionId,
              before,
              terms.after,
              client,
            );
            return terms;
          },
        );
        if (!committed) continue;
        this.logUnappliedSuspensions(committed.settled);
        resumed += 1;
        await this.emit(`maintenance resumed ${r.subscriptionId}`, async () => {
          const d = await this.repo.getNotifyDisplay(r.subscriptionId);
          return d ? this.subscriptionNotice("subscription.resumed", d) : null;
        });
      } catch (err) {
        this.logger.error(
          `product maintenance: subscription ${r.subscriptionId} failed to resume — ${String(err)}`,
        );
      }
    }

    /* 3. 顺延同步：一条 UPDATE，自己的失败自己记，不影响前两段已生效的结果。
       改完**要告诉客户**：预计恢复时间是对他的承诺，承诺变了而当事人不知道，是这一段此前
       缺的那一半。不另立模板——发的还是第 1 段那条，只是带着新日期；去重锚含预计恢复日期，
       所以哪怕这段被重复执行，同一个日子也只会落一条（收件箱唯一键 do nothing）。
       **为什么这里必须自己发**：第 1 段的候选查询排除「有未闭合 episode」的订阅，所以已经
       停着的行永远不会再被它扫到——与「即将到期」那条每趟重扫同一批行不同，光有去重锚的
       粒度不会自己再发一条。单行的发信失败由 `emit` 自己吞掉，不影响 synced 计数。 */
    let synced = 0;
    try {
      const shifted = await this.repo.syncMaintenanceExpectedResume();
      synced = shifted.length;
      for (const s of shifted) {
        // 窗口还打着而 maintenance_until 被清空：没有日子可承诺，不发一条写着「—」的信。
        if (!s.expectedResumeAt) continue;
        const resumeAt = s.expectedResumeAt;
        await this.emit(
          `maintenance resume shifted ${s.subscriptionId}`,
          async () => {
            const d = await this.repo.getNotifyDisplay(s.subscriptionId);
            return d ? this.maintenancePauseNotice(d, resumeAt) : null;
          },
        );
      }
    } catch (err) {
      this.logger.error(
        `product maintenance: expected-resume sync failed — ${String(err)}`,
      );
    }

    return { suspended, resumed, synced };
  }

  /**
   * 「即将到期」这一档的写入方（S6，2026-09-25 补）。
   *
   * 到期提醒的邮件一直在发，**状态却从来没人写**：`expiring` 在值域里、被多处查询读，
   * 全仓零写入方。客户收到一封信，回到页面上看到的还是「服务中」。
   *
   * 不新建作业也不新写谓词：`findExpiringSoon` 的条件本来就是这一档的闸门（自动续费
   * 关着 + 非试用 + 非永久 + leadDays 内到期）。只从 `active` CAS 过去——`overdue` 是更强
   * 的陈述（钱已经晚了），不能被这一档盖掉；已是 `expiring` 的行 CAS 不命中，天然幂等。
   *
   * 返回 { notified, marked }：通知条数与真正改了状态的条数不是一回事（窗口内每趟都会
   * 扫到同一批行，通知靠 dispatcher 按订阅 × 到期日去重，状态则只在第一趟改一次）。
   */
  async notifyExpiringSoon(
    leadDays: number,
    limit = 200,
  ): Promise<{ notified: number; marked: number }> {
    if (!this.notifier) return { notified: 0, marked: 0 };
    const rows = await this.repo.findExpiringSoon(leadDays, limit);
    let notified = 0;
    let marked = 0;
    for (const r of rows) {
      if (r.status === "active") {
        if (!(await this.markExpiring(r.id, r.endAt))) continue;
        marked += 1;
      }
      const days = Math.max(
        0,
        Math.ceil((r.endAt.getTime() - Date.now()) / 86_400_000),
      );
      const ok = await this.emit(`expiring_soon ${r.id}`, async () =>
        this.subscriptionNotice("subscription.expiring_soon", r, { days }),
      );
      if (ok) notified += 1;
    }
    return { notified, marked };
  }

  /**
   * 运营代客动作的通知（2026-09-25 冻结 / 恢复；2026-09-28 收尾补上续期）。
   *
   * 这三个动作今天走的是 admin-bff 里那条裸 SQL 事务（`subscriptions.router`），不经本
   * service，所以拿不到 `updateSubscription` 的写完成尾。客户那边的后果是：服务被停了，
   * 不知道为什么、不知道找谁；恢复了也不知道；**代客续期同样一句话都收不到**，而自助
   * 续费与自动续费两条路一直在发。这里只补「告诉客户」那一半——事务提交后调用，发不
   * 出去只记日志（`emit` 吞异常）：运营动作已经生效，通知失败不该让那个请求失败，更
   * 不该回滚它。
   *
   * 把那条写路径整体搬进 service（顺带拿到 transition hooks 与退订结算）是批 4 的事：
   * 那一批必须动它，改动与风险才配得上。
   */
  async notifyOperatorStatusChange(
    subscriptionId: string,
    action: OperatorSubscriptionAction,
  ): Promise<void> {
    await this.emit(`${action} ${subscriptionId}`, async () => {
      const d = await this.repo.getNotifyDisplay(subscriptionId);
      if (!d) return null;
      /* 续期而**没有新的到期日**：只可能是 perpetual 周期（那条 UPDATE 的 end_at 分支
         明确跳过它），这一次续期没有挪动任何一个日子。「新周期至 —」不是一句话，宁可
         不发；冻结 / 恢复两档不受此限——它们说的是服务在不在，与到期日无关。 */
      if (action === "renewed" && d.endAt === null) return null;
      return this.subscriptionNotice(OPERATOR_ACTION_TEMPLATE[action], d);
    });
  }

  /**
   * Complete an external SQL writer using the same lifecycle and outbox hooks.
   * Caller transactions retain ownership of commit/rollback/release; required
   * compensation, reanchoring and product enqueue failures abort that transaction.
   * Legacy callers without a transaction retain their best-effort behavior.
   * @param id - Subscription already locked and updated by the external writer.
   * @param before - Locked pre-write state, including the term when available.
   * @param transaction - Existing business transaction; never opened here.
   * @param options - Tail work required by the caller's actual transition.
   * @returns Resolves after the required database work completes.
   * @throws {Error} When required work fails within a caller transaction.
   */
  async applyExternalStatusChange(
    id: string,
    before: Pick<SubscriptionRecord, "status" | "planVersionId"> &
      Partial<Pick<SubscriptionRecord, "endAt">>,
    transaction?: PoolClient,
    options: { settleSuspensionId?: string; reanchorPools?: boolean } = {},
  ): Promise<void> {
    const complete = async () => {
      let after = await this.getSubscription(id, transaction);
      if (transaction && options.settleSuspensionId) {
        after = (
          await this.settleSuspensionTerms(after, transaction, [
            options.settleSuspensionId,
          ])
        ).after;
      }
      if (transaction && options.reanchorPools) {
        await this.repo.reanchorPeriodicPools(id, transaction);
      }
      await this.applyTransitionHooks(
        `external:${id}`,
        id,
        before,
        after,
        transaction,
      );
    };
    if (transaction) {
      await complete();
      return;
    }
    try {
      await complete();
    } catch (err) {
      this.logger.error(
        `external status change hooks failed for ${id} — ${String(err)}`,
      );
    }
  }

  /** Mark the scanned term and persist its invalidation before sending a reminder. */
  private async markExpiring(
    id: string,
    expectedEndAt: Date,
  ): Promise<boolean> {
    try {
      return await this.repo.withLockedSubscription(
        id,
        async (before, client) => {
          if (!before) throw new NotFoundException(`订阅 ${id} 不存在`);
          if (
            before.status !== "active" ||
            before.autoRenew ||
            before.subscriptionKind === "trial" ||
            before.cycleType === "perpetual"
          )
            return false;
          const result = await this.repo.update(
            id,
            before,
            {
              status: "expiring",
              operatorType: "system",
              operatorRemark:
                "entered expiry notice window (renewal reminder pass)",
              expectedStatus: "active",
              expectedEndAt,
            },
            client,
          );
          if (!result) return false;
          await this.applyTransitionHooks(
            `expiring:${id}`,
            id,
            before,
            result,
            client,
          );
          return true;
        },
      );
    } catch (err) {
      this.logger.error(`mark expiring: ${id} failed — ${String(err)}`);
      return false;
    }
  }

  /**
   * 「欠费宽限」这一档的写入方（S8，2026-09-25 补）。
   *
   * 现状是：自动续费的单没在到期前付上，到期当天服务直接终止——3 天宽限只存在于续费单的
   * TTL 里，服务侧不认。行业里这一档（Stripe `past_due` / 阿里云「欠费中」）的意思是
   * **服务还在、钱没到**，催款与多轮提醒都在它里面做。
   *
   * 权益不变（`overdue` 仍在 live 唯一索引的集合里），只是把状态说清楚并通知客户。宽限
   * 窗与 `findExpiredSubscriptionIds` 的排除条件是同一个谓词的两面，必须收同一个
   * graceDays——作业里一处取值传两处。
   */
  async markOverdue(graceDays: number, limit = 100): Promise<number> {
    const rows = await this.repo.findOverdueCandidates(graceDays, limit);
    let marked = 0;
    for (const r of rows) {
      try {
        const changed = await this.repo.withLockedSubscription(
          r.id,
          async (before, client) => {
            if (!before) throw new NotFoundException(`订阅 ${r.id} 不存在`);
            if (
              before.status !== r.status ||
              !before.autoRenew ||
              before.subscriptionKind === "trial"
            )
              return false;
            const result = await this.repo.update(
              r.id,
              before,
              {
                status: "overdue",
                operatorType: "system",
                operatorRemark:
                  "renewal order unpaid past period end (grace window)",
                expectedStatus: r.status,
                expectedEndAt: r.endAt,
              },
              client,
            );
            if (!result) return false;
            await this.applyTransitionHooks(
              `overdue:${r.id}`,
              r.id,
              before,
              result,
              client,
            );
            return true;
          },
        );
        if (!changed) continue;
        marked += 1;
        await this.emit(`overdue ${r.id}`, async () =>
          this.subscriptionNotice("subscription.overdue", r, {
            payBy: formatNotifyDate(
              r.endAt
                ? new Date(r.endAt.getTime() + graceDays * 86_400_000)
                : null,
            ),
          }),
        );
      } catch (err) {
        this.logger.error(
          `mark overdue: subscription ${r.id} failed — ${String(err)}`,
        );
      }
    }
    return marked;
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
    client?: PoolClient,
  ): Promise<void> {
    return this.assertNoTierConflict(
      workspaceId,
      planVersionId,
      excludeSubscriptionId,
      client,
    );
  }

  /**
   * 上一次履约中断后遗留的、还没被任何订单认领的在用订阅（2026-09-07 事故）。
   * OrderService.fulfill 的 new 分支用它做幂等：有就认领，不再新建。
   */
  findUnclaimedLiveForProduct(
    workspaceId: string,
    planVersionId: string,
    transaction?: PoolClient,
  ): Promise<SubscriptionRecord | null> {
    return this.repo.findUnclaimedLiveForProduct(
      workspaceId,
      planVersionId,
      transaction,
    );
  }

  private async assertNoTierConflict(
    workspaceId: string,
    planVersionId: string,
    excludeSubscriptionId?: string,
    client?: PoolClient,
  ): Promise<void> {
    const conflicts = await this.repo.findTierConflicts(
      workspaceId,
      planVersionId,
      excludeSubscriptionId,
      ...(client ? [client] : []),
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
    transaction?: PoolClient,
  ): Promise<void> {
    const products = await this.repo.listVersionProducts(
      planVersionId,
      ...(transaction ? [transaction] : []),
    );
    for (const p of products) {
      await this.provisioning.onSubscriptionActivated(
        {
          workspaceId: sub.workspaceId,
          tenantId: sub.tenantId,
          applicationId: p.productId,
          appCode: p.productCode,
          plan: p.planCode,
        },
        ...(transaction ? [transaction] : []),
      );
    }
  }

  /** tenant.deprovisioned for each product with no surviving coverage. */
  private async fireDeprovisionIfUncovered(
    sub: SubscriptionRecord,
    planVersionId: string,
    transaction?: PoolClient,
  ): Promise<void> {
    const products = await this.repo.listVersionProducts(
      planVersionId,
      ...(transaction ? [transaction] : []),
    );
    for (const p of products) {
      const covered = await this.repo.hasOtherActiveCoverage(
        sub.workspaceId,
        p.productId,
        sub.id,
        ...(transaction ? [transaction] : []),
      );
      if (covered) continue;
      await this.provisioning.onSubscriptionDeactivated(
        {
          workspaceId: sub.workspaceId,
          tenantId: sub.tenantId,
          applicationId: p.productId,
          appCode: p.productCode,
        },
        ...(transaction ? [transaction] : []),
      );
    }
  }

  /** Version change: provision the new set, deprovision-check products dropped. */
  private async fireVersionChange(
    sub: SubscriptionRecord,
    oldPlanVersionId: string,
    transaction?: PoolClient,
  ): Promise<void> {
    // 同一个缺口的第二处（2026-10-03）：这道门同时守着**两个方向** —— 下面既发新版本
    // 那批的 provisioned，也撤掉被移除产品的开通。原先判 ACTIVATED，于是一条处在
    // expiring / overdue / suspended 的订阅换版本时，两个方向一个信号都不发：
    // 被移除的产品在产品侧永远留着。改判 heldCoverage —— 这几档仍占着产品，
    // 换版本该发的就得发。
    if (!heldCoverage(sub.status)) return;
    await this.fireProvisioned(sub, sub.planVersionId, transaction);
    const [oldProducts, newProducts] = await Promise.all([
      this.repo.listVersionProducts(
        oldPlanVersionId,
        ...(transaction ? [transaction] : []),
      ),
      this.repo.listVersionProducts(
        sub.planVersionId,
        ...(transaction ? [transaction] : []),
      ),
    ]);
    const kept = new Set(newProducts.map((p) => p.productId));
    for (const p of oldProducts) {
      if (kept.has(p.productId)) continue;
      const covered = await this.repo.hasOtherActiveCoverage(
        sub.workspaceId,
        p.productId,
        sub.id,
        ...(transaction ? [transaction] : []),
      );
      if (covered) continue;
      await this.provisioning.onSubscriptionDeactivated(
        {
          workspaceId: sub.workspaceId,
          tenantId: sub.tenantId,
          applicationId: p.productId,
          appCode: p.productCode,
        },
        ...(transaction ? [transaction] : []),
      );
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
    transaction?: PoolClient,
  ): Promise<void> {
    const changeId = randomUUID();
    const seen = new Set<string>();
    for (const versionId of new Set(planVersionIds)) {
      const products = await this.repo.listVersionProducts(
        versionId,
        ...(transaction ? [transaction] : []),
      );
      for (const p of products) {
        if (seen.has(p.productId)) continue;
        seen.add(p.productId);
        await this.provisioning.enqueueEvent(
          {
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
          },
          ...(transaction ? [transaction] : []),
        );
      }
    }
  }

  /** Generic update: derive events from the status/version transition. */
  private async fireStatusTransition(
    /* 同 applyTransitionHooks：这里只读状态与版本两件事，签名照实写。 */
    before: Pick<SubscriptionRecord, "status" | "planVersionId">,
    after: SubscriptionRecord,
    transaction?: PoolClient,
  ): Promise<void> {
    if (before.planVersionId !== after.planVersionId) {
      await this.fireVersionChange(after, before.planVersionId, transaction);
      return;
    }
    const isActive = ACTIVATED.has(after.status);
    if (!ACTIVATED.has(before.status) && isActive) {
      await this.fireProvisioned(after, after.planVersionId, transaction);
    } else if (heldCoverage(before.status) && DEACTIVATED.has(after.status)) {
      // 判据是 heldCoverage 不是 ACTIVATED：经 expiring / overdue / suspended
      // 走到终态的那些订阅，before 不在 ACTIVATED 里，此前一个信号都不发。
      await this.fireDeprovisionIfUncovered(
        after,
        after.planVersionId,
        transaction,
      );
    }
  }
}
