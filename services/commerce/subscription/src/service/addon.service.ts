import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PgAddonRepository } from "../repository/pg-addon.repository";
import {
  addonActivatedNotice,
  addonLifecycleNotice,
  classifyAddonPool,
  type AddonLifecycleWindow,
} from "./addon-lifecycle";
import type {
  CustomerNotifier,
  CustomerNotifyInput,
} from "./customer-notifier";
import type {
  AddonPackRecord,
  AddonPurchaseRecord,
  CreateAddonOrderInput,
  DeclareAddonPaymentInput,
} from "../types/addon.types";

/**
 * Addon pack purchase orchestration (加油包自助购买闭环, owner 2026-08-20).
 * Thin layer over PgAddonRepository: maps the repo's coded errors to HTTP
 * exceptions and logs settlement outcomes. Business shape (order → offline
 * declare → operator confirm → WS-level pool grant) lives in the repository's
 * transactions; the TTL sweep is driven by platform-api's payment-expiry job.
 *
 * 2026-09-28 批 5：客户通知四条（开通 / 即将到期 / 已用尽 / 已过期）。开通那条挂在
 * confirmPayment 的成功尾上；另外三条没有写入方可挂，走 sweepAddonLifecycle 巡检，
 * 由 platform-api 的 addon-lifecycle 作业驱动。判据全在 addon-lifecycle.ts。
 */
/* 与仓储那侧的默认 limit 同值（findLifecycleCandidates）。两处各写一个数字
   会让「满了」的判据静默跑偏，所以用例钉着两边相等。 */
const DEFAULT_LIFECYCLE_LIMIT = 200;

@Injectable()
export class AddonService {
  private readonly logger = new Logger(AddonService.name);

  // 显式令牌：bff 打包（esbuild）不产装饰器元数据，隐式构造器类型会静默注入 undefined。
  constructor(
    @Inject(PgAddonRepository) private readonly repo: PgAddonRepository,
  ) {}

  /** 客户通知（2026-09-28 批 5）：装配处 setCustomerNotifier 注入；未注入 = 不发。 */
  private notifier: CustomerNotifier | null = null;

  setCustomerNotifier(notifier: CustomerNotifier | null): void {
    this.notifier = notifier;
  }

  /**
   * 通知一律 best-effort：业务写已提交，通知失败只记日志、不回滚不抛。
   * build 延迟求值——未注入 notifier 时连展示数据都不查。
   * 与 subscription.service / order.service 的 emit 同形，这条纪律不该有第三种写法。
   */
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

  async listPacks(): Promise<AddonPackRecord[]> {
    return this.repo.listPacks();
  }

  async listPurchases(workspaceId: string): Promise<AddonPurchaseRecord[]> {
    return this.repo.listPurchases(workspaceId);
  }

  async listPendingOps(): Promise<AddonPurchaseRecord[]> {
    return this.repo.listPendingOps();
  }

  async getByOrderNo(orderNo: string): Promise<AddonPurchaseRecord | null> {
    return this.repo.getByOrderNo(orderNo);
  }

  async createOrder(
    input: CreateAddonOrderInput,
  ): Promise<AddonPurchaseRecord> {
    try {
      const record = await this.repo.createOrder(input);
      this.logger.log(
        `addon order placed: ${record.orderNo} (${record.packCode}, ws ${record.workspaceId})`,
      );
      return record;
    } catch (err) {
      throw this.mapError(err);
    }
  }

  async declarePayment(input: DeclareAddonPaymentInput): Promise<void> {
    try {
      await this.repo.declarePayment(input);
    } catch (err) {
      throw this.mapError(err);
    }
  }

  async cancelOrder(input: {
    orderNo: string;
    tenantId: string;
    reason: string;
  }): Promise<void> {
    try {
      await this.repo.cancelOrder(input);
    } catch (err) {
      throw this.mapError(err);
    }
  }

  /** Operator settlement; null = already settled (re-drive no-op). */
  async confirmPayment(input: {
    purchaseId: string;
    operatorId: string | null;
    remark?: string;
  }): Promise<AddonPurchaseRecord | null> {
    try {
      const record = await this.repo.confirmPayment(input);
      if (record) {
        this.logger.log(
          `addon order settled: ${record.orderNo} → pool ${record.quotaPoolId} (${record.metricKey} +${record.amount})`,
        );
        /*
         * 开通通知（2026-09-28 批 5）。`record` 为 null = CAS 说「已经结算过了」，
         * 那一次不是一次真的转移，重驱动不许再发一封。
         *
         * 到期日不在 `record` 上（重新读回来的那张单没有池的到期时刻），所以走
         * getNotifyDisplay 专门取一次——文案要说清「这份量能用到哪天」。
         */
        await this.emit(`addon activated ${record.orderNo}`, async () => {
          const d = await this.repo.getNotifyDisplay(record.id);
          return d ? addonActivatedNotice(d) : null;
        });
      }
      return record;
    } catch (err) {
      throw this.mapError(err);
    }
  }

  async sweepExpiredOrders(fallbackTtlMinutes: number): Promise<number> {
    return this.repo.sweepExpiredOrders(fallbackTtlMinutes);
  }

  /**
   * 加油包生命周期巡检（2026-09-28 批 5）：即将到期 / 已用尽 / 已过期三档客户通知。
   *
   * 三档都没有写入方可挂——加油包池上没有「状态」这根轴，量用光了、时间到了都只是
   * 事实的自然后果，没有任何一次写操作可以搭。所以走巡检，与订阅「即将到期」同一形状：
   * **每趟重扫同一批行**，去重只靠客户收件箱那个唯一键
   * （account_id, template_code, reference_type, reference_id，dispatcher 上
   * on conflict do nothing）。不新建状态列、不新建去重表。
   *
   * 判据在 classifyAddonPool 一处（含存量闸门与 gauge 排除），本方法只负责发与计数。
   * 单行失败不中断（emit 自己吞），返回每一档**真的发出去**的条数。
   */
  async sweepAddonLifecycle(
    window: AddonLifecycleWindow & { limit?: number },
  ): Promise<{
    expiringSoon: number;
    exhausted: number;
    expired: number;
    saturated: boolean;
  }> {
    const counts = {
      expiringSoon: 0,
      exhausted: 0,
      expired: 0,
      saturated: false,
    };
    /* 没注入 notifier 就连查都不查：这一趟除了发通知不做别的事。 */
    if (!this.notifier) return counts;
    const rows = await this.repo.findLifecycleCandidates({
      leadDays: window.leadDays,
      backlogDays: window.backlogDays,
      ...(window.limit === undefined ? {} : { limit: window.limit }),
    });
    /* 一趟之内用同一个「现在」：跨行取 now() 会让闸门与天数在同一趟里两个口径。 */
    const now = new Date();
    for (const row of rows) {
      const kind = classifyAddonPool(row, window, now);
      if (!kind) continue;
      const ok = await this.emit(`addon ${kind} ${row.orderNo}`, async () =>
        addonLifecycleNotice(kind, row, now),
      );
      if (!ok) continue;
      if (kind === "expiring_soon") counts.expiringSoon += 1;
      else if (kind === "exhausted") counts.exhausted += 1;
      else counts.expired += 1;
    }
    /*
     * 取数到上限要出声。查询按到期日升序截前 N 条，没有游标：真的满了的那一趟
     * 会把同一批头部行反复重扫，尾巴要等头部滑出回看窗才转得到——而它**不报错**，
     * 只是静默少发。没有这一位的话，一趟饱和在日志与心跳里长得跟一趟繁忙一模一样。
     * 只报「满了」不自己翻页：翻页要游标，而谁来翻是下一件事。
     */
    counts.saturated = rows.length >= (window.limit ?? DEFAULT_LIFECYCLE_LIMIT);
    if (counts.saturated) {
      this.logger.warn(
        `addon lifecycle: candidate query hit its cap (${rows.length}) — ` +
          `the tail of this pass was not examined`,
      );
    }
    return counts;
  }

  private mapError(err: unknown): Error {
    const code = err instanceof Error ? err.message : "";
    switch (code) {
      case "addon_pack_not_found":
        return new NotFoundException("加油包不存在或已下架");
      case "addon_order_not_found":
        return new NotFoundException("加油包订单不存在");
      case "addon_order_already_pending":
        return new ConflictException(
          "该加油包已有待支付订单,请先完成或取消原订单",
        );
      case "addon_order_not_pending":
        return new ConflictException("订单不是待支付状态");
      default:
        return err instanceof Error ? err : new Error(String(err));
    }
  }
}
