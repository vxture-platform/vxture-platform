/**
 * types.ts — 运营待办的契约（2026-09-28 根治批）。
 * @package @vxture/service-ops-todos
 *
 * owner：「根治是做一个服务端「待办」接口，页面和作业读同一份，尤其运营端收到的
 * 信息和客户侧要完整一致。」
 *
 * 这里的每一个值域都是从 admin 待办页（OpsTodosPage）原有的派生规则**逐条搬**过来的：
 * 严重度三档、优先级数字、进度键、等待起点、跳转路径都不改语义。新加的只有
 * `refund_audit`（退款审核）——它此前在页面与告警作业里都不存在，是这次要根治的洞。
 *
 * 形状约定：**只给可视码，绝不给 UUID**（order_no / refund_no / tenant_no / ticket_no）。
 */

/**
 * 待办类别。前四类从账务派生（有金额），后三类从租户与工单派生。
 *
 * `follow_up_balance`（部分收款尾款挂账）按 owner 2026-09-08 裁定**不告警**——那一类
 * 在等客户，不在等运营；`scripts/guardrails/check-ops-todo-alerts.mjs` 守着这层对应。
 */
export const OPS_TODO_KINDS = [
  "confirm_payment",
  "reprovision",
  "follow_up_balance",
  "refund_audit",
  "verification",
  "risk",
  "ticket",
] as const;
export type OpsTodoKind = (typeof OPS_TODO_KINDS)[number];

/** 紧急 / 关注 / 一般。页面此前还有一档 `green`，没有任何来源产出它，已摘。 */
export const OPS_TODO_SEVERITIES = ["rose", "amber", "blue"] as const;
export type OpsTodoSeverity = (typeof OPS_TODO_SEVERITIES)[number];

/**
 * 「进展」列的档位。订单待办按运营侧五步（下单 → 客户申报 → 核对到账 → 自动开通
 * → 完成）报「第几步」；其余各类没有步骤，只报一个状态词。`refundAudit` 为本次新增。
 *
 * `ticketBlocked` **今天没有来源**：support.tickets 的 status CHECK 只有
 * open / pending / in_progress / resolved / closed / reopened / cancelled
 * （72_support.sql），没有 blocked / waiting 这两档，所以 `progressOf` 不会产出它。
 * 值域里仍留着这一档是因为 admin 页面的进度文案表按本值域**全覆盖**（`Record<OpsTodoProgress,
 * string>`），摘掉它要连页面与 zh/en 词条一起改；等工单真加了「阻塞」那一档，
 * `progressOf` 接回来即可，页面不用动。
 */
export const OPS_TODO_PROGRESS_KEYS = [
  "pendingVerify",
  "paidUnprovisioned",
  "partialPending",
  "refundAudit",
  "verification",
  "risk",
  "ticketOpen",
  "ticketProcessing",
  "ticketBlocked",
] as const;
export type OpsTodoProgress = (typeof OPS_TODO_PROGRESS_KEYS)[number];

export type OpsTodoSubjectType = "order" | "refund" | "tenant" | "ticket";

export interface OpsTodo {
  /** `${kind}:${可视码}`，稳定，可作 React key。 */
  readonly id: string;
  readonly kind: OpsTodoKind;
  readonly severity: OpsTodoSeverity;
  readonly priority: number;
  /** 只给可视码，绝不给 UUID。 */
  readonly subject: { readonly type: OpsTodoSubjectType; readonly no: string };
  /**
   * 租户的可视属性（owner 2026-09-28「运营端收到的信息要完整」）。
   * `type` 沿用页面口径 `individual` / `company`（库里是 personal / organization）；
   * `status` / `riskLevel` 是库里的枚举原值（`active` / `suspended` / … ·
   * `follow_up` / `high`），文案由页面按界面语言取；`region` / `industry` / `scale`
   * 是租户自填的自由文本。
   *
   * 读不到的一律 null，页面显示「—」——不拿默认档冒充事实：`riskLevel` 为 null 是
   * 「没有未复核的风险记录」，不是「已复核为 normal」；`region` 无 province / city 源列，
   * 取 address 再退 country_code（与 tenants.router 同源，只是这里不兜「未设置」）。
   *
   * `riskLevel` 来自 `admin.risk_records`，随 `includeApplicant` 一起给 / 不给
   * （见 pg-ops-todo.repository 头注「跨 schema 富化块」那一段）。
   */
  readonly tenant: {
    readonly no: string | null;
    readonly name: string;
    readonly type: string | null;
    readonly status: string | null;
    readonly riskLevel: string | null;
    readonly region: string | null;
    readonly industry: string | null;
    readonly scale: string | null;
  } | null;
  /**
   * 申报人 / 申请人（有就带）——页面租户列副行「是谁在等」的来源。
   * 订单：申报腿的客户；退款：客户创建的退款单的创建人；两者都退回租户 owner。
   * 租户类：owner。工单：指派人 / 报单人 / 主联系人（与工单列表同一口径，只有名字）。
   *
   * 邮箱 / 手机是**原文**：脱敏在读方（admin-bff 的 ops-todos.router 按 user:pii.read
   * 掩码，与 orders.router 的 declaredBy 同一道闸门）。`includeApplicant: false` 时整块为 null。
   */
  readonly applicant: {
    readonly name: string | null;
    readonly email: string | null;
    readonly phone: string | null;
  } | null;
  /**
   * 收款类：应收；退款：退款额；其他 null。`value` / `paid` 都是 numeric 的原文
   * （十进制字符串，不做浮点）。
   *
   * `paid`（已收多少）只有部分收款的尾款待办带——那是客服打电话时要说的那个数；
   * 其余类别为 null（不是 0），读方句子退回只说应收的那一版。
   */
  readonly amount: {
    readonly value: string;
    readonly currency: string;
    readonly paid: string | null;
  } | null;
  readonly product: {
    readonly code: string;
    readonly name: string;
    readonly planName: string | null;
  } | null;
  readonly progress: OpsTodoProgress;
  /** ISO；等待起点按页面原有规则（申报时刻 / 到账时刻 / 退款申请时刻 / 认证提交时刻 / …）。 */
  readonly waitingSince: string;
  /** admin 内相对路径：/orders/{order_no} · /verifications · /tenants/{tenant_no} · /tickets/{ticket_no}。 */
  readonly href: string;
  /** `status` 是库里的原值（open / pending / in_progress / reopened），不做归一。 */
  readonly ticket?: {
    readonly title: string;
    readonly priority: string;
    readonly status: string;
  };
}

export interface ListOpsTodosOptions {
  /** 不传 = 全部类别。空数组 = 一类都不要（直接回空列表，不发查询）。 */
  readonly kinds?: readonly OpsTodoKind[] | undefined;
  /** 只要在当前状态里已停留 ≥ 这么多分钟的；不传 = 不按停留时长过滤。 */
  readonly minAgeMinutes?: number | undefined;
  /** 不传 = DEFAULT_LIST_LIMIT。 */
  readonly limit?: number | undefined;
  /**
   * 要不要带跨 schema 的富化块（申报人 + 租户风险档）。不传 = 要。
   *
   * `false` 的唯一在用调用方是 platform-api 的告警作业：它的库角色 `svc_platform_api`
   * 只有 7 个 schema（97_service_roles.sql），没有 `account` / `admin`，而 Postgres 对
   * SQL 里**出现过的每一个关系**查权限（哪一支返不返回行都一样）——这些 join 必须
   * 不在文本里，否则生产上整条查询 42501。告警邮件也用不到这两样（见 operator-alerts.wiring）。
   */
  readonly includeApplicant?: boolean | undefined;
}
