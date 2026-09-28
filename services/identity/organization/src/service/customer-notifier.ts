/**
 * customer-notifier.ts — 客户通知的最小契约（邀请四态，2026-09-29）。
 * @package @vxture/service-organization
 *
 * 与 @vxture/service-subscription 的同名文件**同一形状、同一纪律**：本包只描述
 * 「发生了什么」（模板键 + 参数 + 业务引用），不知道站内 / 邮件怎么发——发送、去重、
 * 偏好、账本由 @vxture/service-notification 的 NotificationDispatcher 实现，装配处
 * （console-bff / platform-api）把它以本接口注入（**结构兼容，不引包**：identity 层
 * 不依赖 notification 层）。未注入 = 静默不发（本地 / 单测 / mock 仓储）。
 * 通知一律 best-effort：业务写已提交，通知失败只记日志。
 *
 * 为什么不复用 subscription 那一份：那是另一个包的内部实现，跨包引它等于把 commerce
 * 的类型做成 identity 的公共依赖（depcruise 的边界规则也不许）。这里只抄形状。
 */

/**
 * 邀请四态的客户通知模板码 —— dispatch/templates.ts 那张联合的**又一份副本**，
 * 按设计同改。本副本是权威那张的子集：只列**写入方住在本包**的模板码。
 *
 * 写成 `as const` 数组而不是手写联合，理由与 subscription 那份相同：两份副本是否
 * 一致，在运行时要有东西可断言（联合是类型，类型在运行时不存在）。
 *
 * 权威那侧的差集声明表（dispatch 的 templates.spec.ts 里的
 * EXPECTED_MISSING_IN_SECOND_COPY）只认 subscription 那一份副本；这四条的写入方在
 * 本包，所以它们在那张表里要记成「写入方在 @vxture/service-organization」。
 */
export const ORGANIZATION_NOTIFICATION_TEMPLATES = [
  /* 受邀人接受 —— 通知邀请人（对方来了）。 */
  "tenant.invitation_accepted",
  /* 受邀人拒绝 —— 通知邀请人。declined ≠ revoked：前者是对方不来，后者是我撤回，
     合成一条会把「对方不来」说成「我撤回了」（tenancy.invitations 的 status
     CHECK 注释就是为这件事写的）。 */
  "tenant.invitation_declined",
  /* 邀请人撤回 —— 通知受邀人（别等了）。 */
  "tenant.invitation_revoked",
  /* 到点没人接 —— 通知邀请人（要不要重发是他的事）。见 invitation-notifications.ts
     里 RECIPIENT_OF 那段：收件人是「没有造成这次转移」的一方。 */
  "tenant.invitation_expired",
] as const;

export type OrganizationNotificationTemplate =
  (typeof ORGANIZATION_NOTIFICATION_TEMPLATES)[number];

export interface CustomerNotifyInput {
  tenantId: string;
  templateCode: OrganizationNotificationTemplate;
  /**
   * 业务引用 = 去重锚（客户收件箱唯一键的一半：account_id × template_code ×
   * reference_type × reference_id）。
   *
   * id 一律是可视码或可视值的组合，**不放 uuid**：inbox 的读路由把 reference_id
   * 原样投影给浏览器。邀请没有可视码（tenancy.invitations 只有 uuid 主键），所以
   * 这里用「租户可视码 + 邀请 id 的不透明摘要 + 终态」拼——算式与位宽见
   * invitation-notifications.ts 的 invitationReferenceId。
   */
  reference: { type: "invitation"; id: string };
  params: Record<string, string | number>;
  /**
   * 只发这些人，不并入租户 owner。
   *
   * 邀请这四条**必须**用它：默认那条「owner 永远包含」的规则在这里是错的——
   * ① 撤回要发给受邀人，那个人此刻还不是（也可能永远不会是）本租户成员；
   * ② 接受 / 拒绝 / 过期发给邀请人，而正文是第二人称（「你邀请的…」），
   *    并入 owner 会让一个没发过这条邀请的人读到一句指着他说的话。
   */
  exactRecipients: string[];
  /** console 内相对路径。 */
  link?: string | undefined;
}

export interface CustomerNotifier {
  notify(input: CustomerNotifyInput): Promise<unknown>;
}

/** 东八区偏移。中国全年单一偏移、没有夏令时，所以这是一个常量而不是一张规则表。 */
const CST_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * 通知参数里的日期：东八区日历日，严格 `YYYY-MM-DD`。
 *
 * 三点说明：
 *   · 这是**进模板的数据串**，不是界面渲染，所以不走 @vxture-platform/shared 的
 *     formatDay——那个吐的是 locale 形状（`2026/09/20`），与同族的
 *     `tenant.invitation` 那条正文里的写法不是同一个东西。
 *   · 不用 `Intl`：日期时间纪律那条守卫把「手搓 Intl.DateTimeFormat」判为违规
 *     （豁免按文件增长就会让判据一路失效，所以不往那张名单里加第三条）。
 *     先加偏移再取 UTC 切片，结果与 Asia/Shanghai 的日历日逐字相同。
 *   · 客户看的是自己日历上的那一天：直接 `toISOString().slice(0, 10)` 会让
 *     北京时间凌晨到期的邀请显示成前一天。
 * 它既进展示参数、**也进过期那一档的去重键**（见 invitationReferenceId）——两处必须
 * 同一个函数：各算一次就会出现「展示的日期变了而键没变」那种静默重复。
 */
export function formatNotifyDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d.getTime() + CST_OFFSET_MS).toISOString().slice(0, 10);
}
