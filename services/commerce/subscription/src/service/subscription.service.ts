import { randomUUID } from "node:crypto";
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { ProvisioningService } from "@vxture/service-provisioning";
import { SUSPENSION_REASON_EXTENDS_TERM } from "@vxture-platform/shared";
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
const ACTIVATED = new Set(["active", "trialing"]);
/** Terminal statuses that trigger the per-component deprovision check. */
const DEACTIVATED = new Set(["cancelled", "expired"]);

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
  /**
   * `before` 只收它真正用到的两个字段（状态与版本）。收窄是有意的：外部写路径
   * （admin-bff 的裸 SQL 事务）只能拿到锁行时读到的那几列，给不出整条
   * `SubscriptionRecord`；把依赖写在签名上，比让调用方去凑一个假记录好。
   */
  private async applyTransitionHooks(
    hookPrefix: string,
    id: string,
    before: Pick<SubscriptionRecord, "status" | "planVersionId">,
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
    const done = await this.sweepToExpired(
      ids.map((id) => ({ id, status: "trialing" })),
      "trial expiry sweep",
      "trial ended without conversion (expiry sweep)",
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
   * 共享的"→ expired"扫描循环（trial 与付费/免费到期共用）：每行 CAS 到读到的当前状态，
   * 输了竞态的行 0 行 no-op 静默跳过；单行失败只记日志，趟不中断。
   */
  private async sweepToExpired(
    rows: { id: string; status: string }[],
    label: string,
    remark: string,
  ): Promise<{ id: string; from: string }[]> {
    const transitioned: { id: string; from: string }[] = [];
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
        // 带上「从哪一档来的」：调用方要按它决定通知发不发（冻结中到期不发）。
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

  /**
   * 顺延结算（2026-09-25 步骤三）。把已闭合但还没结算的暂停 episode 结成天数，加到订阅
   * 的 `end_at` 上。
   *
   * owner 定的三条前提里，「不做退钱」+「客户不承担暂停期间的代价」合起来就是这件事：
   * 不退钱，就把停掉的那些天还回去。还多少由那一次暂停的原因决定（`extends_term`），
   * 在暂停发生时就定了。
   *
   * 两个调用点、一段结算：运营恢复之后 admin-bff 立刻带 `subscriptionId` 调一次（客户
   * 马上就能在页面上看到新到期日），作业每趟不带参数扫一遍兜底。**幂等靠
   * `granted_seconds is null`**，所以两边同时跑也只结一次；某一次失败下一趟自愈——顺延
   * 是欠客户的账，不能静默丢。
   */
  /**
   * 暂停半态对账（只读）。详见 `PgSubscriptionRepository.countSuspensionHalfStates`。
   *
   * 这里不做任何修复动作 —— 两种半态的根治是把「改状态」与「开/闭 episode」并进一个
   * 事务，那是 `repo.update` 的事务边界重构（碰钱、调用方众多），单独一轮做。
   * 本方法只负责让它们**不再隐身**：三条恢复判据都从 episode 或 status 起算，
   * 没有一条看得见这两种形状。
   */
  async countSuspensionHalfStates(): Promise<{
    suspendedWithoutEpisode: number;
    resumedWithOpenEpisode: number;
    samples: { shape: "no_episode" | "open_episode"; subscriptionId: string }[];
  }> {
    return this.repo.countSuspensionHalfStates();
  }

  async settleSuspensionExtension(subscriptionId?: string): Promise<number> {
    try {
      const settled = await this.repo.settleResumedSuspensions(
        // exactOptionalPropertyTypes：不带 subscriptionId 时**整个键不能出现**，
        // 传 undefined 与不传在这里是两种类型。
        subscriptionId ? { subscriptionId, limit: 100 } : { limit: 100 },
      );
      for (const row of settled) {
        if (row.grantedSeconds > 0 && !row.extended) {
          // 永久订阅没有到期日可顺延。记下来而不是静默跳过：将来若要换别的补偿方式，
          // 账在 granted_seconds 里。
          this.logger.log(
            `suspension settle: subscription ${row.subscriptionId} has no end_at, ` +
              `${row.grantedSeconds}s recorded but not applied`,
          );
        }
      }
      return settled.length;
    } catch (err) {
      // 结算失败不该让恢复订阅这个动作失败（它已经生效了），下一趟作业会自愈。
      this.logger.error(`suspension settle failed — ${String(err)}`);
      return 0;
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
      const terminate = !row.extendsTerm;
      try {
        const before = await this.getSubscription(row.subscriptionId);
        if (before.status !== "suspended") continue; // moved since the scan
        // 终止不还原续费意愿（终态本来就不续）；恢复才还原，而存量 episode 的
        // auto_renew_before 为 NULL ⇒ 整个键不出现（= 不动它），不是传 undefined。
        const autoRenew = terminate ? false : row.autoRenewBefore;
        const result = await this.repo.update(row.subscriptionId, before, {
          status: terminate ? "cancelled" : "active",
          ...(autoRenew === null ? {} : { autoRenew }),
          operatorType: "system",
          operatorRemark: terminate
            ? `suspension exceeded ${maxDays} days (reason=${row.reason}) — terminated`
            : `suspension exceeded ${maxDays} days (reason=${row.reason}) — force resumed`,
          expectedStatus: "suspended",
        });
        if (!result) {
          this.logger.debug(
            `suspension deadline: subscription ${row.subscriptionId} changed under us, skipped`,
          );
          continue;
        }
        // 先闭合 episode 再结算：结算的判据是「已闭合且未结算」，顺序反了这一趟捞不到它
        // （下一趟会捞到，但客户要多等一个 tick 才看到新到期日）。
        await this.repo.closeSuspension(row.subscriptionId);
        await this.applyTransitionHooks(
          `suspension-deadline:${row.subscriptionId}`,
          row.subscriptionId,
          before,
          result,
        );
        await this.settleSuspensionExtension(row.subscriptionId);
        // 客户侧要知道：服务被停了很久之后，它是恢复了还是彻底结束了。
        await this.emit(
          `suspension deadline ${row.subscriptionId}`,
          async () => {
            const d = await this.repo.getNotifyDisplay(row.subscriptionId);
            if (!d) return null;
            return this.subscriptionNotice(
              terminate
                ? "subscription.suspension_ended"
                : "subscription.resumed",
              d,
            );
          },
        );
        if (terminate) terminated += 1;
        else resumed += 1;
      } catch (err) {
        this.logger.error(
          `suspension deadline: subscription ${row.subscriptionId} failed — ${String(err)}`,
        );
      }
    }
    return { resumed, terminated };
  }

  /**
   * 产品级维护窗口对账（2026-09-27，owner 定「窗口进行中，该产品所有已订阅租户给时间补偿，
   * 恢复后结算；个例暂停机制不变」）。
   *
   * 不在 opera-bff 的窗口事务里做：一个窗口可能挂几百条订阅，每条要 CAS、开 episode、跑
   * provisioning 钩子、发通知，那不是一笔运营请求该等的事；而且窗口期间新履约开通的订阅
   * 也要补偿——放在作业里下一 tick 自然捞到（开通即补偿），履约路径不必加钩子。
   *
   * 与 sweepOverdueSuspensions 同一条路：`repo.update` CAS + episode 开 / 闭 +
   * `applyTransitionHooks` + `settleSuspensionExtension` + 通知。三段：
   *   1. 进窗口：产品打着窗口、订阅在服务中、没有未闭合 episode → suspended，开一条
   *      reason=platform_ops（顺延由 @shared 的政策表派生，落库）、actor=system、带窗口 id
   *      的 episode，expected_resume_at = 产品上的 maintenance_until，**通知维护暂停**
   *      （`subscription.suspended_maintenance`，不是人工暂停那条）。
   *   2. 出窗口：未闭合 episode 带窗口 id、产品已不再打着同一个窗口 → active（还原暂停那
   *      一刻的 auto_renew）、闭合、结算顺延、通知恢复。
   *   3. 顺延同步：窗口 maintenance_until 变了 → 同窗口未闭合 episode 的预计恢复跟着改。
   *      **这一段不自己发通知，但延长确实会通知到客户**：第 1 段那条的去重锚带着预计恢复
   *      日期（见 `maintenancePauseNotice`），日期一变收件箱唯一键就不再命中，下一 tick
   *      同一条模板自然再发一条带新日期的。承诺的回来时间变了而当事人不知道，靠的是键的
   *      粒度而不是这里再加一个 emit——两个发信点会各自漏各自的。
   * 幂等靠判据本身（状态 + 有无未闭合 episode + 窗口 id 是否仍打在产品上），重跑不重复。
   * 运营手工暂停的（episode 没有窗口 id）不受影响；窗口期间运营手工恢复某条订阅，下一 tick
   * 会再次被暂停——产品确实还在维护，这是对的。
   *
   * 单行失败只记日志，趟不中断（同其它 sweep）。
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
        const before = await this.getSubscription(c.subscriptionId);
        if (before.status !== c.status) continue; // moved since the scan
        const result = await this.repo.update(c.subscriptionId, before, {
          status: "suspended",
          // 冻结期间不该自动续上一期（同 admin-bff 暂停那条 UPDATE）；恢复时按 episode
          // 记下的 auto_renew_before 还原。
          autoRenew: false,
          operatorType: "system",
          operatorRemark: `product maintenance window ${c.maintenanceWindowId}`,
          expectedStatus: c.status,
        });
        if (!result) {
          this.logger.debug(
            `product maintenance: subscription ${c.subscriptionId} changed under us, skipped (lost race)`,
          );
          continue;
        }
        await this.repo.openSuspension({
          subscriptionId: c.subscriptionId,
          tenantId: before.tenantId,
          reason: "platform_ops",
          extendsTerm: SUSPENSION_REASON_EXTENDS_TERM.platform_ops,
          autoRenewBefore: before.autoRenew,
          expectedResumeAt: c.maintenanceUntil,
          actorType: "system",
          maintenanceWindowId: c.maintenanceWindowId,
        });
        await this.applyTransitionHooks(
          `maintenance:${c.subscriptionId}`,
          c.subscriptionId,
          before,
          result,
        );
        /* 维护专属的那条，不是人工暂停那条：说清「为什么停 / 预计什么时候回来 / 回来
           不用你操作」，去重锚带预计恢复日期（见 maintenancePauseNotice）。
           `emit` 自己吞异常 ⇒ 通知失败不会把这条订阅算成失败、更不会中断整趟。 */
        await this.emit(
          `maintenance suspended ${c.subscriptionId}`,
          async () => {
            const d = await this.repo.getNotifyDisplay(c.subscriptionId);
            return d
              ? this.maintenancePauseNotice(d, c.maintenanceUntil)
              : null;
          },
        );
        suspended += 1;
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
        const before = await this.getSubscription(r.subscriptionId);
        if (before.status !== "suspended") continue; // moved since the scan
        // 还原暂停那一刻的续费意愿；episode 没记（null）⇒ 整个键不出现（= 不动它）。
        const result = await this.repo.update(r.subscriptionId, before, {
          status: "active",
          ...(r.autoRenewBefore === null
            ? {}
            : { autoRenew: r.autoRenewBefore }),
          operatorType: "system",
          operatorRemark: `product maintenance window ${r.maintenanceWindowId} ended — resumed`,
          expectedStatus: "suspended",
        });
        if (!result) {
          this.logger.debug(
            `product maintenance: subscription ${r.subscriptionId} changed under us, skipped (lost race)`,
          );
          continue;
        }
        // 先闭合再结算：结算的判据是「已闭合且未结算」（同到点处置）。
        await this.repo.closeSuspension(r.subscriptionId);
        await this.applyTransitionHooks(
          `maintenance-release:${r.subscriptionId}`,
          r.subscriptionId,
          before,
          result,
        );
        await this.settleSuspensionExtension(r.subscriptionId);
        await this.emit(`maintenance resumed ${r.subscriptionId}`, async () => {
          const d = await this.repo.getNotifyDisplay(r.subscriptionId);
          return d ? this.subscriptionNotice("subscription.resumed", d) : null;
        });
        resumed += 1;
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
      const days = Math.max(
        0,
        Math.ceil((r.endAt.getTime() - Date.now()) / 86_400_000),
      );
      const ok = await this.emit(`expiring_soon ${r.id}`, async () =>
        this.subscriptionNotice("subscription.expiring_soon", r, { days }),
      );
      if (ok) notified += 1;
      if (r.status === "active" && (await this.markExpiring(r.id))) marked += 1;
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
   * 外部写路径改完状态之后，补跑**与本服务同一套**写完成尾（2026-09-25 批 5）。
   *
   * 为什么需要它：admin-bff 的 `subscriptions.router` 用裸 SQL 事务改订阅状态——那条
   * 路上整个文件搜不到一处 provisioning，于是运营暂停 / 恢复 / 退订 / 续期之后：
   *   · 退订：**不发 deprovision**，产品侧从未被告知，服务可能还在给；
   *   · 暂停 / 恢复：**不失效 C2 权益缓存**，产品侧照旧看到旧状态直到 TTL 到点。
   * 客户自助那条路（走本服务）两样都做。同一件事只长在一条分支上，另一条就是洞。
   *
   * 为什么不把那条写路径整体搬进来：它的 SQL 还带着三件本服务今天表达不出来的东西
   * ——`renew` 的 `change_type='renewed'`（本服务会按状态派生成 'resumed'）、试用转付费
   * 的 `subscription_kind` 翻转、以及在库里按 `cycle_unit/cycle_count` 算 `end_at`。
   * 照搬会动到审计轨迹与周期数学，那是另一次改动；本方法只补缺的那一半：**副作用**。
   * hooks 仍然只有一份实现（`applyTransitionHooks`），不新造第二套。
   *
   * 由调用方在**事务提交之后**调；`before` 是它在事务里锁行时读到的状态与版本。
   * 内部一律 best-effort（`safeProvisioningHook` 吞异常只记日志）：运营动作已经生效，
   * 通知产品侧失败不该让那个请求失败。
   */
  async applyExternalStatusChange(
    id: string,
    before: Pick<SubscriptionRecord, "status" | "planVersionId">,
  ): Promise<void> {
    try {
      const after = await this.getSubscription(id);
      if (
        after.status === before.status &&
        after.planVersionId === before.planVersionId
      ) {
        return; // 什么都没变（幂等重放）——不必打扰产品侧
      }
      await this.applyTransitionHooks(`external:${id}`, id, before, after);
    } catch (err) {
      this.logger.error(
        `external status change hooks failed for ${id} — ${String(err)}`,
      );
    }
  }

  /** active → expiring 的单行 CAS；输了竞态返回 false，不抛。 */
  private async markExpiring(id: string): Promise<boolean> {
    try {
      const before = await this.getSubscription(id);
      if (before.status !== "active") return false;
      const result = await this.repo.update(id, before, {
        status: "expiring",
        operatorType: "system",
        operatorRemark: "entered expiry notice window (renewal reminder pass)",
        expectedStatus: "active",
      });
      if (!result) return false;
      await this.applyTransitionHooks(`expiring:${id}`, id, before, result);
      return true;
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
        const before = await this.getSubscription(r.id);
        if (before.status !== r.status) continue; // moved since the scan
        const result = await this.repo.update(r.id, before, {
          status: "overdue",
          operatorType: "system",
          operatorRemark: "renewal order unpaid past period end (grace window)",
          expectedStatus: r.status,
        });
        if (!result) continue;
        await this.applyTransitionHooks(
          `overdue:${r.id}`,
          r.id,
          before,
          result,
        );
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
  ): Promise<void> {
    return this.assertNoTierConflict(
      workspaceId,
      planVersionId,
      excludeSubscriptionId,
    );
  }

  /**
   * 上一次履约中断后遗留的、还没被任何订单认领的在用订阅（2026-09-07 事故）。
   * OrderService.fulfill 的 new 分支用它做幂等：有就认领，不再新建。
   */
  findUnclaimedLiveForProduct(
    workspaceId: string,
    planVersionId: string,
  ): Promise<SubscriptionRecord | null> {
    return this.repo.findUnclaimedLiveForProduct(workspaceId, planVersionId);
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
    /* 同 applyTransitionHooks：这里只读状态与版本两件事，签名照实写。 */
    before: Pick<SubscriptionRecord, "status" | "planVersionId">,
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
