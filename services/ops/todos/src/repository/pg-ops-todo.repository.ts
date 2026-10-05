/**
 * pg-ops-todo.repository.ts — 运营待办的**唯一算法**（2026-09-28 根治批）。
 * @package @vxture/service-ops-todos
 * @layer Infrastructure
 * @category Repository
 *
 * ── 补的是哪个盲区 ──
 * 此前待办在**浏览器里**拼（admin 的 OpsTodosPage.buildOpsTodos 读三个列表接口再派生），
 * 告警在**服务端**扫（platform-api 的 OpsTodoAlertJob → OrderService.listOpsTodoOrders）。
 * 两边各写各的判据、谁也不认识谁：退款单 RFD-202609-4E7BD7BEC1（¥99，审核 pending）挂着
 * 无人知——页面没有这一类，作业也没有。owner：「根治是做一个服务端「待办」接口，页面和
 * 作业读同一份」。所以判据只写在这里的片段里，页面（admin-bff `GET /api/ops/todos`）与
 * 作业（platform-api `ops-todo-alert`）都只是它的调用方，各自不再派生。
 *
 * ── 每一类的判据（前 7 类逐条搬自页面不改语义；余下 12 类是 2026-09-28 第三批「做全」）──
 *   confirm_payment    billing.orders.status = 'pending_verify'      rose / 2  / 等待自 declared_at
 *   reprovision        orders.status = 'paid'                        rose / 3  / 等待自 paid_at
 *   follow_up_balance  orders.status = 'pending_payment' 且最近账单 bill_status = 'partial'
 *                                                                    amber / 15 / 等待自 updated_at
 *                      （与 admin-bff orders.router 的 partial_pending 投影同一口径）
 *   order_pending_payment_aging
 *                      orders.status = 'pending_payment' 且 declared_at is null 且最近账单不是 partial，
 *                      已挂 ≥ OPS_ORDER_AGING_HOURS（默认 24h）
 *                                                                    blue / 40 / 等待自 created_at
 *   refund_audit       billing.refunds.audit_status = 'pending' and refund_status = 'pending'
 *                                                                    rose / 2  / 等待自 refunds.created_at
 *   refund_execute     refunds.audit_status = 'approved' and refund_status = 'pending'
 *                                                                    rose / 3  / 等待自 audit_at（退回 updated_at）
 *   refund_processing_stuck
 *                      refunds.refund_status = 'processing' 且已停留 ≥ OPS_REFUND_STUCK_HOURS（默认 72h）
 *                                                                    rose / 6  / 等待自 transfer_initiated_at
 *                                                                    （2026-12-01 起；此前 updated_at——改备注就归零）
 *   refund_failed      refunds.refund_status = 'failed'              rose / 4  / 等待自 updated_at
 *   subscription_overdue
 *                      metering.subscriptions.status = 'overdue' and deleted_at is null
 *                                                                    amber / 12 / 等待自最近一条
 *                                                                    subscription_histories.to_status='overdue'
 *                                                                    （退回 end_at，再退 updated_at）
 *   invoice_applying   billing.invoice_receipts.invoice_status = 'applying' and deleted_at is null
 *                                                                    amber / 18 / 等待自 created_at
 *   invoice_approved   invoice_receipts.invoice_status = 'approved' and deleted_at is null
 *                                                                    amber / 19 / 等待自 audit_at（退回 updated_at）
 *   addon_pending_confirm
 *                      metering.addon_purchases.status = 'pending_payment'
 *                      （= AddonService.listPendingOps 的谓词；那边把「有 pending_verify 支付腿的」
 *                        排在前面，那是排序不是过滤，所以这里的集合与它逐行一致）
 *                                                                    rose / 7  / 等待自 created_at
 *   verification       tenancy.tenants.verification_status = 'pending'
 *                                                                    amber / 20 / 等待自最近一次认证提交
 *   risk               未复核风险记录最高档 <> normal 或 tenants.status = 'suspended'
 *                                                                    high/suspended → rose，否则 amber；
 *                                                                    high → 5，否则 25；等待自最近活跃 / 创建
 *   ticket             support.tickets 状态 <> 已结 且首次响应 SLA 未破
 *                                                                    p0 或 reopened → rose，p1 → amber，
 *                                                                    否则 blue；p0 1 / p1 10 / p2 30 / p3 50；
 *                                                                    等待自 updated_at
 *   ticket_sla         tickets.status in ('open','reopened') 且 first_response_at is null 且
 *                      created_at 早于 p0 1h / p1 4h / p2 24h / p3 72h
 *                                                                    rose / p0 1·p1 6·p2 8·p3 9 / 等待自 created_at
 *   maintenance_overdue
 *                      admin.maintenance_windows.status = 'in_progress' 且 end_at < now()
 *                                                                    rose / 9  / 等待自 end_at
 *   deletion_pending   account.users.status = 'deleting' and deleted_at is null
 *                                                                    blue / 45 / 等待自 deletion_requested_at
 *   purge_imminent     同上，且 deletion_requested_at 早于 27 天前（30 天保留期只剩 3 天）
 *                                                                    amber / 16 / 等待自 deletion_requested_at
 *
 * `ticket` 与 `ticket_sla` **互斥**（同一张工单只出一条：SLA 破了就报 ticket_sla，
 * 它更急、等待起点也不同——从建单算，不从最近一次改动算）。`follow_up_balance` 与
 * `order_pending_payment_aging` 同样互斥（最近账单 partial 的那一支优先）。
 * 退款四类按状态天然互斥（refunds 的两根状态机叉乘只落一格）。
 *
 * 排序：严重度（rose < amber < blue）→ 优先级升序 → 等待起点升序（同一档里等得最久的排最前
 * ——这一页是排班表，不是动态流）。同优先级不同类是有意的（confirm_payment 与 refund_audit
 * 都是 2，refund_execute 与 reprovision 都是 3）：它们一样急，谁先办看谁等得久。
 *
 * ── 升档（2026-09-28 第三批；2026-10-04 owner 裁定 3「通告尽量覆盖全」铺到十类）──
 * 十类有「等太久」的阈值（env，见 `opsTodoThresholds`）：越过一次阈值就把严重度升一档
 * （blue→amber→rose；rose 已是顶档，留在 rose，靠 `escalated` 这个位说话），并把
 * `escalation_step = floor(已等 / 阈值)`（封顶 12）报出去。作业拿 step 当去重键的一格，
 * 于是同一件事每多拖一个阈值周期就多一条 critical 运营通告，而不是被 4h 静默窗口吞掉。
 * 升档算在**外层**（LIST_OPS_TODOS_TAIL）而不是各片段里：它对所有类别同一套算法，
 * 而且升档后的严重度就是排序键，排序在 limit 之前——所以它不能等到 TS 再算。
 *
 * 「已等」默认从 waiting_since 算，但三类的**升档起点不是等待起点**，各片段用投影列
 * `escalate_from`（null = 用 waiting_since）另给一个：
 *   · addon_pending_confirm  从**申报腿**（billing.payments 最早一条 pending_verify）算；
 *                            没申报过 → 不升档。从 created_at 算会把客户自己没付的时间
 *                            记到运营头上：未申报的单由 sweepExpiredOrders 按 TTL 自动取消，
 *                            申报过的才永不自动取消——「等运营」只从申报起算，与
 *                            confirm_payment 的 declared_at 同一语义。
 *   · ticket_sla             从**破约时刻**（created_at + 本档 SLA）算，破约后每再拖
 *                            OPS_ESCALATE_TICKET_SLA_HOURS 一级；四档统一一个周期——
 *                            优先级差异已在 priority 1/6/8/9 的排序里。
 *   · refund_processing_stuck 从「成为卡住」那一刻（transfer_initiated_at + OPS_REFUND_STUCK_HOURS）
 *                            算，不从进入 processing 算：卡住时它已是 rose/6 且已发邮件，
 *                            再拖一个周期没落终态才升档。2026-12-01 起两处时钟（waiting_since 与
 *                            escalate_from）都读 transfer_initiated_at——updated_at 不能当这个时钟，
 *                            改正收款账号、补备注都会写它，一碰就把「卡了多久」归零。
 * 其余七类升档起点 = 等待起点。
 *
 * ── 为什么严重度 / 优先级也算在 SQL 里 ──
 * 告警作业要「最久的前 50 条」，minAge 与 limit 必须落在库里；而 limit 之前要排序，排序键
 * 就是严重度与优先级——所以它们不能等到 TS 再算。进度键 / 跳转路径 / id 只是对已选行的
 * 一一映射，留在 TS（便于单测）。
 *
 * ── 为什么不是一条大 SQL，而是按类别拼片段 ──
 * Postgres 对语句里**出现过的每一个关系**查权限，不管那一支会不会返回行、外层有没有把它
 * 的类别过滤掉。一条把全部类别写进去的 SQL 会同时引用 `account.users` / `account.user_profiles` /
 * `admin.risk_records` / `session.auth_sessions` / `tenancy.tenant_contacts`——而告警作业的
 * 库角色 `svc_platform_api` 只有 7 个 schema（metering / product / sharing / provisioning /
 * tenancy / billing / promotion）外加逐条写明的表级例外（`kyc.tenant_verifications` /
 * `support.tickets` / `admin.maintenance_windows` 等，见
 * `deploy/database/ddl/97_service_roles.sql` 末尾）。那条 SQL 在本机（owner 连库）畅通无阻，
 * 到生产就是 `42501 permission denied for schema session`，整轮作业失败——而这正是那种
 * 本机怎么跑都跑不出来的坏法。
 *
 * 所以：**请求哪几类，就只把那几类的 CTE 拼进文本**（`buildListOpsTodosSql`）。
 * 片段都是整块静态字符串，按数组顺序 join，SQL 里不做任何插值；变的只有「拼哪几块」。
 *
 * ── 跨 schema 富化块（includeApplicant）──
 * 就算只拼订单 / 退款两类，申报人（`account.users` / `account.user_profiles`）与租户风险档
 * （`admin.risk_records`）仍在那两个 schema 之外。这两样是**给人看的富化信息**，告警邮件
 * 一个都不用（见 operator-alerts.wiring 的 todoAlertInput：只用 tenant.name / amount /
 * product / waitingSince）。于是它们收在一块「富化列 + 富化 join」里，由 `includeApplicant`
 * 整块开关：
 *   · 页面（admin-bff，角色有 account / admin / kyc / session）不传 → 要，字段齐全；
 *   · 告警作业（platform-api）传 false → 不要，`applicant` 与 `tenant.riskLevel` 为 null，
 *     文本里一个 `account.` / `admin.` 都不出现。
 * `scripts/guardrails/check-ops-todo-alerts.mjs` 第 5 段拿 97 的授权面对账这件事——
 * 往 `*_FROM` / `*_HEAD` / `*_LEAN_COLUMNS` 里加一个越界的 join，守卫当场红。
 * 真判据是 `ops-todos.itest.spec.ts` 里那一条：`set role svc_platform_api` 之后跑作业那个
 * 调用形状，跑得通才算。
 *
 * ── 工单「未关闭」──
 * 页面的判据是**归一后**的状态 ≠ closed（tickets.router.normalizeTicketStatus：resolved /
 * cancelled 都归 closed）。所以这里排除 resolved / closed / cancelled，而不是只排 'closed'
 * ——已解决的工单不是待办。`reopened` 算**未结**（tickets.router 把它落到 closed 是漏项；
 * tenants.router 的 TENANT_OPEN_TICKET_STATUSES 与 72_support.sql 的 CHECK 都把它当未结），
 * 且「重开过」本身值得升一档，所以它与 p0 同进 rose。
 * 判据只认 CHECK 里真有的那七个值（open / pending / in_progress / resolved / closed /
 * reopened / cancelled）——初版还写了 blocked / waiting / new / processing 四个分支，
 * 库里永远不会出现它们，那种分支不报错、只是让人以为覆盖得很全。
 *
 * ── 谁在等（applicant）──
 * 订单：最近账单上最近一条**客户**支付腿的 actor（申报腿只可能由客户写；按 actor_type 解
 * 引用是本库边界约定），没有就退回租户 owner；退款：客户创建的退款单取 created_by_id，
 * 运营代建的退回 owner。租户类：owner。工单：指派人 / 报单人 / 主联系人（与工单列表同款）。
 * 这一层给的是**原文**：脱敏在读方（admin-bff 的 ops-todos.router 按 user:pii.read 掩码，
 * 与 orders.router 的 declaredBy 同一道闸门、同一套掩码函数）。
 *
 * 参数全部绑定（$1 类别数组 / $2 最短停留分钟 / $3 limit / $4..$15 十二个时长阈值），
 * `$n is null` 写进谓词而不是 JS 拼 where——SQL 一旦插值，lint:anchor-writes 那一族
 * 静态守卫就读不懂它。
 *
 * ── 为什么十二个阈值全在外层用到 ──
 * 绑定参数的**个数**由文本决定：Postgres 会拿「文本里出现过的最大 $n」和送来的参数个数
 * 对账，多一个就是 `bind message supplies 9 parameters, but prepared statement requires 7`。
 * 而本文件按类别拼文本——某个只在可选片段里出现的 $n，在不含那片段的那一拼里就消失了。
 * 所以两个「成熟」阈值（$8 订单挂账 / $9 退款卡住）不写在片段的 where 里，而是写成外层
 * 「等待起点 + 本类别的成熟期 <= now()」——外层永远都在，参数个数于是恒为 15。
 * 它与片段里写一遍等价（等待起点正是那两类要计时的那一列），而且少一处重复。
 * 退款片段的 `escalate_from` 也引用 $9（卡住时刻 = updated_at + $9），那是**第二次**出现，
 * 不是唯一一次——tail 里那一次保证了它在每一拼都在。
 */

import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { OPS_TODOS_PG_POOL } from "../tokens";
import {
  OPS_TODO_KINDS,
  type ListOpsTodosOptions,
  type OpsTodo,
  type OpsTodoKind,
  type OpsTodoProgress,
  type OpsTodoSeverity,
  type OpsTodoSubjectType,
  type OpsTodoThresholds,
} from "../types";

/** 页面不传 limit 时的上限：此前页面拿的是 500 租户 + 全部订单 + 全部工单，2000 够用且有界。 */
export const DEFAULT_LIST_LIMIT = 2000;
export const MAX_LIST_LIMIT = 5000;

/**
 * 每个片段的投影列**逐一对齐**（union all 按位置对齐，多一列少一列就炸）。
 * 富化的四列（tenant_risk_level + applicant 三列）排在最后，好让「要 / 不要」
 * 换掉整块尾巴，中间的列一个都不用动。导出仅为可测。
 *
 * `subject_key` 是**身份**、`subject_no` 是**称呼**，两件事：绝大多数类别的可视码
 * 本身就唯一（订单号 / 退款号 / 发票号 / 工单号 / 用户号），那几段这一列给 null，
 * 身份就退回 subject_no。只有维护窗口不唯一（admin.maintenance_windows.title 上
 * 没有唯一约束，运营会重复用「例行维护」），它给窗口自己的主键——见
 * MAINTENANCE_TODOS_HEAD 那一段。这一列**只进 OpsTodo.id**，不上屏（见 mapOpsTodoRow）。
 */
export const TODO_COLUMN_ORDER: readonly string[] = [
  "kind",
  "subject_type",
  "subject_no",
  "subject_key",
  "order_no",
  "tenant_no",
  "tenant_name",
  "tenant_type",
  "tenant_status",
  "tenant_region",
  "tenant_industry",
  "tenant_scale",
  "amount_value",
  "amount_paid",
  "amount_currency",
  "product_code",
  "product_name",
  "plan_name",
  "severity",
  "priority",
  "waiting_since",
  // 升档起点；null = 用 waiting_since（见头注「升档」）。只进外层算法，不进契约。
  "escalate_from",
  "ticket_title",
  "ticket_priority",
  "ticket_status",
  "tenant_risk_level",
  "applicant_name",
  "applicant_email",
  "applicant_phone",
];

// ── 租户风险档：未复核（reviewer_id is null）记录里最高的一档 ────────────────
// 与 tenants.router 的租户投影同一判据。没有未复核记录 → null（不兜 'normal'：
// 「没有记录」与「复核过是正常」不是一件事，页面显示「—」而不是一个档位）。
// 只出现在富化块里——`admin` 不在 svc_platform_api 的授权面内。
const RISK_LEVEL_SUBQUERY = `(
      select rr.risk_level from admin.risk_records rr
       where rr.tenant_id = t.id and rr.deleted_at is null and rr.reviewer_id is null
       order by case rr.risk_level when 'high' then 0 when 'follow_up' then 1 else 2 end
       limit 1
    )`;

// ── order_todos：四类收款待办，按 case o.status 一分为三，pending_payment 再按账单分两支 ──
// `pending_payment` 那一支的内层 case 是本批新加的第四类（挂着没人付的单）。外层仍然是
// `case o.status when …`：check-ops-todo-alerts 第 3 段从这段文本解析「原始订单态 → 待办类」，
// 改成 `case when o.status = …` 会让那段守卫解析不到而直接拒绝给结论。
export const ORDER_TODOS_HEAD = `order_todos as (
  select
    case o.status
      when 'pending_verify'  then 'confirm_payment'
      when 'paid'            then 'reprovision'
      when 'pending_payment' then
        case when inv.bill_status = 'partial' then 'follow_up_balance'
             else 'order_pending_payment_aging' end
    end                                                    as kind,
    'order'::text                                          as subject_type,
    o.order_no                                             as subject_no,
    null::text                                             as subject_key,
    o.order_no                                             as order_no,
    t.tenant_no::text                                      as tenant_no,
    coalesce(nullif(t.display_name, ''), t.name)           as tenant_name,
    case when t.type = 'personal' then 'individual' else 'company' end as tenant_type,
    t.status                                               as tenant_status,
    coalesce(nullif(tp.address, ''), nullif(tp.country_code, '')) as tenant_region,
    nullif(tp.industry, '')                                as tenant_industry,
    nullif(tp.scale, '')                                   as tenant_scale,
    o.payable_amount::text                                 as amount_value,
    case when o.status = 'pending_payment' and inv.bill_status = 'partial'
         then inv.paid_amount::text end                    as amount_paid,
    o.currency                                             as amount_currency,
    p.product_code                                         as product_code,
    p.product_name                                         as product_name,
    pl.plan_name                                           as plan_name,
    case o.status
      when 'pending_verify' then 'rose'
      when 'paid'           then 'rose'
      when 'pending_payment' then
        case when inv.bill_status = 'partial' then 'amber' else 'blue' end
    end                                                    as severity,
    case o.status
      when 'pending_verify' then 2
      when 'paid'           then 3
      when 'pending_payment' then
        case when inv.bill_status = 'partial' then 15 else 40 end
    end                                                    as priority,
    case o.status
      when 'pending_verify' then coalesce(o.declared_at, o.updated_at)
      when 'paid'           then coalesce(o.paid_at, o.updated_at)
      when 'pending_payment' then
        case when inv.bill_status = 'partial' then o.updated_at else o.created_at end
    end                                                    as waiting_since,
    null::timestamptz                                      as escalate_from,
    null::text as ticket_title, null::text as ticket_priority, null::text as ticket_status,`;

export const ORDER_TODOS_RICH_COLUMNS = `    ${RISK_LEVEL_SUBQUERY}   as tenant_risk_level,
    coalesce(nullif(dup.display_name, ''), du.account,
             nullif(oup.display_name, ''), ou.account)     as applicant_name,
    case when du.id is not null then du.email else ou.email end as applicant_email,
    case when du.id is not null then du.phone else ou.phone end as applicant_phone`;

export const ORDER_TODOS_LEAN_COLUMNS = `    null::text as tenant_risk_level,
    null::text as applicant_name,
    null::text as applicant_email,
    null::text as applicant_phone`;

export const ORDER_TODOS_FROM = `  from billing.orders o
  join tenancy.tenants t on t.id = o.tenant_id
  left join tenancy.tenant_profiles tp on tp.tenant_id = t.id
  left join product.products p on p.id = o.product_id
  left join product.plan_versions pv on pv.id = o.plan_version_id
  left join product.plans pl on pl.id = pv.plan_id
  left join lateral (
    select i.id, i.bill_status, i.paid_amount
      from billing.invoices i
     where i.order_id = o.id and i.deleted_at is null
     order by i.created_at desc
     limit 1
  ) inv on true`;

export const ORDER_TODOS_RICH_JOINS = `  left join account.users ou on ou.id = t.owner_user_id
  left join account.user_profiles oup on oup.user_id = ou.id
  left join lateral (
    select pay.actor_id
      from billing.payments pay
     where pay.bill_id = inv.id and pay.actor_type = 'customer'
     order by (pay.pay_status = 'pending_verify') desc, pay.created_at desc
     limit 1
  ) leg on true
  left join account.users du on du.id = leg.actor_id
  left join account.user_profiles dup on dup.user_id = du.id`;

// 第三支（挂着没人付的单）只写「待付款 + 从没申报过」；「挂了多久才算」在外层按
// $8 判（见头注「为什么十二个阈值全在外层用到」）。已申报过的待付款单不在此列——
// 那是客户付了一部分或正在付，不是没人管。
export const ORDER_TODOS_WHERE = `  where o.status in ('pending_verify', 'paid')
     or (o.status = 'pending_payment' and inv.bill_status = 'partial')
     or (o.status = 'pending_payment' and o.declared_at is null)
)`;

// ── refund_todos：退款单的四类待办 ───────────────────────────────────────────
// 2026-09-28 首批只做了「待审核」；第三批把另外三格补齐——审过没执行、执行卡住、执行失败。
// 客户的钱在外面，这三格每一格都是钱没回去而没人知道。
// 2026-12-01 起 processing 有了写入方（OrderService.initiateRefundTransfer，「已发起转账」）：
// 卡住那一格的时钟是 transfer_initiated_at（发起时刻），waiting_since 与 escalate_from 两处
// 都读它——成熟门（外层 where）读的是 waiting_since，只改 escalate_from 治不到「改一次备注
// 就把卡住时长归零」的病。refund_execute 的含义随之收紧为「审过没发起转账」，谓词不变。
//
// 两根状态机（audit_status → refund_status）叉乘 12 格，落在待办里的只有四格：
//   pending  × pending     待审核        refund_audit
//   approved × pending     审过没退      refund_execute
//   *        × processing   在退款中卡住  refund_processing_stuck
//   *        × failed       退款失败      refund_failed
// 剩下的：rejected × pending 是「驳回了、不退」（办完了）；× success 是退成了；
// 而 rejected/pending × processing|success|failed 被 DDL 的 chk_refunds_execute_needs_approval
// 挡着（只有审核通过的单才允许离开 pending），所以后两格里 audit_status 恒为 approved。
export const REFUND_TODOS_HEAD = `refund_todos as (
  select
    case
      when r.refund_status = 'failed'     then 'refund_failed'
      when r.refund_status = 'processing' then 'refund_processing_stuck'
      when r.audit_status  = 'approved'   then 'refund_execute'
      else 'refund_audit'
    end                                                    as kind,
    'refund'::text                                         as subject_type,
    r.refund_no                                            as subject_no,
    null::text                                             as subject_key,
    ord.order_no                                           as order_no,
    t.tenant_no::text                                      as tenant_no,
    coalesce(nullif(t.display_name, ''), t.name)           as tenant_name,
    case when t.type = 'personal' then 'individual' else 'company' end as tenant_type,
    t.status                                               as tenant_status,
    coalesce(nullif(tp.address, ''), nullif(tp.country_code, '')) as tenant_region,
    nullif(tp.industry, '')                                as tenant_industry,
    nullif(tp.scale, '')                                   as tenant_scale,
    r.refund_amount::text                                  as amount_value,
    null::text                                             as amount_paid,
    coalesce(r.currency, 'CNY')                            as amount_currency,
    p.product_code                                         as product_code,
    p.product_name                                         as product_name,
    pl.plan_name                                           as plan_name,
    'rose'::text                                           as severity,
    case
      when r.refund_status = 'failed'     then 4
      when r.refund_status = 'processing' then 6
      when r.audit_status  = 'approved'   then 3
      else 2
    end                                                    as priority,
    case
      when r.refund_status = 'pending' and r.audit_status = 'approved'
        then coalesce(r.audit_at, r.updated_at)
      when r.refund_status = 'pending'
        then r.created_at
      when r.refund_status = 'processing'
        then r.transfer_initiated_at
      else r.updated_at
    end                                                    as waiting_since,
    case when r.refund_status = 'processing'
         then r.transfer_initiated_at + make_interval(hours => $9::int) end as escalate_from,
    null::text as ticket_title, null::text as ticket_priority, null::text as ticket_status,`;

export const REFUND_TODOS_RICH_COLUMNS = `    ${RISK_LEVEL_SUBQUERY}   as tenant_risk_level,
    coalesce(nullif(cup.display_name, ''), cu.account,
             nullif(oup.display_name, ''), ou.account)     as applicant_name,
    case when cu.id is not null then cu.email else ou.email end as applicant_email,
    case when cu.id is not null then cu.phone else ou.phone end as applicant_phone`;

export const REFUND_TODOS_LEAN_COLUMNS = `    null::text as tenant_risk_level,
    null::text as applicant_name,
    null::text as applicant_email,
    null::text as applicant_phone`;

export const REFUND_TODOS_FROM = `  from billing.refunds r
  join tenancy.tenants t on t.id = r.tenant_id
  left join tenancy.tenant_profiles tp on tp.tenant_id = t.id
  left join billing.invoices i on i.id = r.bill_id
  -- 退款单可能没直接挂订单（order_id 可空）；那就顺账单找回它。
  left join billing.orders ord on ord.id = coalesce(r.order_id, i.order_id)
  left join product.products p on p.id = ord.product_id
  left join product.plan_versions pv on pv.id = ord.plan_version_id
  left join product.plans pl on pl.id = pv.plan_id`;

export const REFUND_TODOS_RICH_JOINS = `  left join account.users ou on ou.id = t.owner_user_id
  left join account.user_profiles oup on oup.user_id = ou.id
  left join account.users cu
    on cu.id = r.created_by_id and r.created_by_type = 'customer'
  left join account.user_profiles cup on cup.user_id = cu.id`;

// 「在 processing 里卡了多久才算卡住」在外层按 $9 判（见头注）。
export const REFUND_TODOS_WHERE = `  where (r.refund_status = 'pending' and r.audit_status in ('pending', 'approved'))
     or r.refund_status in ('processing', 'failed')
)`;

// ── subscription_todos：欠费宽限期里的订阅（第三批）───────────────────────────
// `overdue` 是「服务还在、钱没到」那一档（subscription.service.markOverdue，S8）。客户已经
// 收到催款通知，运营这边此前一条都没有——续费单挂在那儿、宽限期在走，没人盯。
//
// 主体没有自己的可视码：metering.subscriptions 只有 uuid。所以取「最近一次履约本行的订单」
// 的 order_no（current_order_id），它既是可视码又是点开就能办事的那一页；查不到就退回
// 工作空间号（workspace_id 是 NOT NULL + 跨 schema FK，所以这一格一定拿得到东西）。
// admin 的订阅详情路由 `/subscriptions/[subscriptionId]` **双接受**（订单号或 uuid，见
// subscriptions.router 的 resolveSubscriptionId），所以订单号那一支点开就是这条订阅；
// 退回工作空间号时不拼详情链接（它不是那条路由认的键），只给列表页。
//
// 金额故意不给：欠的是**续费单**上的钱，不是本行的 pay_amount（那是上一个周期实付的快照）。
// 拿一个像是的数上屏，比不给更坏——运营会照它去对账（同「代理值要问还有谁写它」）。
export const SUBSCRIPTION_TODOS_HEAD = `subscription_todos as (
  select
    'subscription_overdue'::text                           as kind,
    'subscription'::text                                   as subject_type,
    coalesce(ord.order_no, w.workspace_no::text)           as subject_no,
    null::text                                             as subject_key,
    ord.order_no                                           as order_no,
    t.tenant_no::text                                      as tenant_no,
    coalesce(nullif(t.display_name, ''), t.name)           as tenant_name,
    case when t.type = 'personal' then 'individual' else 'company' end as tenant_type,
    t.status                                               as tenant_status,
    coalesce(nullif(tp.address, ''), nullif(tp.country_code, '')) as tenant_region,
    nullif(tp.industry, '')                                as tenant_industry,
    nullif(tp.scale, '')                                   as tenant_scale,
    null::text as amount_value, null::text as amount_paid, null::text as amount_currency,
    p.product_code                                         as product_code,
    p.product_name                                         as product_name,
    pl.plan_name                                           as plan_name,
    'amber'::text                                          as severity,
    12                                                     as priority,
    coalesce(hist.entered_at, s.end_at, s.updated_at)      as waiting_since,
    null::timestamptz                                      as escalate_from,
    null::text as ticket_title, null::text as ticket_priority, null::text as ticket_status,`;

export const SUBSCRIPTION_TODOS_RICH_COLUMNS = `    ${RISK_LEVEL_SUBQUERY}   as tenant_risk_level,
    coalesce(nullif(oup.display_name, ''), ou.account)     as applicant_name,
    ou.email                                               as applicant_email,
    ou.phone                                               as applicant_phone`;

export const SUBSCRIPTION_TODOS_LEAN_COLUMNS = `    null::text as tenant_risk_level,
    null::text as applicant_name,
    null::text as applicant_email,
    null::text as applicant_phone`;

// 「进入 overdue 的时刻」只在变更审计里：repo.update 每次改状态都插一条 history
// （from_status → to_status），markOverdue 走的正是它。多次进出取最近一条。
export const SUBSCRIPTION_TODOS_FROM = `  from metering.subscriptions s
  join tenancy.tenants t on t.id = s.tenant_id
  left join tenancy.tenant_profiles tp on tp.tenant_id = t.id
  left join tenancy.workspaces w on w.id = s.workspace_id
  left join billing.orders ord on ord.id = s.current_order_id
  left join product.products p on p.id = s.product_id
  left join product.plan_versions pv on pv.id = s.plan_version_id
  left join product.plans pl on pl.id = pv.plan_id
  left join lateral (
    select max(sh.created_at) as entered_at
      from metering.subscription_histories sh
     where sh.subscription_id = s.id and sh.to_status = 'overdue'
  ) hist on true`;

export const SUBSCRIPTION_TODOS_RICH_JOINS = `  left join account.users ou on ou.id = t.owner_user_id
  left join account.user_profiles oup on oup.user_id = ou.id`;

export const SUBSCRIPTION_TODOS_WHERE = `  where s.status = 'overdue' and s.deleted_at is null
)`;

// ── invoice_todos：等运营办的两档开票（第三批）─────────────────────────────────
// applying = 等审核，approved = 审过了等开具并回填发票号 / 文件。issued / sent 已经办完，
// rejected / voided 是结论，都不是待办。两档都落在 /invoices 那一页上办。
export const INVOICE_TODOS_HEAD = `invoice_todos as (
  select
    case ir.invoice_status
      when 'applying' then 'invoice_applying'
      when 'approved' then 'invoice_approved'
    end                                                    as kind,
    'invoice'::text                                        as subject_type,
    ir.invoice_no                                          as subject_no,
    null::text                                             as subject_key,
    null::text                                             as order_no,
    t.tenant_no::text                                      as tenant_no,
    coalesce(nullif(t.display_name, ''), t.name)           as tenant_name,
    case when t.type = 'personal' then 'individual' else 'company' end as tenant_type,
    t.status                                               as tenant_status,
    coalesce(nullif(tp.address, ''), nullif(tp.country_code, '')) as tenant_region,
    nullif(tp.industry, '')                                as tenant_industry,
    nullif(tp.scale, '')                                   as tenant_scale,
    ir.invoice_amount::text                                as amount_value,
    null::text                                             as amount_paid,
    coalesce(ir.currency, 'CNY')                           as amount_currency,
    null::text as product_code, null::text as product_name, null::text as plan_name,
    'amber'::text                                          as severity,
    case ir.invoice_status when 'applying' then 18 else 19 end as priority,
    case ir.invoice_status
      when 'applying' then ir.created_at
      else coalesce(ir.audit_at, ir.updated_at)
    end                                                    as waiting_since,
    null::timestamptz                                      as escalate_from,
    null::text as ticket_title, null::text as ticket_priority, null::text as ticket_status,`;

export const INVOICE_TODOS_RICH_COLUMNS = `    ${RISK_LEVEL_SUBQUERY}   as tenant_risk_level,
    coalesce(nullif(oup.display_name, ''), ou.account)     as applicant_name,
    ou.email                                               as applicant_email,
    ou.phone                                               as applicant_phone`;

export const INVOICE_TODOS_LEAN_COLUMNS = `    null::text as tenant_risk_level,
    null::text as applicant_name,
    null::text as applicant_email,
    null::text as applicant_phone`;

export const INVOICE_TODOS_FROM = `  from billing.invoice_receipts ir
  join tenancy.tenants t on t.id = ir.tenant_id
  left join tenancy.tenant_profiles tp on tp.tenant_id = t.id`;

export const INVOICE_TODOS_RICH_JOINS = `  left join account.users ou on ou.id = t.owner_user_id
  left join account.user_profiles oup on oup.user_id = ou.id`;

export const INVOICE_TODOS_WHERE = `  where ir.invoice_status in ('applying', 'approved') and ir.deleted_at is null
)`;

// ── addon_todos：等运营核销的加油包单（第三批）─────────────────────────────────
// 谓词与 AddonService.listPendingOps 逐字同源（`ap.status = 'pending_payment'`）。那边
// 还按「有没有 pending_verify 的支付腿」排序——那是**排序**不是过滤，集合一样，所以这里
// 不抄那一段：本页的排序键是等得多久。
//
// `order_no` 这一列留 null 是**有意的**：加油包的单号住在 metering.addon_purchases，
// 与 billing.orders 的单号是两个命名空间（形状还长得一样）。填进去会让 hrefOf 拼出
// 一条 /orders/{加油包单号} 的死链。加油包在 /addon-orders 那一页办。
export const ADDON_TODOS_HEAD = `addon_todos as (
  select
    'addon_pending_confirm'::text                          as kind,
    'addon'::text                                          as subject_type,
    ap.order_no                                            as subject_no,
    null::text                                             as subject_key,
    null::text                                             as order_no,
    t.tenant_no::text                                      as tenant_no,
    coalesce(nullif(t.display_name, ''), t.name)           as tenant_name,
    case when t.type = 'personal' then 'individual' else 'company' end as tenant_type,
    t.status                                               as tenant_status,
    coalesce(nullif(tp.address, ''), nullif(tp.country_code, '')) as tenant_region,
    nullif(tp.industry, '')                                as tenant_industry,
    nullif(tp.scale, '')                                   as tenant_scale,
    ap.price::text                                         as amount_value,
    null::text                                             as amount_paid,
    ap.currency                                            as amount_currency,
    ap.pack_code                                           as product_code,
    ap.pack_name                                           as product_name,
    null::text                                             as plan_name,
    'rose'::text                                           as severity,
    7                                                      as priority,
    ap.created_at                                          as waiting_since,
    decl.declared_at                                       as escalate_from,
    null::text as ticket_title, null::text as ticket_priority, null::text as ticket_status,`;

export const ADDON_TODOS_RICH_COLUMNS = `    ${RISK_LEVEL_SUBQUERY}   as tenant_risk_level,
    coalesce(nullif(oup.display_name, ''), ou.account)     as applicant_name,
    ou.email                                               as applicant_email,
    ou.phone                                               as applicant_phone`;

export const ADDON_TODOS_LEAN_COLUMNS = `    null::text as tenant_risk_level,
    null::text as applicant_name,
    null::text as applicant_email,
    null::text as applicant_phone`;

// 申报腿 = 这张单的账单上最早一条 pending_verify 支付腿（AddonService.declare 只写这一种）；
// 它是升档起点（见头注「升档」），没有就 null → 不升档。等待列仍是 created_at。
export const ADDON_TODOS_FROM = `  from metering.addon_purchases ap
  join tenancy.tenants t on t.id = ap.tenant_id
  left join tenancy.tenant_profiles tp on tp.tenant_id = t.id
  left join lateral (
    select min(p.created_at) as declared_at
      from billing.payments p
     where p.bill_id = ap.invoice_id and p.pay_status = 'pending_verify'
  ) decl on true`;

export const ADDON_TODOS_RICH_JOINS = `  left join account.users ou on ou.id = t.owner_user_id
  left join account.user_profiles oup on oup.user_id = ou.id`;

export const ADDON_TODOS_WHERE = `  where ap.status = 'pending_payment'
)`;

// ── user_todos：自助注销的两档（第三批）───────────────────────────────────────
// status='deleting' 起 30 天保留期（050-account §7），到期由清扫作业物理清掉。运营要看见
// 两件事：①有人在等注销（deletion_pending，一般档）②再过 3 天就清了，此时还想挽回 /
// 核对遗留（purge_imminent，关注档）。27 天这个数就是「30 天保留期只剩 3 天」。
//
// 主体是**人**不是租户，所以整块租户列都是 null（页面显示「—」）；「谁在等」放 applicant
// ——本片段的底表就是 account.users，那是这一族里唯一不需要额外跨 schema join 的一处。
// 这两类从不进 ALERT_KINDS（blue / amber），所以这一段不会被拼进作业那一拼。
export const USER_TODOS_HEAD = `user_todos as (
  select
    case when dl.purge_soon then 'purge_imminent' else 'deletion_pending' end as kind,
    'user'::text                                           as subject_type,
    u.user_no::text                                        as subject_no,
    null::text                                             as subject_key,
    null::text                                             as order_no,
    null::text as tenant_no, null::text as tenant_name, null::text as tenant_type,
    null::text as tenant_status,
    null::text as tenant_region, null::text as tenant_industry, null::text as tenant_scale,
    null::text as amount_value, null::text as amount_paid, null::text as amount_currency,
    null::text as product_code, null::text as product_name, null::text as plan_name,
    case when dl.purge_soon then 'amber' else 'blue' end   as severity,
    case when dl.purge_soon then 16 else 45 end            as priority,
    coalesce(u.deletion_requested_at, u.updated_at)        as waiting_since,
    null::timestamptz                                      as escalate_from,
    null::text as ticket_title, null::text as ticket_priority, null::text as ticket_status,`;

export const USER_TODOS_RICH_COLUMNS = `    null::text                                             as tenant_risk_level,
    coalesce(nullif(up.display_name, ''), u.account)       as applicant_name,
    u.email                                                as applicant_email,
    u.phone                                                as applicant_phone`;

export const USER_TODOS_LEAN_COLUMNS = `    null::text as tenant_risk_level,
    null::text as applicant_name,
    null::text as applicant_email,
    null::text as applicant_phone`;

export const USER_TODOS_FROM = `  from account.users u
  cross join lateral (
    select (u.deletion_requested_at is not null
            and u.deletion_requested_at + interval '27 days' <= now()) as purge_soon
  ) dl`;

export const USER_TODOS_RICH_JOINS = `  left join account.user_profiles up on up.user_id = u.id`;

export const USER_TODOS_WHERE = `  where u.status = 'deleting' and u.deleted_at is null
)`;

// ── maintenance_todos：超过计划结束时间还没收的维护窗口（第三批）───────────────
// 窗口一直 in_progress 就意味着产品页还挂着「维护中」、客户还在被拦着。这一条不是运维的
// 便利项：计划 30 分钟的窗口开了 6 小时没人 complete，客户看到的就是产品坏了。
//
// 主体没有可视码（表里只有 uuid 与 title），所以称呼用 title——与批二审计通告对同一件事
// 的称呼一致。租户 / 金额 / 产品整块为 null：窗口不属于任何租户。
//
// 但称呼不能当身份：`title` 是 varchar(256) 且**没有唯一约束**，运营重复用「例行维护」
// 这种名字是常态。两个同名窗口同时超时，按 title 算的待办 id 会撞成一条——页面上少一行、
// 告警的静默窗口把后一条吞掉，而且不报错。所以身份走 `subject_key` = 窗口主键
// （`mw.id`），称呼仍走 `subject_no` = title。**这一列不上屏**：mapOpsTodoRow 只把它
// 拼进 OpsTodo.id（React key 与告警的去重键），href / 主体码 / 标题 / 正文一个都不取它
// ——「任何场景不展示 UUID」那条铁律没有例外。
// href 在 TS 里给 null：出路是 opera 的 /ops/maintenance-windows，而 href 是**平面内**
// 相对路径，admin 里没有这一页（给了就是点开 404）。
export const MAINTENANCE_TODOS_HEAD = `maintenance_todos as (
  select
    'maintenance_overdue'::text                            as kind,
    'maintenance'::text                                    as subject_type,
    mw.title                                               as subject_no,
    mw.id::text                                            as subject_key,
    null::text                                             as order_no,
    null::text as tenant_no, null::text as tenant_name, null::text as tenant_type,
    null::text as tenant_status,
    null::text as tenant_region, null::text as tenant_industry, null::text as tenant_scale,
    null::text as amount_value, null::text as amount_paid, null::text as amount_currency,
    null::text as product_code, null::text as product_name, null::text as plan_name,
    'rose'::text                                           as severity,
    9                                                      as priority,
    mw.end_at                                              as waiting_since,
    null::timestamptz                                      as escalate_from,
    null::text as ticket_title, null::text as ticket_priority, null::text as ticket_status,`;

/**
 * 富化块与精简块同一段文本：这一类没有租户，风险档与申报人都没有来源。
 * 不是「暂时不给」，是这四列对维护窗口不存在——所以 includeApplicant 两版都一样。
 */
export const MAINTENANCE_TODOS_COLUMNS = `    null::text as tenant_risk_level,
    null::text as applicant_name,
    null::text as applicant_email,
    null::text as applicant_phone`;

export const MAINTENANCE_TODOS_FROM = `  from admin.maintenance_windows mw`;

export const MAINTENANCE_TODOS_WHERE = `  where mw.status = 'in_progress' and mw.end_at < now()
)`;

// ── tenant_base：风险那一类的租户底座 ──────────────────────────────────────
// 它天生跨 admin / session 两个 schema——风险档、最近活跃都在那边。risk **从不**被告警
// 作业请求（check-ops-todo-alerts 的 UNRULED，且 admin.risk_records 被三份已合并迁移断言
// 为 0 项权限），所以底座整块只在 risk 入选时才拼进文本。
// 2026-10-04 起 verification 不再从这里投影：认证那一类真正需要的只有
// tenancy.tenants.verification_status 与 kyc.tenant_verifications.created_at，拆成自己的
// 片段（VERIFICATION_TODOS_*）之后作业角色跑得通，它才进得了作业的 NOTICE_ONLY_KINDS。
export const TENANT_BASE_HEAD = `tenant_base as (
  select
    t.id,
    t.tenant_no::text                                      as tenant_no,
    coalesce(nullif(t.display_name, ''), t.name)           as tenant_name,
    case when t.type = 'personal' then 'individual' else 'company' end as tenant_type,
    t.status,
    coalesce(nullif(tp.address, ''), nullif(tp.country_code, '')) as region,
    nullif(tp.industry, '')                                as industry,
    nullif(tp.scale, '')                                   as scale,
    t.created_at,
    ${RISK_LEVEL_SUBQUERY}                                 as risk_level,
    -- 最近活跃 = 成员在 customer realm 的会话最近活动时刻（与租户页同源）。
    (
      select max(ses.last_active_at)
        from session.auth_sessions ses
        join tenancy.tenant_memberships m on m.user_id = ses.user_id
       where m.tenant_id = t.id and m.status <> 'removed' and ses.realm = 'customer'
    )                                                      as last_active_at,`;

export const TENANT_BASE_RICH_COLUMNS = `    coalesce(nullif(oup.display_name, ''), ou.account)     as owner_name,
    ou.email                                               as owner_email,
    ou.phone                                               as owner_phone`;

export const TENANT_BASE_LEAN_COLUMNS = `    null::text as owner_name,
    null::text as owner_email,
    null::text as owner_phone`;

export const TENANT_BASE_FROM = `  from tenancy.tenants t
  left join tenancy.tenant_profiles tp on tp.tenant_id = t.id`;

export const TENANT_BASE_RICH_JOINS = `  left join account.users ou on ou.id = t.owner_user_id
  left join account.user_profiles oup on oup.user_id = ou.id`;

export const TENANT_BASE_WHERE = `  where t.deleted_at is null
    and (
      t.status = 'suspended'
      or exists (
        select 1 from admin.risk_records rr
         where rr.tenant_id = t.id and rr.deleted_at is null
           and rr.reviewer_id is null and rr.risk_level <> 'normal'
      )
    )
)`;

// ── verification_todos：认证 pending 的租户（2026-10-04 从底座拆出）────────────
// 此前它是对 tenant_base 的投影，而底座天生跨 kyc / admin / session 三个 schema。认证这
// 一类真正需要的只有 tenancy.tenants.verification_status 与 kyc.tenant_verifications 的
// 最近一次提交时刻——后者 97 已授 SELECT（2026-11-23 迁移灌活库），tenancy 整 schema 在
// 授权面内。拆出来之后作业角色 svc_platform_api 跑得通，风险档只在富化块里取（admin
// 不在授权面内）。这正是它能进作业的 NOTICE_ONLY_KINDS 而**零授权变更**的原因；
// check-ops-todo-alerts 第 5 段按 97 对账下面四段 LEAN 片段，itest 的 set role 用例真跑。
export const VERIFICATION_TODOS_HEAD = `verification_todos as (
  select
    'verification'::text                                   as kind,
    'tenant'::text                                         as subject_type,
    t.tenant_no::text                                      as subject_no,
    null::text                                             as subject_key,
    null::text                                             as order_no,
    t.tenant_no::text                                      as tenant_no,
    coalesce(nullif(t.display_name, ''), t.name)           as tenant_name,
    case when t.type = 'personal' then 'individual' else 'company' end as tenant_type,
    t.status                                               as tenant_status,
    coalesce(nullif(tp.address, ''), nullif(tp.country_code, '')) as tenant_region,
    nullif(tp.industry, '')                                as tenant_industry,
    nullif(tp.scale, '')                                   as tenant_scale,
    null::text as amount_value, null::text as amount_paid, null::text as amount_currency,
    null::text as product_code, null::text as product_name, null::text as plan_name,
    'amber'::text                                          as severity,
    20                                                     as priority,
    coalesce(kv.submitted_at, t.created_at)                as waiting_since,
    null::timestamptz                                      as escalate_from,
    null::text as ticket_title, null::text as ticket_priority, null::text as ticket_status,`;

export const VERIFICATION_TODOS_RICH_COLUMNS = `    ${RISK_LEVEL_SUBQUERY}   as tenant_risk_level,
    coalesce(nullif(oup.display_name, ''), ou.account)     as applicant_name,
    ou.email                                               as applicant_email,
    ou.phone                                               as applicant_phone`;

export const VERIFICATION_TODOS_LEAN_COLUMNS = `    null::text as tenant_risk_level,
    null::text as applicant_name,
    null::text as applicant_email,
    null::text as applicant_phone`;

// 最近一次认证提交 = kyc.tenant_verifications 里最新的一条；没有提交记录就退回租户创建时刻。
export const VERIFICATION_TODOS_FROM = `  from tenancy.tenants t
  left join tenancy.tenant_profiles tp on tp.tenant_id = t.id
  left join lateral (
    select tv.created_at as submitted_at
      from kyc.tenant_verifications tv
     where tv.tenant_id = t.id
     order by tv.created_at desc
     limit 1
  ) kv on true`;

export const VERIFICATION_TODOS_RICH_JOINS = `  left join account.users ou on ou.id = t.owner_user_id
  left join account.user_profiles oup on oup.user_id = ou.id`;

export const VERIFICATION_TODOS_WHERE = `  where t.deleted_at is null and t.verification_status = 'pending'
)`;

// ── risk：只是对底座的一次投影，没有自己的 join ─────────────────────────────
export const RISK_TODOS_CTE = `risk_todos as (
  select
    'risk'::text as kind, 'tenant'::text as subject_type, tenant_no as subject_no,
    null::text as subject_key,
    null::text as order_no,
    tenant_no as tenant_no, tenant_name as tenant_name, tenant_type as tenant_type,
    status as tenant_status,
    region as tenant_region, industry as tenant_industry, scale as tenant_scale,
    null::text as amount_value, null::text as amount_paid, null::text as amount_currency,
    null::text as product_code, null::text as product_name, null::text as plan_name,
    case when risk_level = 'high' or status = 'suspended' then 'rose' else 'amber' end as severity,
    case when risk_level = 'high' then 5 else 25 end as priority,
    -- 风险没有「进入风险态」的时刻列，只能拿最近活跃 / 创建时刻当起点。
    coalesce(last_active_at, created_at) as waiting_since,
    null::timestamptz as escalate_from,
    null::text as ticket_title, null::text as ticket_priority, null::text as ticket_status,
    risk_level as tenant_risk_level,
    owner_name as applicant_name, owner_email as applicant_email, owner_phone as applicant_phone
  from tenant_base
  where coalesce(risk_level, 'normal') <> 'normal' or status = 'suspended'
)`;

// ── ticket_todos：未结工单，首次响应超时的另算一类（ticket_sla，第三批）──────────
// 一张工单只出一条：SLA 破了就报 ticket_sla（更急、且等待起点从**建单**算，不从最近一次
// 改动算——`updated_at` 会被运营自己的任何一次改动推后，那正好把「没人回过」藏起来）。
// 首响 SLA 按优先级分四档（p0 1h / p1 4h / p2 24h / p3 72h），判据算在 FROM 的 lateral 里，
// 好让 kind / severity / priority / waiting_since 四处共用同一个布尔，不各写一遍。
export const TICKET_TODOS_HEAD = `ticket_todos as (
  select
    case when sla.breached then 'ticket_sla' else 'ticket' end as kind,
    'ticket'::text                                         as subject_type,
    k.ticket_no                                            as subject_no,
    null::text                                             as subject_key,
    null::text                                             as order_no,
    t.tenant_no::text                                      as tenant_no,
    coalesce(nullif(t.display_name, ''), t.name)           as tenant_name,
    case when t.type = 'personal' then 'individual' else 'company' end as tenant_type,
    t.status                                               as tenant_status,
    coalesce(nullif(tp.address, ''), nullif(tp.country_code, '')) as tenant_region,
    nullif(tp.industry, '')                                as tenant_industry,
    nullif(tp.scale, '')                                   as tenant_scale,
    null::text as amount_value, null::text as amount_paid, null::text as amount_currency,
    null::text as product_code, null::text as product_name, null::text as plan_name,
    case
      when sla.breached then 'rose'
      when k.priority = 'p0' or k.status = 'reopened' then 'rose'
      when k.priority = 'p1' then 'amber'
      else 'blue'
    end                                                    as severity,
    case when sla.breached
         then case k.priority when 'p0' then 1 when 'p1' then 6 when 'p2' then 8 else 9 end
         else case k.priority when 'p0' then 1 when 'p1' then 10 when 'p2' then 30 else 50 end
    end                                                    as priority,
    case when sla.breached then k.created_at else k.updated_at end as waiting_since,
    case when sla.breached then sla_at.deadline end        as escalate_from,
    k.title                                                as ticket_title,
    k.priority                                             as ticket_priority,
    k.status                                               as ticket_status,`;

export const TICKET_TODOS_RICH_COLUMNS = `    ${RISK_LEVEL_SUBQUERY}   as tenant_risk_level,
    coalesce(nullif(k.assignee_name, ''), nullif(k.reporter_name, ''), pc.name) as applicant_name,
    null::text                                             as applicant_email,
    null::text                                             as applicant_phone`;

export const TICKET_TODOS_LEAN_COLUMNS = `    null::text as tenant_risk_level,
    null::text as applicant_name,
    null::text as applicant_email,
    null::text as applicant_phone`;

// 首响时限（deadline）单独一段 lateral：它既是「破没破」的判据，也是 ticket_sla 的
// 升档起点（escalate_from，破约后每拖一个周期一级）。两处共用一个值，不各算一遍。
export const TICKET_TODOS_FROM = `  from support.tickets k
  join tenancy.tenants t on t.id = k.tenant_id
  left join tenancy.tenant_profiles tp on tp.tenant_id = t.id
  cross join lateral (
    select k.created_at + case k.priority
                            when 'p0' then interval '1 hour'
                            when 'p1' then interval '4 hours'
                            when 'p2' then interval '24 hours'
                            else interval '72 hours'
                          end                              as deadline
  ) sla_at
  cross join lateral (
    select (k.status in ('open', 'reopened')
            and k.first_response_at is null
            and sla_at.deadline <= now())                  as breached
  ) sla`;

export const TICKET_TODOS_RICH_JOINS = `  left join lateral (
    select c.name from tenancy.tenant_contacts c
     where c.tenant_id = t.id and c.contact_type = 'primary'
     order by c.created_at asc
     limit 1
  ) pc on true`;

export const TICKET_TODOS_WHERE = `  where k.deleted_at is null
    and k.status not in ('resolved', 'closed', 'cancelled')
)`;

/**
 * 外层：升档 + 类别 / 停留时长 / 成熟期过滤 + 排序 + limit。十五个参数全绑定。
 *
 * ── 升档（escalated 这一段 CTE）──
 * 十类有阈值（$4..$7 首批四类，$10..$15 2026-10-04 的六类），其余类别 `seconds` 为 null
 * → step 恒 0。step = 已等 / 阈值 的整数倍数，封顶 12；「已等」从 `escalate_from` 算，
 * 为 null 退回 `waiting_since`（见头注「升档」）。加油包那一行多包一层 case：没有申报腿
 * （escalate_from 为 null）就连阈值都不给——否则 coalesce 退回 created_at，把客户自己没付
 * 的时间算成运营超时。`nullif(…, 0)` 是安全带：阈值真被配成 0 时宁可不升档，也不要除出
 * 一个天文数字把每一条都染成「已超时」（TS 侧已把非正整数挡在外面，这里是第二道）。
 * check-ops-todo-alerts 第 7 段从 `case x.kind … end` 这一段解析「SQL 里真有阈值的类别」
 * 与它的裁定表对账——往这里加一行 `when '<kind>'` 而不登记，守卫当场红。
 *
 * ── 升档后的严重度才是排序键 ──
 * 所以 `severity_effective` 与 `severity_rank` 都在这里算：blue→amber→rose，rose 已是顶档
 * 就留在 rose。片段里的 `severity` 是**基准档**，仍原样带出来（读方不用它，留着是为了
 * 排查时能一眼看出「这条是升上来的还是本来就红」）。
 *
 * ── 成熟期（最后那一条 where）──
 * 两类待办要先等够时间才算成立：挂着没人付的单（$8 小时）、卡在 processing 的退款（$9 小时）。
 * 写在这里而不是片段里，是为了让 $8 / $9 在**每一拼**里都出现——参数个数由文本决定，
 * 少一个 $n 就是 bind 报错（见文件头注）。其余类别走 `make_interval(mins => 0)`，即不设门槛。
 */
export const LIST_OPS_TODOS_TAIL = `, escalated as (
  select x.*,
         case
           when thr.seconds is null then 0
           else least(greatest(floor(
                  extract(epoch from (now() - coalesce(x.escalate_from, x.waiting_since))) / thr.seconds
                ), 0), 12)::int
         end                                               as escalation_step
    from todos x
    cross join lateral (
      select nullif(case x.kind
               when 'confirm_payment' then $4::int * 3600
               when 'refund_audit'    then $5::int * 3600
               when 'reprovision'     then $6::int * 60
               when 'verification'    then $7::int * 86400
               when 'refund_execute'  then $10::int * 3600
               when 'refund_processing_stuck' then $11::int * 3600
               when 'refund_failed'   then $12::int * 3600
               when 'addon_pending_confirm'
                 then case when x.escalate_from is null then null else $13::int * 3600 end
               when 'ticket_sla'      then $14::int * 3600
               when 'maintenance_overdue' then $15::int * 60
             end, 0)::numeric                              as seconds
    ) thr
)
select y.*,
       (y.escalation_step >= 1)                            as escalated,
       case when y.escalation_step >= 1
            then case y.severity when 'blue' then 'amber' else 'rose' end
            else y.severity
       end                                                 as severity_effective,
       case when y.escalation_step >= 1
            then case y.severity when 'blue' then 1 else 0 end
            else case y.severity when 'rose' then 0 when 'amber' then 1 else 2 end
       end                                                 as severity_rank
  from escalated y
 where ($1::text[] is null or y.kind = any($1::text[]))
   and ($2::int is null or y.waiting_since + make_interval(mins => $2::int) <= now())
   and y.waiting_since + case y.kind
         when 'order_pending_payment_aging' then make_interval(hours => $8::int)
         when 'refund_processing_stuck'     then make_interval(hours => $9::int)
         else make_interval(mins => 0)
       end <= now()
 order by severity_rank, priority, waiting_since asc, subject_no asc
 limit $3::int`;

/** 一段可选拼进来的 CTE。`rich` / `lean` 只换投影尾巴与 join，其余共用。 */
interface TodoCteFragment {
  /** CTE 名，只用于 union 行的断言与报错信息。 */
  readonly cteName: string;
  /** 这一段产出哪些类别——任一类入选，本段就要拼。 */
  readonly kinds: readonly OpsTodoKind[];
  /** 要不要先拼 tenant_base 底座。 */
  readonly needsTenantBase: boolean;
  readonly head: string;
  readonly richColumns: string;
  readonly leanColumns: string;
  readonly from: string;
  readonly richJoins: string;
  readonly where: string;
  /** union 的第一行 / 后续行，整句静态，避免在 SQL 里插值表名。 */
  readonly selectAll: string;
  readonly unionAll: string;
}

const ORDER_FRAGMENT: TodoCteFragment = {
  cteName: "order_todos",
  kinds: [
    "confirm_payment",
    "reprovision",
    "follow_up_balance",
    "order_pending_payment_aging",
  ],
  needsTenantBase: false,
  head: ORDER_TODOS_HEAD,
  richColumns: ORDER_TODOS_RICH_COLUMNS,
  leanColumns: ORDER_TODOS_LEAN_COLUMNS,
  from: ORDER_TODOS_FROM,
  richJoins: ORDER_TODOS_RICH_JOINS,
  where: ORDER_TODOS_WHERE,
  selectAll: "  select * from order_todos",
  unionAll: "  union all select * from order_todos",
};

const REFUND_FRAGMENT: TodoCteFragment = {
  cteName: "refund_todos",
  kinds: [
    "refund_audit",
    "refund_execute",
    "refund_processing_stuck",
    "refund_failed",
  ],
  needsTenantBase: false,
  head: REFUND_TODOS_HEAD,
  richColumns: REFUND_TODOS_RICH_COLUMNS,
  leanColumns: REFUND_TODOS_LEAN_COLUMNS,
  from: REFUND_TODOS_FROM,
  richJoins: REFUND_TODOS_RICH_JOINS,
  where: REFUND_TODOS_WHERE,
  selectAll: "  select * from refund_todos",
  unionAll: "  union all select * from refund_todos",
};

const SUBSCRIPTION_FRAGMENT: TodoCteFragment = {
  cteName: "subscription_todos",
  kinds: ["subscription_overdue"],
  needsTenantBase: false,
  head: SUBSCRIPTION_TODOS_HEAD,
  richColumns: SUBSCRIPTION_TODOS_RICH_COLUMNS,
  leanColumns: SUBSCRIPTION_TODOS_LEAN_COLUMNS,
  from: SUBSCRIPTION_TODOS_FROM,
  richJoins: SUBSCRIPTION_TODOS_RICH_JOINS,
  where: SUBSCRIPTION_TODOS_WHERE,
  selectAll: "  select * from subscription_todos",
  unionAll: "  union all select * from subscription_todos",
};

const INVOICE_FRAGMENT: TodoCteFragment = {
  cteName: "invoice_todos",
  kinds: ["invoice_applying", "invoice_approved"],
  needsTenantBase: false,
  head: INVOICE_TODOS_HEAD,
  richColumns: INVOICE_TODOS_RICH_COLUMNS,
  leanColumns: INVOICE_TODOS_LEAN_COLUMNS,
  from: INVOICE_TODOS_FROM,
  richJoins: INVOICE_TODOS_RICH_JOINS,
  where: INVOICE_TODOS_WHERE,
  selectAll: "  select * from invoice_todos",
  unionAll: "  union all select * from invoice_todos",
};

const ADDON_FRAGMENT: TodoCteFragment = {
  cteName: "addon_todos",
  kinds: ["addon_pending_confirm"],
  needsTenantBase: false,
  head: ADDON_TODOS_HEAD,
  richColumns: ADDON_TODOS_RICH_COLUMNS,
  leanColumns: ADDON_TODOS_LEAN_COLUMNS,
  from: ADDON_TODOS_FROM,
  richJoins: ADDON_TODOS_RICH_JOINS,
  where: ADDON_TODOS_WHERE,
  selectAll: "  select * from addon_todos",
  unionAll: "  union all select * from addon_todos",
};

const USER_FRAGMENT: TodoCteFragment = {
  cteName: "user_todos",
  kinds: ["deletion_pending", "purge_imminent"],
  needsTenantBase: false,
  head: USER_TODOS_HEAD,
  richColumns: USER_TODOS_RICH_COLUMNS,
  leanColumns: USER_TODOS_LEAN_COLUMNS,
  from: USER_TODOS_FROM,
  richJoins: USER_TODOS_RICH_JOINS,
  where: USER_TODOS_WHERE,
  selectAll: "  select * from user_todos",
  unionAll: "  union all select * from user_todos",
};

/** 维护窗口没有租户：富化块与精简块同一段文本，也没有富化 join。 */
const MAINTENANCE_FRAGMENT: TodoCteFragment = {
  cteName: "maintenance_todos",
  kinds: ["maintenance_overdue"],
  needsTenantBase: false,
  head: MAINTENANCE_TODOS_HEAD,
  richColumns: MAINTENANCE_TODOS_COLUMNS,
  leanColumns: MAINTENANCE_TODOS_COLUMNS,
  from: MAINTENANCE_TODOS_FROM,
  richJoins: "",
  where: MAINTENANCE_TODOS_WHERE,
  selectAll: "  select * from maintenance_todos",
  unionAll: "  union all select * from maintenance_todos",
};

/** 认证：自 2026-10-04 起有自己的片段，不要底座（见 VERIFICATION_TODOS_HEAD 那一段）。 */
const VERIFICATION_FRAGMENT: TodoCteFragment = {
  cteName: "verification_todos",
  kinds: ["verification"],
  needsTenantBase: false,
  head: VERIFICATION_TODOS_HEAD,
  richColumns: VERIFICATION_TODOS_RICH_COLUMNS,
  leanColumns: VERIFICATION_TODOS_LEAN_COLUMNS,
  from: VERIFICATION_TODOS_FROM,
  richJoins: VERIFICATION_TODOS_RICH_JOINS,
  where: VERIFICATION_TODOS_WHERE,
  selectAll: "  select * from verification_todos",
  unionAll: "  union all select * from verification_todos",
};

/** 风险：整段 CTE 是一块（只从底座投影），没有自己的 join。 */
const RISK_FRAGMENT: TodoCteFragment = {
  cteName: "risk_todos",
  kinds: ["risk"],
  needsTenantBase: true,
  head: RISK_TODOS_CTE,
  richColumns: "",
  leanColumns: "",
  from: "",
  richJoins: "",
  where: "",
  selectAll: "  select * from risk_todos",
  unionAll: "  union all select * from risk_todos",
};

const TICKET_FRAGMENT: TodoCteFragment = {
  cteName: "ticket_todos",
  kinds: ["ticket", "ticket_sla"],
  needsTenantBase: false,
  head: TICKET_TODOS_HEAD,
  richColumns: TICKET_TODOS_RICH_COLUMNS,
  leanColumns: TICKET_TODOS_LEAN_COLUMNS,
  from: TICKET_TODOS_FROM,
  richJoins: TICKET_TODOS_RICH_JOINS,
  where: TICKET_TODOS_WHERE,
  selectAll: "  select * from ticket_todos",
  unionAll: "  union all select * from ticket_todos",
};

/**
 * union 的顺序 = 今天这条 SQL 的顺序，不改（排序键在外层，但同键同序更好比对）。
 * 第三批的五段插在退款与租户底座之间，按域排（账务 → 订阅 → 发票 → 加油包 → 账号 → 维护）。
 */
const TODO_FRAGMENTS: readonly TodoCteFragment[] = [
  ORDER_FRAGMENT,
  REFUND_FRAGMENT,
  SUBSCRIPTION_FRAGMENT,
  INVOICE_FRAGMENT,
  ADDON_FRAGMENT,
  USER_FRAGMENT,
  MAINTENANCE_FRAGMENT,
  VERIFICATION_FRAGMENT,
  RISK_FRAGMENT,
  TICKET_FRAGMENT,
];

const TENANT_BASE_FRAGMENT = {
  head: TENANT_BASE_HEAD,
  richColumns: TENANT_BASE_RICH_COLUMNS,
  leanColumns: TENANT_BASE_LEAN_COLUMNS,
  from: TENANT_BASE_FROM,
  richJoins: TENANT_BASE_RICH_JOINS,
  where: TENANT_BASE_WHERE,
} as const;

/** 一段片段拼成整块 CTE 文本；空串片段直接跳过（风险那一段就一整块）。 */
function renderCte(
  fragment: {
    readonly head: string;
    readonly richColumns: string;
    readonly leanColumns: string;
    readonly from: string;
    readonly richJoins: string;
    readonly where: string;
  },
  includeApplicant: boolean,
): string {
  return [
    fragment.head,
    includeApplicant ? fragment.richColumns : fragment.leanColumns,
    fragment.from,
    includeApplicant ? fragment.richJoins : "",
    fragment.where,
  ]
    .filter((piece) => piece !== "")
    .join("\n");
}

/**
 * 导出仅为可测：进 union 的十段 CTE 各自的整块文本（不含 tenant_base 底座——它不进 union）。
 * union all 按位置对齐，多一列少一列就炸，所以单测拿它逐段核 TODO_COLUMN_ORDER。
 */
export function unionCteTexts(
  includeApplicant = true,
): ReadonlyArray<{ readonly name: string; readonly sql: string }> {
  return TODO_FRAGMENTS.map((fragment) => ({
    name: fragment.cteName,
    sql: renderCte(fragment, includeApplicant),
  }));
}

export interface BuildListOpsTodosSqlOptions {
  /** 不传 = 全部类别。 */
  readonly kinds?: readonly OpsTodoKind[] | undefined;
  /** 不传 = 带跨 schema 富化块（申报人 + 租户风险档）。 */
  readonly includeApplicant?: boolean | undefined;
}

/**
 * 按类别拼出这一次要跑的 SQL。**只把入选类别的 CTE 放进文本**——Postgres 对语句里
 * 出现过的每一个关系查权限，不管那一支会不会返回行（头注「为什么不是一条大 SQL」）。
 *
 * 导出仅为可测与拼装：片段都是静态整块，这里只决定拼哪几块、按什么顺序。
 */
export function buildListOpsTodosSql(
  options: BuildListOpsTodosSqlOptions = {},
): string {
  const kinds = options.kinds ?? null;
  const includeApplicant = options.includeApplicant !== false;
  const wanted = (kind: OpsTodoKind): boolean =>
    kinds === null || kinds.includes(kind);
  const chosen = TODO_FRAGMENTS.filter((f) => f.kinds.some(wanted));
  if (chosen.length === 0) {
    // 空选择拼不出合法 SQL。调用方（list）在此之前就该直接回空列表——
    // 抛出来比拼一条 `with todos as () select …` 的坏 SQL 好。
    throw new Error("ops-todos: 没有任何类别入选，拼不出 SQL");
  }

  const ctes: string[] = [];
  if (chosen.some((f) => f.needsTenantBase)) {
    ctes.push(renderCte(TENANT_BASE_FRAGMENT, includeApplicant));
  }
  for (const fragment of chosen) {
    ctes.push(renderCte(fragment, includeApplicant));
  }

  const union = chosen.map((fragment, index) =>
    index === 0 ? fragment.selectAll : fragment.unionAll,
  );

  return [
    "with",
    ctes.join(",\n"),
    ", todos as (",
    union.join("\n"),
    ")",
    LIST_OPS_TODOS_TAIL,
  ].join("\n");
}

/**
 * 全类别 + 带富化块的那一版——admin 待办页读的就是它。
 * 导出仅为可测与文档；告警作业读的是另外两拼（ALERT_KINDS 九类 / NOTICE_ONLY_KINDS，
 * 都不带富化块）。
 */
export const LIST_OPS_TODOS_SQL = buildListOpsTodosSql();

/**
 * 库里回来的一行；导出仅为可测。
 *
 * 前 29 列逐一对应 TODO_COLUMN_ORDER（各片段的投影），后三列由外层算出来
 * （见 LIST_OPS_TODOS_TAIL）：
 *   · `severity`           片段给的**基准档**，映射不用它，留着便于排查；
 *   · `escalate_from`      升档起点（null = waiting_since），只进外层算法，映射不用它；
 *   · `severity_effective` 升档后的那一档——`OpsTodo.severity` 取的是这一列；
 *   · `escalated` / `escalation_step` 升档位与级数。
 */
export interface OpsTodoRow {
  kind: string;
  subject_type: string;
  subject_no: string;
  /** 身份列：null = 身份就是 subject_no（见 TODO_COLUMN_ORDER 头注）。 */
  subject_key: string | null;
  order_no: string | null;
  tenant_no: string | null;
  tenant_name: string | null;
  tenant_type: string | null;
  tenant_status: string | null;
  tenant_region: string | null;
  tenant_industry: string | null;
  tenant_scale: string | null;
  tenant_risk_level: string | null;
  applicant_name: string | null;
  applicant_email: string | null;
  applicant_phone: string | null;
  amount_value: string | null;
  amount_paid: string | null;
  amount_currency: string | null;
  product_code: string | null;
  product_name: string | null;
  plan_name: string | null;
  severity: string;
  priority: number | string;
  waiting_since: Date | string;
  escalate_from: Date | string | null;
  ticket_title: string | null;
  ticket_priority: string | null;
  ticket_status: string | null;
  severity_effective: string;
  escalated: boolean;
  escalation_step: number | string;
}

/** 外层算出来、不属于任何片段投影的那三列；单测拿它核 OpsTodoRow 的字段面。 */
export const TAIL_COMPUTED_COLUMNS: readonly string[] = [
  "severity_effective",
  "escalated",
  "escalation_step",
];

const KIND_SET: ReadonlySet<string> = new Set(OPS_TODO_KINDS);

function isKind(value: string): value is OpsTodoKind {
  return KIND_SET.has(value);
}

function toIso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function severityOf(value: string): OpsTodoSeverity {
  if (value === "rose" || value === "amber" || value === "blue") return value;
  // SQL 只会产这三个词；到这里说明谓词被改坏了，抛出比静默降档好。
  throw new Error(`ops-todos: 未知严重度 ${value}`);
}

/**
 * 进度键：订单三类各一档；退款一档；租户两类各一档；工单按库里的状态分两档。
 * 这层映射与 kind 一一对应，所以放在 TS 而不是 SQL——SQL 里再写一遍只是重复。
 *
 * 工单：`in_progress` / `pending` 是「有人在处理」，`open` / `reopened` 是「还没人接」
 * （72_support.sql 的 CHECK 里，未结的就这四个值——resolved / closed / cancelled
 * 已被谓词排除）。`ticketBlocked` 没有来源，见 types.ts 那一段。
 */
function progressOf(
  kind: OpsTodoKind,
  ticketStatus: string | null,
): OpsTodoProgress {
  switch (kind) {
    case "confirm_payment":
      return "pendingVerify";
    case "reprovision":
      return "paidUnprovisioned";
    case "follow_up_balance":
      return "partialPending";
    case "order_pending_payment_aging":
      return "orderAging";
    case "refund_audit":
      return "refundAudit";
    case "refund_execute":
      return "refundExecute";
    case "refund_processing_stuck":
      return "refundProcessing";
    case "refund_failed":
      return "refundFailed";
    case "subscription_overdue":
      return "subscriptionOverdue";
    case "invoice_applying":
      return "invoiceApplying";
    case "invoice_approved":
      return "invoiceApproved";
    case "addon_pending_confirm":
      return "addonPendingConfirm";
    case "verification":
      return "verification";
    case "risk":
      return "risk";
    case "ticket":
      return ticketStatus === "in_progress" || ticketStatus === "pending"
        ? "ticketProcessing"
        : "ticketOpen";
    case "ticket_sla":
      return "ticketSla";
    case "maintenance_overdue":
      return "maintenanceOverdue";
    case "deletion_pending":
      return "deletionPending";
    case "purge_imminent":
      return "purgeImminent";
  }
}

/**
 * 地址栏走可读码——任何路由都不出 UUID。回 null = **这个平面里没有这一页**
 * （只有 maintenance_overdue：出路在 opera，见 types.ts 的 href 注释）。
 */
function hrefOf(row: OpsTodoRow, kind: OpsTodoKind): string | null {
  switch (kind) {
    case "confirm_payment":
    case "reprovision":
    case "follow_up_balance":
    case "order_pending_payment_aging":
      return `/orders/${encodeURIComponent(row.subject_no)}`;
    case "refund_audit":
    case "refund_execute":
    case "refund_processing_stuck":
    case "refund_failed":
      // 退款四类都在订单详情页的任务卡上办；退款单没找到订单时退回订单列表，不给死链。
      return row.order_no
        ? `/orders/${encodeURIComponent(row.order_no)}`
        : "/orders";
    case "subscription_overdue":
      // 订阅详情路由双接受订单号；没有当前订单（subject 退回工作空间号）时只给列表页
      // ——工作空间号不是那条路由认的键，拼上去就是 404。
      return row.order_no
        ? `/subscriptions/${encodeURIComponent(row.order_no)}`
        : "/subscriptions";
    case "invoice_applying":
    case "invoice_approved":
      return "/invoices";
    case "addon_pending_confirm":
      return "/addon-orders";
    case "verification":
      return "/verifications";
    case "risk":
      return `/tenants/${encodeURIComponent(row.subject_no)}`;
    case "ticket":
    case "ticket_sla":
      return `/tickets/${encodeURIComponent(row.subject_no)}`;
    case "deletion_pending":
    case "purge_imminent":
      return `/accounts/${encodeURIComponent(row.subject_no)}`;
    case "maintenance_overdue":
      return null;
  }
}

const SUBJECT_TYPES: ReadonlySet<string> = new Set<OpsTodoSubjectType>([
  "order",
  "refund",
  "tenant",
  "ticket",
  "subscription",
  "invoice",
  "addon",
  "user",
  "maintenance",
]);

function subjectTypeOf(value: string): OpsTodoSubjectType {
  if (SUBJECT_TYPES.has(value)) return value as OpsTodoSubjectType;
  throw new Error(`ops-todos: 未知主体类型 ${value}`);
}

/** 导出仅为可测：一行 → 一条待办，纯函数。 */
export function mapOpsTodoRow(row: OpsTodoRow): OpsTodo {
  if (!isKind(row.kind)) {
    throw new Error(`ops-todos: 未知待办类别 ${row.kind}`);
  }
  const kind = row.kind;
  const priority =
    typeof row.priority === "number" ? row.priority : Number(row.priority);
  const todo: OpsTodo = {
    /*
     * id = 类别 + **身份**，不是类别 + 称呼。`subject_key` 为 null 的类别（十九类里的
     * 十八类）身份就是可视码；维护窗口的称呼（窗口标题）不唯一，身份是窗口主键。
     * 这个值只当身份用——React key、告警去重键——**不上屏**，也不进 href / subject.no。
     */
    id: `${kind}:${row.subject_key ?? row.subject_no}`,
    kind,
    // 升档后的那一档（外层算的）。基准档在 row.severity 里，不进契约。
    severity: severityOf(row.severity_effective),
    priority,
    subject: { type: subjectTypeOf(row.subject_type), no: row.subject_no },
    tenant: row.tenant_name
      ? {
          no: row.tenant_no,
          name: row.tenant_name,
          type: row.tenant_type,
          status: row.tenant_status,
          riskLevel: row.tenant_risk_level,
          region: row.tenant_region,
          industry: row.tenant_industry,
          scale: row.tenant_scale,
        }
      : null,
    applicant:
      row.applicant_name || row.applicant_email || row.applicant_phone
        ? {
            name: row.applicant_name,
            email: row.applicant_email,
            phone: row.applicant_phone,
          }
        : null,
    amount:
      row.amount_value !== null
        ? {
            value: row.amount_value,
            currency: row.amount_currency ?? "CNY",
            paid: row.amount_paid,
          }
        : null,
    product:
      row.product_code && row.product_name
        ? {
            code: row.product_code,
            name: row.product_name,
            planName: row.plan_name,
          }
        : null,
    progress: progressOf(kind, row.ticket_status),
    waitingSince: toIso(row.waiting_since),
    href: hrefOf(row, kind),
    escalated: row.escalated === true,
    escalationStep:
      typeof row.escalation_step === "number"
        ? row.escalation_step
        : Number(row.escalation_step),
  };
  if (kind === "ticket" || kind === "ticket_sla") {
    return {
      ...todo,
      ticket: {
        title: row.ticket_title ?? "",
        priority: row.ticket_priority ?? "p2",
        status: row.ticket_status ?? "open",
      },
    };
  }
  return todo;
}

/**
 * 十二个时长阈值的兜底值（env 读不到 / 不是正整数时用）。
 * 与 types.ts 的 OpsTodoThresholds 注释逐条对应。六个新默认值是设计提议，owner 可调。
 */
export const DEFAULT_OPS_TODO_THRESHOLDS: OpsTodoThresholds = {
  confirmPaymentHours: 4,
  refundAuditHours: 24,
  reprovisionMinutes: 30,
  verificationDays: 3,
  refundExecuteHours: 24,
  refundProcessingHours: 24,
  refundFailedHours: 4,
  addonConfirmHours: 4,
  ticketSlaHours: 4,
  maintenanceOverdueMinutes: 30,
  orderAgingHours: 24,
  /* 2026-12-01 起 72：卡住的判据是「发起转账后多久没到账」，跨行到账 1–3 个工作日，4h 会把
     每一笔正常的银行转账都报成卡住（owner 决策 4）。两份 .env example 登记同一个默认值。 */
  refundStuckHours: 72,
};

/**
 * 阈值在**自己的单位**里的上限（分钟 ≈ 13.9 天、小时 ≈ 2.3 年、天 ≈ 55 年）。
 *
 * 上限由 SQL 定，不是口味：tail 里阈值是 `$n::int * 86400` 这样在 int4 里乘出来的秒数，
 * 24855 天（或 596523 小时）就溢出，Postgres 对**整条**查询报 integer out of range——
 * 页面打不开、作业轮轮失败，而这正是 positiveIntEnv 承诺不会发生的事。
 * 超过的按上限算（饱和）而不回兜底：配一个很大的值的意思是「很久 / 别升档」，
 * 回兜底会让它反而比默认更早升档。spec 里从 tail 的真文本解析出最大乘数，
 * 钉 MAX × 乘数 ≤ 2^31−1——谁往 tail 里加更大的乘数（按周？）那条就红。
 */
export const MAX_OPS_TODO_THRESHOLD = 20000;

/**
 * env 里的正整数；空 / 非数 / ≤0 一律用兜底，超过 MAX_OPS_TODO_THRESHOLD 按上限算
 * （都不抛：一个配歪的阈值不该让整页打不开）。
 */
function positiveIntEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw) || raw < 1) return fallback;
  return Math.min(Math.floor(raw), MAX_OPS_TODO_THRESHOLD);
}

/**
 * 本次要用的十二个阈值：env 为准，`overrides` 只给测试用。
 * 导出仅为可测与文档——两个调用方（页面、告警作业）都不传，读的是同一套值。
 * 这里出现的 env 名就是 check-ops-threshold-env-parity 对账两份 example 的词表。
 */
export function opsTodoThresholds(
  overrides: Partial<OpsTodoThresholds> = {},
): OpsTodoThresholds {
  const fromEnv: OpsTodoThresholds = {
    confirmPaymentHours: positiveIntEnv(
      "OPS_ESCALATE_CONFIRM_PAYMENT_HOURS",
      DEFAULT_OPS_TODO_THRESHOLDS.confirmPaymentHours,
    ),
    refundAuditHours: positiveIntEnv(
      "OPS_ESCALATE_REFUND_AUDIT_HOURS",
      DEFAULT_OPS_TODO_THRESHOLDS.refundAuditHours,
    ),
    reprovisionMinutes: positiveIntEnv(
      "OPS_ESCALATE_REPROVISION_MINUTES",
      DEFAULT_OPS_TODO_THRESHOLDS.reprovisionMinutes,
    ),
    verificationDays: positiveIntEnv(
      "OPS_ESCALATE_VERIFICATION_DAYS",
      DEFAULT_OPS_TODO_THRESHOLDS.verificationDays,
    ),
    refundExecuteHours: positiveIntEnv(
      "OPS_ESCALATE_REFUND_EXECUTE_HOURS",
      DEFAULT_OPS_TODO_THRESHOLDS.refundExecuteHours,
    ),
    refundProcessingHours: positiveIntEnv(
      "OPS_ESCALATE_REFUND_PROCESSING_HOURS",
      DEFAULT_OPS_TODO_THRESHOLDS.refundProcessingHours,
    ),
    refundFailedHours: positiveIntEnv(
      "OPS_ESCALATE_REFUND_FAILED_HOURS",
      DEFAULT_OPS_TODO_THRESHOLDS.refundFailedHours,
    ),
    addonConfirmHours: positiveIntEnv(
      "OPS_ESCALATE_ADDON_CONFIRM_HOURS",
      DEFAULT_OPS_TODO_THRESHOLDS.addonConfirmHours,
    ),
    ticketSlaHours: positiveIntEnv(
      "OPS_ESCALATE_TICKET_SLA_HOURS",
      DEFAULT_OPS_TODO_THRESHOLDS.ticketSlaHours,
    ),
    maintenanceOverdueMinutes: positiveIntEnv(
      "OPS_ESCALATE_MAINTENANCE_OVERDUE_MINUTES",
      DEFAULT_OPS_TODO_THRESHOLDS.maintenanceOverdueMinutes,
    ),
    orderAgingHours: positiveIntEnv(
      "OPS_ORDER_AGING_HOURS",
      DEFAULT_OPS_TODO_THRESHOLDS.orderAgingHours,
    ),
    refundStuckHours: positiveIntEnv(
      "OPS_REFUND_STUCK_HOURS",
      DEFAULT_OPS_TODO_THRESHOLDS.refundStuckHours,
    ),
  };
  const merged = { ...fromEnv, ...overrides };
  for (const [key, value] of Object.entries(merged)) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`ops-todos: 阈值 ${key} 必须是正整数，收到 ${value}`);
    }
  }
  return merged;
}

/**
 * 十五个绑定参数，位置即 $1..$15：
 *   $1 类别 / $2 最短停留 / $3 limit /
 *   $4 confirm_payment h / $5 refund_audit h / $6 reprovision min / $7 verification d /
 *   $8 订单挂账成熟 h / $9 退款卡住成熟 h（也是 refund_processing_stuck 的升档起点）/
 *   $10 refund_execute h / $11 refund_processing_stuck h / $12 refund_failed h /
 *   $13 addon_pending_confirm h / $14 ticket_sla h / $15 maintenance_overdue min
 */
export type ListOpsTodosParams = [
  OpsTodoKind[] | null,
  number | null,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/** 调用方给的选项要先落到十五个绑定参数；坏值在这里抛，不进 SQL。 */
export function bindListOptions(
  options: ListOpsTodosOptions = {},
): ListOpsTodosParams {
  const kinds = options.kinds ? [...options.kinds] : null;
  if (kinds) {
    const bad = kinds.filter((k) => !isKind(k));
    if (bad.length > 0) {
      throw new Error(`ops-todos: 未知待办类别 ${bad.join(", ")}`);
    }
  }
  const minAge = options.minAgeMinutes ?? null;
  if (minAge !== null && (!Number.isInteger(minAge) || minAge < 0)) {
    throw new Error(`ops-todos: minAgeMinutes 必须是非负整数，收到 ${minAge}`);
  }
  const limit = options.limit ?? DEFAULT_LIST_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    throw new Error(
      `ops-todos: limit 必须是 1..${MAX_LIST_LIMIT} 的整数，收到 ${limit}`,
    );
  }
  const thresholds = opsTodoThresholds(options.thresholds ?? {});
  return [
    kinds,
    minAge,
    limit,
    thresholds.confirmPaymentHours,
    thresholds.refundAuditHours,
    thresholds.reprovisionMinutes,
    thresholds.verificationDays,
    thresholds.orderAgingHours,
    thresholds.refundStuckHours,
    thresholds.refundExecuteHours,
    thresholds.refundProcessingHours,
    thresholds.refundFailedHours,
    thresholds.addonConfirmHours,
    thresholds.ticketSlaHours,
    thresholds.maintenanceOverdueMinutes,
  ];
}

@Injectable()
export class OpsTodoRepository {
  // 必须显式 @Inject：BFF 打包走 esbuild，它**不产 emitDecoratorMetadata**。
  // 漏了不会在启动期抛，而是造出一个依赖为 undefined 的壳，第一次调用才 500。
  constructor(@Inject(OPS_TODOS_PG_POOL) private readonly pool: Pool) {}

  /**
   * 列待办。页面不带 minAge 全量取；告警作业按类别 + 停留时长 + limit 取，
   * 且传 `includeApplicant: false`（它的库角色碰不到 account / admin）。
   * 两个调用方读的是同一套片段、同一套排序——这正是「读同一份」的落点。
   */
  async list(options: ListOpsTodosOptions = {}): Promise<OpsTodo[]> {
    const params = bindListOptions(options);
    const kinds = params[0];
    // 明确要「零个类别」：不发查询（拼不出合法 SQL，也没有任何行可回）。
    if (kinds !== null && kinds.length === 0) return [];
    const sql = buildListOpsTodosSql({
      kinds: kinds ?? undefined,
      includeApplicant: options.includeApplicant,
    });
    // 参数个数恒为 15：$4..$15 全落在外层，外层每一拼都有（见文件头注）。
    const result = await this.pool.query<OpsTodoRow>(sql, params);
    return result.rows.map(mapOpsTodoRow);
  }
}
