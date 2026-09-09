/**
 * NotificationPreferencesService — 用户通知偏好(主题 × 渠道)。
 * @package @vxture/service-account
 * @layer Domain
 *
 * **存在 `account.user_profiles.preferences` 里,不新建表**(owner 2026-08-21
 * 裁定决策 1 选项 A;这一点改了简报里「新建 account.notification_preferences」
 * 的判断)。理由:该列的 DDL 注释写的就是「通知开关等细粒度偏好」——schema
 * 早就指定了家,再建一张表等于让同一个概念有两个权威,违反 SQL-DDL 单一权威。
 * 顺带也免掉了 DDL / 迁移 / 列锁三处改动(`preferences` 已在 GRANT UPDATE 列表里)。
 *
 * 取舍记录:关系表在「谁订阅了 billing 的 email」这类反查上更强。但发信侧的
 * 实际形态是**先由业务事件确定收件人、再逐人问该不该发**,那是按 user_id 的
 * 点查,jsonb 正好。真出现全局反查需求时,加一个 GIN 索引即可,不必先付建表的成本。
 *
 * **服务端是默认值与合法性的权威**:返回的永远是补齐后的完整矩阵,前端不再
 * 自带一份默认值——两份默认值早晚会漂移,而漂移的症状是「换个设备看到的开关不一样」。
 */

import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { ACCOUNT_PG_POOL } from "../tokens";

/**
 * 偏好主题（owner 2026-09-08 重排）。
 *
 * 判据：**一个主题必须对应真实发生的事件**。改之前有 6 个主题，其中 `account` /
 * `security` / `usage` 三个没有任何模板会落到它们头上（见 dispatch 的 `topicOf`），
 * 客户勾了等于没勾——页面在说假话。
 *
 * 现在 11 个主题，前 5 个有模板已经在发，后 6 个的**事件源都已存在**（各自的状态机
 * 或 webhook 事件类型跑着），只是通知模板还没接：这些在界面上挂「开发中」标并**禁用
 * 三个渠道开关**，不给假开关。
 *
 * 顺序即页面顺序（平铺，不分组）。
 */
export const NOTIFICATION_TOPICS = [
  // ── 已有模板 ──────────────────────────────────────────────────────────────
  "subscription_expiry", // subscription.expiring_soon / expired / renewed
  "provision_result", // order.fulfilled
  "payment_due", // order.renewal_created
  "refund_progress", // refund.requested / approved / rejected / completed
  "announcement", // announcement.published
  // ── 事件源已存在、模板待接（界面标「开发中」）────────────────────────────
  "security", // 站内强制锁定；异地登录/凭据变更等
  "invoice_progress", // billing.invoice_receipts 六态
  "verification_result", // kyc.tenant_verifications 四态
  "member_invitation", // tenancy.invitations 四态
  "quota_alert", // provisioning webhook 的 quota_warning
  "ticket_activity", // support.tickets 七态
] as const;

/**
 * 事件源已存在但通知模板未接：界面上标「开发中」并禁用三个渠道开关。
 *
 * `member_invitation` 留在这张表里是**故意的**（owner 2026-09-09）：它下面已经有一个
 * 模板在发（`tenant.invitation`，按用户号邀请的站内送达），但那条是 `mandatory` 的——
 * 站内这条消息**就是**邀请本身，关掉它，邀请人会收到「已送达对方账号」而对方那边
 * 什么也没有。给一个按下去不起作用的开关比不给更糟。等 accepted / declined / revoked
 * 三态的模板接上（那三条是可选的周知），再把它挪出去。
 */
export const NOTIFICATION_TOPICS_PLANNED = [
  "security",
  "invoice_progress",
  "verification_result",
  "member_invitation",
  "quota_alert",
  "ticket_activity",
] as const;

export const NOTIFICATION_CHANNELS = ["inbox", "email", "sms"] as const;

export type NotificationTopic = (typeof NOTIFICATION_TOPICS)[number];
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export type NotificationChannelState = Record<NotificationChannel, boolean>;
export type NotificationPreferences = Record<
  NotificationTopic,
  NotificationChannelState
>;

/** 站内是默认通道,邮件/短信默认关——默认开外发通道等于替用户同意打扰。 */
const DEFAULT_CHANNELS: NotificationChannelState = {
  inbox: true,
  email: false,
  sms: false,
};

/**
 * 不可关闭的通道。安全类通知(异地登录、密码变更)必须至少有一个到达路径,
 * 否则账号被接管时用户无从得知——这是安全兜底,不是产品偏好,所以由服务端
 * 强制而不是靠前端把开关画成 disabled。
 */
const LOCKED: Partial<Record<NotificationTopic, NotificationChannel[]>> = {
  security: ["inbox"],
};

/**
 * 主题级默认覆盖。**事务性**通知默认开邮件（owner 2026-09-03「通知先做站内 + 邮件」）：
 * 不发邮件用户会错过付款期与到期。其余主题默认关——默认开外发通道等于替用户同意打扰。
 *
 * 2026-09-08 主题重排后，原「订阅」「账单」两档拆成了四个，事务性的判据不变：
 * 到期提醒、开通结果、待付订单、退款进度——**错过了会有实际损失**的那几件。
 * 公告与「开发中」的六个都不属于此列。
 */
const TOPIC_DEFAULT_OVERRIDES: Partial<
  Record<NotificationTopic, Partial<NotificationChannelState>>
> = {
  subscription_expiry: { email: true },
  provision_result: { email: true },
  payment_due: { email: true },
  refund_progress: { email: true },
};

function defaults(): NotificationPreferences {
  return Object.fromEntries(
    NOTIFICATION_TOPICS.map((topic) => [
      topic,
      { ...DEFAULT_CHANNELS, ...(TOPIC_DEFAULT_OVERRIDES[topic] ?? {}) },
    ]),
  ) as NotificationPreferences;
}

/**
 * 把任意来源的值(库里的旧结构、前端提交的 body)规整成完整矩阵:
 * 只认白名单里的主题与渠道、只认布尔、缺的补默认、锁定的强制为 true。
 * 未知键**丢弃**——库里存下未知主题会让「这个开关是什么」永远没人答得上来。
 */
function normalize(raw: unknown): NotificationPreferences {
  const out = defaults();
  if (raw === null || typeof raw !== "object") return out;
  const source = raw as Record<string, unknown>;

  for (const topic of NOTIFICATION_TOPICS) {
    const entry = source[topic];
    if (entry !== null && typeof entry === "object") {
      const channels = entry as Record<string, unknown>;
      for (const channel of NOTIFICATION_CHANNELS) {
        if (typeof channels[channel] === "boolean") {
          out[topic][channel] = channels[channel];
        }
      }
    }
    for (const channel of LOCKED[topic] ?? []) {
      out[topic][channel] = true;
    }
  }
  return out;
}

@Injectable()
export class NotificationPreferencesService {
  constructor(@Inject(ACCOUNT_PG_POOL) private readonly pool: Pool) {}

  /** 该用户的完整偏好矩阵。从未设置过 → 全默认(不是空对象)。 */
  async get(userId: string): Promise<NotificationPreferences> {
    const res = await this.pool.query<{ notifications: unknown }>(
      `select preferences -> 'notifications' as notifications
         from account.user_profiles
        where user_id = $1`,
      [userId],
    );
    return normalize(res.rows[0]?.notifications ?? null);
  }

  /**
   * 覆盖写。返回规整后的实际存量,调用方据此回填 UI——提交什么就显示什么
   * 会让「锁定通道被强制打开」这件事在界面上不可见。
   *
   * 只替换 `preferences` 的 `notifications` 键(`||` 顶层合并),其余键原样保留:
   * 这一列是共享的压力阀,整列覆写会静默清掉别人的数据。
   */
  async replace(
    userId: string,
    input: unknown,
  ): Promise<NotificationPreferences> {
    const next = normalize(input);
    await this.pool.query(
      `insert into account.user_profiles (user_id, preferences, created_at, updated_at)
       values ($1, jsonb_build_object('notifications', $2::jsonb), now(), now())
       on conflict (user_id) do update
          set preferences = coalesce(account.user_profiles.preferences, '{}'::jsonb)
                            || jsonb_build_object('notifications', $2::jsonb),
              updated_at = now()`,
      [userId, JSON.stringify(next)],
    );
    return next;
  }

  /**
   * 发信侧的判据:该用户在这个主题上是否接受这个渠道。
   * 站内信与外发通道将来都从这里问,不各自解释 jsonb。
   */
  async allows(
    userId: string,
    topic: NotificationTopic,
    channel: NotificationChannel,
  ): Promise<boolean> {
    const prefs = await this.get(userId);
    return prefs[topic][channel];
  }
}
