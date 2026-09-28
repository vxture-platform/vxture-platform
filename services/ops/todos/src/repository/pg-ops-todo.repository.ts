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
 * ── 每一类的判据（逐条搬自页面，不改语义；只有 refund_audit 是新加）──
 *   confirm_payment    billing.orders.status = 'pending_verify'      rose / 2  / 等待自 declared_at
 *   reprovision        orders.status = 'paid'                        rose / 3  / 等待自 paid_at
 *   follow_up_balance  orders.status = 'pending_payment' 且最近账单 bill_status = 'partial'
 *                                                                    amber / 15 / 等待自 updated_at
 *                      （与 admin-bff orders.router 的 partial_pending 投影同一口径）
 *   refund_audit       billing.refunds.audit_status = 'pending' and refund_status = 'pending'
 *                                                                    rose / 2  / 等待自 refunds.created_at
 *   verification       tenancy.tenants.verification_status = 'pending'
 *                                                                    amber / 20 / 等待自最近一次认证提交
 *   risk               未复核风险记录最高档 <> normal 或 tenants.status = 'suspended'
 *                                                                    high/suspended → rose，否则 amber；
 *                                                                    high → 5，否则 25；等待自最近活跃 / 创建
 *   ticket             support.tickets 状态 <> 已结                   p0 或 reopened → rose，p1 → amber，
 *                                                                    否则 blue；p0 1 / p1 10 / p2 30 / p3 50；
 *                                                                    等待自 updated_at
 * 排序：严重度（rose < amber < blue）→ 优先级升序 → 等待起点升序（同一档里等得最久的排最前
 * ——这一页是排班表，不是动态流）。
 *
 * ── 为什么严重度 / 优先级也算在 SQL 里 ──
 * 告警作业要「最久的前 50 条」，minAge 与 limit 必须落在库里；而 limit 之前要排序，排序键
 * 就是严重度与优先级——所以它们不能等到 TS 再算。进度键 / 跳转路径 / id 只是对已选行的
 * 一一映射，留在 TS（便于单测）。
 *
 * ── 为什么不是一条大 SQL，而是按类别拼片段 ──
 * Postgres 对语句里**出现过的每一个关系**查权限，不管那一支会不会返回行、外层有没有把它
 * 的类别过滤掉。一条把七类全写进去的 SQL 会同时引用 `account.users` / `account.user_profiles` /
 * `kyc.tenant_verifications` / `admin.risk_records` / `session.auth_sessions` / `support.tickets` /
 * `tenancy.tenant_contacts`——而告警作业的库角色 `svc_platform_api` 只有 7 个 schema
 * （metering / product / sharing / provisioning / tenancy / billing / promotion，见
 * `deploy/database/ddl/97_service_roles.sql`）。那条 SQL 在本机（owner 连库）畅通无阻，
 * 到生产就是 `42501 permission denied for schema account`，整轮作业失败——而这正是那种
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
 * 参数全部绑定（$1 类别数组 / $2 最短停留分钟 / $3 limit），`$n is null` 写进谓词而不是
 * JS 拼 where——SQL 一旦插值，lint:anchor-writes 那一族静态守卫就读不懂它。
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
} from "../types";

/** 页面不传 limit 时的上限：此前页面拿的是 500 租户 + 全部订单 + 全部工单，2000 够用且有界。 */
export const DEFAULT_LIST_LIMIT = 2000;
export const MAX_LIST_LIMIT = 5000;

/**
 * 每个片段的投影列**逐一对齐**（union all 按位置对齐，多一列少一列就炸）。
 * 富化的四列（tenant_risk_level + applicant 三列）排在最后，好让「要 / 不要」
 * 换掉整块尾巴，中间的列一个都不用动。导出仅为可测。
 */
export const TODO_COLUMN_ORDER: readonly string[] = [
  "kind",
  "subject_type",
  "subject_no",
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

// ── order_todos：三类收款待办，按 case o.status 一分为三 ──────────────────────
export const ORDER_TODOS_HEAD = `order_todos as (
  select
    case o.status
      when 'pending_verify'  then 'confirm_payment'
      when 'paid'            then 'reprovision'
      when 'pending_payment' then 'follow_up_balance'
    end                                                    as kind,
    'order'::text                                          as subject_type,
    o.order_no                                             as subject_no,
    o.order_no                                             as order_no,
    t.tenant_no::text                                      as tenant_no,
    coalesce(nullif(t.display_name, ''), t.name)           as tenant_name,
    case when t.type = 'personal' then 'individual' else 'company' end as tenant_type,
    t.status                                               as tenant_status,
    coalesce(nullif(tp.address, ''), nullif(tp.country_code, '')) as tenant_region,
    nullif(tp.industry, '')                                as tenant_industry,
    nullif(tp.scale, '')                                   as tenant_scale,
    o.payable_amount::text                                 as amount_value,
    case when o.status = 'pending_payment' then inv.paid_amount::text end as amount_paid,
    o.currency                                             as amount_currency,
    p.product_code                                         as product_code,
    p.product_name                                         as product_name,
    pl.plan_name                                           as plan_name,
    case o.status
      when 'pending_verify' then 'rose'
      when 'paid'           then 'rose'
      else 'amber'
    end                                                    as severity,
    case o.status
      when 'pending_verify' then 2
      when 'paid'           then 3
      else 15
    end                                                    as priority,
    case o.status
      when 'pending_verify' then coalesce(o.declared_at, o.updated_at)
      when 'paid'           then coalesce(o.paid_at, o.updated_at)
      else o.updated_at
    end                                                    as waiting_since,
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

export const ORDER_TODOS_WHERE = `  where o.status in ('pending_verify', 'paid')
     or (o.status = 'pending_payment' and inv.bill_status = 'partial')
)`;

// ── refund_todos：待审核的退款单（2026-09-28 补的那一类）─────────────────────
export const REFUND_TODOS_HEAD = `refund_todos as (
  select
    'refund_audit'::text                                   as kind,
    'refund'::text                                         as subject_type,
    r.refund_no                                            as subject_no,
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
    2                                                      as priority,
    r.created_at                                           as waiting_since,
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

export const REFUND_TODOS_WHERE = `  where r.audit_status = 'pending' and r.refund_status = 'pending'
)`;

// ── tenant_base：认证 / 风险两类共用的租户底座 ───────────────────────────────
// 它天生跨 kyc / admin / session 三个 schema——认证提交时刻、风险档、最近活跃都在那边。
// 这两类**从不**被告警作业请求（check-ops-todo-alerts 的 UNRULED），所以底座整块只在
// verification / risk 入选时才拼进文本。
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
    t.verification_status,
    t.created_at,
    (
      select tv.created_at from kyc.tenant_verifications tv
       where tv.tenant_id = t.id
       order by tv.created_at desc
       limit 1
    )                                                      as verification_submitted_at,
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
      t.verification_status = 'pending'
      or t.status = 'suspended'
      or exists (
        select 1 from admin.risk_records rr
         where rr.tenant_id = t.id and rr.deleted_at is null
           and rr.reviewer_id is null and rr.risk_level <> 'normal'
      )
    )
)`;

// ── verification / risk：只是对底座的两次投影，没有自己的 join ────────────────
export const VERIFICATION_TODOS_CTE = `verification_todos as (
  select
    'verification'::text as kind, 'tenant'::text as subject_type, tenant_no as subject_no,
    null::text as order_no,
    tenant_no as tenant_no, tenant_name as tenant_name, tenant_type as tenant_type,
    status as tenant_status,
    region as tenant_region, industry as tenant_industry, scale as tenant_scale,
    null::text as amount_value, null::text as amount_paid, null::text as amount_currency,
    null::text as product_code, null::text as product_name, null::text as plan_name,
    'amber'::text as severity, 20 as priority,
    coalesce(verification_submitted_at, created_at) as waiting_since,
    null::text as ticket_title, null::text as ticket_priority, null::text as ticket_status,
    risk_level as tenant_risk_level,
    owner_name as applicant_name, owner_email as applicant_email, owner_phone as applicant_phone
  from tenant_base
  where verification_status = 'pending'
)`;

export const RISK_TODOS_CTE = `risk_todos as (
  select
    'risk'::text as kind, 'tenant'::text as subject_type, tenant_no as subject_no,
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
    null::text as ticket_title, null::text as ticket_priority, null::text as ticket_status,
    risk_level as tenant_risk_level,
    owner_name as applicant_name, owner_email as applicant_email, owner_phone as applicant_phone
  from tenant_base
  where coalesce(risk_level, 'normal') <> 'normal' or status = 'suspended'
)`;

// ── ticket_todos：未结工单 ───────────────────────────────────────────────────
export const TICKET_TODOS_HEAD = `ticket_todos as (
  select
    'ticket'::text                                         as kind,
    'ticket'::text                                         as subject_type,
    k.ticket_no                                            as subject_no,
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
      when k.priority = 'p0' or k.status = 'reopened' then 'rose'
      when k.priority = 'p1' then 'amber'
      else 'blue'
    end                                                    as severity,
    case k.priority when 'p0' then 1 when 'p1' then 10 when 'p2' then 30 else 50 end as priority,
    k.updated_at                                           as waiting_since,
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

export const TICKET_TODOS_FROM = `  from support.tickets k
  join tenancy.tenants t on t.id = k.tenant_id
  left join tenancy.tenant_profiles tp on tp.tenant_id = t.id`;

export const TICKET_TODOS_RICH_JOINS = `  left join lateral (
    select c.name from tenancy.tenant_contacts c
     where c.tenant_id = t.id and c.contact_type = 'primary'
     order by c.created_at asc
     limit 1
  ) pc on true`;

export const TICKET_TODOS_WHERE = `  where k.deleted_at is null
    and k.status not in ('resolved', 'closed', 'cancelled')
)`;

/** 外层：类别 / 停留时长过滤 + 排序 + limit。三个参数全绑定。 */
export const LIST_OPS_TODOS_TAIL = `select x.*,
       case x.severity when 'rose' then 0 when 'amber' then 1 else 2 end as severity_rank
  from todos x
 where ($1::text[] is null or x.kind = any($1::text[]))
   and ($2::int is null or x.waiting_since + make_interval(mins => $2::int) <= now())
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
  kinds: ["confirm_payment", "reprovision", "follow_up_balance"],
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
  kinds: ["refund_audit"],
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

/** 认证 / 风险：整段 CTE 是一块（只从底座投影），没有自己的 join。 */
const VERIFICATION_FRAGMENT: TodoCteFragment = {
  cteName: "verification_todos",
  kinds: ["verification"],
  needsTenantBase: true,
  head: VERIFICATION_TODOS_CTE,
  richColumns: "",
  leanColumns: "",
  from: "",
  richJoins: "",
  where: "",
  selectAll: "  select * from verification_todos",
  unionAll: "  union all select * from verification_todos",
};

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
  kinds: ["ticket"],
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

/** union 的顺序 = 今天这条 SQL 的顺序，不改（排序键在外层，但同键同序更好比对）。 */
const TODO_FRAGMENTS: readonly TodoCteFragment[] = [
  ORDER_FRAGMENT,
  REFUND_FRAGMENT,
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

/** 一段片段拼成整块 CTE 文本；空串片段直接跳过（认证 / 风险那两段就一整块）。 */
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
 * 导出仅为可测：进 union 的五段 CTE 各自的整块文本（不含 tenant_base 底座——它不进 union）。
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
 * 导出仅为可测与文档；告警作业读的是另一拼（三类 + 不带富化块）。
 */
export const LIST_OPS_TODOS_SQL = buildListOpsTodosSql();

/** 库里回来的一行；导出仅为可测。 */
export interface OpsTodoRow {
  kind: string;
  subject_type: string;
  subject_no: string;
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
  ticket_title: string | null;
  ticket_priority: string | null;
  ticket_status: string | null;
}

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
    case "refund_audit":
      return "refundAudit";
    case "verification":
      return "verification";
    case "risk":
      return "risk";
    case "ticket":
      return ticketStatus === "in_progress" || ticketStatus === "pending"
        ? "ticketProcessing"
        : "ticketOpen";
  }
}

/** 地址栏走可读码——任何路由都不出 UUID。 */
function hrefOf(row: OpsTodoRow, kind: OpsTodoKind): string {
  switch (kind) {
    case "confirm_payment":
    case "reprovision":
    case "follow_up_balance":
      return `/orders/${encodeURIComponent(row.subject_no)}`;
    case "refund_audit":
      // 「去审核」在订单详情页的任务卡上；退款单没找到订单时退回订单列表，不给死链。
      return row.order_no
        ? `/orders/${encodeURIComponent(row.order_no)}`
        : "/orders";
    case "verification":
      return "/verifications";
    case "risk":
      return `/tenants/${encodeURIComponent(row.subject_no)}`;
    case "ticket":
      return `/tickets/${encodeURIComponent(row.subject_no)}`;
  }
}

function subjectTypeOf(value: string): OpsTodoSubjectType {
  if (
    value === "order" ||
    value === "refund" ||
    value === "tenant" ||
    value === "ticket"
  ) {
    return value;
  }
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
    id: `${kind}:${row.subject_no}`,
    kind,
    severity: severityOf(row.severity),
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
  };
  if (kind === "ticket") {
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

/** 调用方给的选项要先落到三个绑定参数；坏值在这里抛，不进 SQL。 */
export function bindListOptions(
  options: ListOpsTodosOptions = {},
): [OpsTodoKind[] | null, number | null, number] {
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
  return [kinds, minAge, limit];
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
    const result = await this.pool.query<OpsTodoRow>(sql, params);
    return result.rows.map(mapOpsTodoRow);
  }
}
