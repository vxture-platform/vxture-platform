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

export const NOTIFICATION_TOPICS = [
  "account",
  "security",
  "subscription",
  "billing",
  "usage",
  "product",
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

function defaults(): NotificationPreferences {
  return Object.fromEntries(
    NOTIFICATION_TOPICS.map((topic) => [topic, { ...DEFAULT_CHANNELS }]),
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
