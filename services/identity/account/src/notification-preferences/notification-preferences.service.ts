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
 * 13 个主题，**前 10 个有模板已经在发**，后 3 个的事件源都已存在（各自的状态机或
 * webhook 事件类型跑着），只是通知模板还没接：这些在界面上挂「开发中」标并**禁用三个
 * 渠道开关**，不给假开关。
 *
 * 2026-09-28 批 5：`verification_result` 与 `quota_alert` 从后一段挪到前一段——本批给
 * 它们接上了模板（企业认证通过 / 驳回；加油包额度用尽）。**这两半必须同时动**：模板上线
 * 而开关还禁着，客户就收得到一封关不掉的信，比不发更糟。
 *
 * 2026-09-29：`member_invitation` 也挪到前一段。它此前是「开发中」段里**故意留着**的一条
 * （下面 PLANNED 那张表的旧表头记着 owner 2026-09-09 的理由），因为它当时只有一条模板而
 * 那条是 mandatory 的。本次把邀请的四个终态（接受 / 拒绝 / 撤回 / 过期）接上了模板，四条
 * 都是可选周知，开关于是有了真正的作用对象。那条 mandatory 的仍然不许变成可开关的——
 * 见下面 `LOCKED` 对这个主题的说明。
 *
 * 2026-09-29（owner 看过那一页之后当天再裁定）：**邀请拆成两个主题**。
 * `member_invitation` 只留强制那一条（`tenant.invitation`，站内恒锁），四个终态另立
 * `invitation_activity`，三个渠道全部可开关。
 * 理由是**两件事性质不同**：一个**是**邀请本身，关掉它等于让邀请派不出去；另一个是周知，
 * 客户嫌吵就该能关。而这张矩阵的粒度只有「主题 × 渠道」——两者同住一行时，站内那一档为了
 * 保住邀请本身必须锁死，四条周知的站内档就跟着关不掉，客户被迫在「收得到邀请」与「别吵我」
 * 之间二选一。拆开之后两件事各有自己的开关。
 *
 * 顺序即页面顺序（平铺，不分组；console 的 NotificationsPage 那份手写清单同序）。
 */
export const NOTIFICATION_TOPICS = [
  // ── 已有模板 ──────────────────────────────────────────────────────────────
  "subscription_expiry", // subscription.expiring_soon / expired / renewed
  "provision_result", // order.fulfilled
  "payment_due", // order.renewal_created
  "refund_progress", // refund.requested / approved / rejected / completed
  "announcement", // announcement.published
  // owner 2026-09-09:补上「订单最后怎么样了」与「租户升为组织」两类。
  // 三条订单事件同一个主题——它们回答同一个问题;不塞进 payment_due(「有单要付」)
  // 或 provision_result(「开通了吗」),那会让那两个开关名不副实。
  "order_status", // order.payment_declared / cancelled / expired
  "tenant_change", // tenant.converted
  // 2026-09-28 批 5 接上模板的两个（此前有位无模板，界面标「开发中」）。
  "verification_result", // tenant.verification_approved / rejected
  // 本批只接了「加油包额度用尽」这一条；provisioning webhook 的 quota_warning
  // （订阅池告警）仍然零模板——同一个主题下缺的那半，不是这一批的范围。
  "quota_alert", // addon.exhausted
  // 2026-09-29 接上四个终态后移出「开发中」；同日 owner 又把它**拆成两行**（见文件头最后
  // 一段）。这一行只剩强制那一条——站内那条消息**就是**邀请本身，所以站内恒锁（见 LOCKED）。
  "member_invitation", // tenant.invitation（仅此一条，mandatory + inboxOnly）
  // 四个终态的周知。**紧跟在成员邀请后面**就是页面顺序：两行相邻，客户才看得出差别在哪。
  // 不进 LOCKED：这四条没有一条是「送达手段本身」，嫌吵就该能整条关掉。
  "invitation_activity", // tenant.invitation_accepted / _declined / _revoked / _expired
  // ── 事件源已存在、模板待接（界面标「开发中」）────────────────────────────
  "security", // 站内强制锁定；异地登录/凭据变更等
  "invoice_progress", // billing.invoice_receipts 六态
  "ticket_activity", // support.tickets 七态
] as const;

/**
 * 事件源已存在但通知模板未接：界面上标「开发中」并禁用三个渠道开关。
 *
 * 2026-09-28 批 5 移出两个：`verification_result`（企业认证通过 / 驳回）与 `quota_alert`
 * （加油包额度用尽）的模板本批上线，开关必须同时放开——否则客户收得到却关不掉。
 *
 * 2026-09-29 移出 `member_invitation`。owner 2026-09-09 当初把它**故意**留在这里，理由是
 * 它下面唯一那条模板（`tenant.invitation`）是 `mandatory` 的——站内这条消息**就是**邀请
 * 本身，关掉它邀请人会收到「已送达对方账号」而对方那边什么也没有；那条裁定还写着「等
 * accepted / declined / revoked 三态的模板接上，再把它挪出去」。本次连 expired 一共接上
 * 四条可选周知，所以移出。**那条裁定的实质没有失效**：mandatory 那条仍然不许变成可开关
 * 的，守住它的是 `LOCKED` 里这个主题的站内档 + dispatcher 的 mandatory 短路（见下）。
 *
 * 剩下三个是事件源在、模板未接：`security` / `invoice_progress` / `ticket_activity`。
 */
export const NOTIFICATION_TOPICS_PLANNED = [
  "security",
  "invoice_progress",
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
 * 不可关闭的通道。由服务端强制而不是靠前端把开关画成 disabled——前端画不画是可以绕过的。
 * 今天有两条各自成立的理由住在这张表里：
 *
 *  · `security`（安全兜底）——异地登录、凭据变更必须至少有一个到达路径，否则账号被接管时
 *    用户无从得知。这不是产品偏好。
 *  · `member_invitation`（**这条消息本身就是送达手段**）——2026-09-29 拆分之后，这个主题
 *    下**只剩一条**模板：`tenant.invitation`，`mandatory` + `inboxOnly`。
 *      站内 —— 锁定为开。邀请本身走的就是站内，关掉它邀请人会收到「已送达对方账号」而
 *              对方那边什么也没有（owner 2026-09-09）。让这一档可关，界面就会出现「未订阅」
 *              而邀请照样进收件箱的假象，而那一页的抬头写着「站内消息始终可查」。
 *      邮件 / 短信 —— 不锁（owner 2026-09-29：站内恒锁、邮件短信可开关）。但邀请本身是
 *              `inboxOnly` 的（call site 见 console-bff 的 `notifyInviteeInApp`，前端明说了
 *              「不发邮件」），这两档今天没有作用对象，所以**默认关**——见
 *              `TOPIC_DEFAULT_OVERRIDES` 那段。
 *
 * **`invitation_activity` 故意不在这张表里**（拆分的全部意义就在这里）。四个终态的周知没有
 * 一条是「送达手段本身」：客户把三个渠道全关掉，也不会让任何人少收到一条邀请——
 * accepted / declined / expired 的收件人是邀请人自己，revoked 的收件人是被邀请人自己，
 * 关掉的是发给**自己**的那份周知。2026-09-29 拆分之前这四条与邀请本身同住一行，于是被上面
 * 那条站内锁连带锁住，客户只能二选一。
 *
 *    真正兜住「关不掉邀请本身」的不是这张表，是 dispatcher 里
 *    `!input.mandatory && !(await this.allows(...))` 这个短路：偏好即使全关，mandatory 那条
 *    照样落库。那一条有**跑分发器**的用例（templates.spec.ts 末尾一组），不是一句注释。
 */
const LOCKED: Partial<Record<NotificationTopic, NotificationChannel[]>> = {
  security: ["inbox"],
  member_invitation: ["inbox"],
};

/**
 * 主题级默认覆盖。**事务性**通知默认开邮件（owner 2026-09-03「通知先做站内 + 邮件」）：
 * 不发邮件用户会错过付款期与到期。其余主题默认关——默认开外发通道等于替用户同意打扰。
 *
 * 2026-09-08 主题重排后，原「订阅」「账单」两档拆成了四个，事务性的判据不变：
 * 到期提醒、开通结果、待付订单、退款进度——**错过了会有实际损失**的那几件。
 * 公告与仍标「开发中」的那三个都不属于此列。
 */
const TOPIC_DEFAULT_OVERRIDES: Partial<
  Record<NotificationTopic, Partial<NotificationChannelState>>
> = {
  subscription_expiry: { email: true },
  provision_result: { email: true },
  payment_due: { email: true },
  refund_progress: { email: true },
  /* 与前端 DEFAULT_NOTIFICATION_STATE 同源:两者都是事务性——错过了会误判自己的
     订单或权限状态——邮件默认开、可关。 */
  order_status: { email: true },
  tenant_change: { email: true },
  /* 2026-09-28 批 5 的两个，判据与上面六个同一条：**错过了会有实际损失**。
     认证结果——驳回了不知道，企业认证就一直卡着，订阅与开票都跟着卡；
     额度用尽——花钱买的加油包用完了不知道，业务在没有余量的情况下继续跑。
     所以跟着事务性那几个走「邮件默认开、可关」，而不是照抄它们此前在「开发中」段里
     的那一行默认值（那时候三个开关都是禁用的，默认值根本没被人选择过）。 */
  verification_result: { email: true },
  quota_alert: { email: true },
  /* 2026-09-29 拆成两个主题之后，**邀请这两行都不在这张表里**（= 邮件默认关）。两行各有
     自己的理由，不是同一条：
       `member_invitation` —— 它只剩 `tenant.invitation` 一条，而那条是 `inboxOnly` 的。
         默认打开一个**永远不会发出邮件**的开关，正是这一页改之前的老毛病：页面在说假话。
         开关本身仍然留着可点（owner 2026-09-29 的裁定），只是默认关。
       `invitation_activity` —— 四条终态是**周知**不是事务性（owner 2026-09-29 的分类）。
         这张表的判据只有一条：**错过了会有实际损失**（上面那八个，错过就误判自己的订单、
         权限、认证或余量状态）。邀请的接受 / 拒绝 / 撤回 / 过期错过了，代价是「晚一点才知道
         席位没补上」，与平台公告同一档 —— 所以照 `announcement` 走：默认只进站内，想要邮件
         的自己开。默认开外发通道等于替用户同意打扰。 */
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
