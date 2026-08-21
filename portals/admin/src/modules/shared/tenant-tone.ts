/**
 * tenant-tone.ts —— 租户域各值域的展示映射。
 *
 * @package @vxture/admin
 * @layer Presentation
 * @category Shared
 *
 * ── 为什么要拆出这些表 ────────────────────────────────────────────────────
 * 迁移前这些状态全部走同一个 CSS 前缀 `vx-tenant-pill--*`，而那一个前缀被
 * **12 个互不相干的值域**共用：
 *
 *   tenant.status · tenant.verifiedStatus · member.status · ticket.status
 *   subscription.status · policy.state · event.result · draft.tenantType
 *   model.isActive · provider.isActive · rule.isActive · 风险档
 *
 * 于是 `.vx-tenant-pill--active` 一条规则同时是「租户正常」「成员在职」
 * 「订阅生效」「模型已启用」。今天没出事只是因为这些域恰好都想要绿色——它与
 * `vx-invoice-pill--type-` 的撞车（见 §十三）是同一类问题，只是 12 路。
 *
 * 按值域拆开之后，新增一个值域不会再撞到别人身上，缺档也会被 `Record` 逼出来。
 *
 * ── 六档语气的对应见 `status-tone.ts` 头部 ────────────────────────────────
 * 下面每张表按那份对应关系定，与 CSS 原色不一致的地方逐条注明。
 *
 * **租户态、认证态、风险档不在这里**：`modules/tenants/tenant-utils.ts` 早就有
 * `TENANT_STATUS_TONE` / `VERIFICATION_TONE` / `TENANT_RISK_TONE` 三张，且已经
 * 按"试用=进行中→info""待审=流程中→info""未认证=中性"定过。本文件只收那三张
 * 没覆盖到的值域，不另起同名表。
 */

import type { StatusTone } from "@vxture-platform/shared";

import type {
  TenantOperationModelPolicy,
  TenantOperationSubscription,
} from "@/entities/console";

/**
 * 租户视角的订阅态。
 *
 * **它与订阅列表页不是同一个值域**：这里是 `TenantOperationSubscription.status`
 * （trial / active / **past_due** / cancelled），订阅列表页是
 * `SubscriptionOperationStatus`（trial / active / expiring / **overdue** /
 * suspended / cancelled）。同一件"欠费"，一个叫 `past_due`、一个叫 `overdue`。
 *
 * 这正是 TD #33 记的契约漂移，在这里露了头——此前两边都往 `vx-tenant-pill--*`
 * 里塞，撞不出来；按值域拆表之后类型立刻报了。**本轮只如实建表，不改值域**：
 * 改名要连 BFF 与 view-model 一起动，属 #33。
 *
 * 另：`past_due` 我先前按"CSS 类名全仓 0 引用"判成了死档——错的，它由模板拼接
 * 产生（`--${subscription.status}`），字面量搜不到。判死码必须考虑模板拼接
 * （同 admin-table-consolidation.md 记过的那条）。
 */
export const TENANT_SUBSCRIPTION_TONE: Record<
  TenantOperationSubscription["status"],
  StatusTone
> = {
  active: "success",
  trial: "warning",
  past_due: "danger",
  cancelled: "neutral",
};

/**
 * 成员在职态。
 *
 * **`invited` 是这次被 `Record` 逼出来的缺口**：值域有三个值，CSS 只画了两个，
 * 已邀请未加入的成员一直是默认样式。按六档对应表它属于"新来的，等人接手"，
 * 与账号态的 `invited` 同档。
 */
export const MEMBER_STATUS_TONE = {
  active: "success",
  invited: "brand",
  suspended: "danger",
} as const satisfies Record<string, StatusTone>;

/** 工单态。`closed` 是正常闭环，给绿；`processing` 是流程在走，给 `info`。 */
export const TICKET_STATUS_TONE = {
  open: "warning",
  processing: "info",
  blocked: "danger",
  closed: "success",
} as const satisfies Record<string, StatusTone>;

/**
 * 工单优先级。
 *
 * 优先级是**紧急度**，不是等级阶梯——这一点与套餐档不同（见 `tier-level.ts`：
 * 那里五档表达的是商业分类，硬塞进语气会说错话）。紧急度恰好就是语气表达的东西，
 * 所以它该走语气而不是自建色阶。
 *
 * p2/p3 都给中性：常规与低优先级之间的差别由文字承担，不值得再占一档颜色。
 *
 * **与状态分开取色**是这次修的重点。原先一个 `ticketTone()` 同时看 priority 和
 * status，于是「待处理」这枚标被 p0 染成红色——一枚标同时说两件事，读者无从
 * 判断红的是"这单很急"还是"这单出事了"。表格里优先级本就另有一列。
 */
export const TICKET_PRIORITY_TONE = {
  p0: "danger",
  p1: "warning",
  p2: "neutral",
  p3: "neutral",
} as const satisfies Record<string, StatusTone>;

/**
 * 模型授权策略的生效态。
 *
 * `disabled` 是第二个被 `Record` 逼出来的缺口：值域四个值，CSS 只画了三个。
 * 它是"关掉了"不是"配错了"，取中性，与 `undefined`（没配）的红分开。
 */
export const POLICY_STATE_TONE: Record<
  TenantOperationModelPolicy["state"],
  StatusTone
> = {
  effective: "success",
  limited: "warning",
  undefined: "danger",
  disabled: "neutral",
};

/** 审计事件结果。值本身就是语气词，一一对应。 */
export const AUDIT_RESULT_TONE = {
  success: "success",
  warning: "warning",
  danger: "danger",
} as const satisfies Record<string, StatusTone>;

/** 启用 / 停用两态的布尔开关（模型、厂商、计价规则共用）。 */
export function activeTone(isActive: boolean): StatusTone {
  return isActive ? "success" : "neutral";
}
