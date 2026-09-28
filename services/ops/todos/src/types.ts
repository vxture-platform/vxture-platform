/**
 * types.ts — 运营待办的契约（2026-09-28 根治批）。
 * @package @vxture/service-ops-todos
 *
 * owner：「根治是做一个服务端「待办」接口，页面和作业读同一份，尤其运营端收到的
 * 信息和客户侧要完整一致。」
 *
 * 这里的每一个值域都是从 admin 待办页（OpsTodosPage）原有的派生规则**逐条搬**过来的：
 * 严重度三档、优先级数字、进度键、等待起点、跳转路径都不改语义。
 *
 * 2026-09-28 第三批（owner：「先把通知，信息，任务，提醒这些信息做全，做多，后续再
 * 订阅选择上再做筛选。本轮需要充分考虑信息完整性。」）在此之上加了 12 类与一层**升档**：
 * 类别从 7 涨到 19，另给每条待办一个「等太久了」的位（`escalated` / `escalationStep`）。
 *
 * 形状约定：**上屏的每一处只给可视码，绝不给 UUID**（order_no / refund_no / tenant_no /
 * ticket_no / invoice_no / user_no / 维护窗口标题）。唯一的例外是 `id` ——它是身份不是
 * 称呼，维护窗口那一类取窗口主键，且约定它**只当键用、任何场景不上屏**（见该字段注释）。
 */

/**
 * 待办类别。2026-09-28 第三批按 owner「先把通知、信息、任务、提醒这些信息做全、做多，
 * 后续再在订阅选择上做筛选」补齐到 19 类——凡是**在等运营做一件事**的状态都进来，
 * 宁可多一类，不为怕吵而少一类。
 *
 * ── 按域分组（每一类的谓词、严重度、优先级、等待起点见 pg-ops-todo.repository 头注）──
 *   订单   confirm_payment / reprovision / follow_up_balance / order_pending_payment_aging
 *   退款   refund_audit / refund_execute / refund_processing_stuck / refund_failed
 *   订阅   subscription_overdue
 *   发票   invoice_applying / invoice_approved
 *   加油包 addon_pending_confirm
 *   租户   verification / risk
 *   工单   ticket / ticket_sla
 *   维护窗口 maintenance_overdue
 *   账号注销 deletion_pending / purge_imminent
 *
 * `follow_up_balance`（部分收款尾款挂账）按 owner 2026-09-08 裁定**不告警**——那一类
 * 在等客户，不在等运营；`scripts/guardrails/check-ops-todo-alerts.mjs` 守着这层对应，
 * 并对本批每一个新类别都记了一条明文裁定（推 / 不推邮件）。
 *
 * ── 有一类没有加进来 ──
 * `webhook_dead`（provisioning.webhook_deliveries.status = 'dead'）本批**没做**：
 * 全仓没有任何一处写这个值（commerce / provisioning / bff / platform-api 逐个搜过，
 * 只有 opera 的作业调度页在读 `status in ('failed','dead')`）。投递超过 max_attempts
 * 之后落的是 `failed`，`dead` 是 54_provisioning.sql 的 CHECK 里一个没有写入方的预留值。
 * 给它写一条永远不成立的谓词，会在页面上留一类「永远 0 条」的待办，看起来是覆盖到了
 * ——那正是本仓最常见的坏法（做了没接）。等 provisioning 真的转 dead 时再接。
 */
export const OPS_TODO_KINDS = [
  "confirm_payment",
  "reprovision",
  "follow_up_balance",
  "order_pending_payment_aging",
  "refund_audit",
  "refund_execute",
  "refund_processing_stuck",
  "refund_failed",
  "subscription_overdue",
  "invoice_applying",
  "invoice_approved",
  "addon_pending_confirm",
  "verification",
  "risk",
  "ticket",
  "ticket_sla",
  "maintenance_overdue",
  "deletion_pending",
  "purge_imminent",
] as const;
export type OpsTodoKind = (typeof OPS_TODO_KINDS)[number];

/** 紧急 / 关注 / 一般。页面此前还有一档 `green`，没有任何来源产出它，已摘。 */
export const OPS_TODO_SEVERITIES = ["rose", "amber", "blue"] as const;
export type OpsTodoSeverity = (typeof OPS_TODO_SEVERITIES)[number];

/**
 * 「进展」列的档位。订单待办按运营侧五步（下单 → 客户申报 → 核对到账 → 自动开通
 * → 完成）报「第几步」；其余各类没有步骤，只报一个状态词。
 * 与类别**一一对应**（`progressOf` 是对 kind 的穷尽 switch，加一类就必须在这里加一档，
 * 漏了 TS 当场红）；第三批的 12 个新档位按类别名的驼峰写法。
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
  "orderAging",
  "refundAudit",
  "refundExecute",
  "refundProcessing",
  "refundFailed",
  "subscriptionOverdue",
  "invoiceApplying",
  "invoiceApproved",
  "addonPendingConfirm",
  "verification",
  "risk",
  "ticketOpen",
  "ticketProcessing",
  "ticketBlocked",
  "ticketSla",
  "maintenanceOverdue",
  "deletionPending",
  "purgeImminent",
] as const;
export type OpsTodoProgress = (typeof OPS_TODO_PROGRESS_KEYS)[number];

/**
 * 待办的宾语是什么。2026-09-28 第三批加的五档各有自己的可视码：
 *   subscription  当前履约订单的 order_no，没有就退回工作空间号（订阅表没有自己的可视码）
 *   invoice       invoice_receipts.invoice_no
 *   addon         addon_purchases.order_no（**不是** billing.orders 的单号，见仓储头注）
 *   user          account.users.user_no（主体码，上屏要经 formatPrincipalNo 加 U- 前缀，
 *                 与 tenant 那两类的 tenant_no 同一约定：路由用裸号、屏上用带前缀的）
 *   maintenance   维护窗口的标题——admin.maintenance_windows 只有 uuid 与 title，没有可视码，
 *                 而 UUID 一律不上屏；批二的审计通告同样拿 title 当这件事的称呼。
 *                 title 上没有唯一约束，所以它只是**称呼**；那一类的身份在 `id` 里
 *                 （窗口主键），两者分开是有意的。
 */
export type OpsTodoSubjectType =
  | "order"
  | "refund"
  | "tenant"
  | "ticket"
  | "subscription"
  | "invoice"
  | "addon"
  | "user"
  | "maintenance";

export interface OpsTodo {
  /**
   * `${kind}:${身份}`，稳定，可作 React key、也是告警去重键的那一格。
   *
   * 十九类里的十八类身份就是 `subject.no`（可视码本身唯一）。`maintenance_overdue`
   * 例外：它的称呼是**运营自己填的窗口标题**，`admin.maintenance_windows.title` 上没有
   * 唯一约束（运营重复用「例行维护」是常态），所以那一类的身份取窗口主键
   * （见 pg-ops-todo.repository 的 MAINTENANCE_TODOS_HEAD 与 mapOpsTodoRow）。
   *
   * 于是这个字段**可能含 UUID**，而 `subject.no` / `href` 永远不含。读方只把它当身份用
   * （React key、去重键），**任何场景不上屏**——「不展示 UUID」那条铁律没有例外。
   */
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
  /**
   * admin 内相对路径：/orders/{order_no} · /subscriptions/{order_no} · /invoices ·
   * /addon-orders · /verifications · /tenants/{tenant_no} · /tickets/{ticket_no} ·
   * /accounts/{user_no}。
   *
   * **可以是 null**：`maintenance_overdue` 的出路在运维台（opera 的 /ops/maintenance-windows），
   * 而 admin 里没有维护窗口这一页（2026-09-28 核过 portals/admin 的路由表）。href 是
   * **平面内**相对路径，各平面各自解析，给一个 opera 的路径等于在 admin 里点开 404
   * ——与批二 composeJobHealthNotice「planes 含 admin 时不给链接」同一条判断。
   * 读方（页面 / 告警邮件）拿到 null 就不渲染链接，改用文案说清去哪儿办。
   */
  readonly href: string | null;
  /**
   * 等太久了：已越过本类别的升档阈值（2026-09-28 第三批）。
   *
   * 只有四类有阈值（confirm_payment / refund_audit / reprovision / verification，
   * 阈值来自 env，见 pg-ops-todo.repository 的 `opsTodoThresholds`），其余类别恒 false。
   * 升档**同时**作用在 severity 上（blue→amber→rose，rose 已是顶档就留在 rose），
   * 所以 `severity` 给的是升档后的那一档；这个布尔位是「为什么是这一档」。
   *
   * 页面据它打「已超时」标记；**在 ALERT_KINDS 之内的类别**还会由告警作业另写一条
   * critical 运营通告——邮件有 4h 静默窗口且漏看就没了，通告留在列表里。
   *
   * 四类有阈值，其中三类（confirm_payment / refund_audit / reprovision）都在
   * ALERT_KINDS 里，两半都有；**`verification` 只有页面这一半**，通告那一半没有。
   * 两个原因叠在一起：①通告是在 OperatorAlertsWiring.alertTodo 里写的，而作业只对
   * ALERT_KINDS 调它，`verification` 从未被 owner 裁定过要不要告警（明写在
   * scripts/guardrails/check-ops-todo-alerts.mjs 的 UNRULED）；②就算裁定了也不能只改
   * 那张表——认证那一段要先拼 tenant_base，它引用 `kyc.tenant_verifications` /
   * `admin.risk_records` / `session.auth_sessions`，全在告警作业的库角色 `svc_platform_api`
   * 的授权面之外，整轮作业会 42501（见 `includeApplicant` 那一段）。所以这是要 owner 裁定
   * 加 97 扩授权面的两件事，不是漏接线。
   */
  readonly escalated: boolean;
  /**
   * 升了几级：`floor(已等 / 阈值)`，封顶 12。0 = 没越过阈值（`escalated` 即 `>= 1`）。
   *
   * 它是告警通告去重键里的那一格（`{kind}:{可视码}:{step}`）——**每跨过一个阈值倍数
   * 播一条**，所以一件事拖得越久，运营台上就多一条 critical，而不是同一条被静默吞掉。
   * 封顶 12 是为了让这个阶梯有个尽头：同一件事已经有 12 条 critical 挂着，再播只是噪音，
   * 待办本身仍在页面上红着。
   */
  readonly escalationStep: number;
  /** `status` 是库里的原值（open / pending / in_progress / reopened），不做归一。 */
  readonly ticket?: {
    readonly title: string;
    readonly priority: string;
    readonly status: string;
  };
}

/**
 * 六个时长阈值（2026-09-28 第三批）。**全部落进绑定参数**，在 SQL 里算——
 * 升档要参与排序（升档后的严重度就是排序键），而排序在 limit 之前，所以它不能等到 TS。
 *
 * 前四个是**升档**阈值：等待超过它，那一类的严重度升一档、`escalated` 置真。
 * 后两个是**成熟**阈值：等待不到它，那一类**根本还不是待办**（刚下的单、刚进
 * processing 的退款都在正常流程里），所以在外层 where 里直接滤掉。
 *
 * 缺省值来自 env（读不到 / 不是正整数就用括号里的兜底）：
 *   OPS_ESCALATE_CONFIRM_PAYMENT_HOURS  (4)   客户申报付款后多久没人核对
 *   OPS_ESCALATE_REFUND_AUDIT_HOURS     (24)  退款申请后多久没人审
 *   OPS_ESCALATE_REPROVISION_MINUTES    (30)  已收款后多久权益还没落地
 *   OPS_ESCALATE_VERIFICATION_DAYS      (3)   企业认证提交后多久没人看
 *   OPS_ORDER_AGING_HOURS               (24)  待付款单多久没申报才算「挂着」
 *   OPS_REFUND_STUCK_HOURS              (4)   退款在 processing 里多久算「卡住」
 */
export interface OpsTodoThresholds {
  readonly confirmPaymentHours: number;
  readonly refundAuditHours: number;
  readonly reprovisionMinutes: number;
  readonly verificationDays: number;
  readonly orderAgingHours: number;
  readonly refundStuckHours: number;
}

export interface ListOpsTodosOptions {
  /** 不传 = 全部类别。空数组 = 一类都不要（直接回空列表，不发查询）。 */
  readonly kinds?: readonly OpsTodoKind[] | undefined;
  /**
   * 覆盖部分阈值（**只给测试用**：单测要钉升档边界，得能把阈值固定下来）。
   * 生产上两个调用方都不传，一律走 env / 兜底——「页面和作业读同一份」也包括阈值。
   */
  readonly thresholds?: Partial<OpsTodoThresholds> | undefined;
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
