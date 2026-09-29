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
 * 15 个主题（2026-09-29 两批拆分之后的数），**前 14 个有模板已经在发**，最后 1 个的事件源
 * 已存在（`billing.invoice_receipts` 六态跑着），只是通知模板还没接：它在界面上挂
 *「开发中」标并**禁用三个渠道开关**，不给假开关。
 * 这个数字与下面那张清单是同一份事实的两处写法；改清单时要一起改，否则注释就在说假话。
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
 * 2026-09-29（同日，工单线批 2）：`ticket_activity` 接上三条模板（运营回复 / 标记处理完成 /
 * 关闭），从「开发中」挪进前一段。与批 5 那两个主题同一条纪律：模板与开关**两半同时动**。
 *
 * 2026-09-29（同日，账号安全线）：旧的 `security` **改名成 `security_event` 并拆出
 * `login_activity`**（owner 裁定 2），两行都接上了模板、都移出「开发中」。
 * 改名而不是原地留用：这一行此前是「开发中」段里一个没有任何模板落上去的占位，名字也含糊
 * ——它同时被读成「安全事件」与「登录活动」两件事，而这两件事的开关要求正好相反。
 *
 * **改名的代价记在这里，并且已经付掉了一半**：`normalize` 丢弃未知主题，所以库里存着的旧
 * `security` 键会被丢掉、两个新主题回落成默认值——而新的默认是**邮件开**，旧那一行存的是
 * 邮件关。这件事一度被记成「无害」，理由是旧那一行三个开关在界面上全是禁用的（`planned`）。
 * 那个理由**只覆盖 2026-09-08 重排之后**：在那之前 `security` 是能点的（`planned` 这个概念
 * 是重排时才引入的），所以库里确实可能存着一个可证的选择——客户当年自己把安全邮件 / 短信
 * 打开过。而 `replace` 写回的是 `normalize` 补齐后的**完整矩阵**，所以凡存过一次偏好的账号，
 * 那一行就带着 `security` 这个键，不是「可能带」。
 * 补这一半的是 deploy/database/migrations/2026-11-24-notification-topic-security-split.sql：
 * 剥掉旧键，并把**开着的**邮件 / 短信两档搬到两个新主题上（关着的那些与「从没动过的默认值」
 * 无法区分，不搬——搬了等于替每个存量客户关掉裁定 1 要的安全邮件）。迁移写回的可能是残缺
 * 对象（如 `{ sms: true }`），`normalize` 对这种形状是现成的：缺的档按默认补齐。
 * 换成一个有真实模板的主题时，这个代价必须像这样先算过再改名，不能顺手改——而「算过」
 * 的意思包括**翻一遍那一行的历史**，不只是看它今天长什么样。
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
  // 2026-09-29 账号安全线：**两行**，紧挨着（页面顺序也是这样——两行相邻，客户才看得出
  // 差别在哪）。上面那行站内恒锁 + 邮件默认开，下面那行三档全可关。
  "security_event", // account.locked / _unlocked / sessions_ended_by_operator /
  // password_changed / password_reset / phone_changed /
  // email_changed_old / email_changed_new / identity_linked /
  // identity_unlinked / password_login_enabled / _disabled /
  // session_ended_by_self（十三条）
  "login_activity", // account.new_device_signin（仅此一条）
  // 2026-09-29 工单线：接上三条模板后移出「开发中」。**紧挨在这里**是页面顺序——它与上面
  // 两行同属「有人对我的东西做了什么」，而下面那一行仍是开发中，开发中的排在最后。
  // 不进 LOCKED：三条都是周知，客户把三档全关掉也不会让任何人少收到一条回复（回复本身在
  // 工单详情页，与「站内这条消息就是邀请本身」那种情形不同）。
  "ticket_activity", // ticket.replied / ticket.resolved / ticket.closed
  // ── 事件源已存在、模板待接（界面标「开发中」）────────────────────────────
  "invoice_progress", // billing.invoice_receipts 六态
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
 * 2026-09-29 移出 `security`（它同时改名成 `security_event` 并拆出 `login_activity`）。
 * 本批给账号安全接上了十四条模板——运营锁定 / 解锁 / 全端下线，客户自己改密码（含邮件重置
 * 令牌那条今天既不落审计也不通知的路）、改手机号、改邮箱（新旧两地址各一条）、绑解绑三方、
 * 翻密码登录开关、下线自己的设备，以及在没见过的设备上登录。**两半必须同时动**：模板上线
 * 而开关还禁着，客户就收得到一封关不掉的信，比不发更糟。
 *
 * 2026-09-29 移出 `ticket_activity`（工单线批 2）。批 1 建起写入路径之后
 * `support.tickets` 才第一次有行，本批给三件客户真的在等的事接上了模板：运营回复、标记处理
 * 完成、关闭（`ticket.replied` / `_resolved` / `_closed`，见 @vxture/service-notification
 * 的 `topicOf`）。**两半必须同时动**：模板上线而开关还禁着，客户就收得到一封关不掉的信，
 * 比不发更糟——而工单这一条尤其明显，提了工单的人本来就在等我们说话。
 * 其余四个工单状态（open / pending / in_progress / reopened / cancelled）没有模板，
 * 理由逐条写在 templates.ts 的工单那一段；它们不影响这一行的判断——这个主题**已经有模板**了。
 *
 * 剩下**一个**是事件源在、模板未接：`invoice_progress`。
 */
export const NOTIFICATION_TOPICS_PLANNED = ["invoice_progress"] as const;

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
 *  · `security_event`（安全兜底）——凭据变更、联系方式变更、运营处置必须至少有一个到达
 *    路径，否则账号被接管时用户无从得知。这不是产品偏好。
 *    **`login_activity` 不在这张表里**（2026-09-29 拆两行的全部意义）：「没见过的设备登录」
 *    不是「唯一的到达路径」，它是这条线上唯一会**反复**发生的一条，客户嫌吵就该能整条关掉
 *    ——而关掉它不会让「你的密码被改了」少送一条。合成一行时，站内那一档为了兜住安全事件
 *    必须锁死，于是「换个浏览器就来一条」也跟着关不掉，客户被迫二选一。
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
  security_event: ["inbox"],
  member_invitation: ["inbox"],
};

/**
 * 主题级默认覆盖。**事务性**通知默认开邮件（owner 2026-09-03「通知先做站内 + 邮件」）：
 * 不发邮件用户会错过付款期与到期。其余主题默认关——默认开外发通道等于替用户同意打扰。
 *
 * 2026-09-08 主题重排后，原「订阅」「账单」两档拆成了四个，事务性的判据不变：
 * 到期提醒、开通结果、待付订单、退款进度——**错过了会有实际损失**的那几件。
 * 公告与仍标「开发中」的那两个都不属于此列（账号安全那两行属于，但判据是另一条——
 * 见下面它们自己那一段）。
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
  /* ── 账号安全线（2026-09-29）：**两行都默认开邮件，但理由是两条不同的话。** ──
     `security_event` —— owner 裁定 1 直接给了判据：「默认发邮件。依据：锁定与强制下线两类，
       站内送不到——账号都进不去了。」这不是「错过了会有实际损失」那条判据的又一例，是更硬
       的一条：**站内这个通道本身在这一档上不可信**。被我们锁定的客户打不开收件箱，解释躺在
       一个他进不去的地方等于没送到。
     `login_activity` —— **没有照抄上面那一行**，按 owner 那句判据自己算了一遍，结论同向、
       理由不同：账号没被锁，客户打得开收件箱；但这一条要报的恰恰是「有别人进来了」，而进来
       的那个人**手上就握着这个收件箱**（站内消息他读得到、也标得掉）。拿一个在对方手里的
       通道去警告对方的受害人，与「被锁定的人打不开收件箱」是同一个失效，只隔了一步。所以
       邮件默认开——它是另一个信箱，接管者多半没有。
       代价是客户换台电脑就多收一封邮件。这一条**可关**（不在 `LOCKED` 里，三档全可点），
       嫌吵的人自己关掉即可；而 owner 裁定 6（只算没见过的设备、不算没见过的 IP）已经把
       频次压到「换设备才发」。默认开、可关，是这两件事唯一都成立的组合。 */
  security_event: { email: true },
  login_activity: { email: true },
  /* ── 工单线（2026-09-29）：**邮件默认开**，判据是这张表原本那一条，不是照抄上面两行。 ──
     这张表的判据只有一条：**错过了会有实际损失**（上面那八个错过就误判自己的订单、权限、
     认证或余量状态）。逐条按它算过这三条模板：
       · `ticket.replied`  —— 客户提了工单就是在等我们说话。回复错过了，他会以为没人管，
         而工单那一侧会因为没人回话走向 resolved / closed；
       · `ticket.resolved` —— 这一条给的是**一个有时限的动作**：不认可就要回一句，否则单子
         接着走向关闭。错过它就等于默认「好了」；
       · `ticket.closed`   —— 终态。错过之后客户还在等一个不会再来的回复。
     三条都符合，所以跟着事务性那几个走「邮件默认开、可关」。
     **不照抄 `security_event` 那条更硬的判据**（站内通道本身不可信）：工单的客户账号好着，
     站内他打得开；这里成立的是普通的那一条。
     也不照 `announcement` / `invitation_activity` 的「周知 ⇒ 默认只进站内」：那两类错过了
     只是晚一点知道一件与自己无关的事，而这三条每一条都指着一个客户自己要做的下一步。
     三个渠道全部可开关（**不进 `LOCKED`**）：客户把它们全关掉不会让任何人少收到一条回复
     ——回复本身在工单详情页留着，站内这条消息只是入口，不是回复本身。 */
  ticket_activity: { email: true },
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
