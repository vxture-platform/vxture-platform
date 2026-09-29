/**
 * customer-notifier.ts — 账号安全事件的客户通知契约（2026-09-29）。
 * @package @vxture/service-account
 *
 * 与 @vxture/service-subscription / @vxture/service-organization 的同名文件**同一形状、
 * 同一纪律**：本包只描述「发生了什么」（模板键 + 参数 + 业务引用），不知道站内 / 邮件怎么
 * 发——发送、去重、偏好、账本由 @vxture/service-notification 的 NotificationDispatcher
 * 实现，装配处（console-bff / auth-bff）把它以本接口注入（**结构兼容，不引包**：identity
 * 层不依赖 notification 层，depcruise 的边界规则也不许）。
 * 未注入 = 静默不发，且为了凑参数而多做的那些读查询**一次都不发生**——此时本包的行为与加
 * 这段之前逐字相同。通知一律 best-effort：业务写已提交，通知失败只记日志。
 *
 * ── 与权威那一份的关系（这一段是本文件存在的全部风险，所以写在最前面）──
 * 模板码、参数名、去重锚的形状，权威都在 dispatch 的 `templates.ts`（那边的
 * `securityEventStamp` / `ACTOR_PARAM` / `PROVIDER_PARAM` 就是这份契约）。本文件是**照抄的
 * 第二份**，抄的理由是层边界：本包引不到那个包。抄的代价必须说清楚——两份会漂，而漂的症状
 * 不是报错：锚少了时刻，收件箱的唯一键 `(account_id, template_code, reference_type,
 * reference_id)` 会把客户**第二次**改密码静默压掉；参数名写错，`interpolate` 把它换成空串，
 * 客户读到一句带洞的话。所以：
 *   · 下面每个常量都标了权威那侧的出处，改哪一边都要照着对面改；
 *   · `securityReferenceId` / `formatOccurredAt` 与 `securityEventStamp` / `formatOccurredAt`
 *     **逐字同算**（含用户号的形状校验与 `unknown` 回落）；
 *   · 真正的收口是让 dispatch 把 `securityEventStamp` 从 barrel 导出、再由装配处适配 ——
 *     那要改 dispatch 的文件，不在本次的范围里，已在交付说明里点名。
 */

/**
 * 账号安全事件的模板码 —— dispatch `NotificationTemplateCode` 那张联合里 `account.*` 的
 * 那一段（**十四条，权威那侧的全集**）。
 *
 * 写成 `as const` 数组而不是手写联合，理由与另两份副本相同：两份副本是否一致，在运行时要有
 * 东西可断言（联合是类型，类型在运行时不存在）。
 *
 * 主题归属（权威在 dispatch 的 `TOPIC_OF`）：前十三条进 `security_event`（站内恒锁——被锁定、
 * 被强制下线的人打不开收件箱也罢，至少不许把唯一的到达路径关掉）；
 * `account.new_device_signin` 一条进 `login_activity`（三个渠道全可关）。
 */
export const SECURITY_NOTIFICATION_TEMPLATES = [
  /* 运营处置三条：正文带运营填的原因（owner 裁定 3）。 */
  "account.locked",
  "account.unlocked",
  "account.sessions_ended_by_operator",
  /* 凭据两条。`password_changed` 带 actorLabel（本人 / 组织管理员）；
     `password_reset` 是**邮件重置令牌**那一条——今天既不落审计也不通知的那一条。 */
  "account.password_changed",
  "account.password_reset",
  /* 联系方式三条。邮箱拆两条是因为两个收件人视角不同（owner 裁定 4）。 */
  "account.phone_changed",
  "account.email_changed_old",
  "account.email_changed_new",
  /* 第三方登录两条 + 密码登录开关两条。 */
  "account.identity_linked",
  "account.identity_unlinked",
  "account.password_login_enabled",
  "account.password_login_disabled",
  /* 客户自己把一台设备下线。 */
  "account.session_ended_by_self",
  /* 主题是 `login_activity`，不是 `security_event`。 */
  "account.new_device_signin",
] as const;

export type AccountNotificationTemplate =
  (typeof SECURITY_NOTIFICATION_TEMPLATES)[number];

/**
 * 业务引用类型。权威：dispatch 的 `SECURITY_REFERENCE_TYPE`。
 * 它**故意不指向任何一张表**——账号安全事件在库里没有属于自己的一行（两条改密路径连审计行
 * 都没有），`reference_id` 是算出来的。
 */
export const SECURITY_REFERENCE_TYPE = "security";

/**
 * 操作者码。权威：dispatch 的 `ACTOR_NAMES`（`ACTOR_PARAM` = `actorLabel`）。
 * **放码不放词**：词要按收件人语言给，而语言只有模板层知道。此前有过一处是反着做的——
 * 英文角色码直接印进中文正文，客户读到「以「member」身份加入」。
 */
export const SECURITY_ACTORS = {
  /** 客户自己（自助改密、首次设密）。 */
  self: "self",
  /** 组织管理员替成员设密码。 */
  tenantAdmin: "tenant_admin",
  /** 平台运营。 */
  operator: "operator",
} as const;

/** 模板里唯一的操作者参数名。权威：dispatch 的 `ACTOR_PARAM`。 */
export const ACTOR_PARAM = "actorLabel";
/** 模板里唯一的第三方登录参数名。权威：dispatch 的 `PROVIDER_PARAM`。 */
export const PROVIDER_PARAM = "providerName";

export interface CustomerNotifyInput {
  /**
   * 安全事件挂在账号的**个人租户**名下。
   *
   * `support.inbox_messages.tenant_id` 是 NOT NULL，而安全事件是账号级的——这不是阻塞：
   * 每个账号必有个人租户（注册时自动开通、部分唯一索引保证 ≤1、且有自愈尾巴），而收件箱
   * 读路由只按 `account_id` 过滤、**不按租户**，所以填个人租户即可，用户以任何身份浏览
   * 都看得见。解析语句见 `UserReadRepository.findPersonalTenantId`。
   */
  tenantId: string;
  templateCode: AccountNotificationTemplate;
  /** 去重锚。形状与位宽算术见 `securityReferenceId`。 */
  reference: { type: typeof SECURITY_REFERENCE_TYPE; id: string };
  params: Record<string, string | number>;
  /**
   * 只发这个人，不并入租户 owner。
   *
   * 这一批**必须**用它。个人租户的 owner 恰好就是本人，所以今天两条路结果相同；但默认那条
   * 「owner 永远包含」的规则在这里是错的：组织管理员替成员设密码那一条收件人是**成员**，
   * 而正文是第二人称（「由你所在组织的管理员修改」）——一旦哪天安全消息落到组织租户名下，
   * 并入 owner 就会让一个管理员读到一句指着他说的话。
   */
  exactRecipients: string[];
  /** console 内相对路径。 */
  link?: string | undefined;
  /**
   * 这条通知的**邮件那一半**改送这个地址；站内那一半不变，照旧落在
   * `exactRecipients` 名下的收件箱里。权威：dispatch 的 `NotifyInput.emailTo`。
   *
   * 只有一条模板用它：`account.email_changed_old`。分发器默认按 account_id 回查收件人
   * **当前**的邮箱，而这一条要送的恰恰是**换走之前**那个地址——邮箱一写完，库里就查不到它
   * 了，所以只能由调用方把写之前捕获到的旧地址显式带进来。
   *
   * 不给（缺省）⇒ 与加这个字段之前逐字相同：邮件走回查出来的当前地址。给空串**不是**
   * 合法值：那等于把一封信发给「没有地址」。所以旧地址取不到时整条不发，判据在
   * `securityNotice`（`no_old_address`），不在这里——这里只是一个字段。
   */
  emailTo?: string | undefined;
}

export interface CustomerNotifier {
  notify(input: CustomerNotifyInput): Promise<unknown>;
}

/** 中国标准时间与 UTC 的固定时差。中国不用夏令时，所以这是个常数而不是一张规则表。 */
const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 可视用户号的形状。权威：dispatch `securityEventStamp` 里的 `VISIBLE_USER_NO`。 */
const VISIBLE_USER_NO = /^\d{6,20}$/;

/**
 * `occurredAt` 参数的唯一格式：`2026-09-29 20:14:32 (UTC+8)`。
 * **与 dispatch 的 `formatOccurredAt` 逐字同算**（那一个不从 barrel 导出，拿不到）。
 *
 * 三件事都是有意的：
 *   · **带秒**。日期时间纪律第一条就点名了通知：「同一分钟内的先后顺序恰恰最要紧」——
 *     安全事件更是如此，客户要对的是「这是我刚才那一下吗」。
 *   · **带时区**，且写死 UTC+8：这一个字符串要同时进两种语言的正文与一封邮件，而渲染层
 *     拿得到 locale 拿不到时区偏好。
 *   · **不走共用的 formatDateTime、也不用 Intl**：那个吐 locale 形状（`2026/09/29 20:14:32`），
 *     而这里要的是形状固定、与语言无关的数据串；`Intl` 还会被日期时间纪律那条守卫判为手搓。
 */
export function formatOccurredAt(at: Date): string {
  const shifted = new Date(at.getTime() + CHINA_OFFSET_MS).toISOString();
  return `${shifted.slice(0, 10)} ${shifted.slice(11, 19)} (UTC+8)`;
}

/**
 * 去重锚：`sec:{可视用户号}:{事件名}:{ISO 时刻}`。
 * **与 dispatch 的 `securityEventStamp` 逐字同算。**
 *
 * · **事件名从模板码算**（去掉 `account.` 前缀），不另收一个参数：少一个要对齐的名字。
 * · **时刻必须在里面**。这些事天生会重复（客户一天可以改两次密码、被锁了又解锁又锁），
 *   而收件箱的唯一键就是 (account, template, ref_type, ref_id)——少了时刻，第二次被静默
 *   压掉，而这一批最怕的恰恰是「接管者第二次改密码时本人收不到任何东西」。
 * · **一个 uuid 都没有**，而且对用户号**验形状**：`reference_id` 被客户收件箱的读路径原样
 *   投影给浏览器（console-bff 的 inbox.router → `InboxMessage.referenceId`）。不是可视号就
 *   退成 `unknown`——宁可让锚少一个可读的把手，也不让一个 uuid 过客户端那条线；锚仍然唯一，
 *   因为时刻在里面。
 * · 长度（`support.inbox_messages.reference_id` 是 varchar(128)）：最长模板码
 *   `account.sessions_ended_by_operator` 34 ⇒ 事件名 26，锚 = 4 + 10 + 1 + 26 + 1 + 24
 *   = **66**，余 62。用例按真实码表重算，不手抄。
 */
export function securityReferenceId(
  userNo: string | null | undefined,
  templateCode: AccountNotificationTemplate,
  occurredAt: Date,
): string {
  const trimmed = String(userNo ?? "").trim();
  const who = VISIBLE_USER_NO.test(trimmed) ? trimmed : "unknown";
  return `sec:${who}:${securityEventOf(templateCode)}:${occurredAt.toISOString()}`;
}

/**
 * 模板码 → 去重锚里的事件名。**从模板码算出来，不另写一张表**：两处各写一份，改了模板码
 * 忘了改表就会出现「展示的事件变了而键没变」那种静默重复，而这一批的全部意义就在于重复
 * 事件不许被吞。
 */
export function securityEventOf(
  templateCode: AccountNotificationTemplate,
): string {
  return templateCode.slice("account.".length);
}
