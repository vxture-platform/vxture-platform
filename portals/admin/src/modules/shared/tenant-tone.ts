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
  TenantOperationAuditEvent,
  TenantOperationMember,
} from "@/entities/console";

/*
 * 租户视角的订阅态原来在这里另有一张 `TENANT_SUBSCRIPTION_TONE`（trial / past_due
 * 那套自建值域，TD #33 记的契约漂移）。2026-08-30 租户详情的订阅投影改用
 * `@vxture-platform/shared` 的七值后，直接用 `status-tone.ts` 的
 * `SUBSCRIPTION_OPERATION_TONE`，这张表删除。
 */

/**
 * 成员在职态。值域照 `tenancy.tenant_memberships.status`（active / suspended；
 * removed 读取时过滤）。原来这里还有 `invited` 一档——库里从没有过来源，受邀未加入
 * 的人在 `tenancy.invitations`，不是成员（2026-08-30 随契约一起删）。
 */
export const MEMBER_STATUS_TONE: Record<
  TenantOperationMember["status"],
  StatusTone
> = {
  active: "success",
  suspended: "danger",
};

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

/*
 * 模型授权策略（`POLICY_STATE_TONE`）随 `TenantOperationModelPolicy` 一起删除
 * （2026-08-30）：模型用量归 Atlas，平台库没有这份数据，那一页从来只渲染过空表。
 */

/**
 * 审计事件结果，值域 = `support.audit_logs.result` CHECK（success / failure / denied）。
 * failure 是坏了，danger；denied 是被拦下（鉴权挡住的尝试），要留意但系统按预期
 * 工作，warning。
 */
export const AUDIT_RESULT_TONE: Record<
  TenantOperationAuditEvent["result"],
  StatusTone
> = {
  success: "success",
  failure: "danger",
  denied: "warning",
};

/** 启用 / 停用两态的布尔开关（模型、厂商、计价规则共用）。 */
export function activeTone(isActive: boolean): StatusTone {
  return isActive ? "success" : "neutral";
}
